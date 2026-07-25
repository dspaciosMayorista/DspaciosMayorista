# Contabilidad — hoja técnica

> Índice: [`README.md`](./README.md)

Módulo de partida doble (PUC + Libro diario/auxiliar) con posteo **automático** desde el resto
de la app (abonos, facturación, cuentas por pagar, pagos, retenciones), más Conciliaciones
bancarias y Retenciones a proveedores como front-ends que usan ese motor.

---

## 1. Plan de cuentas (PUC)

- **Tabla:** `puc_cuentas` — jerárquico (`nivel` 1-5: clase/grupo/cuenta/subcuenta/auxiliar),
  `padre_id` (autoreferencia), `naturaleza` (`'debito'|'credito'`), `permite_movimiento`
  (boolean — solo las cuentas hoja reciben posteos), `activa`, todo **por `tenant`**
  (`'mayorista'|'minorista'`, cada uno con su propio set de cuentas).
- **Migración semilla:** `supabase/migrations/20260601000126_plan_cuentas_puc.sql` — ~60
  cuentas típicas de agencia de viajes, sembradas para ambos tenants dentro de un bloque
  `do $$ ... $$` idempotente (`on conflict do nothing`). Ver el árbol completo ahí; las cuentas
  hoja (`permite_movimiento = true`) más usadas por el posteo automático:

  | Código | Nombre | Naturaleza |
  |---|---|---|
  | `110505` | Caja general | débito |
  | `111005` / `111010` | Bancos moneda nacional / USD | débito |
  | `130505` | Clientes nacionales | débito |
  | `280505` | Anticipos de clientes | crédito |
  | `280510` | Anticipos de clientes sin identificar (migración 129) | crédito |
  | `281505` | Comisiones y recobros por pagar a aliados B2B | crédito |
  | `281510` | Ingreso recibido para terceros (IRT) (migración 127) | crédito |
  | `220505/510/515/520/595` | Proveedores: hotel/aéreo/receptivo/asistencia/otros | crédito |
  | `613505/510/515/520/595` | Costo de ventas: hotel/aéreo/receptivo/asistencia/otros | débito |
  | `236540` / `236570` | Retefuente servicios / honorarios | crédito |
  | `413505` | Comisiones (ingreso propio) | crédito |
  | `240802` | IVA generado | crédito |
  | `530525` | Comisiones bancarias | débito |

- **Agregar cuentas nuevas:** desde `/dashboard/contabilidad/plan-cuentas` (crear
  subcuentas bajo una madre, hereda el prefijo de código) — `app/(dashboard)/dashboard/
  contabilidad/plan-cuentas/actions.ts` (`listarCuentas`, `crearCuenta`, `actualizarCuenta`,
  `eliminarCuenta` — bloquea si tiene subcuentas o movimientos).
- **⚠️ Si el dueño renombra/borra una cuenta que usa el posteo automático**, el asiento
  correspondiente falla con un error explícito (`"Falta la cuenta X en el Plan de cuentas..."`)
  — nunca se inventa una cuenta nueva sola (ver `postearAsiento` más abajo).

## 2. Libro diario / Libro auxiliar (UI manual)

- **Tablas:** `asientos_contables` (cabecera: `id, tenant, numero` secuencial por tenant,
  `fecha, descripcion, origen, referencia, usuario_email`) + `asiento_lineas` (detalle:
  `asiento_id, cuenta_id, tercero, descripcion, debe, haber`).
- **`origen`** identifica quién generó el asiento: `manual` (creado a mano, el único que se
  puede eliminar directo desde Libro diario), o el nombre de la fuente automática: `abono`,
  `facturacion`, `cxp`, `pago_proveedor`, `retencion`, `conciliacion`, o `<origen>_reversion`
  para las reversiones (ver §3).
- **`referencia`** es la clave estable que identifica de dónde viene el asiento — permite
  encontrarlo/reemplazarlo/reversarlo después: `abono:{id}`, `cxp:{cuentaId}`,
  `pago:{cuentaId}:{pagoId}`, `retencion:{id}`, `facturacion:{numeroContrato}`,
  `conciliacion:{concId}`, `manual:{concId}` (movimiento directo de conciliaciones).
