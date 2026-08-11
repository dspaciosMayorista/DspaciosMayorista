# Tarifario y armado de paquetes — hoja técnica

> Índice: [`README.md`](./README.md) · Relacionado: [`tarifas-hotel.md`](./tarifas-hotel.md) ·
> [`reservar.md`](./reservar.md) · [`vuelos-inventario.md`](./vuelos-inventario.md)

Cómo se arma un "paquete" (mezcla de vuelo negociado/hotel/servicios) y cómo eso se convierte en
las filas que ve el tarifario público. **Ojo con el nombre "empaquetado"**: no existe como tipo
en este módulo — ver §0.

---

## 0. Corrección importante: tipos de paquete reales

El enum real (Postgres `tarifario_modulo`, usado por `armado_paquetes.tipo` y todo el motor
`generarTarifario`) tiene **4 valores**:

- `bloqueo` — vuelo negociado (`bloqueos_vuelo`) + hotel negociado.
- `porcion_terrestre` — solo hotel, sin vuelo.
- `servicios` — solo servicios, sin hotel/vuelo.
- `dinamico` — hotel negociado (liquidado noche a noche, mismo motor que `porcion_terrestre`)
  **+ un vuelo "de sistema"** (`salidas_dinamicas`, sin PNR/record, rota semanalmente —
  migración 094).

`empaquetado` **sí existe como texto**, pero pertenece a un módulo **hermano y distinto**:
`app/(dashboard)/dashboard/contratos/actions.ts` (`TipoPaquete = "bloqueo" | "porcion_terrestre"
| "empaquetado" | "dinamico"`) — el generador de contratos MANUAL (legacy/paralelo, un asesor
tipea costos a mano). Ese módulo NO alimenta `tarifario_resultado` ni pasa por
`generarTarifario`. No confundir los dos sistemas.

## 1. `armado_paquetes` — modelo de datos

- **`armado_paquetes`**: `id, nombre, activo, destino_id, tipo` (`tarifario_modulo`, default
  `bloqueo`), `noches, fecha_compra_inicio/fin, fecha_viaje_inicio/fin, pct_mk` (numeric,
  fracción — 0.20 = 20%), `impuesto_tipo` (enum `tiquete`/`fijo`), `impuesto_fijo, imagen_url,
  notas, moneda` (resuelta por `generarTarifario`).
- **`armado_vuelos`** (join, PK `paquete_id, bloqueo_id`): `aplica_mk, ta` — solo el vuelo
  decide markup vs. TA (Tarifa Administrativa) fija.
- **`armado_hoteles`** (join, unique `paquete_id, hotel_id`): `categorias text[]|null,
  regimenes text[]|null` (null/vacío = todas las categorías/regímenes incluidos).
- **`armado_servicios`** (join, unique `paquete_id, servicio_id`): `modo ('persona'|'grupo'),
  incluido boolean` (incluido = horneado en el PVP del hotel por persona; no incluido = add-on
  opcional publicado aparte).
- **`salidas_dinamicas`** (solo `tipo='dinamico'`): `paquete_id, aerolinea, ruta, origen,
  fecha_ida (not null), fecha_regreso, 4 horarios, valor_tiquete` (neto adulto 2+), `aplica_mk,
  ta, fee_infante, compra_inicio/fin, activo, notas, orden`.

## 2. `actions.ts` — funciones exportadas

| Función | Hace |
|---|---|
| `crearPaquete`/`actualizarPaquete`/`eliminarPaquete` | CRUD de `armado_paquetes`. |
| `setVuelo`/`setTodosVuelos` | Marca/desmarca vuelos (con `aplica_mk`/`ta`) en `armado_vuelos`. |
| `setHotel`/`setTodosHoteles`/`getTarifasHotel`/`setHotelFiltros` | Marca hoteles y restringe categorías/regímenes en `armado_hoteles`. |
| `setServicio` | Marca servicios (modo persona/grupo, incluido/opcional). |
| **`generarTarifario(paqueteId)`** | **Borra y re-inserta** todas las filas de `tarifario_resultado` del paquete — es la función central, ver §3. |
| `regenerarTarifariosDeHotel/Bloqueo/Servicio` | Re-ejecutan `generarTarifario` en paralelo (best-effort) para todo paquete activo afectado por un cambio en hotel/bloqueo/servicio. |
| `crearSalidaDinamica`/`actualizarSalidaDinamica`/`eliminarSalidaDinamica` | CRUD de `salidas_dinamicas`; cada una dispara `generarTarifario` automáticamente. |

