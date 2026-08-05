# Comisiones, Rentabilidad y Punto de equilibrio — hoja técnica

> Índice: [`README.md`](./README.md) · Relacionado: [`contabilidad.md`](./contabilidad.md)

Motor de P&L por contrato (`lib/calc/finanzas.ts`), su envoltorio de orquestación
(`lib/finanzas/rentabilidad.ts`), y los 3 módulos que lo consumen: Rentabilidad, Comisiones
(B2B) y Punto de equilibrio.

---

## 0. Aclaración de nombres: dos archivos, no uno

- **`lib/calc/finanzas.ts`** — las funciones puras/testeables reales (`calcComisionB2B`,
  `calcComisionAsesorBase`, `calcRentabilidad`, `fiscalFromParams`). El motor per-contrato de
  verdad.
- **`lib/finanzas/rentabilidad.ts`** — un wrapper de orquestación/lectura
  (`calcularRentabilidad()`) que trae filas de Supabase y llama a las funciones puras de arriba
  por contrato. Es la fuente ÚNICA usada por `/dashboard/rentabilidad` **y**
  `/dashboard/punto-equilibrio`, para que el margen neto sea idéntico en los dos módulos
  (confirmado por el comentario del propio archivo).

## 1. `calcularRentabilidad()` — `lib/finanzas/rentabilidad.ts`

```ts
async function calcularRentabilidad(): Promise<{
  filas: RentabilidadFila[]; margenNeto: number; margenBruto: number; totales; tasas;
}>
```

Flujo (para el tenant activo, vía `getTenant()`):
1. Trae `ventas` (filtrado `.eq("tenant", tenant)`), `aliados_b2b`, `facturacion`,
   `cuentas_por_pagar`, `asesores`, `contrato_facturacion` — **solo `ventas` tiene filtro
   explícito de tenant**; las otras 5 consultas NO lo tienen. El aislamiento entre
   mayorista/minorista funciona igual porque `numero_contrato` es único globalmente
   (minorista usa prefijo `MIN-`), así que los `Map` que unen por `numero_contrato` solo
   matchean filas del mismo tenant "por accidente correcto" — no es defensa en profundidad,
   solo funciona porque las claves no colisionan.
2. Carga `parametros_tributarios` (global, sin tenant) → `fiscalFromParams()`.
3. Conversión USD: factor = `trm_contrato` propio o `trm_referencia` de fallback.
4. Comisión B2B agregada por contrato vía `calcComisionB2B()`.
5. IVA generado/descontable: de `facturacion` (`base_gravable*IVA` / `iva_proveedor`); de
   `cuentas_por_pagar` clasificadas `"costo"` (suman IVA descontable) vs `"irt"` (se excluyen —
   "el IRT no descuenta IVA").
6. Si hay `contrato_facturacion`, `liquidarFacturacion()` da `baseProvisiones = ingreso_propio
   (PVP − IRT)` y sobreescribe el IVA generado con el valor calculado en vivo.
7. Llama `calcRentabilidad()` por contrato con `comAsesor` **hardcodeado a `0`** — ver hallazgo
   abajo.

### ⚠️ Hallazgo: `comAsesor` nunca se resta en Rentabilidad/Punto de equilibrio
`calcularRentabilidad()` fija `const comAsesor = 0;` — la comisión del asesor interno **nunca**
se descuenta en el cálculo de Rentabilidad/PE en vivo, aunque `calcComisionAsesorBase()` existe
como función pura y se usa (solo como estimado de display) en
`app/(dashboard)/dashboard/contratos/[numero]/page.tsx`. La liquidación real de comisión del
asesor interno vive en un módulo TOTALMENTE APARTE: `/dashboard/liquidacion` (§3.3), desacoplado
de Rentabilidad.

## 2. Fórmulas exactas — `lib/calc/finanzas.ts`

### `calcComisionB2B(i)`
```
base           = i.baseComisionable || pvp
comisionBase   = base × pctComision
recobroAliado  = recobroTotal × (pctRecobroAliado ?? 0.5)
totalComision  = comisionBase + recobroAliado
retencion      = aplicaRetencion ? totalComision × pctRetencion : 0    (sobre el TOTAL, no solo la base)
totalPagar     = totalComision − retencion
```

