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
    origen/destino vía IATA.
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
