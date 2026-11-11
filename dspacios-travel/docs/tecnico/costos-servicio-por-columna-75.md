# Costos de servicio por columna: la asistencia médica no es costo receptivo (#75, 2026-11-10)

## Síntoma (Preview)
Un contrato de Tarifario con hotel y asistencia médica, y sin receptivo, guardaba la asistencia en `ventas.costo_receptivo`.

## Causa demostrada
En el flujo de Tarifario, el costo de **todos** los servicios se sumaba en una sola variable y se escribía como `costo_receptivo`. Ocurría en `calcularFinancieroReserva` (reserva individual, opcionales e incluidos), en la rama de oferta #63 y en `convertirCotizacionCarrito`. Al editar un pendiente pasaba lo mismo: `actualizarServiciosContrato` escribía `costo_receptivo: costoReceptivo`.

La CxP de cada servicio sí salía con su tipo (`tipoProveedorCxpServicio`: asistencia→`asistencia`), así que columna y obligación no coincidían.

Reproducido con el código anterior sobre una base nueva:

| Columna / obligación | Valor |
|---|---|
| `costo_receptivo` | 60.000 |
| `costo_asistencia` | 0 |
| Obligación de asistencia (CxP) | 60.000 |

## Corrección (origen)
`lib/reservar/serviciosPaquete.ts` añade `columnaCostoServicio` y `costosServicioPorColumna`. La columna sale del **mismo tipo** que la CxP:
- asistencia → `costo_asistencia`;
- tours/traslados y «otro» → `costo_receptivo`, como siempre. `otros_costos` no se toca porque también recibe costos manuales que no son servicios.

Se aplica en la reserva individual (opcionales e incluidos), en la oferta #63 (equivalentes de sus mismas CxP en la moneda de la oferta), en el carrito y en la edición de servicios de un pendiente. La edición usa la RPC `pendiente_aplicar_servicios` de la 288, que ya admite `costo_asistencia`.

Se conservan el costo directo total, la moneda, la TRM y los componentes. La cobertura de CxP (`faltantesCxP`) mide las columnas de servicio como una sola bolsa, así que no aparecen faltantes ni duplicados. **Sin migración. No reclasifica históricos.**

## Pruebas
`pruebas/alcance262.pg.ts`, bloque «75 · costos por categoría», corre las acciones reales contra PostgREST y Postgres en una base nueva:

| Caso | Qué comprueba |
|---|---|
| CC1 | Reserva individual con hotel y asistencia, sin receptivo: asistencia en `costo_asistencia` y receptivo en 0. El costo directo cuadra con las obligaciones. Al reabrir, la lectura con sesión ve las mismas columnas. En pendiente la asistencia es prevista; al confirmar queda **una** CxP de 60.000 y las columnas no cambian. Aparece en la rentabilidad interna. |
| CC2 | Control con tour: `costo_receptivo` 80.000 y asistencia en 0. |
| CC3 | Carrito: el mismo reparto, más el control con tour. |
| CC4 | Editar los servicios de un pendiente: añadir asistencia la pone en su columna; quitarla deja 0; el tour sigue en receptivo. |
| CC5 | Conteo de solicitudes (ver la sección de consumo). |

Con el código anterior fallan CC1, CC3 y CC4; el control CC2 pasa en las dos versiones.

Además, en `pruebas/costosServicioColumna75.test.ts` va la prueba pura y en `serviciosPaqueteWiring.test.ts` la de cableado (R294-5 adaptada). Con `cxpCobertura`, `financieroContratoWiring` y `obligacionesAlConfirmar288` suman 119/119.

Las corre un runner local que reutiliza `alcance262.pg.ts` sobre una plantilla con 287 y 288 aplicadas.

## Validación de consumo (`docs/agents/VALIDACION_CONSUMO_VERCEL.md`)
**Alcance:** dos Server Actions y un ayudante puro. No se tocan efectos React, sondeos, reintentos, temporizadores ni rutas de cliente. `revalidatePath` es el mismo de antes.

**Medido en CC5,** contando cada solicitud HTTP de la app a PostgREST:

| Acción | Código nuevo | Código anterior |
|---|---|---|
| `convertirCotizacion` | 41 | 41 |
| Editar servicios, añadir asistencia | 31 | 31 |
| Editar servicios, quitar asistencia | 20 | 20 |
| Repetir la misma edición | 31 | 31 |
| Recarga de la ficha | 1 | 1 |
| `confirmarVenta` | 26 | no medido |

- Con el código anterior, CC5 se detiene en su aserción de costos antes de confirmar, así que esa fila no tiene comparación.
- El desglose por ruta de las demás acciones es idéntico entre versiones; en la edición, 1 RPC `pendiente_aplicar_servicios` más lecturas de catálogo.
- Tras cada acción se espera 1,5 s en reposo sin ninguna solicitud nueva.
- Repetir la misma edición cuesta lo mismo: no hay crecimiento ni reintentos.

**Falta, como siempre:** la verificación del dueño en Network/Observability de Preview. Las pruebas usan una sola pestaña; el cambio no añade nada que dependa de varias.

## Límites
- En un pendiente de Tarifario, editar servicios recalcula `costo_asistencia` desde lo seleccionado, igual que ya hacía con `costo_receptivo`. Un ajuste manual de esa columna se sobrescribe.
- «Otro» sigue en `costo_receptivo`. Moverlo a `otros_costos` es otra decisión.
- La edición de servicios no recalcula los servicios **incluidos** del paquete. Es comportamiento previo y no cambia.
- No probé la página de la ficha ni la tabla de `GestionTabs`. Reciben estas columnas tal cual y ya muestran «Costo asistencia».