### `calcComisionAsesorBase()` (pura, NO usada en vivo por Rentabilidad/PE)
```
comisionBruta = max(0, precioVenta − impuesto/BNC) × pctBase (default 0.08)
retencion     = comisionBruta × RETENCION_HONORARIOS (default 0.11)
comisionNeta  = comisionBruta − retencion
```

### `calcRentabilidad()` — el P&L por contrato
```
ingreso      = PVP (IVA incluido)
costoNeto    = costoDirecto (total proveedor, IVA incluido)
utilBruta    = ingreso − costoNeto

baseProv     = baseProvisiones ?? ingreso     (= ingreso propio si hay facturación configurada)
provIca      = baseProv × ICA (1.0% sobre ingresos brutos/ingreso propio)
provBomberil = provIca × BOMBERIL (1.0% DEL VALOR DE ICA, no del ingreso directamente)
provFontur   = max(0, utilBruta) × FONTUR (2.5% sobre utilidad bruta, base nunca negativa)
provRenta    = baseProv × RETENCION_RENTA (3.5%, misma base que ICA)
totalProvisiones = provIca + provBomberil + provFontur + provRenta

ivaPorPagar  = ivaGenerado − ivaDescontable
utilNeta     = utilBruta − comB2B − comAsesor(=0 en vivo) − totalProvisiones − ivaPorPagar
margenNeto   = utilNeta / ingreso

clasificacion = margenNeto>=0.15 ? "Alta" : margenNeto>=0.08 ? "Media" : "Baja"
```

### `liquidarFacturacion()` (`lib/contabilidad/facturacion.ts`) — split IRT/IVA
```
baseGravable  = max(0, PVP − IRT − ingresoExento)
ingresoPropio = baseGravable + ingresoExento   (= PVP − IRT)
baseNeta      = baseGravable / (1+ivaPct)
ivaGenerado   = baseGravable − baseNeta
```
Las provisiones (ICA/Bomberil/Renta) se calculan sobre **ingreso propio** cuando el contrato
tiene `contrato_facturacion` configurado; si no, sobre el PVP crudo. El IRT nunca genera IVA ni
provisiona.

## 3. Constantes fiscales — valores exactos confirmados

`lib/constants.ts`:
```ts
SMMLV = 1_750_905
SUBSIDIO_TRANSPORTE = 249_095
TRIBUTARIO = { ICA:0.01, BOMBERIL:0.01, FONTUR:0.025, RETENCION_RENTA:0.035,
  IMPUESTO_RENTA:0.35, IVA:0.19, RETENCION_HONORARIOS:0.11 }
```
`parametros_tributarios` (tabla, GLOBAL — sin columna `tenant`, compartida por mayorista y
minorista): mismos 6 valores sembrados + `IMPUESTO_RENTA=0.35` (migración 106, separado
explícitamente de `RETENCION_RENTA`: 3.5% es un anticipo/retención por contrato; 35% es el
impuesto de renta PyME sobre la renta líquida, usado solo en Estados de resultados, no por
contrato). También editables ahí: `COMISION_AGENCIA=0.12`, `COMISION_FREELANCE=0.11`,
`recobro_pct_aliado_b2b=0.5`, `trm_referencia`. Editable en vivo en Configuración → Parámetros
tributarios (`actualizarParametro`, solo toca `valor`/`updated_at`).

## 4. `/dashboard/rentabilidad`

- Roles: `superadmin/gerencia/administracion`. `force-dynamic`.
- **No hay tabla `rentabilidad`** — se calcula EN VIVO en cada request, sin snapshot ni
  trigger; cualquier cambio en costos/comisión B2B/parámetro fiscal se refleja de inmediato.
- Columnas: Contrato, Cliente, Asesor, Ingreso, Costo, Comisiones (B2B+asesor), Provisiones,
  IVA x pagar, Util. neta, Margen, Clase (badge Alta/Media/Baja).
- Fila expandible: waterfall completo Ingreso→−Costo→=Util.bruta→−ComB2B→−provisiones→−IVA
  →=Util.neta, + bloque IVA aparte, + PVP/TRM si es USD, + split IRT/ingreso propio/exento si
  aplica.

## 5. `/dashboard/comisiones` (B2B)

- Roles: `superadmin/gerencia/administracion`.
- Lee todas las `aliados_b2b` del tenant y re-deriva con `calcComisionB2B()` (misma función que
  Rentabilidad → consistencia garantizada).
- Lista "por definir": ventas `canal='B2B'`/`tipo_asesor` en agencia|freelance sin fila
  `aliados_b2b` todavía.
