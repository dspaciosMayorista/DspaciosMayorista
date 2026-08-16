# Vuelos / Inventario de sillas — hoja técnica

> Índice: [`README.md`](./README.md) · Relacionado: [`reservar.md`](./reservar.md)

Control de bloqueos de vuelo (records/PNR negociados) y del inventario de sillas que se
descuentan al reservar. Vive en `app/(dashboard)/dashboard/vuelos/`.

---

## 1. Modelo de datos

Migración base: `20260601000003_schema_vuelos.sql`. Enum **`estado_silla`**: `disponible,
en_plazo, confirmada, devuelta, no_vendida, cambio, cambio_entrante`.

- **`bloqueos_vuelo`**: `id, record` (PNR, **unique**, se guarda en mayúsculas), `aerolinea,
  ruta, origen, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso,
  fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar`
  (tarifa de reventa/PVP), `tarifa_neta` (costo pagado a la aerolínea, migración 071),
  `fecha_devolucion` (plazo para devolver sillas), `fecha_emision, notas, proveedor_id` (FK
  `proveedores`), `destino_id` (FK `destinos` — **no hay columna de destino en texto plano,
  solo la FK**), `rangos_edad bigint[]`.
- **`sillas`**: `id, bloqueo_id` (FK), `numero_silla, estado, numero_contrato` (FK `ventas`,
  venta "orgánica"), `contrato_manual` (venta externa fuera del flujo — el CHECK
  `sillas_contrato_unico`, migración 085, obliga a que `numero_contrato IS NULL OR
  contrato_manual IS NULL`, nunca ambos), `pasajero_nombres/apellidos/tipo_doc/numero_doc/
  nacimiento, asesor, agencia, hotel, acomodacion, plazo, inf_nombres/apellidos/tipo_doc/
  numero/nacimiento, responsable_menor`.
- **`movimientos_silla`**: **el** mecanismo de "cambios entre records" (log de auditoría):
  `id, silla_id` (FK), `bloqueo_origen_id` (FK), `bloqueo_destino_id` (FK), `motivo,
  fecha_movimiento, registrado_por`.
- **`bloqueo_cambios`**: tabla SEPARADA — log operativo de cambios de horario del vuelo (y,
  de paso, registra entradas de "cupo eliminado"): `id, bloqueo_id` (FK cascade), `fecha,
  detalle` (texto "antes→después"), `nota, registrado_por`.
- Vista `cupos_por_bloqueo` existe pero no se consulta directamente en ningún lado; la app
  recalcula ocupación con `lib/vuelos/stats.ts`.
- **`rangos_edad`** (catálogo, migración 021): `id, denominacion, edad_min, edad_max, activo`.
  La misma columna `rangos_edad bigint[]` se agregó en TRES tablas (`hoteles`,
  `bloqueos_vuelo`, `servicios_adicionales`), todas editadas con el mismo componente
  compartido `<RangosEdadPicker>`.
- RLS: lectura para `superadmin/gerencia/administracion/operaciones/venta/control_vuelo`;
  escritura (ALL) restringida a `superadmin/administracion/operaciones/control_vuelo`.

## 2. `app/(dashboard)/dashboard/vuelos/actions.ts` (694 líneas) — funciones exportadas

| Función | Qué hace |
|---|---|
| `crearBloqueo` | Inserta el bloqueo + N filas en `sillas` numeradas 1..cuposTotal. |
| `actualizarBloqueo` | Edita el bloqueo; llama `regenerarTarifariosDeBloqueo`. |
| `registrarCambioOperacional` | Diffea 8 campos de horario/fecha, loguea en `bloqueo_cambios`, llama `regenerarTarifariosDeBloqueo`. |
| `cargarBloqueosMasivo` | Carga CSV; resuelve destino/proveedor/rangos_edad por nombre. |
| **`cambiarSillas({origenId, destinoId, cantidad, motivo})`** | **La** transferencia masiva entre records: selecciona N sillas `disponible`/`cambio_entrante` en el origen → `estado='cambio'`; inserta N filas nuevas en el destino con `estado='cambio_entrante'`; reajusta `cupos_total` en ambos lados; loguea en `movimientos_silla`. |
| `cambiarEstadoSilla` | Override manual (`EstadoSillaManual = disponible\|en_plazo\|confirmada\|devuelta\|no_vendida` — `cambio`/`cambio_entrante` NO son seleccionables a mano). |
| `asignarContratoManual` / `quitarContratoManual` | Ventas externas fuera del flujo de reservar. |
| `eliminarCupo` | Borra una silla en duro (solo si está `disponible`/`cambio_entrante` y sin contrato). |
| `eliminarBloqueo` | Borra el bloqueo completo, regenera el tarifario de los paquetes afectados. |
| `editarPasajeroSilla` / `borrarPasajeroSilla` | Edita o borra los datos de pasajero de una silla; borrar deja la silla en `disponible`. |
| `moverPasajeroSilla` | Transferencia de **un solo** pasajero (con contrato+estado) entre records — el análogo de 1 silla de `cambiarSillas`. |
| `cargarPasajerosMasivo` | Carga CSV masiva de pasajeros; dedup por PNR+numero_doc. |

