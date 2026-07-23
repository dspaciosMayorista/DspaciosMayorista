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

- **`/dashboard/vuelos`** (dashboard de control): tarjetas vía `lib/vuelos/stats.ts`.
  **`ocupacionPct(c) = round((confirmadas+en_plazo)/total*100)`** — cuenta confirmadas Y en
  plazo como ocupadas.
- **`/dashboard/vuelos/historico`**: solo bloqueos pasados (`esPasado()`).
  **`ventaPct(c) = round(confirmadas/total*100)`** — excluye las en plazo (pendientes).
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

## Enlaces cruzados

- **Reservar** — descuenta cupos (`disponible→en_plazo`), confirma (`en_plazo→confirmada`),
  libera vencidas — ver [`reservar.md`](./reservar.md).
- **Tarifario y paquetes** — un bloqueo alimenta el paquete tipo `bloqueo` (`armado_vuelos`) —
  ver [`tarifario-y-paquetes.md`](./tarifario-y-paquetes.md).