- **Archivos:**
  - `app/(dashboard)/dashboard/contabilidad/libro-diario/actions.ts` — `listarAsientos`
    (⚠️ pagina `asiento_lineas` con `.range()` avanzando por lo realmente recibido, no por lo
    pedido — evita el truncado silencioso de PostgREST si el proyecto tiene un límite de filas
    bajo, ver §6), `crearAsiento` (valida partida doble con `validarLineas`, origen siempre
    `"manual"`), `eliminarAsiento` (bloquea si `origen !== "manual"`, dirige a deshacer desde
    el módulo de origen), `listarCuentasMovimiento` (cuentas hoja para el datalist).
  - `LibroDiarioClient.tsx` — formulario multi-línea (cuenta buscable por código/nombre,
    tercero opcional, débito/crédito, valida que sumen igual antes de guardar).
  - `app/(dashboard)/dashboard/contabilidad/libro-auxiliar/actions.ts` — `obtenerAuxiliar
    (cuentaId, desde?, hasta?)`: movimientos de UNA cuenta con saldo corrido (arrastra saldo
    inicial si se filtra por fecha; ⚠️ también paginado igual que Libro diario).

## 3. Posteo automático — `lib/contabilidad/asientos.ts`

Módulo compartido que el resto de la app llama para generar asientos **best-effort**: la
acción de negocio (registrar un abono, un pago…) **nunca** falla por un problema contable — si
falta una cuenta o algo no cuadra, se devuelve un error/aviso que el módulo que llama decide
mostrar, pero el registro de negocio ya se hizo. Usa **service-role** para leer/escribir
(`db()` interno) porque quien dispara el posteo (un asesor reservando, un usuario sin rol
contable registrando un abono) no tiene por qué pasar la RLS de `puc_cuentas`/`asientos_
contables`.

### Funciones exportadas

| Función | Firma | Qué hace |
|---|---|---|
| `postearAsiento` | `(input: {fecha, descripcion, origen, referencia, lineas}) => PResult` | Crea el asiento + líneas desde cero. Resuelve cada `cuentaCodigo` a su id (por tenant); si falta alguna, no crea nada y devuelve error. Filtra líneas con valor ≈0 antes de validar. |
| `reemplazarAsiento` | `(origen, referencia, nuevo \| null) => PResult` | Borra cualquier asiento existente con ese `origen+referencia` y postea el `nuevo` si se da uno (`null` = solo borrar). Para asientos que **nunca** se presentan a un tercero externo — editar/eliminar solo reemplaza. |
| `reversarYRegistrar` | `(origen, referencia, nuevo \| null) => PResult` | Para asientos que **sí** pudieron presentarse externamente (ej. una factura ante la DIAN): **no borra** — busca el asiento activo más reciente con ese origen+referencia, crea un espejo con débito/crédito invertidos (`origen_reversion`), y postea el `nuevo` encima. El rastro de la corrección queda en el libro. |
| `postearAsientoCxP` | `(input: {cuentaId, numeroContrato, tipoProveedor, proveedor, servicio, valorTotal, fecha}) => PResult` | `Debe Costo de ventas (por tipo) / Haber Proveedores (por tipo)`. Usa `reemplazarAsiento` (idempotente — se puede llamar de nuevo si se edita la CxP). `referencia = cxp:{cuentaId}`. |
| `eliminarAsientoCxP` | `(cuentaId) => PResult` | `reemplazarAsiento("cxp", ..., null)`. |
| `postearAsientoPago` | `(input: {cuentaId, pagoId, numeroContrato, tipoProveedor, proveedor, valor, formaPago, moneda, fecha}) => PResult` | `Debe Proveedores / Haber Caja-Bancos` (según `cuentaDisponible`). `pagoId` es el id de la fila en `cxp_pagos` (migración 130 — pagos **ilimitados** por CxP, reemplaza el viejo modelo fijo de 3 slots `abono1/2/3`). `referencia = pago:{cuentaId}:{pagoId}`. |
| `eliminarAsientoPago` | `(cuentaId, pagoId) => PResult` | ídem, borra. |
| `postearAsientoRetencion` | `(input: {retencionId, tipoProveedor, proveedor, valor, fecha}) => PResult` | `Debe Proveedores / Haber Retención en la fuente por pagar` (`236570` si el tipo de proveedor contiene "honorari", si no `236540`). Usa `postearAsiento` directo (no reemplaza — cada retención es un registro nuevo). |
| `anticipoNetoDeContrato` | `(numeroContrato) => Promise<number>` | Suma `haber − debe` de todas las líneas de `280505 Anticipos de clientes` con `tercero = numeroContrato` — el anticipo neto acumulado, usado por el asiento de facturación. |
| `cuentaDisponible` | `(formaPago, moneda) => codigo` | `efectivo` → Caja (`110505`); si no, Bancos según moneda (`111005` COP / `111010` USD). |
| `cuentasProveedor` | `(tipoProveedor) => {proveedor, costo}` | Mapea `tipo_proveedor` (hotel/aéreo/receptivo/asistencia/otro) a su par de subcuentas Proveedores/Costo. Default `220595`/`613595` ("otros"). |
| `CUENTA` | objeto constante | Códigos usados por el motor: `CAJA, BANCOS_COP, BANCOS_USD, CLIENTES, ANTICIPOS_CLIENTES, ANTICIPOS_SIN_IDENTIFICAR, INGRESOS_PROPIOS, IVA_GENERADO, IRT`. |