## 3. Pantallas

- **`/dashboard/vuelos`** (dashboard de control): dos pestañas — **Inventario**
  (`BloqueosTabla`, tarjetas vía `lib/vuelos/stats.ts`; **`ocupacionPct(c) =
  round((confirmadas+en_plazo)/total*100)`** — cuenta confirmadas Y en plazo como
  ocupadas) y **CONTROL VUELOS** (texto de la pestaña en mayúsculas, así lo pidió el
  dueño — `ControlVuelosTabla`, ver §7). La pestaña activa vive en la URL
  (`?vista=inventario` | `?vista=control-vuelos`, default `inventario`), no en estado de
  React — sobrevive a un recargado y es enlazable. El encabezado (H1 + subtítulo) también
  cambia según la vista: "Inventario de vuelos" / "Control vuelos". La página consulta
  `bloqueos_vuelo` SIEMPRE (una sola vez) pero `sillas` **solo si `vista ===
  "inventario"`** — Control Vuelos no usa sillas para nada (ni columnas ni ocupación), así
  que no tiene sentido descargarlas.
- **`/dashboard/vuelos/historico`**: mismo patrón de dos pestañas ("Histórico de vuelos" /
  "Control vuelos histórico"), sobre bloqueos pasados (`esPasado()`) únicamente — nunca
  mezcla activos con históricos. **`ventaPct(c) = round(confirmadas/total*100)`** — excluye
  las en plazo (pendientes). El botón "Histórico" de la página activa y el link de regreso
  de la página histórica **propagan el `?vista=` actual en ambas direcciones**
  (`/dashboard/vuelos?vista=control-vuelos` → Histórico → `/dashboard/vuelos/historico
  ?vista=control-vuelos`, y de vuelta) — cambiar de pestaña en una no debe perder la
  pestaña elegida en la otra.
- **`/dashboard/vuelos/[id]`**: pestaña Pasajeros (tabla de sillas) + pestaña Cambios
  (`CambiarSillasForm`, `CambioOperacionalForm`, historial de `movimientos_silla`/
  `bloqueo_cambios`).
- **`/dashboard/vuelos/pasajeros`**: búsqueda global de pasajeros + widget de carga CSV masiva.

## 4. Cron diario

`app/api/cron/liberar-vencidas/route.ts` — `GET`, header `Authorization: Bearer
${CRON_SECRET}`, **falla cerrado** (503) si la env var no está configurada. Llama
`liberarVencidas()` (`reservar/actions.ts`). Programado en `vercel.json`: `"0 6 * * *"`.

## 5. Conexión con Reservar

- `disponible`/`cambio_entrante` → `en_plazo` en `reservarDesdeTarifario()`.
- `en_plazo` → `confirmada` vía `confirmarVenta()`.
- `en_plazo` → `disponible` vía `liberarVencidas()` (cron).
- Cualquier estado → `disponible` al eliminar el contrato, vía RPC `eliminar_contrato(p_numero,
  p_reusar)` (migración 060, candado de rol agregado en migración 117).

Ver [`reservar.md`](./reservar.md) para el flujo completo de `reservarDesdeTarifario`.

## 6. Gotcha confirmado: `bloqueos_vuelo.rangos_edad` no se usa para clasificar pasajeros

No existe ningún código que **lea de vuelta** `bloqueos_vuelo.rangos_edad` al momento de
liquidar/clasificar pasajeros (confirmado por grep en todo el proyecto). La clasificación de
niño/infante SIEMPRE corre con los umbrales de edad del **hotel**
(`hoteles.edad_infante_max/edad_nino_max`), nunca los del vuelo. Hoy `bloqueos_vuelo.rangos_edad`
es solo un catálogo guardado/mostrado — no es un insumo activo de precio/clasificación. Vale la
pena tenerlo presente antes de invertir tiempo intentando "usar" ese campo en el motor de
reservar: no está conectado a nada todavía.

