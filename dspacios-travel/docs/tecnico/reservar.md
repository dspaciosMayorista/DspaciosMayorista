# Reservar — hoja técnica

> Índice: [`README.md`](./README.md) · Relacionado: [`tarifario-y-paquetes.md`](./tarifario-y-paquetes.md), [`vuelos-inventario.md`](./vuelos-inventario.md)

Cómo un paquete del tarifario se convierte en venta/contrato real. `app/(dashboard)/dashboard/
reservar/actions.ts` (1200+ líneas) ya está refactorizado en dos librerías puras + el archivo
de acciones que las orquesta:

- `lib/reservar/cotizar.ts` — motor de cotización EN VIVO por fechas (sin escrituras).
- `lib/reservar/computo.ts` — capa de cómputo de precio/pax compartida entre crear un contrato
  real y crear una cotización (para que ambos flujos usen exactamente la misma fuente de precio).

---

## 1. `reservarDesdeTarifario(input)` — el flujo principal

`app/(dashboard)/dashboard/reservar/actions.ts`. Paso a paso:

1. Valida nombre del cliente.
2. **`computarReserva(sb, input)`** (§3) — fuente ÚNICA de precio, compartida con `crearCotizacion`.
3. Si es tipo `bloqueo` con vuelo: chequeo previo de cupos disponibles (service-role) antes de
   crear nada, para no sobrevender.
4. Genera el número de contrato vía RPC de Postgres `siguiente_numero_contrato()`.
5. Calcula canal (B2C/B2B) y, para B2B (agencia/freelance), la comisión (`modoCompra: "neta"`
   resta la comisión del precio final; `"comisionable"` deja el precio igual y marca
   `comisionEstado: "pendiente"`). % desde `aliados.pct_comision` o fallback a
   `parametros_tributarios` (`COMISION_AGENCIA`/`COMISION_FREELANCE`, default 12%/11%).
6. **Insert `ventas`**: nace SIEMPRE `estado: "pendiente"`.
7. Si B2B con aliado: inserta `aliados_b2b` (comisión).
8. **Insert `contrato_pasajeros`** (uno por pasajero).
9. **Insert `contrato_hoteles`** (si no es módulo `servicios`): arma `detalle_acomodacion`
   legible, resuelve el proveedor real del hotel (service-role).
10. **Insert `contrato_vuelos`** (solo `bloqueo` con `bloqueoId`): lee `bloqueos_vuelo`, parsea
    origen/destino vía IATA. **Migración 135** (jul-2026) cambió el modelo: cada fila ahora
    representa **UN solo tramo/dirección** (`direccion: "ida"|"regreso"|"suelto"`, más
    `numero_vuelo`/`fecha`/`hora_salida`/`hora_llegada`) en vez de una fila combinada ida+regreso
    — pensado para casos multi-ciudad con varios vuelos. Un bloqueo con ida y regreso inserta
    **2 filas** (una por dirección, la de regreso con origen/destino invertidos), no 1. Las
    columnas viejas (`vuelo_ida`/`vuelo_regreso`/etc.) se conservan sin usar (no se borran
    columnas en este proyecto). `NuevoContratoForm.tsx` (contrato manual) arma las tarjetas de
    vuelo con este mismo modelo (1 tarjeta = 1 tramo, botón "+ Agregar regreso" invierte origen/
    destino automáticamente). `ContratoDocumento.tsx` sabe renderizar ambas formas (nueva de un
    tramo por fila, y la vieja legacy de ida+regreso combinado en una sola fila) para no romper
    contratos ya generados antes de la migración.
11. **Insert `contrato_items`**: una línea por tipo de habitación, Niño 1/2 (si aplica), Infante
    (solo si el hotel configuró PVP de infante), servicios adicionales, cargo de mascota.
