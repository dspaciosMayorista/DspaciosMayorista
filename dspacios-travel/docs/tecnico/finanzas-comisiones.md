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
  aplica_retencion, pct_retencion, estado ('pendiente'|'pagada'), fecha_pago, tenant`.
- Acciones: `marcarComisionB2BPagada`/`marcarComisionB2BPendiente`,
  `actualizarComisionB2B(id, {baseComision, recobroTotal, pctRecobroAliado})` — revalida tanto
  `/dashboard/comisiones` como `/dashboard/rentabilidad` (editar aquí cambia directamente los
  números de Rentabilidad, porque ésta lee `aliados_b2b` en vivo).

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

## 7. `liquidacion_comisiones` — tabla en el schema, SIN uso real

Existe (`numero_contrato, asesor, mes_liquidacion, precio_venta, costo_total, com_b2b_pagada,
fecha_liquidacion, fecha_pago, estado`, + `tenant`) pero **no hay ningún INSERT/UPDATE/SELECT**
contra ella en toda la app fuera de los cascades de borrado de contrato
(`eliminar_contrato()`/migración 117) y un label de auditoría. Scaffolding legacy, superado en
la práctica por `/dashboard/liquidacion` (asesores) y `aliados_b2b.estado`/`fecha_pago` (B2B).

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