## 7. Control general por record (migración 152)

Tres campos MANUALES en `bloqueos_vuelo`, independientes del estado de las sillas —
`lib/vuelos/control.ts` centraliza tipos, type guards (`esModalidadEmision`/
`esEstadoEmision`/`esEstadoPago`) y las etiquetas de UI:

- **`modalidad_emision`** (`individual` | `grupo`) — obligatoria al crear un bloqueo
  (`crearBloqueo` rechaza si falta o no es un valor válido).
- **`estado_emision`** (`pendiente` | `emitido`) — si el vuelo YA se emitió. **No** se
  deduce de `fecha_emision` (que sigue siendo solo la fecha límite/programada, renombrada
  en la UI a "Fecha límite de emisión" para dejar la distinción clara).
- **`estado_pago`** (`pendiente` | `pagado`) — si YA se le pagó al proveedor/aerolínea.
  **No** es el pago del cliente (eso vive en `abonos`/`cuentas_por_pagar` por contrato);
  deliberadamente no se cruza con eso.

**`null` ≠ `'pendiente'`.** Un registro de antes de la migración 152 no tiene forma de
saber si ya se emitió o se pagó, así que las tres columnas nacen SIN default — un bloqueo
viejo queda con las tres en `null`, y la UI lo muestra como "Sin definir" (modalidad) /
"Por confirmar" (estados), nunca como "Pendiente" (que afirmaría algo que no se sabe). Un
bloqueo NUEVO sí nace en `estado_emision`/`estado_pago = 'pendiente'`, pero eso lo decide
la aplicación en el `insert` (`crearBloqueo`/`cargarBloqueosMasivo`), no un default de
columna.

**Edición y auditoría — RPC atómico `actualizar_control_bloqueo()`.** La primera versión
de `actualizarControlBloqueo` hacía `SELECT` (estado anterior) + `UPDATE` + `INSERT` en
`bloqueo_cambios` como tres llamadas sueltas de supabase-js — si el `INSERT` del historial
fallaba, el `UPDATE` ya había corrido sin dejar rastro (mismo patrón sin atomicidad que
`registrarCambioOperacional`, ver más abajo). Se reemplazó por una función de Postgres
(`language plpgsql`, **sin** `security definer`) que hace `SELECT ... FOR UPDATE` (bloquea
la fila) + `UPDATE` + `INSERT` en `bloqueo_cambios`, las tres dentro de la misma
transacción — si el `INSERT` final falla, todo se revierte, incluido el `UPDATE`. El actor
("quién") se resuelve DENTRO de la función por `auth.uid()` contra `public.usuarios`, no se
recibe como parámetro del cliente. La Server Action `actualizarControlBloqueo` solo valida
el shape de los tres campos y delega en el RPC; `revalidatePath` corre solo después de
confirmar que el RPC no devolvió error. **No** llama a `regenerarTarifariosDeBloqueo`: estos
tres campos son control operativo, no afectan tarifa ni fechas de los paquetes armados. El
formulario general "Editar bloqueo" (`actualizarBloqueo`/`EditarBloqueoForm`) NO toca estos
campos — `BloqueoEditInput` los excluye explícitamente (`Omit<BloqueoInput, "cuposTotal" |
"modalidadEmision">`) para que solo tengan un único camino de escritura con historial.

Probado en Postgres local (`supabase/scripts/test_control_bloqueo_atomico.sql`): cambio
correcto → un historial exacto con el antes→después esperado; fallo forzado del `INSERT`
del historial (trigger de prueba) → los tres campos quedan intactos; usuario sin permiso
de escritura (`venta`, que sí puede leer) → no modifica ni registra nada — Postgres exige
que `SELECT ... FOR UPDATE` también pase la policy de `UPDATE`, así que el rechazo ocurre
ya al intentar bloquear la fila; nota sin cambio de estado → registra solo la nota; dos
cambios consecutivos → cada entrada del historial refleja el antes→después real de ESE
cambio, no el estado original ni el final.