12. **CxP + contabilidad (best-effort, nunca bloquea la reserva, solo si hay
    `SUPABASE_SERVICE_ROLE_KEY`)**:
    - **Sillas + costo aéreo** (bloqueo): `costoAereo = tarifa_para_empaquetar × paxConSilla`;
      asigna sillas libres (`disponible`/`cambio_entrante`) → `en_plazo`, copiando datos del
      pasajero a la silla (infantes excluidos de ocupar silla).
    - **Costo aéreo dinámico** (sin sillas): desde `salidas_dinamicas.valor_tiquete`/`fee_infante`.
    - **Costo neto de hotel**: suma `netoPorAcom` (ya calculado por `computarReserva` — "una
      sola fuente del costo", nunca se recalcula distinto en dos lugares).
    - **Costo de servicios/receptivo**: re-lee `armado_servicios`/`servicio_tarifa_pax`/
      `servicio_temporadas` con service-role, respeta la temporada vigente en `fecha_ida`
      (`temporadaVigenteParaFecha`) y su `factorLiquidacion`, aplica `recargo_individual` si
      `totalPax === 1`.
    - Inserta las CxP acumuladas y por cada una llama **`postearAsientoCxP`** (ver
      [`contabilidad.md`](./contabilidad.md) §3) — este es el call site real de la contabilización.

## 2. Otras funciones en `reservar/actions.ts`

| Función | Qué hace |
|---|---|
| `cotizarPorFechas` / `buscarHoteles` | Wrappers finos que reexportan `lib/reservar/cotizar.ts` (§4) — sin lógica propia. |
| `crearCotizacion(input, opts?)` | Crea una **cotización** (`cotizaciones`, sin número de contrato) reusando `computarReserva` (misma fuente de precio, "no diverge"). Snapshot en `detalle` jsonb para el PDF. `vigencia_hasta` default hoy+1 día. Sin efectos en inventario/CxP. |
| `convertirCotizacion(id, pasajeros?, override?, asesorInterno?)` | Convierte una cotización en contrato real: exige pasajeros (salvo `override && rol === superadmin`), llama `reservarDesdeTarifario`, marca la cotización `estado: "convertida"`. |
| `actualizarVigenciaCotizacion` / `descartarCotizacion` | Cambios de estado simples sobre `cotizaciones`, solo si `estado = "abierta"`. |
| `confirmarVenta(numeroContrato)` | `pendiente → confirmado`: cambia estado, mueve sillas `en_plazo → confirmada`, llama `asegurarCuentasPorPagar` como respaldo. **Sin chequeo de rol dentro de la función** (a diferencia de `editar-contrato-actions.ts`). |
| `asegurarCuentasPorPagar(numeroContrato)` | Respaldo: crea CxP que falten (hotel/aéreo/receptivo/asistencia/otro) desde `ventas.costo_*`, nunca duplica, llama `postearAsientoCxP` por cada una nueva. |
| `liberarVencidas()` | Núcleo del cron diario (§5): libera sillas `en_plazo` vencidas y cancela la venta. |
| `reservarPrograma(input)` | Flujo INDEPENDIENTE para un "programa" (circuito de proveedor, otra moneda) — NO usa `computarReserva`/`lib/reservar`, usa `pvpPrograma()` de `lib/programas.ts` (ver [`programas-y-cotizacion-manual.md`](./programas-y-cotizacion-manual.md)). También llama `postearAsientoCxP` para su única CxP (`tipo_proveedor: "programa"`). |

## 3. `computarReserva(sb, input)` — `lib/reservar/computo.ts`

Capa de cómputo COMPARTIDA por `reservarDesdeTarifario` y `crearCotizacion` — ninguna de las
dos calcula precio por su cuenta. Ramifica según `input.modulo`:

- **`servicios`** (sin hotel): solo lee `tarifario_resultado` para nombre/destino.
- **Record fijo** (`bloqueo`/`porcion_terrestre` sin fechas en vivo, o `dinamico` con `salidaId`):
  lee PVP de `tarifario_resultado`, y ADEMÁS re-deriva el costo **neto** en vivo desde
  `tarifa_hotel` (service-role) respetando las temporadas actuales — **si la vigencia de compra
  ya venció, la reserva se BLOQUEA** ("Esta tarifa ya no está vigente para compra…"). El PVP
  puede quedar congelado desde el tarifario, pero el costo neto y la vigencia SIEMPRE se
  revalidan en vivo.
- **Fechas elegidas** (porción/dinámico con `fechaIda`/`fechaRegreso`): llama
  `liquidarHotelPaquete` (§4) directamente, en vivo.

Común a ambas ramas de hotel:
- **Adults Only** rechaza niños/infantes; hotel no pet-friendly rechaza mascotas declaradas.
- **Clasificación por edad**: `clasificarPorEdad(edades, hotel.edad_infante_max ?? 2,
  hotel.edad_nino_max ?? 10)` donde `edades = fecha_nacimiento` de cada pasajero **calculada a
  la fecha de SALIDA del viaje** (`fecha_ida`), contra los umbrales configurados POR HOTEL.
- **Validación de capacidad**: `validarReservaHabitaciones` (§4, `lib/acomodaciones.ts`) — todo
  error bloquea (salvo cotización preliminar sin pasajeros, que se revalida al convertir).
- **Cargo de mascota**: `round(numMascotas × noches × marcar(pet_costo_neto, %mk))` si el hotel
  tiene costo configurado; $0 = gratis pero permitido.
- **Servicios adicionales**: re-escala por la temporada vigente en `fecha_ida` (proporcional
  `neto_temporada/neto_general`), aplica `recargo_individual` si va 1 solo pax.
- **Impuesto (BNC)**: `armado_paquetes.impuesto_fijo × paxConSilla` (solo módulos con hotel).

Devuelve `ComputoReserva` (pvpPorAcom, netoPorAcom, precioVenta, paxConSilla, lineasHab,
serviciosItems, impuestoTotal, cargoMascota, etc.) — **sin ninguna escritura**.

## 4. `lib/reservar/cotizar.ts` — cotización en vivo por fechas

- **`liquidarHotelPaquete(admin, paqueteId, hotelId, fechaIda, numNoches)`**: re-liquida UN
  hotel para fechas elegidas por el asesor, reusando **el mismo motor que genera el tarifario**
  (`liquidarHotelNoches` de `lib/calc/paquetes.ts`, ver [`tarifario-y-paquetes.md`](./tarifario-y-paquetes.md)).
  Respeta blackouts (total → hotel no vendible; por acomodación → esa acomodación se excluye).
  Devuelve tanto `precios` (PVP) como `netos` (costo interno — **nunca se expone al cliente**).
- **`cotizarPorFechas(input)`**: wrapper público — valida rango de fechas del paquete, exige
  `SUPABASE_SERVICE_ROLE_KEY`, aplica `minNoches`, arma un error diagnóstico detallado si no
  liquida nada (qué temporada falta / qué noches quedan fuera de vigencia). **Quita `netos`
  antes de devolver** — el cliente solo ve PVP.
- **`buscarHoteles(input)`**: motor de búsqueda pública — itera todos los `(paquete_id,
  hotel_id)` de `tarifario_resultado` con `modulo='porcion_terrestre'` y `paquete_activo=true`,
  re-liquida cada uno, valida capacidad contra `hotel_acomodaciones`, ordena por precio total
  más barato.
- **`buscarReceptivos(input)`** (jul-2026, mismo patrón que `buscarHoteles`): motor de búsqueda
  en vivo para el buscador de Receptivos del tarifario público (`BuscadorReceptivos.tsx`, ver
  [`tarifario-y-paquetes.md`](./tarifario-y-paquetes.md) §"Receptivos"). Por destino/fechas/pax:
  lee `armado_servicios` (modo persona/grupo + `pct_mk` del paquete) + `servicios_adicionales` +
  `servicio_tarifa_pax` + `servicio_temporadas`, resuelve la temporada vigente para `fecha_ida`
  con `temporadaVigenteParaFecha`, calcula `precioServicio(modo, netoPersona, gruposServ, pax) ×
  factorLiquidacion(...)`, suma `recargo_individual` si `pax === 1`, aplica el markup del
  paquete y redondea con `redondearVenta`. Devuelve `ResultadoServicio[]` (nombre, destino,
  descripción, foto, total, pax) — sin costo neto expuesto, mismo criterio que `cotizarPorFechas`.
  Exportado como wrapper fino en `reservar/actions.ts`.

## 5. `lib/acomodaciones.ts` — validación de capacidad

- **`ACOM_ROOMS = ["sencilla","doble","triple","multiple"]`** — tipos de habitación (niño/
  niño2/infante se reservan por CANTIDAD, no como habitación).
- **`PAX_TARIFA_DEFAULT = {sencilla:1, doble:2, triple:3, multiple:4}`** — multiplicador default
  de pax por habitación cuando el hotel no configuró el suyo en `hotel_acomodaciones`.
- **`clasificarPorEdad(edades, infanteMax, ninoMax)`**: clasificador simple por umbral —
  `edad ≤ infanteMax → infante`, `edad ≤ ninoMax → niño`, si no `adulto`; sin fecha de
  nacimiento → `sinFecha` (no bloquea, genera aviso).
- **`validarReservaHabitaciones(inp)`**: cruza (a) niños/infantes declarados vs. capacidad de
  las habitaciones elegidas (`chd_max`/`inf_max` × cantidad), (b) pax total vs. `pax_min/max`
  del hotel, (c) declarado vs. **real** (según fecha de nacimiento) — si la clasificación real
  supera lo declarado/lo que permiten las habitaciones, es error bloqueante; pasajeros sin
  fecha de nacimiento degradan a aviso no bloqueante.

## 6. Estado del contrato: pendiente → confirmado

- **Nace `pendiente`** siempre (`reservarDesdeTarifario`, `reservarPrograma`).
- **Confirmación manual**: `confirmarVenta` (botón en `EstadoVenta.tsx`, contrato detalle).
- **Auto-confirma con abono ≥ umbral** (default 30%, configurable en `config_cobros.pct_abono`
  por `tipo_paquete`): `recalcularEstadoAbono` (en `contratos/actions.ts`), llamado desde
  `registrarAbono`/`actualizarAbono` — si `totalAbonado ≥ precio_venta × pctMin` y el contrato
  está `pendiente`, confirma, mueve sillas y llama `asegurarCuentasPorPagar`.
- **Cron diario** (`app/api/cron/liberar-vencidas/route.ts`, `GET` con `Authorization: Bearer
  ${CRON_SECRET}`, falla cerrado con 503 si no hay secreto configurado; `vercel.json`:
  `"0 6 * * *"`) → `liberarVencidas()`: libera sillas `en_plazo` cuyo `plazo < hoy` y **cancela**
  esa venta (no solo libera el cupo — `ventas.estado = 'cancelado'`).
- **Reconciliación financiera diaria** (`app/api/cron/reconciliar-financiero/route.ts`,
  `"0 10 * * *"`, compatible con Vercel Hobby): reintenta el payload financiero durable o
  revierte el contrato incompleto. Mientras siga `financiero_estado = 'pendiente'`, el contrato
  no acepta abonos; en Hobby la reparación automática puede tardar hasta la siguiente ejecución.

## 7. Editar una reserva pendiente — qué existe hoy, qué no

**Sí implementado:**
- **Servicios**: `actualizarServiciosContrato` (solo si `estado === "pendiente"`) — re-liquida
  servicios, ajusta `precio_venta`, recalcula costos. No toca hotel/fechas/habitaciones.
- **Pasajeros**: `actualizarPasajerosContrato` — reemplazo completo, mismos validadores que al
  reservar.
- **Asesor interno**: `actualizarAsesorContrato`.
- **Edición manual de cabecera**: `actualizarVenta` — edita cliente/destino/fechas/**precio_
  venta**/pax directamente, **sin re-liquidar nada** y sin importar el estado del contrato.

**❌ NO implementado (confirmado, sigue siendo un hueco real):** no existe ninguna función que
permita cambiar hotel, fechas de viaje o composición de habitaciones de un contrato existente
y que el sistema **re-corra `computarReserva`** y reescriba `contrato_hoteles`/
`contrato_items`/sillas bajo el MISMO número de contrato. Hoy la única forma es (a) el
sobre-escritura manual sin re-liquidar, o (b) anular y crear un contrato nuevo.

## 8. Mayorista vs minorista

Minorista **no tiene acceso** a Reservar (tampoco a Cotizaciones/Vuelos/Paquetes/Producto/CMS).
Doble gate:
- **UI**: `SidebarNav.tsx` — `{ href: "/dashboard/reservar", minoristaOculto: true }` (oculta el
  link).
- **`proxy.ts`** (servidor, no evadible navegando directo a la URL): array `MINORISTA_OCULTAS`
  incluye `"/dashboard/reservar"` — si el tenant activo (cookie) es minorista y la ruta
  coincide (o es subruta), redirige a `/dashboard` con `NextResponse.redirect`.

## 9. #63 — reserva de una salida vinculada a Empaquetados sin record (modo `cop_trm_63`)

> La 227 va ANTES del código. El origen de la reserva sigue siendo `salidaId` (`origen.tipo === "salida"`).

- **Sin cupos.** Una vinculada (y cualquier salida o Empaquetado) **no consulta `cupos_por_bloqueo` ni `sillas`**: la validación de cupos de
  `reservarDesdeTarifarioInterno` vive solo dentro de `if (origen.tipo === "bloqueo")`. Un Bloqueo sigue exigiéndolos (probado en
  `salidaVinculada63Reserva.react.ts`, con mutación: hacer que una salida consulte cupos rompe la prueba).
- **`computarReserva`** llama a `resolverOfertaSalida63` (`lib/reservar/prepararOferta63.ts`, cliente de servicio) solo para origen salida: valida la fuente
  VIVA (activa, sin record, ventana, COP, copia coincidente, destino aéreo 220) **antes de leer precio**. Devuelve `oferta63` (TRM, R, F, monedas de origen de
  hotel y servicios, generación/revisión publicadas). En un paquete de siempre devuelve `null` y nada cambia.
- **BNC.** Oferta 63: `impuestoTotal = impuestoPorPersona63 × paxConSilla` (tiquete = **R**; fijo = importe del paquete en COP). Los menores de 2 años no
  ocupan silla ni generan BNC. Antes (legacy) se ignoraba `impuesto_tipo`; eso no cambia fuera del modo 63.
- **Datos de vuelo.** `datosVueloSalida` (`empaquetadoOrigen.ts`) resuelve una vinculada contra su fuente viva: `record` null, `costo_neto` = N, `fee_infante` = F.
  Una salida **manual** en modo 63 usa el tiquete y el fee ya convertidos de `oferta63` (R1).
- **Costos y CxP.** `ventas` queda en COP. Cada CxP conserva su **moneda de origen** (hotel/servicios pueden ser USD; el aéreo de Empaquetados, COP) y lleva
  `valor_cop`/`trm` (`camposCxP63`) que `registrar_financiero_contrato` (227) guarda en `cuentas_por_pagar.valor_cop_63`/`trm_63` **en la misma transacción**.
  `ventas.costo_hotel`/`costo_receptivo` son la suma de esos equivalentes (el aéreo ya sale en COP). `postearAsientoCxP` devenga por `valor_cop_63`
  (nunca por el nominal USD; si no puede leerlo, devuelve error). `asegurarCuentasPorPagar` mide la cobertura con el equivalente COP (sin complemento fantasma).
  `actualizarServiciosContrato` y el valor de una CxP 63 **no se editan** después de reservar (se anula y se reserva de nuevo).
- **Aceptación atómica con snapshot privado (E/F/G, migración 227).** Una oferta en COP con TRM no se cobra "recalculando": se **cotiza y se acepta** contra un
  snapshot que calcula el servidor UNA vez y que ningún dato vivo posterior altera.
  1. **Cotizar** (`crearCotizacion`): lee las revisiones de T0 del paquete ANTES de calcular (`leerRevisiones63`: `tarifario_revision_fuente`/`_publicada`,
     `tarifario_generacion_publicada`, `p63_rev_costos`), calcula costos y obligaciones con `calcularFinancieroReserva` (los pasos 9–12 de la reserva, extraídos sin cambiar su
     cálculo), arma el snapshot (`lib/reservar/aceptacion63.ts`: cabecera, hotel, tramos, ítems, costos, obligaciones con clave estable `hotel:0`/`aereo:0`/`<tipo>:s<servicio_id>`,
     TRM, resumen) y guarda **cotización + oferta + snapshot en UNA transacción** con la RPC `crear_cotizacion_oferta_63` (que vuelve a comparar T0 bajo candado: no hay cotización
     "rasgada"). El snapshot vive en `p63_oferta` (PRIVADA); la cotización visible solo tiene la huella de precio. La autoría estable y el alta de personas (219) siguen siendo el paso posterior de siempre.
  2. **Aceptar** (`reservarDesdeTarifarioInterno` → `aceptarOferta63` → `aceptar_oferta_63`): ANTES de numerar o crear nada, el servidor recalcula en vivo la huella de precio y la
     huella FINANCIERA (`huellaFinanciera63`: costos, proveedor, retención, moneda, valor y equivalente COP) solo para COMPARAR. La RPC toma los candados en orden fijo
     (fuente FOR SHARE → salida FOR SHARE → paquete FOR NO KEY UPDATE → oferta FOR UPDATE; el mismo orden en que escriben los triggers, hoja → paquete; nunca toma la venta),
     revalida AHORA con la fecha de negocio de Bogotá (`p63_hoy_bogota`, `clock_timestamp`): activo, ventanas de compra y viaje de salida y fuente, fuente sin record y en COP,
     copia coincidente, TRM, tarifario publicado, revisiones, contador de costos, huellas y destino aéreo (220). Reserva el número (mismo generador de mayorista) y congela el
     snapshot en `p63_aceptacion`. Un reintento recibe el MISMO intento. Un cambio de costo/proveedor/retención con el PVP igual se rechaza ("La oferta cambió…").
  3. **Materializar**: cabecera, hotel, tramos, ítems, costos y obligaciones salen **solo** de lo devuelto por la aceptación (`aceptacion63.snapshot` / `aceptacion63.financiero`); no hay lecturas
     vivas de costos/proveedores en esos pasos. La cabecera lleva `ventas.aceptacion_63_id` y un trigger BEFORE INSERT la compara campo a campo con lo aceptado y marca el intento
     `materializando` en el mismo insert (un worker viejo o un número descartado no crean cabecera; después de la cabecera no hay takeover automático).
  4. **Finalizar**: `registrar_financiero_contrato` conserva EXACTO el texto de la 210 para contratos de siempre; para un contrato con `aceptacion_63_id` desvía a `p63_registrar_financiero`,
     que deriva costos y obligaciones del snapshot, **rechaza cualquier payload distinto** (también una llamada directa con payload adulterado o sin pendiente), exige el pendiente exacto
     y los hijos completos, escribe las CxP con `aceptacion_63_id`/`obligacion_63` y marca la aceptación `completa` en la misma transacción. El pendiente
     (`contrato_financiero_pendiente`) solo admite el payload derivado y solo tras los hijos.
  5. **Recuperación**: el reconciliador reintenta el MISMO payload aceptado aunque la fuente cambie después; sin payload, la reversión (`revertir_contrato_incompleto`) borra la cabecera y un trigger
     descarta el intento (el número queda como tombstone) y reabre la oferta. Una oferta convertida es terminal (no se reabre por desaparecer la venta).
  - **Protecciones de lo aceptado**: triggers impiden editar principal, moneda, proveedor, servicio y retención de una obligación aceptada y los costos del contrato (el borrado es diferido: `eliminar_contrato` sigue pudiendo
    borrar el contrato entero); `gestion-actions.ts` y `actualizarServiciosContrato` responden un rechazo claro. `asegurarCuentasPorPagar` NUNCA complementa un contrato #63 con nominales (verifica por clave de obligación o pide revisión;
    distingue ausencia de marca de fallo de lectura). `postearAsientoCxP` falla CERRADO ante cualquier error de lectura (`resolverImporteContable63`).
  - **Plan B2B congelado (ciclo 5).** La comisión y el precio NETO ya no se recalculan con el % de hoy: `crearCotizacion` resuelve el aliado (`resolverAliadoReserva` con service-role, el mismo cliente que al aceptar) y guarda en el
    snapshot `b2b` = `{ aliado_id, tipo_asesor, pct, base, comision, modo_compra, comision_estado, precio_final }` más `cabecera.tipo_asesor`/`canal` (`construirPlanB2b63`). Tres capas: (1) `huellaFinanciera63` incluye `b2b` (la clave no entra si la
    venta es interna, así que la huella de una oferta B2C es la de siempre): con el PVP igual, un % distinto da otra huella y `aceptar_oferta_63` responde `p63_oferta_cambio` ANTES de reservar número; (2) los triggers `trg_p63_costos_aliados`
    (`pct_comision`/`tipo`) y `trg_p63_costos_parametros_*` (`COMISION_AGENCIA`/`COMISION_FREELANCE`) suben `p63_rev_costos` de TODOS los paquetes en modo 63 (`p63_bump_costos_todos`), en la misma transacción del cambio; (3) la cabecera del
    contrato sale del snapshot (`aceptacion63.snapshot.b2b`, ya no hay `pctAliado63`) y `trg_ventas_aceptacion_63_ins` la contrasta contra ese valor (aliado, modo, comisión, estado y `precio_final`; sin plan, todo eso debe ser null y el precio es el PVP).
    Un cambio del % POSTERIOR a la aceptación falla cerrado: `registrar_comision_b2b_reserva` recalcula con el % vigente, no coincide con la cabecera y la reserva se revierte completa (la oferta se reabre).
  - **Vigencias de compra dentro de la RPC (ciclo 5).** `computarReserva` devuelve `vigencias63` (hotel: toda temporada que ganó una noche o respalda la tarifa de habitación y de niño 1 / niño 2 / infante con `procedencia` y `temporadasTarifa`; servicio opcional:
    la temporada elegida por `temporadaVigenteParaFecha`, con `ref = "<servicio_id>|<nombre>"`) con sus `compra_inicio`/`compra_fin`; el snapshot las guarda (`normalizarVigencias63`). `aceptar_oferta_63` las valida con `p63_hoy_bogota()` de SU transacción
    antes de reservar el número (`v_hoy < compra_inicio` o `v_hoy > compra_fin` → `p63_oferta_cambio`), así que una compra que cierra (o aún no abre) entre el cálculo del servidor y la RPC —cruce de medianoche— se rechaza **sin que ningún UPDATE haya movido una revisión**.
    Un intento ya aceptado no se revalida al recuperarlo (es lo aceptado antes de vencer).
  - **Desviaciones declaradas**: (a) las vigencias que se congelan son las de las temporadas que GANARON el precio (no las de todas las temporadas del hotel) y no cubren los servicios INCLUIDOS horneados en el PVP (usan la tarifa general); (b) el cálculo vivo del servidor
    sigue revalidando las ventanas antes de llamar a la RPC (la RPC es la segunda guardia, no la única); (c) el marcado "completa" lo hace la propia RPC financiera (no un trigger separado) en la misma transacción; (d) los errores técnicos de las otras acciones de gestión pueden mostrar el texto
    `p63_*` de la base (en español, sin datos sensibles).

## Enlaces cruzados

- **Tarifario/Paquetes** — de dónde sale el PVP congelado (`tarifario_resultado`) y el motor
  de liquidación noche a noche que `cotizar.ts` reutiliza en vivo — ver
  [`tarifario-y-paquetes.md`](./tarifario-y-paquetes.md).
- **Vuelos/Inventario** — el ciclo de vida de las sillas (`disponible→en_plazo→confirmada`) que
  este módulo mueve — ver [`vuelos-inventario.md`](./vuelos-inventario.md).
- **Contabilidad** — `postearAsientoCxP`, llamado en 3 puntos de este archivo — ver
  [`contabilidad.md`](./contabilidad.md).
- **Programas / Cotización manual** — flujos de venta alternativos que NO pasan por
  `computarReserva` — ver [`programas-y-cotizacion-manual.md`](./programas-y-cotizacion-manual.md).