### Puntos donde se dispara cada asiento (call sites)

1. **Abono** (`app/(dashboard)/dashboard/contratos/actions.ts`, helper local
   `postearAsientoAbono`): al registrar/editar/eliminar un abono. `Debe Caja o Bancos (según
   forma de pago) / Haber Anticipos de clientes (280505) si el contrato AÚN no está facturado
   (`contrato_facturacion` no existe para ese `numero_contrato`), o Haber Clientes (130505) si
   ya lo está.` La distinción importa: antes de facturar, la plata recibida es un pasivo
   (anticipo), no una cuenta por cobrar todavía. Llamado desde `registrarAbono` (crea),
   `actualizarAbono` (corrige valor/fecha/forma de pago sin crear un 2º abono), `eliminarAbono`
   (`reemplazarAsiento("abono", ..., null)`).
2. **Facturación** (`app/(dashboard)/dashboard/contabilidad/facturacion/actions.ts`, helper
   local `postearAsientoFacturacion`): al guardar/quitar la facturación de un contrato.
   Asiento **compuesto** (usa `reversarYRegistrar`, porque una factura puede haberse
   presentado a la DIAN):
   `Debe Clientes (PVP completo)`
   `Haber IRT (281510)` — si `irt > 0` (plata de terceros/hoteles/aerolíneas, NO es ingreso propio)
   `Haber Ingresos propios (413505)` — si `ingresoPropio > 0`
   y si hay anticipo acumulado (`anticipoNetoDeContrato`, topado al PVP):
   `Debe Anticipos de clientes / Haber Clientes` por ese monto — "aplica" el anticipo contra
   la cartera recién reconocida (si el contrato estaba 100% pagado por adelantado, Clientes y
   Anticipos quedan ambos en $0 para ese contrato). `quitarFacturacion` solo reversa (no postea
   nada nuevo).
3. **Cuentas por pagar — creación** (4 puntos en tiempo real, el importador histórico masivo
   queda **fuera a propósito**, es backfill no forward):
   - `app/(dashboard)/dashboard/reservar/actions.ts` (3 call sites: flujo normal de reservar,
     una para programa, una para servicios/vuelo adicional).
   - `app/(dashboard)/dashboard/contratos/[numero]/gestion-actions.ts` — `asegurarCuentasPorPagar`
     y el editor de Proveedores del contrato (crear/actualizar).
   - `app/(dashboard)/dashboard/contratos/actions.ts` — creación de contrato manual.
   - `app/(dashboard)/dashboard/cotizaciones/manual-actions.ts` — convertir cotización dinámica
     a contrato.
   Todos llaman `postearAsientoCxP` justo después del `insert` en `cuentas_por_pagar`.
4. **Pago a proveedor** (`app/(dashboard)/dashboard/pagos/actions.ts`,
   `registrarPagoProveedor`/`deshacerUltimoPago`): llama `postearAsientoPago`/
   `eliminarAsientoPago`. Nota: esta función no rastrea `forma_pago`, así que siempre asume
   Bancos (`cuentaDisponible` con `formaPago: null`).
5. **Retención practicada** (`app/(dashboard)/dashboard/contabilidad/retenciones/actions.ts`,
   `registrarRetencion`/`eliminarRetencion`): llama `postearAsientoRetencion`/
   `reemplazarAsiento("retencion", ..., null)`.
6. **Conciliaciones bancarias** — ver §4 (usa `postearAsiento` directo, no una función propia
   en `asientos.ts`, porque la lógica de qué cuentas usar depende del tipo de diferencia).

### ⚠️ Asientos automáticos son SOLO hacia adelante, no retroactivos