⚠️ **`registrarCambioOperacional` (horario/vuelo) y `crearBloqueo`/`cargarBloqueosMasivo`
(bloqueo + sillas) tienen el MISMO patrón sin atomicidad, sin corregir todavía** — quedaron
fuera del alcance de la migración 152 a propósito. Ver
[`docs/futuro/atomicidad-vuelos-legacy.md`](../futuro/atomicidad-vuelos-legacy.md).

**Control como pestaña propia, separada del inventario de sillas.** La primera versión
metía los tres campos como una sola columna "Control" (con `ControlBadges`, tres badges
juntos) dentro de la misma tabla de inventario (`BloqueosTabla`) — con 15 columnas la tabla
quedaba pesada, y una sola columna con tres badges era ambigua (no se podía filtrar ni leer
cada campo por separado). Ahora `/dashboard/vuelos` y `/dashboard/vuelos/historico` tienen
dos pestañas independientes (ver §3):

- **Inventario** (`BloqueosTabla.tsx`) — la tabla de siempre, orientada a sillas/ocupación
  (record, aerolínea, ruta, ida, regreso, disponibles/plazo/confirmadas/devueltas/no
  vendidas, total, ocupación, fecha de devolución). Ya NO tiene la columna Control ni sus
  filtros — solo conserva los filtros de ruta y mes. Sigue siendo la única pestaña con el
  botón de eliminar un record (`EliminarBloqueoBtn`).
