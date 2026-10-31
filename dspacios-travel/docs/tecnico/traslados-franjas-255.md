# Traslados: tarifa sin «GENERAL» + suplementos por franja horaria (migración 255)

## Qué cambió
1. **Un servicio solo se vende con una vigencia** (`servicio_temporadas` con fechas, en vigencia de compra) y, en cobro por grupo, con **un rango de pasajeros de ESA vigencia** (`servicio_tarifa_pax.temporada = nombre`). La tarifa `GENERAL` (`servicios_adicionales.precio_persona`, rangos `GENERAL`, `recargo_individual` base) **ya no es fuente de precio ni de costo** en las rutas convertidas. El dato no se borra. Un pax fuera de todo rango ya no cae al rango más alto.
2. **Suplementos por franja horaria** (`servicio_suplementos_franja`, cuelga de la vigencia por `servicio_temporada_id`): hora desde/hasta, tramo (`llegada`/`salida`/`ambos`), tipo (`monto` neto o `porcentaje` del neto base), cobro (`grupo`/`persona`). Se suman al **costo neto** y después se aplica el margen.

## Reglas de las franjas (código en `lib/calc/trasladoFranjas.ts`; trigger equivalente en la 255)
- `[desde, hasta)`: el inicio se incluye, el fin no. `desde > hasta` cruza la medianoche (19:00–06:00). `desde == hasta` se rechaza; todo el día = `00:00`–`24:00` (`24:00` solo como fin).
- Solape = dos franjas de la misma vigencia que comparten tramo (`ambos` choca con los dos) y alguna hora común → no se puede guardar.
- `ambos` es UNA regla evaluada por tramo: un cargo por cada tramo que cumple, nunca dos por el mismo tramo.
- Llegada = hora local de **llegada** del vuelo de ida. Salida = hora local de **salida** del vuelo de regreso. Sin hora conocida para un tramo con franja **no se cotiza** (búsqueda: tarifa base + `requiereHora`; carrito/conversión: falla).
- `porcentaje` = % del neto base (tarifa × factor de liquidación, sin recargo individual).

## Fuente única de cálculo
`lib/calc/servicioTarifa.ts::costoNetoServicio` lo usan la venta (`lib/reservar/liquidacionServicio.ts::calcularPrecioServicioDetallado`) y el costo/CxP (`lib/reservar/costosObligacionesCarrito.ts::liquidarCostoTour`). Lectura de vigencias+franjas: `lib/reservar/temporadasServicio.ts` (tolera que la 255 aún no esté aplicada).

## Dónde viven las horas
`bloqueos_vuelo.hora_llegada_ida/hora_salida_reg` (time), `salidas_dinamicas` (text), `contrato_vuelos.hora_salida/hora_llegada` por tramo (texto, ya contratado). Porción terrestre, empaquetados y salidas vinculadas a empaquetado **no guardan horas** → se captura la hora prevista (`BuscadorReceptivos` → carrito `TourCartItem.horas` → `SolicitudTourValidado.horas`). Con vuelo, el servidor usa `lib/reservar/horasRecorrido.ts` y pisa lo que mande el navegador.

## Cotización → conversión
La cotización guarda en `payload.tours[].horas` las horas con que cotizó y `suplementos`. `convertirCotizacionCarrito` compara ANTES de numerar con el horario vigente del vuelo (`horarioCambio`); si cambió, devuelve «recotiza antes de generar el contrato» y no crea nada. Costo/CxP se liquidan con las mismas horas.

## Rutas convertidas (ya no usan GENERAL como respaldo)
Búsqueda y checkout (`liquidarServicioPuntual`), costo/CxP (`liquidarCostoTour`), publicación (`generarTarifario`: opcionales e incluidos), cotización por fechas (`liquidacionHotel.evaluarHotelPorFechas`), Reservar interno (`computo.ts`: opcionales e incluidos; costos en `reservar/actions.ts`), Bernalo (`computoReservaBernalo.ts`) y edición de servicios de un contrato pendiente (`contratos/actions.ts::actualizarServiciosContrato`, que re-liquida con las mismas funciones y toma las horas de `contrato_vuelos`).

Publicación = **referencia** (`lib/calc/servicioVigencias.ts::referenciaPublicacion`): mínimo neto entre las vigencias que cubren TODO el viaje del paquete; rangos de grupo idénticos entre esas vigencias o falla. Las rutas que escalan el precio publicado (`computo.ts`) usan la MISMA función para el denominador. Incluidos: `incluidoEnEstadia` exige UNA vigencia en la estadía y sin franjas. Cualquier faltante falla con mensaje legible y la publicación no escribe nada.

**Pendiente conocido:** el carrito muestra el precio base de un traslado con franjas añadido desde la tarjeta de un hotel hasta el checkout (el servidor lo recalcula con la hora del vuelo); la vista previa de la tarjeta ya lo rotula «Desde / Total referencial».

## Operación
Orden: preflight 255 → `auditoria_255_servicios_sin_vigencia.sql` (qué se queda sin tarifa) → migración 255 → postcheck 255. Rollback: `rollback_255_…` (aborta si hay franjas). Preview y Producción comparten base.