## 3. `generarTarifario` — lógica de negocio

1. **Guard de moneda única**: un paquete es de UNA sola moneda. Se resuelve primero por hotel
   (COP salvo hotel USD); si algún servicio incluido difiere, es error duro. Sin hoteles
   (paquete puro `servicios`), todos los servicios deben compartir una moneda.
2. Por hotel × combo (categoría,régimen) × acomodación (`sencilla, doble, triple, multiple,
   nino, nino2, infante`) liquida el costo: `bloqueo`/`dinamico` → `liquidarHotelNoches` (fecha
   fija, noches exactas); `porcion_terrestre` → `liquidarHotelMasBarato` (noche más barata en
   la ventana de fechas, "desde"). Filas de habitación (`esRoom`) con costo `<=0` se descartan;
   `nino/nino2/infante` en `0` SÍ se conservan (0 = gratis legítimo).
3. `aporteHotel = marcar(costoHotel, pctMk)` — **el hotel siempre lleva el markup del paquete**,
   nunca TA.
4. Servicios "incluidos" se hornean por persona en la fila del hotel (escalados por
   `factorLiquidacion`).
5. Por tipo de paquete: `bloqueo` → una liquidación por vuelo seleccionado (noches del vuelo,
   impuesto = neto tiquete o fijo; la etiqueta pública es **solo la ruta**, nunca el PNR/record
   interno); `porcion_terrestre` → una liquidación desde `fecha_viaje_inicio` por `noches`,
   `masBarato=true`; `dinamico` → una por cada `salidas_dinamicas` activa.
6. Servicios sueltos/opcionales (no incluidos) siempre se publican como filas propias
   `modulo:'servicios'` — modo persona → 1 fila; modo grupo → 1 fila por rango de pax de
   `servicio_tarifa_pax` (solo temporada `'GENERAL'`).
7. **Reescritura total**: borra TODAS las filas de `tarifario_resultado` del `paquete_id` y
   reinserta el set nuevo — por eso la tabla es un snapshot desechable/regenerable, y por eso
   existen las funciones `regenerarTarifariosDe*` (en vez de updates incrementales).

## 4. `lib/calc/paquetes.ts` — el motor de precios (422 líneas)

Doctrina: `PRODUCTO (costos netos) → PAQUETES (margen) → TARIFARIO`.

```
aporte_hotel    = costo_hotel/(1-%mk)                          (hotel SIEMPRE con mk)
aporte_servicio = costo_serv/(1-%mk)                            (servicio SIEMPRE con mk)
aporte_vuelo    = aplica_mk ? costo_tiquete/(1-%mk) : costo_tiquete + TA   (solo el VUELO decide mk vs TA)
PVP             = aporte_hotel + Σaporte_servicio + aporte_vuelo
impuesto (BNC)  = valor neto del tiquete, o un valor fijo
base_comisionable = PVP − impuesto
```

Funciones clave (orden del archivo):

- `hoyISO()` — hoy en zona `America/Bogota` (ancla de todas las vigencias de compra).
- `cubreFecha(t, t0)` — coverage de una temporada: usa `t.rangos[]` si existe, si no cae a
  `fecha_inicio/fecha_fin`; resta `blackouts[]`.
- `compraVigente(t, hoy)` — vigencia de COMPRA (no de viaje): una temporada puede cubrir la
  estadía pero no estar vendible hoy.
- **`entradasNoche(t0, temporadas, hoy, regimen?)`** — el resolver central: filtra temporadas
  que cubren la fecha + están vigentes de compra + (sin `regimen_restringido` o matchean el
  régimen); ordena por `prioridad` descendente. Todo lo demás pasa por aquí.
