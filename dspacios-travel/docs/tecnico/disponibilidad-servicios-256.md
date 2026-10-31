# Disponibilidad de servicios por fecha/salida (migración 256)

Decisión del dueño (ago-2026): **no** se extienden vigencias, **no** se copia GENERAL y **no** se pone tarifa en un hueco sin respaldo del proveedor. Antes, un servicio
con un hueco de vigencia hacía fallar la generación de TODO el paquete («No se publicó una tarifa nueva»). Ahora se publica solo lo vendible.

## Regla

| Servicio | Sin vigencia/tarifa válida en… | Efecto |
|---|---|---|
| **Opcional** | ninguna fecha del viaje del paquete | no se publica (oculto) |
| **Opcional** | parte del viaje | se publica con `tarifario_resultado.fechas_disponibles` (tramos `{desde,hasta}`) y la descripción lo dice; fuera de los tramos no se ofrece |
| **Incluido** | la fecha de ida de una salida (bloqueo/dinámico) o la ventana de una porción terrestre | el servicio **se OMITE de esa salida/estadía** (no entra al PVP, al costo ni a la CxP, ni a «Incluye»/documentos) y el hotel/paquete **se ofrece igual, sin ese servicio**; en las salidas cubiertas va «incluido y cobrado» |
| **Incluido** | todas las salidas | el paquete se ofrece sin el servicio en todas (diagnóstico: «Servicios incluidos omitidos por falta de tarifa vigente…») |
| **Incluido** con franjas horarias o varias vigencias en la estadía | — | error de CONFIGURACIÓN (no «sin tarifa»): esa salida no se publica; con ninguna salida vendible el paquete se publica vacío con «Sin oferta vendible» |

> Cambio de decisión (257 de producto, sin migración): antes un incluido sin cobertura impedía publicar/reservar la salida. El dueño pidió omitir el servicio y conservar la oferta del hotel.
> Un incluido omitido en la cotización/carrito queda fuera de la composición recalculada; la conversión compara composición y costo y rechaza si cambiaron (`validarIncluidosConversion`), y el precio se re-valida
> en el servidor (checkout y conversión): nunca se sustituye en silencio. El texto manual «Incluye» del paquete (migración 169) es libre y NO se edita solo: el diagnóstico lista los servicios omitidos para que el operador lo ajuste.

Una vigencia con fechas invertidas (`fecha_fin < fecha_inicio`) o sin fechas **no cubre ninguna fecha** y su tarifa no se usa ni se corrige.

## Dónde vive

- `lib/calc/servicioVigencias.ts` — `coberturaVentana` (tramos cubiertos) y `referenciaPublicacion` (ya no falla por un hueco parcial; devuelve `cobertura`).
  `incluidoEnEstadia` no cambió: sigue exigiendo UNA vigencia para la estadía.
- `lib/tarifario/disponibilidadServicios.ts` — puro: tramos, etiqueta de disponibilidad, `diagnosticoDisponibilidad`.
- `app/(dashboard)/dashboard/paquetes/actions.ts::generarTarifario` — omite salidas con incluidos sin cobertura (`salidasOmitidas`), oculta/parcializa opcionales, publica el
  conjunto vacío si ninguna salida es vendible y registra el diagnóstico (`registrar_diagnostico_tarifario`). La falta de vigencia **ya no marca la generación fallida**.
- Migración 256: `tarifario_resultado.fechas_disponibles jsonb` (solo `modulo = 'servicios'`), `armado_paquetes.tarifario_diagnostico text`, vista publicable ampliada,
  publicador interno (huella de la 254) que guarda los tramos y borra el diagnóstico anterior, y `registrar_diagnostico_tarifario(paquete, generacion, texto)` (solo si esa
  generación es la publicada). Atomicidad intacta: filas + estado + borrado del diagnóstico en la misma transacción; el diagnóstico nuevo es informativo.