- **`aliados_b2b`**: `id, numero_contrato (FK ventas), aliado, nit, tipo_aliado, contacto,
  precio_venta, base_comision, pct_comision, recobro_total, pct_recobro_aliado,
  aplica_retencion, pct_retencion, estado, fecha_pago, tenant`. `estado`/`fecha_pago` son
  **vestigiales desde la migración 131** (no se borran, convención del proyecto, pero la app
  ya no los lee/escribe) — ver "Abonos" abajo.
- Acciones: `actualizarComisionB2B(id, {baseComision, pctComision, recobroTotal,
  pctRecobroAliado})` — revalida tanto `/dashboard/comisiones` como `/dashboard/rentabilidad`
  (editar aquí cambia directamente los números de Rentabilidad, porque ésta lee `aliados_b2b`
  en vivo). `pctComision` se puede ingresar en la UI por % directo o calculado hacia atrás desde
  un valor en pesos (`ComisionesList.tsx::FilaDetalle`, toggle "Ingresar por %"/"por valor").

### Abonos a comisión B2B (migración 131, `comision_b2b_pagos`)

Reemplaza el viejo "marcar pagada" todo-o-nada (`aliados_b2b.estado`/`fecha_pago`) por un log
ilimitado de pagos parciales, mismo patrón que `cxp_pagos` (130) / `retenciones_cxp` (125):
`comision_b2b_pagos(id, aliado_b2b_id FK, fecha, valor, tenant)`. Motivo: comisiones grandes que
se pagan en varios abonos, no de una sola vez.

- `lib/finanzas/pagosComisionB2B.ts`: `sumarPagosPorAliado()` (suma por `aliado_b2b_id`) +
  `estadoComisionB2B(totalPagar, pagado)` → `'pendiente'|'parcial'|'pagada'` (tolerancia de $1
  por redondeo de %). El estado ya NO se lee de `aliados_b2b.estado` — se deriva en
  `/dashboard/comisiones/page.tsx` en cada request, sumando `comision_b2b_pagos` por aliado.