El cableado de partida doble automática (todo lo de arriba) solo generó asiento para
CxP/abonos/pagos/retenciones **creados o editados DESPUÉS** de que se cableó (jul-2026). Ni el
importador histórico masivo (`app/(dashboard)/dashboard/contratos/importar/`) ni la CxP/cartera
previa a ese cableado tienen asiento retroactivo — es una decisión de diseño explícita, igual
que el importador histórico en general. Si un usuario reporta "el libro diario muestra pocos
asientos y solo de contratos puntuales", **no es un bug** — es este comportamiento esperado.
Backfill de lo histórico sería una herramienta aparte, no construida todavía.

---

## 4. Conciliaciones bancarias

`app/(dashboard)/dashboard/contabilidad/conciliaciones/` (`actions.ts` + `ConciliacionesClient.tsx`).

### Modelo de datos

- **`conciliacion_extracto`**: una fila por movimiento del extracto pegado (`fecha, descripcion,
  valor` con signo, `saldo`, `periodo` YYYY-MM, `cuenta`, `conciliacion_id` — null = pendiente).
- **`conciliacion`**: cabecera de un cruce (`nota, total, tenant`).
- **`conciliacion_sistema`**: lado "sistema" de un cruce — snapshot del ítem real (`ref`
  identifica su origen: `abono:{id}`, `pago:{cuentaId}:{n}`, `movimiento:{id}`,
  `saldo-cxp:{cuentaId}`, o `manual:{concId}` para movimientos directos; `numero_contrato`
  snapshot para trazabilidad — migración 124).

### Importar extracto — `importarExtracto(texto, anio?, cuenta?)`

Parser puro en `lib/contabilidad/extracto.ts` (`parseExtracto`) — separa por tab o 2+ espacios,
detecta fecha (con o sin año), valor (acepta con o sin decimal; descarta candidatos de 7+
dígitos sin separador como probable número de cuenta/referencia), saldo (penúltimo/último
numérico de la fila). **Dedup**: antes de insertar, compara contra TODO lo ya existente en esos
períodos (huella `fecha|valor|saldo`) y descarta lo repetido. **Inserta en lotes de 100
verificando el conteo REAL** (`.select("id")`) en vez de confiar en el conteo parseado —
reporta si algo no se guardó.

- `eliminarLineaExtracto` / `eliminarLineasExtracto`: borran solo líneas sin conciliar
  (`conciliacion_id is null`).
- `eliminarPeriodoExtracto(periodo)`: vacía TODO lo pendiente de un mes (limpieza masiva).

### Cruzar — `cruzar({extractoIds, sistema, nota?, diferenciaCaja?, gastoLineas?})`

Cruce manual N:M — las sumas (valor absoluto) deben coincidir, salvo que se declare una
diferencia justificada:

- **`diferenciaCaja: true`**: el sobrante/faltante quedó (o salió) en efectivo — reclasifica
  entre Caja y Bancos (`Debe Caja/Haber Bancos` en cartera, al revés en proveedores). El
  pre-asiento del abono/pago ya asumió Bancos por defecto; esto solo corrige cuál cuenta tenía
  la plata realmente.
- **`gastoLineas: [...]`** (solo lado Cartera): la diferencia es un gasto real (ej. comisión
  del datáfono descontada antes de consignar) — el usuario reparte el valor en 1+ cuentas
  (`EditorLineasCuenta`, tercero opcional), postea `Debe cuentas de gasto / Haber Bancos`.
  El descuento/gasto se resta del BANCOS_COP asumido, nunca inventa cuenta.
- Ambos casos postean con `origen: "conciliacion", referencia: "conciliacion:{concId}"`.
- `deshacerCruce(conciliacionId)`: libera las líneas del extracto, borra `conciliacion`
  (cascade borra `conciliacion_sistema`) y el asiento asociado (`origen='conciliacion'`).

### Movimiento directo — `registrarMovimientoDirecto({extractoIds, nota, contratoReferencia?, lineas})`

Para líneas del extracto **sin contrapartida ya registrada en el sistema** (consignaciones/pagos
puramente contables, o depósitos de clientes que no se van a relacionar con un contrato). Arma
el asiento a mano: Bancos se autocompleta con el total del extracto elegido, el resto lo reparte
el usuario (cuenta + tercero opcional + valor). `contratoReferencia` es texto libre (no exige
que el contrato exista en el sistema) — se guarda como `tercero`/`numero_contrato` snapshot.
**Sigue siendo partida doble completa** (el nombre viejo del botón decía "sin contrapartida",
que era engañoso — SIEMPRE hay contrapartida, solo que la elige el usuario en vez de un
abono/pago ya registrado). Para depósitos de cliente sin contrato identificado, la primera
línea sugiere `280510 Anticipos de clientes sin identificar` (migración 129) cuando el lado es
Cartera — sigue siendo el mismo tipo de pasivo que `280505`, solo que no se sabe a cuál
contrato pertenece.