- Venta: `computo.ts` re-valida SIEMPRE contra la vigencia viva de la fecha pedida (opcional: `resolverTarifaServicio`; incluido: `incluidoEnEstadia`). Una fila publicada
  vieja jamás vende una fecha sin cobertura; el mensaje de un incluido sin vigencia se muestra (antes salía «No hay tarifa para esas fechas»). Carrito/cotización
  (`liquidarServicioPuntual`) resuelven por fecha y exigen la fila publicada: un opcional oculto da «ya no está publicado/activo».
- UI: `ReservaForm` no ofrece un opcional fuera de sus tramos (aviso + casilla deshabilitada); la pestaña Tarifario del paquete muestra «Publicado con omisiones» /
  «Publicado sin oferta vendible» con el diagnóstico.

## Asistencia médica: tarifa base permanente

Excepción a «todo servicio exige vigencia» (decisión del dueño): un servicio con `servicios_adicionales.categoria = 'asistencia'` que **no tiene NINGUNA fila en `servicio_temporadas`** cobra su
tarifa base (precio por persona, o rangos `GENERAL` en modo grupo) en **cualquier fecha**. Con una o más vigencias —vencidas, invertidas o sin fechas incluidas— rigen solo ellas: la base **nunca
rellena un hueco**. Traslados, tours y «otro» siguen exigiendo vigencia aunque tengan precio base.

- Fuente única: `lib/calc/tarifaBasePermanente.ts` + `leerTemporadasServicio` (`lib/reservar/temporadasServicio.ts`) agregan una vigencia sintética «GENERAL» (1900-01-01 a 2999-12-31) a la asistencia sin
  vigencias. Publicación (`cargarVigenciasServicios`), reserva directa (`computo.ts`, costo/CxP en `reservar/actions.ts`), carrito/cotización/conversión (`cotizar.ts`) y costo de obligaciones
  (`costosObligacionesCarrito.ts`) leen por ahí y resuelven con las mismas funciones (`costoNetoServicio`, `incluidoEnEstadia`, `referenciaPublicacion`): precio y costo no pueden divergir.
- Base inválida (precio vacío/negativo, o sin rangos GENERAL en modo grupo): la vigencia sintética queda sin precio y cada ruta rechaza con «no tiene precio por persona / rangos de pasajeros en su
  vigencia «GENERAL»» (nunca inventa).
- Armado: `servicioSeleccionable` y la tarjeta de servicio aceptan la asistencia permanente.
- Auditor: estado `OK_TARIFA_PERMANENTE` (no bloquea ni aparece en las vistas A–D del plan); la vista E no la cuenta como bloqueante. `diagnostico_cobertura_255_lectura.sql` S0-F lista categoría,
  base y vigencias de los servicios del caso (1, 131, 50, 112, 132, 133).
- Pruebas: `asistenciaTarifaBase256.test.ts`, bloques «asistencia» de `disponibilidadServicios256.test.ts` y `reservaFechaSinCobertura256.test.ts`, y los paquetes `PQ_*` de `test_255_auditoria.sh`.

## Casos reales auditados (banderas exactas)

| Paquete | Servicios | Resultado (código + vista `E_paquete_oferta`) |
|---|---|---|
| **73** | 112 `incluido=true`; asistencia 1 `incluido=false` (opcional); 131 no asociado. 19 salidas futuras, 16 sin cobertura del 112 | **OFERTA_CON_SERVICIOS_OMITIDOS**: las 19 salidas se ofrecen; el 112 va cobrado en 3 y se omite en 16. La asistencia 1 opcional: tarifa base permanente si es `asistencia` con base válida y sin vigencias |
| **33** | 50 `incluido=true`; asistencia 1 `incluido=true` (sin vigencias). Inventario real: **4 de 16** salidas con cobertura del 50 | **OFERTA_CON_SERVICIOS_OMITIDOS**: las 16 salidas se ofrecen; el 50 solo se cobra en 4 y se omite en 12; la asistencia 1 (permanente, si es `asistencia` con base válida) va en todas. Si no es `asistencia` o no tiene base válida, también se omite |
| **36 / 133** | traslado incluido. Inventario real: **0 de 16** con cobertura | se omite en las 16; el hotel se ofrece en las 16 sin el traslado (`OFERTA_SIN_SERVICIOS`) |
| **70 / 132** | traslado incluido. Inventario real: **0 de 16** con cobertura | igual que 36/133 |
| **73 / 112** | Inventario real: **3 de 19** con cobertura del 112 | ver la fila 73 de arriba |