- Acciones (`comisiones/actions.ts`): `registrarPagoComisionB2B(aliadoB2bId, valor, fecha)`
  (valida valor > 0) y `deshacerUltimoPagoComisionB2B(aliadoB2bId)` (borra el pago más reciente
  por fecha+id). Sin actualización de `aliados_b2b.estado` — el estado siempre se recalcula.
  **Fix (jul-2026):** el insert no estampaba `tenant` (mismo bug que ya se había corregido en
  `crearComisionB2B`/`crearCuentaPorPagar`) — quedaba en el default `'mayorista'`, así que un
  abono registrado viendo minorista pasaba la RLS (superadmin/gerencia ven ambos tenants) pero
  desaparecía de la consulta filtrada por tenant de `/dashboard/comisiones` (parecía que "no se
  guardaba nada"). Ahora toma el tenant de `aliados_b2b` del abono. Script de reparación:
  `supabase/scripts/backfill_comision_b2b_pagos_tenant.sql`.
- UI: `ComisionesList.tsx::PagoComisionPanel` dentro de la fila expandida — tabla de abonos +
  botón deshacer último + formulario (valor/fecha/"Registrar abono", con atajo "Saldo total").
  Badge de la fila: Pagada (verde) / Parcial · saldo $X (ámbar) / Pendiente (ámbar). El
  resumen de tarjetas (Total/Pagado/Pendiente) suma `min(pagado, totalPagar)` por fila, no el
  booleano de antes.
- Backfill (migración 131): toda comisión que ya estaba `estado in ('pagada','pagado')` se migró
  a un pago único por el total calculado (misma fórmula de `calcComisionB2B`), en la fecha que
  tenía en `fecha_pago`.

Ver §9 más abajo — la cuenta de cobro (`/portal/comision/[numero]`) ahora resuelve por dos vías
(flujo tarifario B2B en `ventas`, o `aliados_b2b` cuando ese flujo no aplica — único camino en
minorista) y `crearComisionB2B` captura `tipoAliado`.

### Estado de cuenta de abonos (`/portal/comision/[numero]/estado-cuenta`, jul-2026)

Documento separado de la cuenta de cobro (que muestra el TOTAL a cobrar, no cómo se ha ido
pagando) — pedido del dueño para poder llevar el historial de abonos de una comisión grande que
se paga en varias cuotas. Reutiliza `lib/finanzas/comisionResolver.ts::resolverComisionB2B()`
(extraído de la lógica que antes vivía solo en la página de cuenta de cobro — mismas dos vías,
mismo control de acceso) y, si `aliadoB2bId` no es `null` (solo vía 2 — la vía 1 del flujo
tarifario de mayorista no tiene log de abonos, `notFound()` en ese caso), trae
`comision_b2b_pagos` de esa comisión ordenados por fecha y calcula el saldo corrido tras cada
abono (mismo patrón que `lib/cuenta/estado.ts::cargarEstadoCuenta`, pero sobre comisiones en vez
de sobre el contrato del cliente). Usa `DocHeader`/`PRINT_DOC_STYLE` (branding por tenant, A4) en
vez del layout de la cuenta de cobro. Link cruzado en ambos sentidos: la cuenta de cobro linkea a
"Estado de cuenta →" (solo si `aliadoB2bId` existe) y `/dashboard/comisiones` (`ComisionesList.tsx`)
tiene el link directo junto a "Cuenta de cobro".

### Recobro (migración 086)
> RECOBRO = mayor valor cobrado que entra al total de la venta pero NO corresponde a ningún
> servicio y NO se le muestra al cliente.

`ventas.recobro_total/recobro_empresa/recobro_aliado`. B2C → 100% empresa. B2B → split por
`recobro_pct_aliado_b2b` (default 0.5, sugerido) o el `aliados_b2b.pct_recobro_aliado` puntual
(el realmente aplicado). `recobroAliado` se SUMA a `totalComision` en `calcComisionB2B()` — por
eso también entra como gasto en Rentabilidad.

## 6. Comisión de asesor interno — mecanismo real vs. columnas vestigiales

- **`asesores`**: `pct_comision_base` (SÍ se usa — pero solo para mostrar un estimado en el
  detalle del contrato, no en el cálculo vivo de Rentabilidad), `meta_mensual` (guardado,
  editable, **nunca leído** en ningún cálculo), `pct_sobre_meta` (definido en el schema, **cero
  usos** en toda la app — columna vestigial/muerta).
- **El mecanismo real de liquidación de comisión de asesor interno es `/dashboard/liquidacion`**
  (completamente aparte de Rentabilidad):
  - `usuarios.rol='venta'` con `escala_id`/`aplica_retencion`.
  - `escala_rangos (escala_id, pvp_desde, pvp_hasta, pct)` — escala escalonada.
  - `lib/calc/escalas.ts::comisionMes({sumaPvp, sumaBase, rangos, retHonorarios})`:
    ```
    pct  = pctParaPvp(sumaPvp, rangos)   // NO marginal — todo el PVP acumulado del mes usa UN % único
    bruta = round(sumaBase × pct/100)
    retencion = round(bruta × retHonorarios)  (default 0.11)
    neta = bruta − retencion
    ```
  - Agrupa ventas por `ventas.asesor_firma_nombre` del mes elegido (solo estados
    activo/confirmado/confirmada); base comisionable = PVP−impuesto(BNC), sumada por mes.
  - **Totalmente separado de/no alimenta `calcularRentabilidad()`** — coherente con que
    `comAsesor` esté hardcodeado a 0 ahí.

### Descuentos a la liquidación (migración 132, `liquidacion_descuentos`)

Caso real: un asesor le da un descuento al cliente que sale de su propia comisión (o cualquier
otro descuento puntual, con su motivo) — antes no había forma de reflejarlo, la neta del mes
salía siempre completa. `liquidacion_descuentos(id, usuario_id FK usuarios, mes 'YYYY-MM', valor,
descripcion, numero_contrato opcional, created_at)` — log ilimitado por asesor+mes, **no** por
contrato (puede no venir de ningún contrato puntual). Sin columna `tenant`: sigue el mismo
criterio ya existente de esta página, que agrupa `usuarios.rol='venta'` y `ventas` sin filtrar
por tenant (gap preexistente, no introducido por esta migración).

- `lib/finanzas/descuentosLiquidacion.ts::sumarDescuentosPorAsesor()`.
- Acciones (`liquidacion/actions.ts`): `agregarDescuentoLiquidacion({usuarioId, mes, valor,
  descripcion, numeroContrato?})` / `eliminarDescuentoLiquidacion(id)` — candado de rol adentro
  de la Server Action (`puedeEditar()`, mismo set superadmin/gerencia/administracion que gatea
  la página), no solo en el componente.
- UI: `page.tsx` pasó de tabla estática a `LiquidacionTable.tsx` (client component) — fila
  expandible por asesor con tabla de descuentos + formulario para agregar (valor + descripción +
  N° contrato opcional). Columna nueva "Descuentos" (rojo, − $X) y "Neta a pagar" =
  `max(0, neta − Σdescuentos)` reemplaza la vieja columna "Neta" (que ahora es un valor
  intermedio, antes de descuentos). Totales del footer también recalculados neto de descuentos.

## 7. `liquidacion_comisiones` — tabla en el schema, SIN uso real

Existe (`numero_contrato, asesor, mes_liquidacion, precio_venta, costo_total, com_b2b_pagada,
fecha_liquidacion, fecha_pago, estado`, + `tenant`) pero **no hay ningún INSERT/UPDATE/SELECT**
contra ella en toda la app fuera de los cascades de borrado de contrato
(`eliminar_contrato()`/migración 117) y un label de auditoría. Scaffolding legacy, superado en
la práctica por `/dashboard/liquidacion` (asesores) y `comision_b2b_pagos` (B2B, migración 131).

## 8. `/dashboard/punto-equilibrio`

- Roles: `superadmin/gerencia/administracion`.
- Trae `pe_empleados`/`pe_costos` (`.eq("activo",true).eq("tenant",tenantId)`) + llama
  `calcularRentabilidad()` para `margenNeto`/`margenBruto` y `ventasMes`/`contratosMes` del mes
  actual (match por `f.mes === mesActual`).

### Dashboard tab
```
totNomina   = Σ liquidar(empleado).costoTotal
totFijos    = Σ pe_costos donde clasificacion='fijo'
totalCubrir = totFijos + totNomina        (costos variables NO entran — el margen ya los neteó)
m           = margenEf/100                (margenNeto automático o override manual)
ventasMin   = round(totalCubrir/m)         (punto de equilibrio)
MARGEN_ERROR = 0.15                        (constante hardcodeada, buffer 15%)
metaMes     = round(ventasMin × 1.15)      ("ventas mínimas del mes")
```
El margen puede ser "automático" (idéntico a Rentabilidad) o manual (override para escenarios).

### Nómina — `lib/calc/nomina.ts`
```ts
TASAS_NOMINA = { salud:0.085, pension:0.12, sena:0.02, icbf:0.03, caja:0.04,
  prima:0.0833, cesantias:0.0833, interesesCesantias:0.01, vacaciones:0.0417 }
ARL = { I:0.00522, II:0.01044, III:0.02436, IV:0.0435, V:0.0696 }
UMBRAL_EXONERACION = 10×SMMLV = 17,509,050
```
```
auxilio = conAuxilio ? SUBSIDIO_TRANSPORTE : 0
baseP   = salario + auxilio
exonerado = declarante && 0 < salario < 10×SMMLV
salud = exonerado?0:salario×8.5% | pension=salario×12% | arl=salario×ARL[riesgo]
sena  = exonerado?0:salario×2%   | icbf=exonerado?0:salario×3% | caja=salario×4% (nunca exonerada)
prima=baseP×8.33% | cesantias=baseP×8.33% | interesesCesantias=baseP×1% | vacaciones=salario×4.17%
costoTotalMensual = salario+auxilio+seguridadSocial+parafiscales+prestaciones
```

### ⚠️ Hallazgo: exoneración por declarante hardcodeada a `true`, ignora el campo real
`PuntoEquilibrioClient.tsx::liquidar()` pasa `empresaDeclarante = true` SIEMPRE al llamar
`liquidarEmpleadoContrato`, para todo empleado tipo `'empleado'` — el campo real
`pe_empleados.declarante` (existe en BD, editable en el formulario) **no se lee** en este
cálculo; el checkbox del formulario siempre se guarda como `true` (`EmpleadoEditor.guardar()`
también lo hardcodea). Es decir: la exoneración Art. 114-1 E.T. (sin Salud/SENA/ICBF bajo 10
SMMLV) se asume SIEMPRE activa — el flag por-empleado en BD hoy es inerte para la nómina.

`tipo:'servicios'` (prestación de servicios) salta toda esta cuenta — se cuenta a valor de cara
(sin seg. social/prestaciones).

## 9. Gate cuenta de cobro (freelance) vs. factura electrónica (agencia)

Doble candado sobre `ventas.tipo_asesor` (`"interno"|"agencia"|"freelance"`):
1. **`app/portal/b2b/page.tsx`**: solo `tipo_asesor==='freelance'` muestra el link "Cuenta de
   cobro →"; `tipo_asesor==='agencia'` muestra el texto "Factura electrónica".
2. **`app/portal/comision/[numero]/page.tsx`**: si `tipo_asesor==='agencia'` (y el visor no es
   interno), bloquea con mensaje explicativo — las agencias (persona jurídica) deben facturar
   electrónicamente, no generan cuenta de cobro.

`tipo_asesor` se fija en `crearContrato()` según `input.tipoVenta`; el bloque `if (aliado)` al
final de esa función es el gate exacto de si el contrato crea o no una fila `aliados_b2b` — una
venta `interno` (B2C) NUNCA crea `aliados_b2b`, sin importar el tenant.

### Cuenta de cobro — dos vías (jul-2026)

El punto 2 de arriba dependía de `ventas.modo_compra==='comisionable' && ventas.comision_b2b`
(columnas que solo se llenan en `dashboard/reservar/actions.ts`, flujo tarifario/reservar B2B).
Ese flujo **solo existe en mayorista** — minorista no tiene tarifario/reservar
(`minoristaOculto: true`). Toda comisión de minorista (y las agregadas a mano en mayorista desde
`crearComisionB2B`) vive en `aliados_b2b`, sin tocar esas columnas de `ventas` — la página
quedaba con `notFound()` siempre para esos casos, aunque la comisión existiera y se viera bien
en `/dashboard/comisiones` o en la pestaña Comisiones del contrato.

`app/portal/comision/[numero]/page.tsx` ahora intenta **vía 1** (la de siempre,
`modo_compra==='comisionable' && comision_b2b`, datos de `ventas`) y si no aplica cae a
**vía 2**: busca la fila más reciente de `aliados_b2b` para el contrato, recalcula el monto con
`calcComisionB2B()` (misma función que Rentabilidad/`/dashboard/comisiones`) y usa
`tipo_aliado`/`aliado` de ahí en vez de `tipo_asesor`/`freelance_nombre`/`agencia_nombre` de
`ventas`. El gate agencia-vs-freelance de arriba pasa a evaluar `tipoAsesorEfectivo` (el de la
vía que haya aplicado), no `v.tipo_asesor` directo. Dueño del documento (`esDueno`) en la vía 2
= `perfil.nombre === aliado_b2b.aliado` (no hay `b2b_usuario_id` en `aliados_b2b`, a diferencia
de `ventas`) — un rol interno siempre puede verla y usarla para imprimir la cuenta de cobro "en
nombre del aliado" cuando este no tiene cuenta en el portal B2B (caso típico en minorista). Link
directo desde `/dashboard/comisiones` (`ComisionesList.tsx`, columna de acciones, oculto si
`tipoAliado==='agencia'`).

`crearComisionB2B` (agregar comisión a mano desde el contrato, `gestion-actions.ts`) ahora
captura `tipoAliado` (`"freelance"|"agencia"`, default freelance — antes siempre quedaba
`null`, así que la vía 2 trataba TODO como freelance). El selector "Elegir aliado existente"
(`GestionTabs.tsx::ComisionesTab`) trae `aliados.tipo` del catálogo y lo autocompleta; también
hay un `<select>` manual Freelance/Agencia en el formulario.

### Cuenta de cobro — rediseño con datos de pago + desglose (migración 133, jul-2026)

Pedido del dueño con 2 formatos de referencia: una plantilla real de cuenta de cobro (CXC, con
NIT/dirección del aliado, "DEBE LA SUMA DE" en números y letras, cláusula del Art. 383 E.T. y
datos bancarios) y una hoja de liquidación interna (PVP / valor tiquetes / base comisionable /
% / recobro por fila). El documento (`app/portal/comision/[numero]/page.tsx`) se amplió así:

- **`aliados` (catálogo) gana datos de pago**: `tipo_documento` ('NIT'/'CC'), `direccion`,
  `banco`, `tipo_cuenta`, `numero_cuenta` — editables en `/dashboard/aliados`
  (`AliadosClient.tsx::DatosPago`, panel expandible por fila; también en el formulario de
  creación). Antes el catálogo no tenía forma de saber A QUIÉN/DÓNDE consignar la comisión.
- **`aliados_b2b.aliado_id`** (FK opcional a `aliados`): cuando la comisión se creó eligiendo un
  aliado del desplegable "Elegir aliado existente" (`elegirAliado()` en
  `GestionTabs.tsx::ComisionesTab`), queda enlazada al catálogo — antes solo copiaba
  nombre/nit/% como texto suelto, sin ningún vínculo real. La cuenta de cobro usa este enlace
  para traer documento/dirección/cuenta bancaria automáticamente. Si la comisión se tipeó a
  mano (no elegida del catálogo), `aliado_id` queda `null` y la página cae a un **match suave
  por nombre** (`ilike` contra `aliados.nombre`) como mejor esfuerzo — si tampoco hay match, esa
  sección del documento simplemente no aparece (no bloquea la generación).
- **Desglose del valor** (`type Detalle` en la página): vía 2 (`aliados_b2b`) muestra el
  desglose COMPLETO que ya calcula `calcComisionB2B()` — PVP, base comisionable, % comisión,
  comisión, recobro (si > 0), retención (si aplica). Vía 1 (`ventas.comision_b2b`, flujo
  tarifario B2B de mayorista) NO tiene ese desglose guardado — solo el total ya calculado — así
  que se muestra un **"% efectivo"** (`comision_b2b / precio_venta`, rotulado explícitamente
  como efectivo, no el % contratado real) y se omiten base/recobro/retención (no se inventan).
- **Monto en letras**: `lib/utils/numeroALetras.ts::pesosEnLetras()` (sin dependencias) — "Un
  millón doscientos sesenta mil pesos", con la regla gramatical de agregar "de" cuando el monto
  es múltiplo exacto de un millón ("Un millón DE pesos").
- **Cláusula de retención**: si `aliados_b2b.aplica_retencion === false` (vía 2 únicamente —
  vía 1 no trackea retención en comisión) se imprime el boilerplate del Art. 383 E.T. + "NO
  HACER RETENCIÓN EN LA FUENTE" (mismo texto de la plantilla de referencia); si aplica
  retención, la tabla de desglose ya resta el valor retenido con su %.
- **Concepto**: texto compuesto `"Comisión por venta — Contrato {numero} — Cliente {cliente} —
  Destino {destino}"` en vez del párrafo libre de la plantilla de referencia (esa es para
  servicios profesionales genéricos; esto es siempre "comisión de venta", así que se generó el
  texto en vez de pedirlo a mano cada vez).
- **No implementado a propósito**: numeración tipo "CXC MDE-008" de la plantilla de
  referencia — no hay un esquema de numeración correlativo existente en el sistema para
  cuentas de cobro y no se quiso inventar uno desconectado de cómo el dueño numera sus
  documentos reales; el contrato ya identifica el documento de forma única. Se puede agregar
  si se define el esquema.

## 10. Mayorista vs. Minorista

- **Rentabilidad y Punto de equilibrio SÍ son tenant-scoped**: `ventas` filtrado por tenant en
  `calcularRentabilidad()`; `pe_empleados`/`pe_costos` filtrados explícitamente por tenant (cada
  agencia configura su propia nómina/costos fijos).
- **Compartido entre tenants (SIN scoping)**: `parametros_tributarios` (tasas fiscales,
  `COMISION_AGENCIA/FREELANCE`, `recobro_pct_aliado_b2b`, `trm_referencia`) y `asesores` — ambas
  tablas están ausentes de la lista de columnas `tenant` agregadas en la migración 107.
- **`aliados_b2b`/`liquidacion_comisiones`/`pe_empleados`/`pe_costos` SÍ tienen `tenant`**
  (default `'mayorista'`).
- El importador histórico de minorista (`lib/minorista/importMinorista.ts` + `contratos/
  importar/actions.ts`) **nunca crea `aliados_b2b`** — solo escribe `ventas`/`abonos`. Contratos
  nuevos creados vía `crearContrato()` en tenant minorista SÍ seguirían el mismo gate de
  `tipoVenta` que mayorista (el gate es agnóstico de tenant) — es específicamente la
  **importación masiva histórica** la que se salta B2B por completo.

## Enlaces cruzados

- **Contabilidad** (PUC, asientos automáticos, IRT) — ver [`contabilidad.md`](./contabilidad.md).
- **Reservar/Contratos** — donde nace `ventas.tipo_asesor`/`aliados_b2b` — ver
  [`reservar.md`](./reservar.md).