- **Control Vuelos** (`ControlVuelosTabla.tsx`, componente nuevo y dedicado) — record
  (enlazado al detalle), aerolínea, ruta, ida (fecha + N° de vuelo), regreso (fecha + N° de
  vuelo), **fecha límite de emisión** (`bloqueos_vuelo.fecha_emision` — OJO, no es
  `fecha_devolucion`), y Modalidad/Emisión/Pago como **tres columnas separadas**, cada una
  con su propio `EstadoBadge` (mismos colores/badges que antes — `labelModalidad`/
  `labelEstadoEmision`/`labelEstadoPago` de `lib/vuelos/control.ts`, "Sin definir"/"Por
  confirmar" completos, nunca truncados). Filtros propios e independientes de ruta, mes,
  modalidad, emisión y pago, con badge de cantidad de records. Sin columnas de sillas, sin
  fila de totales, sin acción de eliminar.

`ControlBadges` (el badge combinado de los tres campos) **no se tocó** — sigue usándose tal
cual en la pestaña "Control" del detalle de UN record (`/dashboard/vuelos/[id]`,
`BloqueoTabs.tsx`), que es una vista distinta (edita el control de ESE record, con
historial) y queda fuera del alcance de este cambio.

**Helpers compartidos entre las dos tablas** (`lib/vuelos/filtros.ts`, nuevo): `mesKey`/
`mesLabel`/`MESES` (agrupar por mes de `fecha_ida`) y `matchControl`/`SIN_DEFINIR_VAL`
(mismo criterio de "sin_definir ⇒ filtra por `null`, nunca lo confunde con `'pendiente'`"
que ya usaba el filtro de Control en la tabla vieja). El estado de cada set de filtros vive
en `useState` LOCAL de cada componente — Inventario y Control Vuelos filtran de forma
completamente independiente entre sí, aunque compartan la lógica pura de comparación.

**Pestaña en la URL, no en estado de React.** `VistaTabs.tsx` (nuevo, sin `"use client"`:
son enlaces `<Link href="?vista=...">`, no hace falta ningún hook) lee el `vista` que cada
página ya resolvió desde `searchParams` (`vistaDeParam`, con fallback a `'inventario'` si
falta o trae un valor desconocido) y compara contra cada pestaña para el subrayado activo.
Precedente distinto al de `BloqueoTabs.tsx` (pestañas del detalle de un record, en
`useState` local, sin URL) — acá se prefirió la URL a propósito porque el pedido explícito
era que la pestaña sobreviviera a un recargado y fuera enlazable directamente
(`/dashboard/vuelos?vista=control-vuelos`).

**Ronda 2 de ajustes (jul-2026):** tres correcciones sobre el rediseño de arriba, pedidas
tras ver la primera versión en revisión:

1. **Texto exacto de la pestaña y encabezado por vista.** El texto de la pestaña de
   Control quedó como el dueño lo pidió textualmente: `CONTROL VUELOS` (todo en
   mayúsculas — la pestaña de Inventario no cambió). Antes el H1/subtítulo de la página
   decían siempre "Inventario de vuelos" sin importar la pestaña activa, lo cual era
   contradictorio al estar parado en Control Vuelos. Ahora el H1 y el subtítulo debajo
   cambian según `vistaInventario` en las cuatro combinaciones (página activa e
   histórica × Inventario/Control).
2. **La pestaña sobrevive a navegar a Histórico y de vuelta.** El botón "Histórico" de
   `/dashboard/vuelos` y el link de regreso "← Inventario de vuelos" de
   `/dashboard/vuelos/historico` eran links ESTÁTICOS (`href="/dashboard/vuelos/
   historico"` / `href="/dashboard/vuelos"`) — perdían la pestaña elegida al cruzar entre
   las dos páginas. Ahora ambos toman `vista` (el que la página ya resolvió desde
   `searchParams`) y lo propagan: `href={`/dashboard/vuelos/historico?vista=${vista}`}` y
   `href={`/dashboard/vuelos?vista=${vista}`}` — el link del estado vacío "No hay vuelos
   activos → revisa el histórico" también se corrigió igual.
3. **Control Vuelos ya no descarga `sillas`.** Antes ambas páginas hacían
   `Promise.all([bloqueos_vuelo, sillas])` sin importar la pestaña — la tabla de Control
   nunca usa sillas (sin columnas de sillas, sin ocupación), así que esa descarga era
   deuda que crecería con el inventario real sin ningún beneficio en esa vista.
   `bloqueos_vuelo` se sigue consultando SIEMPRE (una sola vez, ambas pestañas la
   necesitan); `sillas` solo corre si `vista === "inventario"` — en Control Vuelos el
   segundo elemento del `Promise.all` es un `Promise.resolve({ data: null })` (no golpea
   la red) en vez de la consulta real, y `conteo`/`tot`/`ocup` (activa) /
   `gen`/`totPas` (histórica) tampoco se calculan, quedan en sus valores por defecto sin
   invocar `conteoPorBloqueo`/`sumarConteos`/`ocupacionPct`. El comportamiento de
   Inventario no cambió: sigue pidiendo ambas tablas en paralelo exactamente como antes.

**RLS:** sin cambios — las tres columnas viven en `bloqueos_vuelo`, que ya tiene su policy
de escritura (`superadmin/administracion/gerencia/operaciones/control_vuelo`, migración
137); una columna nueva hereda esa policy, Postgres no tiene RLS por columna. El RPC no usa
`service_role` ni `security definer` en ningún punto — corre con el rol de quien llama,
sujeto a esas mismas policies.

**UI:** badges compactos (`components/vuelos/ControlBadges.tsx`, reutiliza el componente
genérico `EstadoBadge` — infiere el tono del TEXTO: "Emitido"/"Pagado" → verde,
"Pendiente" → ámbar, "Sin definir"/"Por confirmar" → gris neutro) en el encabezado del
detalle del bloqueo y como columna "Control" en `BloqueosTabla` (compartida por
`/dashboard/vuelos` y `/dashboard/vuelos/historico`). Pestaña "Control" en el detalle
(`BloqueoTabs` + `ControlBloqueoForm`), junto a Pasajeros y Cambios. `BloqueosTabla` suma
filtros por modalidad/emisión/pago (con una opción "sin definir" que filtra por `null`
explícitamente, distinta de "todas").

**CSV:** `cargarBloqueosMasivo` exige `modalidad_emision` por fila (rechaza la fila si
falta o no es `individual`/`grupo`); `estado_emision`/`estado_pago` son opcionales — vacío
= `'pendiente'` (una fila nueva del CSV es un bloqueo nuevo, genuinamente empieza así),
cualquier otro texto tiene que ser exactamente un valor válido o la fila se rechaza
(validación estricta, no se adivina ni se ignora un typo).

**Notificaciones:** `lib/notificaciones.ts` deja de incluir la alerta de "fecha límite de
emisión" cuando `estado_emision = 'emitido'`. La alerta de devolución (`fecha_devolucion`)
no depende de esto — se conserva igual que antes.

## Enlaces cruzados

- **Reservar** — descuenta cupos (`disponible→en_plazo`), confirma (`en_plazo→confirmada`),
  libera vencidas — ver [`reservar.md`](./reservar.md).
- **Tarifario y paquetes** — un bloqueo alimenta el paquete tipo `bloqueo` (`armado_vuelos`) —
  ver [`tarifario-y-paquetes.md`](./tarifario-y-paquetes.md).
