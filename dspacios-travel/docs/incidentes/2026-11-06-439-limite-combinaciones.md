# Incidente #439 — Todas las salidas de los hoteles Dubai fallaban al cotizar (límite de combinaciones)

- **Fecha:** 2026-11-06
- **Tarea:** #439 (tarifario, precio «Desde» elegible)
- **Rama del PR (remota):** `codex/tarifario-motivo-error` · **commit de la corrección:** `33c045bda`
- **Estado:** corregido; el dueño confirmó que funciona en **Preview**. El merge a `main` y la validación en **Producción** no están confirmados en este documento.

## 1. Suceso y síntomas

- La tarjeta del hotel mostraba su precio **«Desde»**, pero al **elegir una salida** (tarjeta de Vista Booking, modal «Ver opciones» y Vista tabla) aparecía el mensaje genérico
  *«No pudimos calcular el precio para esas fechas. Elige otras o intenta de nuevo.»*
- Ocurría en **todas** las salidas de los hoteles Dubai, no en una fecha puntual.
- En los registros del servidor solo aparecían mediciones de la página `/tarifario` (carga de la página y detalle de tarifas con `resultado=ok`). **No** aparecía la línea `[cotizarTarjetaHotel]`
  que el código escribe cuando un cálculo falla.

## 2. Impacto y alcance comprobado

- **Comprobado:** afecta a cualquier hotel cuya salida tenga **más de 12 combinaciones** categoría×régimen con tarifa doble publicada. El caso reportado tiene 16 (4 categorías × PA, PAE, PAM y PC).
  Se reprodujo también con otro hotel de 15 combinaciones (ids distintos, sin excepciones por hotel). Con 12 o menos calcula con normalidad.
- **Superficies:** tarjeta, modal «Ver opciones» y Vista tabla comparten el mismo validador de entrada (`validarEntradaTarjeta`) y productores equivalentes (`salidasDeTarjeta` para la tarjeta,
  `entradaSalida` para modal y Vista tabla). Vista tabla se confirmó por lectura del código (`TarifarioPublic.tsx`, que agrupa por hotel y llama a `entradaSalida`) y con una prueba.
- **No comprobado / fuera de alcance:** no se midió cuántos hoteles de producción superan las 12 combinaciones; el validador solo se usa en la cotización de la tarjeta (no en Reservar ni en el checkout).

## 3. Investigación y evidencias

1. **Datos publicados (SQL de solo lectura).** Las consultas de diagnóstico ejecutadas por el dueño confirmaron que la oferta estaba publicada y coherente: generación publicada vigente, fila «doble» publicada para la salida,
   evidencia de composición presente y generación/publicación completas. La consulta concreta tenía pocas filas, así que el volumen total del paquete no explicaba un truncamiento.
   **SQL no podía obtener el rechazo de la aplicación:** el error nace en el servidor, antes de leer datos, y solo se vería en el registro del servidor.
2. **Hipótesis descartadas como causa del fallo general.**
   - *Cierre `hotel_blackouts`:* existía un cierre total sobre las noches de una de las salidas, pero el fallo ocurría en todas, incluidas las que no estaban cerradas. Con el motor real se comprobó además
     que en la ruta de **bloqueo** `computarReserva` ni siquiera lee `hotel_blackouts` (vende igual con el cierre puesto). Es un defecto distinto (se ofrecen fechas cerradas) y quedó **separado**.
   - *Vigencias, servicios incluidos, evidencia de composición, reglas EBB/Long Stay:* se mapearon todos los candados de `computarReserva` y se reprodujeron con el motor real y datos de prueba equivalentes. Al demostrarse que el rechazo ocurría **antes** de llegar a ellos, dejaron de ser sospechosos del fallo general (siguen siendo candados válidos de la reserva).
   - *Paginación y límite de filas:* la carga del resumen y la verificación de vigencia paginan de forma robusta; las lecturas sin paginar de `computarReserva` no deciden qué hoteles aparecen.
3. **Por qué no había registro.** Se siguió el recorrido completo desde elegir la salida hasta el mensaje genérico. Hay caminos que muestran ese mensaje **sin** pasar por el `console.error` esperado; uno de ellos
   es el rechazo de la entrada por `validarEntradaTarjeta`, que devolvía el mensaje genérico antes de llamar a `computarReserva` y sin escribir nada.
4. **Reproducción con código real.** Se construyó la entrada con los productores reales y se pasó por `cotizarTarjetaHotel` real:
   - 16 combinaciones (hotel de 94) y 15 (otro hotel): resultado `ok:false` con el mensaje exacto observado, **0 llamadas a `computarReserva` y 0 registros de error**, tanto por la ruta de la tarjeta como por la del modal.
   - 12 combinaciones: calcula (ok).

## 4. Causa raíz

Dos reglas independientes que no coincidían:

- **Productores sin tope:** la tarjeta, el modal y Vista tabla envían **todas** las combinaciones categoría×régimen de la salida con doble publicada (para poder hallar la más barata).
- **Validador con un `12` suelto:** `validarEntradaTarjeta` rechazaba cualquier entrada con más de 12 combinaciones, devolvía el mismo mensaje que «sin tarifa» y no dejaba registro ni código.

Un hotel de 16 combinaciones era rechazado en todas sus salidas, antes de `computarReserva`, sin ningún indicio en los registros. La causa quedó **demostrada** por la reproducción (apartado 3.4), no inferida.

## 5. Resolución

Corrección general, sin excepciones por hotel ni paquete y sin recortar combinaciones:

1. **Límite técnico único `MAX_COMBOS_TARJETA = 64`** (8 categorías × los 8 regímenes del catálogo), una constante exportada que usa el validador. Es un techo de **recursos**, no un máximo comercial.
   Se calculan **todas** las combinaciones aceptadas, así que la más barata se sigue encontrando aunque sea la última.
2. **Lecturas compartidas exclusivamente por llamada** (`lib/reservar/lecturasCompartidas.ts`): cada combinación ejecutaba `computarReserva` completo y repetía lecturas idénticas (paquete, hotel, origen aéreo,
   temporadas, servicios incluidos, evidencia). Un memo creado en cada llamada de `cotizarTarjetaHotel` las hace una sola vez.
   - Sin estado de módulo: nunca se comparte entre llamadas, usuarios ni peticiones.
   - La clave de cada lectura lleva todo lo que la distingue (cliente, ids, fecha, noches); **no** se memoiza lo que depende del combo (fila publicada, tarifa del combo, composición).
   - Cada uso recibe una **copia profunda**; un resultado con `error` se conserva tal cual; una lectura que lanza excepción no se guarda.
   - `computarReserva` recibe el memo como parámetro opcional: **sin él, Reservar, el checkout y la conversión se comportan como antes**.
3. **Códigos de rechazo y diagnóstico seguro:** cada rechazo de entrada lleva un código estable (`combos_exceden_limite`, `ids_invalidos`, `combo_invalido`, etc.). El servidor registra
   `[cotizarTarjetaHotel] entrada_rechazada codigo=… combos_recibidos=… limite=…` sin copiar valores de la entrada, y un rol interno activo ve un motivo propio («no es ausencia de tarifa»). El mensaje público no cambia.
4. Cuatro pruebas de «cableado» que leen el código como texto se ajustaron a la nueva forma de las lecturas, sin cambiar lo que verifican.

## 6. Pruebas y validación

**Mediciones locales de consultas** (cliente de base falso que cuenta lecturas, sin red). Son conteos de consultas, **no** latencia remota:

| Caso | Sin memo | Con memo |
|---|---|---|
| Bloqueo, 16 combinaciones, con servicios incluidos y regla EBB con composición | 320 | 64 |
| Bloqueo, 64 combinaciones, mismas condiciones | 1280 | 208 |
| Porción terrestre, 6 combinaciones | 132 | 32 |

Cada combinación aporta 3 lecturas propias en bloqueo/dinámico. El peor caso anterior (12 combinaciones) costaba 240 consultas en las mismas condiciones; 64 combinaciones con memo cuestan 208.

**Pruebas añadidas** (cada una falla sin la corrección o sin el aislamiento):
- `pruebas/tarjetaCombosProductor439.react.ts` — productores reales (tarjeta, modal, Vista tabla) → validador → acción → `computarReserva`; límite exacto y exceso; entradas inválidas sin tocar tarifas.
- `pruebas/lecturasCompartidas439.test.ts` — el memo; igualdad con y sin memo (tres orígenes, servicios, EBB con composición); aislamiento entre combos, hoteles y llamadas; lecturas fallidas; 64 y 65 combinaciones; códigos de rechazo y registro.
- `pruebas/porcionTerrestreMemo439.test.ts` — liquidación en vivo de porción: resultados distintos por combo, igualdad con y sin memo, el más barato al final, cambio de fechas/noches (incluida una estadía que cruza dos temporadas) y fallos de liquidación.
- Verificación de eficacia por mutación: omitir el hotel en una clave, no pasar el memo y omitir ida/noches en la clave de la liquidación hacen fallar pruebas.

**Resultados reales:**
- Pruebas focalizadas: 197 unitarias y 19 de React sin fallos; 10 de porción sin fallos.
- Suite unitaria completa: 29 fallos, **exactamente los mismos** que sin los cambios (previos al incidente). Suite React completa: 13 fallos, todos de `dinamicoEnPaquetes.react.ts` y previos.
- `tsc --noEmit` sin errores; eslint sin errores en los archivos tocados.

**Validación:** el dueño confirmó que la corrección funciona en **Preview**. **No** consta merge a `main` ni validación en **Producción**.

## 7. Límites y seguimientos separados

- **64 no es un máximo comercial.** Una entrada por encima se rechaza con código propio. Subirlo exige reducir más el costo por combinación (más lecturas compartidas) o calcular en paralelo con concurrencia acotada.
- **`hotel_blackouts` (defecto separado, no corregido aquí):** hoy se ofrecen fechas cerradas. Requisito acordado: la generación debe excluir las ofertas alcanzadas por el cierre, la publicación no debe activarlas,
  un cierre creado después debe sacarlas de «Desde», del selector y de lo vendible, una tarifa válida fuera del cierre debe conservarse, y Reservar mantiene su validación como protección final (incluida la ruta de bloqueo,
  que hoy no la aplica). Cubre cierres totales y parciales por categoría y acomodación, y las noches de estancia.
- **Hoteles seleccionados que no aparecían:** investigación aparte, resultado registrado en la tarea **#100**, pospuesta por el dueño. No forma parte de este incidente.
- **Latencia remota:** no se midió; las cifras anteriores son conteos locales de consultas.
- **Scripts SQL de diagnóstico** (`supabase/scripts/diagnostico_439_*.sql`): de solo lectura, se usaron para esta investigación y **no** forman parte de la corrección funcional.
- **Fallos previos de las suites completas** (29 unitarios y 13 de React): ya existían antes de este incidente y no se tocaron.