### Sugerencia automática de cruce

`buscarSugerencia` (en `ConciliacionesClient.tsx`) — si solo hay selección de un lado, busca en
el otro TODOS los ítems sueltos que cuadren en valor, o (a falta de sueltos) un PAR cuya suma
cuadre (acotado a listas de ≤200 para no explotar combinatoriamente).

### ⚠️ Gotcha ya corregido — paginación

`conciliacion_extracto` se leía con un `.select("*")` simple en `page.tsx` — si el límite de
filas por respuesta del proyecto de Supabase (Settings → API → "Max rows") es menor al total
real, PostgREST corta la respuesta **sin error**. Síntoma: "importa 205 líneas pero solo se ven
algunas, y al borrar las visibles aparecen más" (parecía duplicación, no lo era). Corregido con
`traerTodo()` (paginado por `.range()`, avanza por la cantidad REAL recibida, no por lo pedido,
para en página vacía). Aplicado también a Libro diario/auxiliar. **Si alguna otra pantalla
reporta un conteo que "cambia solo" o "nunca coincide", sospecha primero de esto antes que de
duplicación de datos.**

---

## 5. Retenciones a proveedores

`app/(dashboard)/dashboard/contabilidad/retenciones/` (`actions.ts` + `RetencionesClient.tsx`).
Dos pestañas: **Aplicar retención** (calculadora + búsqueda por contrato) y **Informe mensual
(DIAN)**.

### Modelo de datos

`retenciones_cxp` (migración 125): `cuenta_por_pagar_id, valor, base_gravable` (migración 128,
nullable — retenciones previas a esa migración no la tienen), `fecha_practica, mes_declaracion`
(YYYY-MM, mes en que se declara a la DIAN), `observaciones` (texto libre — la calculadora
siempre escribe ahí el detalle completo: `"Base $X · IVA: $Y · IPC/otro: $Z · Base gravable $W
· Retención N%"`). Puede haber varias retenciones por cuenta (ej. una por cada abono parcial).
Se descuenta del saldo pendiente del proveedor igual que un abono (`lib/finanzas/
retenciones.ts::sumarRetencionesPorCuenta`).

### Calculadora (pestaña "Aplicar retención")

`Base gravable = Base − Valor IVA − Valor IPC/otro` (ambos en **pesos directos**, como trae la
factura del proveedor — NO como porcentaje; se cambió de %/base a valor directo porque escribir
el valor en el campo de % disparaba la base gravable a $0 sin ninguna pista del error).
`Valor retención = Base gravable × % Retención` si `Base gravable ≥ Base mínima aplicable`, si
no, $0. Aviso rojo si `IVA + IPC > Base` (matemáticamente imposible, señal de dato mal puesto).

### Informe mensual (DIAN)

`informeMensualRetenciones(mes)` — todas las retenciones con ese `mes_declaracion`, join a
`cuentas_por_pagar` (proveedor, tipo, contrato, moneda), agrupadas **por moneda** (evita sumar
COP con USD), con total de Base gravable y Valor retención — los dos números del formulario 350.
`listarMesesDeclaracion()` alimenta el selector.

### Recalcular bases faltantes

`recalcularBasesFaltantes()` — retenciones anteriores a la migración 128 tienen `base_gravable`
en null. Se recupera parseando `observaciones` con `derivarBaseGravable()` (regex sobre el texto
`"Base gravable $X"`, dato exacto del momento en que se practicó); si el texto no trae esa base,
se deriva dividiendo `valor / (pct_retencion_de_la_cuenta / 100)` (aproximación — ese % pudo
cambiar desde entonces). Deja en blanco solo lo que de verdad no se pueda calcular.

---

## Enlaces cruzados

- **Punto de equilibrio / Rentabilidad** leen de estas mismas tablas para sus cálculos
  derivados (hoy siguen siendo cálculos aparte, no conectados directamente al Libro diario —
  pendiente de integrar, ver `CLAUDE.md` §"Contabilidad").
- **Cartera** (`/dashboard/cartera`) y **Pagos a proveedores** (`/dashboard/pagos`) son los
  módulos donde el usuario registra abonos/pagos que disparan el posteo — ver `contratos/
  actions.ts` y `pagos/actions.ts`.
- **Multitenant**: todo en este módulo está scoped por `tenant` (`mayorista`/`minorista`) — cada
  uno tiene su propio PUC, numeración de asientos y conciliaciones independientes.