- `minNochesAplicable(...)` — noches mínimas exigidas por la temporada de mayor prioridad que
  cubre la noche de entrada (excluye `promo_noche_gratis`).
- `redondearMilArriba(n)` — redondea una venta HACIA ARRIBA al millar COP.
- **`netoNoche(t0, temporadas, netoPorTemporada, hoy, regimen?)`** — resuelve el costo neto de
  UNA noche; si el combo categoría/régimen no tiene neto cargado para la temporada ganadora,
  cae a la temporada `tarifa` de mayor prioridad que SÍ tenga neto cargado para ese combo
  (degradación ante huecos de datos, en vez de fallar toda la liquidación).
- **`promoNocheGratisFactor(...)`** — "N noches, 1 gratis": NO se resuelve noche a noche
  (depende del largo TOTAL de la estadía); ancla a la noche de check-in; si aplica, descuenta
  siempre exactamente 1 noche sin importar el total: `factor = (N-1)/N`.
- **`liquidarHotelNoches({fechaIda, numNoches, temporadas, netoPorTemporada, hoy?, regimen?})`**
  — suma `netoNoche` en cada noche calendario de una estadía FIJA (`bloqueo`/`dinamico`);
  `null` si alguna noche no tiene tarifa (todo-o-nada).
- **`liquidarHotelMasBarato({desde, hasta, numNoches, ...})`** — el costeo "desde" de
  `porcion_terrestre`: escanea toda la ventana `[desde,hasta]`, toma la noche MÁS BARATA
  encontrada en cualquier parte de la ventana, la multiplica por `numNoches`. La fecha real se
  re-liquida al reservar (`liquidarHotelNoches` vía el módulo Reservar).
- `marcar(costo, pctMk)` — `costo/(1-pctMk)`; `0` si `pctMk>=1`.
- `aporteVuelo(costoTiquete, aplicaMk, pctMk, ta)` — la regla específica del vuelo (mk vs TA).
- `redondearVenta(n, moneda?)` — COP al millar arriba; USD al dólar entero arriba.
- **`componerTarifa(...)`** → `{pvp, impuesto, baseComisionable}` — suma los 3 aportes marcados,
  redondea, `baseComisionable = pvp − impuesto` (el impuesto se RESTA, no se suma aparte —
  porque ya viene embebido dentro del aporte de vuelo/hotel).
- `precioServicio`/`costoServicio`/`factorLiquidacion` — modo persona vs. grupo, y el
  multiplicador según liquidación `noche`/`dia`/`paquete` (N noches ⇒ N+1 días calendario).

### Niño/infante — sin caso especial en el motor
Los 7 tipos de acomodación (`sencilla,doble,triple,multiple,nino,nino2,infante`) pasan por el
MISMO pipeline `liquidarHotelNoches/MasBarato → marcar → componerTarifa` — no hay matemática de
infante hardcodeada aparte. La única asimetría vive en el filtro de emisión de filas de
`generarTarifario`: para habitaciones "de verdad" un costo `<=0` se descarta; para
`nino/nino2/infante`, `0` se mantiene y se publica (gratis real).

### Vigencias restringidas por régimen
`hotel_temporadas.regimen_restringido` (migración 123): `NULL` = todos los regímenes; si se
fija, esa vigencia (cualquier `tipo`) solo participa para ese régimen — filtrado dentro de
`entradasNoche`, cada función acepta un parámetro `regimen` que fluye hasta ahí.

## 5. Tarifario interno (`/dashboard/tarifario`) — dos cosas bajo un mismo prefijo

1. **`page.tsx`** — el visor real: lee `tarifario_resultado` (`paquete_activo=true`), filtra
   vencidas (`filtrarTarifarioVencidas`), renderiza con el MISMO componente `TarifarioPublic`
   que usa la vitrina pública — internamente solo muestra `precio_pvp` por fila, nunca
   `base_comisionable`/`impuesto`/costos netos (eso solo está en la tabla de resultado de
   `ArmadoClient`, gateada a roles altos vía RLS de `armado_*`).