> Los conteos «de N» de esta tabla son los del inventario auditado que dio el dueño (vista `E_paquete_oferta` ejecutada por el operador en solo lectura antes de esta ronda). Esta rama NO ejecuta SQL remoto: hay que volver a correr la vista E
> en la base compartida antes de afirmar conteos vigentes. Las pruebas locales usan fixtures con esa forma; no son datos de producción.

Fe de erratas: un informe anterior afirmó que el 73 quedaba sin oferta por las asistencias 1 y 131 «incluidas». Era un error del informe (supuso banderas que no son las reales). Cubierto por `disponibilidadServicios256.test.ts` («banderas REALES»), `reservaFechaSinCobertura256.test.ts` y `test_255_auditoria.sh` (PQ_73 / PQ_33).

## «Incluye» manual por salida (acreditado, no detectado)

`armado_paquetes.programa_incluye` (migración 169) es texto libre y único para todas las salidas. El emparejamiento por NOMBRE no basta (el texto puede nombrar un servicio con otras palabras: «Transfer aeropuerto-hotel» para
«Traslado 133»), así que la regla es de **acreditación**. `lib/tarifario/incluyePorSalida.ts` (puro) deriva la presentación de cada salida; el texto guardado **nunca se modifica**:

- Salida **sin** servicios omitidos → el texto guardado se presenta íntegro.
- Salida **con** algún servicio omitido → el texto libre no se presenta como inclusión cierta. Se presentan solo las inclusiones acreditadas por la composición efectiva (los servicios que sí se incluyen y cobran, por su nombre de
  catálogo). Una línea del texto se conserva únicamente si cada fragmento es exactamente el nombre de un servicio efectivo; la que es exactamente el nombre de un omitido se retira; todo lo demás es texto no verificable: se retira de la
  presentación y se avisa al **operador** («ATENCIÓN operador…» en el diagnóstico de la publicación; el cliente no lo ve).
- Composición por salida: `lib/tarifario/composicionIncluidos.ts` calcula, con `incluidoEnEstadia` en la fecha de ida de cada salida fija, qué incluidos se omiten y la cuelga de `descripcionPorPaquete[id].composicion`
  (datos.ts, resumen.ts, datosBernalo.ts). Si el cálculo falla, el «Incluye» manual no se presenta (`composicionNoDisponible`, falla cerrado).
- UI: `<IncluyeSalida fechaIda | incluidos>` (tarjetaHotelCompartida.tsx) declara la salida (salida elegida en HotelModal/DinamicoModal; búsqueda en vivo: `BusquedaResultado.incluidosDeLaSalida`). Sin salida elegida se trata como omitido todo
  servicio omitido en alguna salida (no se promete donde falta).
- Cotización y documentos: su «Incluye» sale de `payload.serviciosIncluidos` (los efectivos recalculados), nunca del texto manual; lo omitido no figura. La conversión recompara composición y costo (`validarIncluidosConversion`).
- Límite: porción terrestre por fechas libres no tiene salidas fijas que precalcular; las tarjetas Bernalo sin fecha elegida usan la vista general.

## Filas publicadas antiguas: evidencia de composición (migración 258)

En bloqueo/dinámico el PVP sale de la fila publicada y el costo/CxP de la composición viva. Para que nunca se cobre el PVP antiguo de un servicio que la composición actual omite, **el servidor acredita la fila antes de cotizar o numerar**:

- `tarifario_composicion_publicada(paquete_id, fecha_ida, generacion, regla, servicios_incluidos)` guarda, por salida publicada, los incluidos horneados en su precio. La escribe `generarTarifario` justo después de publicar
  (`registrar_composicion_publicada`, solo si esa generación sigue siendo la publicada; reemplaza todo el paquete; con el conjunto vacío limpia).
