# Ciclo de vida de la comisión B2B — ajuste de alcance compartido #97 ↔ #75

Redactado 2026-11-08. **Propuesta para decisión del dueño. No se implementó nada de la transición financiera**: ni la RPC 205, ni `p97_priv.aplicar`, ni `confirmar_venta` se tocaron en esta ronda. No hay SQL remoto, ni commit.

## 1. Regla indicada por el dueño (a respetar)
1. Cotización y contrato **pendiente**: se conservan aliado, porcentaje, BNC, recobro y el cálculo **informativo**.
2. Un pendiente **no** genera comisión exigible ni permite emitir cuenta de cobro.
3. **NETO**: se conserva el descuento pactado; no se crea una comisión adicional por pagar.
4. **Confirmación autorizada**: se materializa la comisión que corresponda **una sola vez**, sin recalcular en silencio el acuerdo.
5. Reintentos y concurrencia no pueden duplicarla.
6. **Un único responsable** de la transición entre #75 y #97 (no dos mecanismos).

## 2. Hechos verificados hoy (código y base local, no suposiciones)
| Tema | Hecho |
| --- | --- |
| Gancho de confirmación | Existe UNO en base: `public.confirmar_venta(p_numero)` (migración 197, `SECURITY INVOKER`, `update ventas set estado = 'confirmado'` + sillas, atómico). Lo llaman `confirmarVenta` (`reservar/actions.ts`, rol alto, manual) y `recalcularEstadoAbono` (`contratos/actions.ts`, automático al llegar el abono mínimo). **Ni #75 (284/285/287) ni #97 (286) la redefinen hoy.** |
| Estado de nacimiento | Reservar (tarifario): `pendiente`. Conversión de cotización dinámica: `pendiente`. Contrato **manual** (`crearContrato`): `activo` (los documentos ya lo tratan como confirmado). |
| Dónde nace hoy la fila exigible de `aliados_b2b` | (a) RPC 205 `registrar_comision_b2b_reserva` **al crear** (Reservar PVP; manual y negociado PVP de #97): `estado = 'pendiente'`. (b) `p97_priv.aplicar` **al convertir** una dinámica (#97): `pendiente`. (c) NETO: fila `pagada` con `descontada_en_precio = true` (no es por pagar). |
| Dónde se vuelve exigible/emitible | `resolverComisionB2B` permite cuenta de cobro por (i) la fila de `aliados_b2b` o (ii) la «vía 1» `ventas.comision_b2b` con `modo_compra = 'comisionable'` **aun sin fila**. No mira `ventas.estado`. El portal y `/dashboard/comisiones` listan como pendiente. |
| Interacción con #75 | El reuso exige contrato pendiente, nunca confirmado y **vacío**: la 287 bloquea si hay filas en cualquier tabla con `numero_contrato` (incluida `aliados_b2b`) o campos comerciales llenos (`comision_b2b`, `modo_compra`, `aliado_id`…). `aliados_b2b` es tabla **guardada** por la 284: toda escritura de la materialización debe viajar bajo la identidad declarada del contrato. |

Consecuencia: **hoy el diseño de #97 (y el flujo ya existente de Reservar) viola las reglas 2 y 4**: la comisión exigible nace en el pendiente. Cambiarlo es cambio de comportamiento también para Reservar (ya en `main`).

## 3. Propuesta (única) — un solo mecanismo, un solo responsable
**Responsable único propuesto: #97**, por ser dueño del modelo de comisión (acuerdo, liquidador, RPC 205, documentos). **#75 queda limitado a:** no redefinir `confirmar_venta`, no crear otro gancho de confirmación y garantizar que su guarda de identidad cubre la llamada. *(Alternativa legítima: #75 como dueño por poseer el ciclo de vida del contrato. Lo que no se acepta es que ambos editen `confirmar_venta`.)*

Mecanismo, sin construir todavía:
1. **Plan informativo, fuente única por contrato** (solo inserción y versionado, como el acuerdo): lo sellan la cotización (acuerdo, ya existe), la reserva y el contrato manual. Contiene aliado por id, %, BNC, recobro, participación, ordinaria y total. Mientras el contrato esté pendiente solo existe el plan.
2. **Pendiente:** se guarda el plan; **no** se inserta en `aliados_b2b`; las lecturas lo muestran como «comisión estimada, pendiente de confirmación», sin enlace de cobro.
3. **Confirmación:** `confirmar_venta` llama, al final de su transacción y solo en la transición pendiente → confirmado, a **una** función idempotente `materializar_comision_b2b(p_numero)`. Copia el plan sellado (`comision_valor` = ordinaria) y **no recalcula** con el catálogo de hoy.
4. **Una sola vez / concurrencia:** `FOR UPDATE` de `ventas` + unicidad por (contrato, aliado, origen plan) con `ON CONFLICT DO NOTHING`. La confirmación manual y la automática por abono se serializan en ese bloqueo: una materializa y la otra no hace nada.
5. **NETO:** el descuento vive en el precio; la fila `pagada/descontada` no es comisión por pagar. Se conserva tal cual (decisión a confirmar: si nace al crear o al confirmar).
6. **Gating de lectura:** el resolvedor y `comisionVisibleAliado`, `/dashboard/comisiones` y la liquidación exigen contrato confirmado para tratar la comisión como exigible o emitir cuenta de cobro.
7. **Edición antes de confirmar:** una nueva **versión explícita** del plan; se materializa la última. Nunca recalculo silencioso.

## 4. Qué NO se toca hasta aprobar este alcance
- #97: no modifica RPC 205, `p97_priv.aplicar`, `confirmar_venta` ni la 286 (sin aplicar remotamente; **no aplicarla hasta cerrar esto**, porque `aplicar` hoy crea la fila exigible).
- #75: no toca comisiones ni `confirmar_venta`.
- Siguen válidos y sin reabrir: precisión numérica, redondeo, identidad e `INT97-75`.

## 5. Decisiones que necesito del dueño
1. ¿Responsable único: **#97** (propuesto) o #75?
2. Contrato **manual** (nace `activo`): ¿materializa al crear (ya es confirmado) o exige un paso de confirmación?
3. «Confirmación autorizada» = `confirmar_venta`: ¿vale tanto la manual (rol alto) como la automática por abono mínimo?
4. Reversión: si una confirmación se deshace o el contrato se anula, ¿qué pasa con la fila ya materializada (conservar, anular, ajustar)?
5. Reservar/tarifario (en producción): ¿se acepta cambiar su comportamiento y cómo se tratan las filas pendientes ya existentes (sin recalcular)?
6. NETO: ¿la fila descontada nace al crear (como hoy) o al confirmar?

## 6. Impacto en pruebas ya hechas (se rehacen tras decidir)
`V97-*`, `N97-*`, `Q97-*`, `F2`, `T2` y `DOC97-1` asumen la fila al crear/convertir; `INT97-75` ejercita la RPC 205 en la ventana de creación. Se reescriben contra el nuevo punto de materialización. El parche de integración con #75 (`integracion-97-con-75.diff`) y `INT97-75` se conservan.

## 7. Decisiones definitivas del dueño y estado (2026-11-08, posterior)
1. **Responsable:** #75 implementa la transición (`confirmar_venta`, confirmación por abono, estados de nacimiento); #97 entrega el plan y `materializar_comision_b2b`. Una tabla de plan (`comision_plan`) y una función de materialización.
2. **Manuales nacen pendientes** (parte de #75); no se modifican estados históricos.
3. **Confirmación:** valen la interna y el pago que alcance el mínimo; atómica e idempotente.
4. **Comisión:** pendiente = informativa, sin comisión exigible ni cuenta de cobro; al confirmar se materializa el plan conservado, sin recalcular; el respaldo `ventas.comision_b2b` no cobra saltándose el estado.
5. **NETO:** descuento desde la creación; nunca segunda comisión ni cuenta de cobro.
6. **Reservar e históricos:** nuevos contratos alineados; históricas no se borran, recalculan ni desactivan; se diagnostican y no se duplican.
7. **Reversión/anulación:** sin borrar obligaciones ni pagos; la política contable queda fuera hasta presentarla al dueño.

**Estado:** implementado por #97 en la 286 (ver `comision-asistida-97.md` §11). #75 ya llama a `materializar_comision_b2b` desde su 288. **Pendientes de #75:** (los manuales de Mayorista ya nacen siempre pendientes, regla de #75 en su código; el ciclo debe estar encendido antes de desplegarlo); arreglar los 2 errores de tipos de `obligacionesAlConfirmar288.test.ts`; aplicar el parche de tres llamadas al fusionar. Las secciones 3 a 6 de este documento quedan como histórico de la propuesta.

## 8. Ajustes de identidad y de despliegue (posterior)
- El plan se liga por **`contrato_uid`** (identidad de #75), no por número ni por fecha: los planes huérfanos se conservan como evidencia y nunca se eligen.
- El ciclo es un **interruptor explícito** (`p97_priv.ciclo`) que solo se enciende con sus dependencias (identidad 284, guarda de `comision_plan`, gancho único 288); la regla comercial **no cambia según qué funciones existan**. El manual de Mayorista nace pendiente y el de Minorista conserva `activo` (regla de #75, independiente del interruptor); sin el ciclo encendido #97 rechaza el manual B2B de Mayorista antes de numerar (nunca lo marca activo).
- Un solo gancho de confirmación (de #75) y una sola función de materialización (de #97). Detalle y pruebas: `comision-asistida-97.md` §12.