2. **`[id]/page.tsx` + `HotelesTab`/`TemporadasTab`/`ProductoTab`/`InclusionesTab`** — en
   realidad es una pantalla de gestión de **Destinos** (crear/fusionar/eliminar destinos,
   gestionar hoteles, tablas LEGACY `temporadas`/`temporada_fechas`/`tarifas`/`tarifa_precios`,
   e `inclusiones`). **No** lee/escribe `hotel_temporadas`/`tarifa_hotel`/`tarifario_resultado`
   del motor actual. No está en el nav (`SidebarNav`); solo enlazado desde los quick-links del
   home del dashboard. Es una pantalla legacy huérfana respecto al pipeline de precios actual
   — no confundir con el visor de Tarifario de arriba.

## 6. Tarifario público (`app/tarifario/`)

- **`page.tsx`** (server): resuelve roles (`esAgencia`, `puedeReservar`), pagina
  `tarifario_resultado` (1000 filas), enriquece con cupos (`cupos_por_bloqueo`, service-role),
  filtra vigencias de compra vencidas y salidas ya pasadas, restringe filas `modulo='servicios'`
  a paquetes tipo `servicios` (para que servicios add-on de un hotel no se filtren al catálogo
  de "Servicios" suelto).
- **`TarifarioPublic.tsx`**: toggle Vista tabla (estática, agrupada por Salida/Paquete/
  Servicios) vs. Vista Booking (`VistaBooking.tsx`, tarjetas dinámicas), + pestaña Programas si
  existen circuitos.
- **`VistaBooking.tsx`**: sub-tabs Bloqueo/Porción terrestre/Receptivos; tarjetas de hotel con
  precio "desde"; abre `HotelModal` → `Selector` (bloqueo/dinámico, fechas fijas) o
  `SelectorPorFechas` (porción, fechas reales del usuario, llama `cotizarPorFechas` server
  action que re-liquida con service-role — el costo neto nunca sale del servidor) →
  `EditorPax` (habitaciones + niños + infantes, validado contra `hotel_acomodaciones`). Los
  campos de fecha de `SelectorPorFechas` y de `BuscadorBooking.tsx` (motor general "Buscar
  alojamiento") arrancan **vacíos** — antes autocompletaban Regreso = Ida + 3 noches, quitado
  por pedido del dueño (jul-2026): las fechas se llenan a mano.
- **Receptivos** (jul-2026, rediseñado): dejó de ser una vitrina estática de "desde" por
  servicio. Ahora tiene su propio buscador `BuscadorReceptivos.tsx` (destino, ida, regreso,
  pax) sobre `buscarReceptivos()` (`lib/reservar/cotizar.ts`, service-role) que **liquida cada
  tour EN VIVO** para esas fechas/pax — resuelve la temporada vigente del servicio si tiene
  tarifa por fecha (`servicio_temporadas`), la tarifa por persona o el rango de grupo según el
  pax buscado (`precioServicio`), el recargo individual si va 1 pax, y el markup del paquete
  dueño del servicio (`armado_paquetes.pct_mk` del par `paquete_id+servicio_id`) — mismo motor
  que ya usa Reservar al agregar servicios a un paquete existente. Debajo del buscador queda una
  vitrina estática de "explorar todos", ahora **agrupada por destino** (antes todos mezclados en
  una sola grilla) usando el `desde` precomputado de `tarifario_resultado`. Cada tarjeta (de la
  búsqueda o de la vitrina estática) es clicable y abre `ReceptivoModal` con foto + descripción +
  precio — antes solo mostraba nombre y precio sin poder ver detalle. La foto
  (`servicios_adicionales.foto_url`, migración 138, bucket público `servicio-fotos`) se lee en
  vivo por `servicio_id` (igual patrón que `fotosPorHotel`), no se denormaliza en
  `tarifario_resultado`; se sube desde `/dashboard/producto/servicios` (miniatura clicable por
  fila, `ServicioFotoCell.tsx`).
- **`CartDrawer.tsx`** → `/tarifario/checkout` (gateado tras `checkoutHabilitado`).

### Columnas de la tabla horizontal
`Hotel · Categoría · R.A. · Sencilla · Doble · Triple · Múltiple · Chd1 · Chd2` — **infante NO
es columna** (solo aparece como nota/badge, para no ensuciar la comparación "desde" con un
precio casi-siempre-$0).

### El fix del precio "desde" — `minRoomPvp`/`ACOM_ROOMS`
`lib/acomodaciones.ts`: `ACOM_ROOMS = ["sencilla","doble","triple","multiple"]`.
`VistaBooking.tsx::minRoomPvp()` filtra explícitamente SOLO esas 4 acomodaciones y `precio_pvp >
0` antes de tomar el mínimo — así infante (casi siempre la tarifa más baja, a veces $0) nunca
domina el precio "desde" mostrado en la tarjeta del hotel.

### No existe distinción neta-vs-pública por rol
Ni `esAgencia` ni `puedeReservar` cambian ningún precio en `app/tarifario/*`. `esAgencia` solo
cambia un badge "Modo agencia"; `puedeReservar` solo muestra/oculta el botón "Reservar →". Todo
precio mostrado es `precio_pvp` de `tarifario_resultado` — la tabla es pública por diseño
(`using (true)` en su RLS de lectura) precisamente porque estructuralmente nunca contiene costo
neto.

### Gating minorista (confirmado, doble mecanismo)
1. **`proxy.ts`**: `MINORISTA_OCULTAS = ["/dashboard/reservar","/dashboard/cotizaciones",
   "/dashboard/vuelos","/dashboard/paquetes","/dashboard/producto","/cms"]` — si el cookie
   `tenant==='minorista'`, redirige a `/dashboard`. **`/dashboard/tarifario` NO está en esta
   lista**, y el `/tarifario` público tampoco (es una ruta pública/anónima, no se filtra por
   tenant a nivel de middleware).
2. **Nav** (`app/(dashboard)/layout.tsx`): `minoristaOculto: true` en `/tarifario`,
   `/dashboard/reservar`, `/dashboard/cotizaciones`, `/dashboard/vuelos`, `/dashboard/paquetes`
   ("Montaje de producto"), `/dashboard/producto` ("Netas"), `/cms` — se oculta el LINK aunque
   la ruta en sí no siempre esté bloqueada por el proxy. Duplicado también en
   `app/(dashboard)/dashboard/page.tsx`'s `OCULTOS_MINORISTA` (que sí incluye
   `/dashboard/tarifario`).