- `computarReserva` (cotización, carrito, checkout, reserva y conversión) exige, para paquetes con incluidos: evidencia de la fecha de ida, escrita por la generación hoy publicada, con la regla vigente (`REGLA_COMPOSICION_PUBLICADA`) y
  con EXACTAMENTE los servicios que la composición viva incluye. Sin evidencia (toda fila anterior a la 258, o cuya escritura falló), con generación/regla distinta o con otra composición → se rechaza: «regenera el tarifario».
  Si la tabla no existe (258 sin aplicar) también se rechaza, con un mensaje distinto (no se vende lo que no se puede acreditar). Un paquete sin servicios incluidos no exige evidencia.
- Fallo cerrado de punta a punta: si el registro de la evidencia falla, las filas quedan publicadas pero se rechazan hasta regenerar (la respuesta de `generarTarifario` lo avisa).
- Numeración: la **257 está reservada para B2B**; esta migración es la **258** y no reutiliza ni edita ninguna existente. Preflight/postcheck/rollback y `test_258_gates.sh` (255 → 256 → 258).

## Despliegue (Preview y Producción comparten base)

- Esta ronda no agrega migración, pero las **255 y 256 siguen PENDIENTES** de aplicar (preflight → migración → postcheck, y recién después el código). Hasta entonces el código es tolerante: las franjas (255) se leen con respaldo si la
  tabla no existe, `reservar/nuevo` relee sin `fechas_disponibles` si la vista aún no la tiene, y el diagnóstico (RPC 256) solo avisa si falla.
- **Orden:** 255 → 256 → 258 (cada una: preflight → migración → postcheck) y recién después el código. La 257 es de B2B y no se toca. El código nuevo SIN la 258 rechaza toda reserva de bloqueo/dinámico con servicios incluidos.
- **Protección durante el despliegue:** las filas publicadas antes no tienen evidencia de composición, así que el servidor las rechaza («regenera el tarifario») hasta que cada paquete se regenere con el código nuevo; no depende de una instrucción operativa.
  Tras aplicar y desplegar, regenerar el tarifario de cada paquete bloqueo/dinámico con incluidos (el preflight 258, fila 6, cuenta cuántos son).
- Los conteos reales de oferta se obtienen ejecutando `plan_saneamiento_255_lectura.sql` (vista E) y `diagnostico_cobertura_255_lectura.sql` en solo lectura en la base compartida.

## Límites

- Porción terrestre con un incluido: la unidad publicada es la VENTANA completa (una sola vigencia); si no la cubre, no se publica la ventana. La reserva por fechas
  del asesor sigue validando la estadía real.
- Los tramos publicados son una foto: si cambia una vigencia el trigger 181 invalida el tarifario y hay que regenerar; la venta no depende de esa foto.
- No evalúa franjas horarias de un incluido en la auditoría (dependen de la tabla de la 255).

## Auditoría y pruebas

`supabase/scripts/auditoria_255_servicios_sin_vigencia.sql` (estados `OPCIONAL_PARCIAL`, `OPCIONAL_OCULTO`, `INCLUIDO_BLOQUEA_SALIDAS`, `INCLUIDO_BLOQUEA_TODAS` + columna `efecto`),
`plan_saneamiento_255_lectura.sql` (vista `E_paquete_oferta`: paquetes con oferta completa/parcial/sin oferta), `diagnostico_cobertura_255_lectura.sql` (identidad de vigencias y
publicado; solo lectura). Gates: `test_256_gates.sh` (preflight → 256 → postcheck → `test_256_disponibilidad.sql` → reaplicación → rollback → reaplicación).
Pruebas: `disponibilidadServicios256.test.ts` (generarTarifario real con los casos 73/33/asistencias), `reservaFechaSinCobertura256.test.ts` (computarReserva real).
La medición del timeout del paquete 73 (`lib/tarifario/cronometroGeneracion.ts`, #416) es independiente de esto.
