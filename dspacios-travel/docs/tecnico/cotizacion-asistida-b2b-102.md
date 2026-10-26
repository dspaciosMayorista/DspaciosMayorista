# Cotización asistida B2B desde el carrito del Tarifario (#102 · migración 238)

> Estado: **código, migración y pruebas listos en rama; NADA aplicado en producción ni en Supabase remoto.** Orden de despliegue al final.
> Alcance: el recorrido operativo checkout → cotización → conversión → contrato → comisión / CxP / cobro / portal. Asientos y conciliación del
> recorrido B2B nuevo siguen siendo C (con #43), sin doble contabilización: se reutilizan los mismos asientos de abonos, CxP y facturación.

## 1. Qué resuelve

Al cotizar un carrito del Tarifario con un usuario interno, solo se podía escoger asesor: `convertirCotizacionCarrito` fijaba `tipoAsesor: "interno"`,
`aliadoId: null`, `canal: "B2C"`. Ahora el personal de Mayorista elige **cliente final (B2C)** o **aliado identificado (B2B)** y, en B2B, la modalidad
**PVP con comisión** o **NETO**. El contrato nace del mismo canal que la cotización. El navegador solo **elige** (id del aliado y modalidad); quién asiste,
quién es el beneficiario, el porcentaje, la base y los totales los resuelve el servidor.

## 2. Reglas (fuente única; no se inventó ninguna fórmula)

| Concepto | Regla | Dónde |
|---|---|---|
| Base comisionable | `máximo(PVP − impuesto, 0)` | `baseComisionableB2B` (`lib/calc/finanzas.ts`) |
| Porcentaje | propio del aliado; si es `NULL`, parámetro general de su tipo (`COMISION_AGENCIA`/`COMISION_FREELANCE`); si falta, 12 % / 11 %. Un **0 explícito se respeta** | `pctComisionAliado` (`lib/finanzas/comisionB2B.ts`), espejo de `registrar_comision_b2b_reserva` (205) |
| Comisión | `Math.round(base × %)` | `planComisionReserva` (`lib/reservar/comisionReserva.ts`) |
| PVP con comisión | el comprador paga el PVP; la comisión queda `pendiente` | `comision_estado = 'pendiente'` |
| NETO | exigible = PVP − comisión; la comisión queda `descontada` y no se puede pagar otra vez ni agregar otra | `comision_estado = 'descontada'`; triggers de la 205 |

## 3. Quién puede asistir

Lista **explícita** (`ROLES_ASISTENCIA_B2B`, `lib/cotizacion/asistidaB2B.ts`): `superadmin`, `gerencia`, `administracion`, `operaciones`, `venta`.
**No** se deriva de `ROLES_INTERNOS` (incluiría `control_vuelo`); hay una prueba de cableado que lo impide. Además: usuario **activo**, y agencia
**Mayorista** (el carrito es exclusivo de Mayorista; solo `superadmin` cruza). `venta` conoce los términos comerciales de la cotización (aliado, %,
comisión, total exigible) y elige PVP/NETO, sin acceso nuevo a costos ni márgenes: el plan no lleva ningún costo, y `venta` ya leía `aliados` y los parámetros.
Un aliado B2B logueado conserva su flujo de siempre: si manda `asistencia` se rechaza (no se "asiste" a sí mismo).

El **autor** (empleado) y el **beneficiario** (aliado) van por separado: `payload.b2bAsistido.asistido_por` (id, correo, rol) y `aliado_id`/`aliado_nombre`. El sello
`cotizaciones.creado_por_id` lo estampa el mecanismo de personas de #42 (best-effort, igual que antes). `cotizaciones.aliado_id` NO se usa: un trigger de la 211 lo
reserva a la RPC de comparativas.

## 4. Dónde está cada pieza

| Pieza | Archivo |
|---|---|
| Reglas puras (roles, entrada, aliado, % y origen, plan, relectura, comparación congelado/vivo, plan por contrato, dato externo) | `lib/cotizacion/asistidaB2B.ts` |
| Resolución en servidor (actor, aliado vigente, lista del selector, aliado vivo al convertir) | `lib/cotizacion/asistidaB2BServidor.ts` |
| Crear la cotización, acción `getContextoAsistenciaB2B`, mensaje interno | `app/tarifario/checkout/actions.ts` (`crearSolicitudReserva`, `crearCotizacionCarrito`) |
| Selector «Tipo de venta» y resultado | `app/tarifario/checkout/page.tsx`, `components/cotizacion/TerminosB2BAsistido.tsx` |
| Convertir (barreras antes de numerar, contrato B2B, comisión, candado) | `app/(dashboard)/dashboard/reservar/actions.ts` (`convertirCotizacionCarrito`) |
| Ficha interna y vista previa de la conversión | `app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx`, `ConvertirCarritoBtn.tsx` |
| Documentos externos (imprimible y enlace público) | `app/cotizacion/[id]/page.tsx`, `app/cot/[token]/page.tsx` |
| Desactivar aliados | `app/(dashboard)/dashboard/aliados/` (columna «Activo») |
| Migración y scripts | `supabase/migrations/20260601000238_cotizacion_asistida_b2b.sql`, `supabase/scripts/{preflight,postcheck,rollback}_238_cotizacion_asistida_b2b.sql`, `test_238_asistida_b2b.sh` |

## 5. Flujo

1. **Crear.** `crearSolicitudReserva` lee `asistencia` (solo `{canal, aliadoId, modo}`), autoriza al actor, lee el aliado del catálogo (activo, agencia/freelance, % y de dónde sale)
   **antes** de crear nada. El motor liquida cada hotel/servicio; cada unidad aceptada aporta una **línea** (`item-N` = `ref` estable del ítem; `tour-N` = posición en `payload.tours`) con su PVP e
   impuesto (BNC). `construirPlanB2B` suma, calcula la comisión y **congela** todo en `cotizaciones.payload.b2bAsistido` (PVP, impuesto, base, % y origen, comisión, estado, total exigible, líneas, autor).
2. **Documentos.** La ficha interna muestra todo (`TerminosB2BAsistido`). Los documentos del comprador **no** leen `payload`: reciben solo `detalle.b2bExterno.netoTotalExigible` y, en NETO,
   `ContratoDocumento` prorratea los valores por ítem a NETO (sin PVP original ni comisión; regla de #30). En PVP con comisión el documento es el de siempre.
3. **Convertir.** Antes de numerar: se relee y valida el bloque (presente pero ilegible o inconsistente ⇒ error, **nunca** se convierte como B2C); el actor debe estar en la lista; el aliado vivo debe ser el
   congelado (existe, activo, mismo tipo, **mismo %**); **cobertura exacta**: las claves de las unidades de TODOS los grupos (`it.ref` de cada hotel y `tour-N` de cada tour, ya convertidos o pendientes, sumadas entre
   grupos) deben coincidir **una sola vez** con las líneas congeladas (`verificarCoberturaLineasB2B`; una unidad faltante, repetida o ajena ⇒ `MENSAJE_COTIZACION_B2B_INVALIDA`; en un reintento se vuelve a
   verificar el conjunto completo, también con los grupos ya convertidos); cada unidad debe valer exactamente lo congelado (PVP e impuesto) y la moneda coincidir. Cualquier diferencia de valor ⇒
   `MENSAJE_TERMINOS_CAMBIARON`, sin número ni escrituras.
   **Regla de PVP de los tours:** el PVP de un tour se **congela al cotizar** (es el `precio` de `payload.tours[]` y su línea `tour-N`) y la conversión NO lo re-liquida contra el catálogo — igual que en la conversión
   B2C, donde `t.precio` es lo cobrado. Un cambio posterior del catálogo (precio vigente) no rechaza la conversión ni mueve el PVP ni la comisión; lo que sí se re-liquida en vivo es el **costo** del tour (CxP al
   proveedor). Es distinto de los hoteles, cuyo PVP se re-liquida y, si cambió, rechaza. Alterar el `precio` del tour en el payload tampoco sirve: ya no coincide con la línea congelada (y el bloque congelado no se
   puede editar, ver §6).
4. **Contrato.** `ventas` nace `canal 'B2B'`, `tipo_asesor` = tipo del aliado, `modo_compra`, `comision_b2b`, `comision_estado`, `impuesto`, `aliado_id`, nombre de agencia/freelance, y `precio_venta` = **exigible**
   (el total de cobro/`moneda_cobro` se convierte desde ese importe). Justo después, `registrar_comision_b2b_reserva` (205, SECURITY DEFINER) crea la fila de `aliados_b2b` recalculando con la misma regla; si falla, el
   contrato del grupo se revierte completo. CxP, costos y asientos siguen como siempre (no dependen de la comisión).
5. **Por destino.** Cada contrato calcula su plan con el % y la modalidad **congelados** sobre sus propias unidades. Un contrato por todo coincide exactamente con el congelado; con varios, cada uno redondea su
   comisión (diferencia máxima de medio peso/dólar por contrato frente a la suma congelada).

## 6. Migración 238 (aditiva)

- `aliados.activo boolean not null default true`: el catálogo no tenía estado. Las filas existentes quedan activas. Solo la venta asistida lo exige; no afecta contratos ni comisiones ya creados.
- `ventas.cotizacion_origen_id` + `ventas.grupo_conversion` (nullable) con **índice único parcial**: una cotización convierte **una vez** cada grupo. Cierra el doble envío simultáneo (antes dos conversiones
  paralelas creaban dos contratos; en B2B además dos comisiones): el segundo choca con `23505` **antes** de escribir pasajeros, comisión o CxP. Si un contrato se revierte por una falla, su fila desaparece y
  el reintento queda libre. Solo la conversión B2B escribe las marcas (un B2C queda como estaba; su carrera previa NO se corrigió: fuera de alcance).
- **Frontera del plan congelado:** disparador `trg_cot_b2b_asistido_inmutable` (BEFORE UPDATE, por fila) sobre `cotizaciones`: rechaza (`42501`, `B2B_ASISTIDO_INMUTABLE`) cualquier cambio de
  `payload -> 'b2bAsistido'` — borrarlo (la conversión lo leería como B2C), reescribirlo con otro %/modalidad (un bloque rehecho con coherencia lo aceptaría el código) o agregarlo a una cotización B2C (saltaría la
  autorización del actor, que solo se evalúa al crear). La política «cotizaciones: actualizar» deja a cualquier rol comercial (incl. `venta`) hacer PATCH del payload; esto cierra ese hueco para todos los roles,
  incluido `service_role` y el superusuario (mantenimiento: `ALTER TABLE … DISABLE TRIGGER`). Mientras la cotización lleve el bloque también quedan congeladas sus **unidades económicas** (`payload.items`, `payload.tours`, `payload.serviciosIncluidos`): las líneas `item-N`/`tour-N` y el PVP solo describen un precio, no QUÉ se vende, y sin esto un PATCH podía cambiar `servicioId`/`paqueteId`/`nombre`/`destino` de `payload.tours[0]` manteniendo `tour-0` y el PVP, y la conversión creaba un contrato o una CxP distintos de lo cotizado (probado F6). No bloquea nada operativo (cliente, pasajeros, otras llaves, progreso y estado de la conversión: `detalle` (progreso y cobro de la conversión), `estado`, `numero_contrato`,
  `vigencia_hasta`, el resto del `payload` (p. ej. el alta de personas, que hace `jsonb_set` de otras llaves) y reescribir el mismo bloque o las mismas unidades pasan como siempre).
- No agrega `tenant` a `aliados` (catálogo global por diseño) y no toca RLS ni datos. Su única función es la del disparador anterior.
- **Orden:** preflight (UNA consulta) → 238 → postcheck (UNA consulta) → recién después el código. Sin la 238 la venta B2B asistida y `/dashboard/aliados` fallan con mensaje explícito; el B2C no cambia.
- Rollback: `rollback_238_cotizacion_asistida_b2b.sql` (se niega si hay aliados inactivos).

## 7. Pruebas

| Capa | Archivo | Cómo se corre |
|---|---|---|
| Reglas puras | `pruebas/cotizacionAsistidaB2B102.test.ts` | `npm run test:unit` |
| Servidor con cliente falso | `pruebas/cotizacionAsistidaB2B102.servidor.test.ts` | `npm run test:unit` |
| Cableado (orden de barreras, cobertura antes de numerar, autoridad, documentos) | `pruebas/cotizacionAsistidaB2B102.wiring.test.ts` | `npm run test:unit` |
| React (checkout, panel, vista previa de conversión, documento NETO, catálogo) | `pruebas/cotizacionAsistidaB2B102.react.ts`, `…documentos.react.ts` | `npm run test:react` |
| **Recorrido integrado contra Postgres real** (checkout → conversión → comisión/CxP/cobro/portal, RLS real, candado, frontera SQL del plan congelado y de sus unidades F1-F8, reintento por destino G5, cobertura exacta G1-G4, regla de PVP de tours H1-H2) | `pruebas/cotizacionAsistidaB2B102.pg.ts` | `sh supabase/scripts/test_238_asistida_b2b.sh t102_x <contenedor> <plantilla>` (Docker local; plantilla con 001-237 — la 237 pide `auth.sessions` y `auth.jwt()`, que la imagen no trae: créalos como stub de entorno antes de aplicarla) |

## 8. Límites conocidos

- **Comparativas** (`modo=comparativa`) no soportan B2B asistido: el selector no aparece y la comparativa/hija se comporta como siempre (B2C).
- **Aliado logueado** (portal): su checkout sigue sin congelar términos en la cotización (solo mensaje); fuera de este alcance.
- **Catálogo sin tenant:** "aliado de otro tenant" no existe como dato; la frontera es el actor (Mayorista), la cotización (tenant fijo) y el contrato (tenant de la cotización).
- **Carrera en B2C:** la doble conversión simultánea de un carrito B2C sigue sin candado (no se tocó el flujo existente).
- **Número consumido:** el perdedor de una carrera reserva un consecutivo que queda sin usar.
- **Contabilidad (C):** sin cambios; la comisión descontada en NETO no genera asiento propio (el precio ya es neto), igual que los contratos NETO vigentes.