## 7. `tarifario_resultado` — esquema exacto

`id, paquete_id (FK cascade), paquete_nombre, paquete_activo, modulo (enum tarifario_modulo),
bloqueo_id (FK), bloqueo_label` (denormalizado — solo la ruta, nunca el PNR/record), `hotel_id
(FK), hotel_nombre, servicio_id (FK), servicio_nombre, destino_id (FK), destino_nombre,
categoria, regimen, acomodacion (enum acomodacion_tipo), noches, fecha_ida, fecha_regreso,
pax_desde, pax_hasta, tipo_tarifa ('persona'|'grupo'), base_comisionable, impuesto, precio_pvp
(el único valor público), descripcion, recargo_individual, moneda ('COP'|'USD'), salida_id (FK-like
→ salidas_dinamicas), created_at`.

RLS: **lectura pública total** (`using (true)`); **escritura** restringida a
`superadmin/gerencia/administracion/operaciones` — el mismo set de roles que puede escribir
`armado_*`. Es el único límite deliberado del sistema: la tabla está construida para nunca
contener costo neto, así que hacerla legible por cualquiera es seguro por construcción (lo
garantiza lo que `generarTarifario` decide escribir, no una máscara de columnas en RLS).

## Enlaces cruzados

- **Tarifas de hotel** (`tarifa_hotel`, `hotel_temporadas`) y el gotcha de texto-sin-FK — ver
  [`tarifas-hotel.md`](./tarifas-hotel.md).
- **Reservar** — re-liquida por fechas reales (`cotizarPorFechas`), descuenta cupos — ver
  [`reservar.md`](./reservar.md).
- **Vuelos/Inventario** — `bloqueos_vuelo` alimenta el paquete `bloqueo` — ver
  [`vuelos-inventario.md`](./vuelos-inventario.md).
