# Publicación del tarifario por lotes con generaciones almacenadas (migración 260 · SIN aplicar en producción)

> **Idea.** Separar **calcular** de **hacer visible**. Cada lote de filas se escribe en una *generación invisible*; solo una generación **completa, válida y acreditada** se activa cambiando UN puntero (`armado_paquetes.tarifario_generacion_publicada`). Lo ya publicado sigue visible e intacto hasta ese instante. No se amplían límites: las funciones nuevas fijan **su propio** `statement_timeout=30s` y `lock_timeout=8s` (como la 259) y el publicador monolítico (254/256/259) queda intacto.
> **Estado.** Migración `20260601000260_publicacion_tarifario_por_lotes.sql` + `preflight_260_…`, `postcheck_260_…`, `rollback_260_…` escritos y probados en PostgreSQL **local**. **Nada se ejecutó en la base compartida.** El código nuevo está **apagado por defecto** (`TARIFARIO_PUBLICACION_POR_LOTES=1` lo enciende): puede desplegarse antes que la migración y, apagado, usa el publicador de siempre.
> **Numeración.** 255/256/258 son del hotfix de traslados (sin aplicar), 257 es de B2B, 259 está aplicada → **260 libre** (verificado en todas las ramas y worktrees locales el 2026-10-30; volver a comprobarlo antes de aplicar).

## Orden de despliegue (obligatorio)
1. Aplicar **255 → 256 → 258** (hotfix) y confirmar la **259**. La 260 **aborta** si faltan (comprueba columnas, tablas y huellas exactas de lo que reemplaza).
2. Correr `supabase/scripts/auditoria_empates_vigencia.sql` y `supabase/scripts/lectura_pg_cron_260.sql` (solo lectura, ver abajo) y decidir.
3. `preflight_260_publicacion_por_lotes.sql` (una consulta, columna `estado`; nada debe decir `BLOQUEA`) → **260** → `postcheck_260_publicacion_por_lotes.sql` (nada debe decir `FALLA`).
4. Desplegar el código (apagado). `CRON_SECRET` ya es obligatoria para los otros crons; el flujo normal por pg_cron NO depende de ella (solo el respaldo de la ruta).
5. Encender `TARIFARIO_PUBLICACION_POR_LOTES=1`, regenerar un paquete chico y luego el 73.
**Preview y Producción comparten base:** la 260 cambia comportamiento de la base para *ambos* despliegues (los disparadores de invalidación y la vista) desde que se aplica, aunque la bandera esté apagada.

## Qué hace la migración
| Pieza | Para qué |
|---|---|
| `tarifario_resultado.generacion/revision_fuente/lote/ord` + `armado_paquetes.tarifario_por_generacion` | cada fila sabe de qué generación es |
| Vista `tarifario_resultado_publicable` (**reemplaza la de la 256**) y política de lectura de la tabla base (**reemplaza la de la 182**) | solo se ve la generación **publicada**. Una fila de una generación no publicada **nunca** es visible, tenga o no el paquete la bandera; las filas heredadas (sin generación) se ven mientras el paquete no haya publicado por lotes |
| `tarifario_resultado_neto` | el costo neto del hotel por fila (lo necesita la invalidación exacta). **Tabla aparte, sin acceso para `anon`/`authenticated`**: NO es columna de la tabla legible (el prototipo la exponía por la vista) |
| `tarifario_manifiesto(_lote)` | manifiesto **solo-inserción** fijado antes de cargar: lotes, filas, SHA-256 del texto exacto de cada lote, composición de la 258, diagnóstico de la 256, modo/TRM de la 63 |
| `tarifario_lote_espera`, `tarifario_publicacion_cola` | lotes ya calculados esperando al trabajador, y una publicación por paquete lista para avanzar |
| `tarifario_lote_agregar(_i)`, `_activar(_i)`, `_limpiar(_i)` | cargar un lote (idempotente, verifica huella y filas), **activar** (puntero + composición 258 + diagnóstico 256 + oferta 63 en la MISMA transacción), limpiar generaciones superadas (un solo `DELETE`) |
| `tarifario_lote_espera_guardar`, `_publicacion_encolar`, `_publicacion_avanzar(_i)`, `tarifario_cola_correr` | preparar, encolar, avanzar UN paso, y el **trabajador** que lo hace sin sesión |
| `tarifario_invalidar` (**reemplaza la de la 181**) + 6 disparadores por sentencia (**reemplazan los 2 por fila de la 181**) + `tarifario_evaluar_ocultar` | invalidación diferencial de hoteles (abajo) |
| pg_cron (si existe) | `tarifario_cola_correr` cada 10 s y purga diaria de `cron.job_run_details` |

Las funciones `_i` son internas (sin comprobación de rol: las llama el trabajador, que corre sin sesión) y **no son invocables** por `anon`/`authenticated`; los envoltorios públicos conservan la comprobación `mi_rol()` de siempre. `tarifario_cola_correr` solo la ejecuta `service_role`.

## Flujo de una petición (`lib/tarifario/controladorPublicacion.ts`)
1. **Manifiesto** (idempotente; si el cálculo cambió → `conflicto`, nunca se mezclan dos cálculos).
2. **Preparar**: cada lote se sube **una sola vez** a la espera (se verifica su huella). Es lo único que exige el cálculo en memoria. Si la ventana se agota aquí NO puede seguir sola → `pendiente` **manual** (otra petición vuelve a calcular las mismas filas y sube lo que falta).
3. **Encolar**: con todos los lotes en la base la publicación puede terminar **sin la petición ni el navegador**.
4. **Avanzar**: pasos cortos (un lote, la activación o una tanda de 250 filas de limpieza) mientras quepan en la ventana. Lo que quede lo termina el trabajador.
Respuestas de `avanzar`: `lote:N · activada · limpieza:N · listo · ocupada · sin_cola · fallida · obsoleta · fuente_cambio · modo_cambio · error:<msg> (transitorio, se reintenta) · detenida:<SQLSTATE o motivo> (determinista, se detiene)`.

**Fallos entre lotes.** Un lote que falla revierte por completo; lo ya cargado sigue invisible; lo publicado antes sigue intacto. Los errores **deterministas** (integridad 23, dato malformado 22, sintaxis/permiso 42, validación propia `P0001`: p. ej. una FK de hotel inexistente) **detienen la publicación de inmediato** (`fallida`, paquete `fallido`, el error real queda en `tarifario_publicacion_cola.ultimo_error` y llega a quien espera). Los **transitorios** (espera de candado 55P03, timeout 57014, deadlock, conexión) se reintentan con espera creciente (10, 20, 40, 80, 160, 320 s) hasta **6 intentos**; luego `fallida`. Se atrapan por paso, así que un timeout cuenta como intento en vez de repetirse sin fin.

## Continuación SIN navegador
El usuario quiere que la publicación siga aunque cierre la pestaña. `ejecutarReanudable` ya no recalcula en cada vuelta: si todo está en la base solo **consulta** (`estadoPublicacionTarifario`, barato); si faltan lotes por preparar, vuelve a calcular y subirlos.

**1. pg_cron (principal).** Verificado en local con **pg_cron 1.6 real** (la imagen de Supabase): un trabajo `N seconds` ejecutó `tarifario_cola_correr()` y publicó 4.000 filas **sin ningún cliente** (≈ 6 s); la sintaxis exacta de la migración (`'10 seconds'`, purga diaria) es aceptada. La migración lo programa sola **si la extensión está habilitada** y, si no, avisa y no falla.
- **NO verificado en la base compartida** (no se ejecuta SQL remoto): correr `supabase/scripts/lectura_pg_cron_260.sql` (una consulta de solo lectura; veredicto `pg_cron LISTO` / `DISPONIBLE, falta habilitar` / `NO viable`). En Supabase se habilita en *Database → Extensions → pg_cron*.
**2. Ruta de Vercel (respaldo, probada).** `app/api/cron/publicacion-tarifario/route.ts` (`CRON_SECRET`, falla cerrado): corre el trabajador hasta ~48 s y, **si queda cola, encadena otra invocación de sí misma** (`after()`, tope de 60 encadenadas). La acción la **empuja** apenas deja la publicación encolada (solo si `CRON_SECRET` existe; sin él no pasa nada y la cola sigue por pg_cron). **No hay cron programado en `vercel.json`**: con pg_cron activo (trabajador cada 10 s) un cron diario no aportaría nada. Se puede llamar a mano con el secreto. No depende de pg_cron ni del plan (solo del `maxDuration` de 60 s, válido en toda configuración). Probada: unitariamente (`continuacionPublicacion.test.ts`) y de punta a punta con el `GET` real contra PostgREST+Postgres (`RUTA=1`).
Ambos conviven sin estorbarse: un solo trabajador por publicación (`FOR UPDATE SKIP LOCKED`).

**Controles.** *Reintentos*: arriba. *Concurrencia*: `SKIP LOCKED` (una llamada a una publicación tomada responde `ocupada` sin esperar; dos trabajadores en carrera publican una vez y sin filas duplicadas — probado). *Huérfanos*: cada pasada del trabajador borra (a) colas `pendiente` de generaciones superadas, (b) colas `fallida` con más de 3 días (y limpia su generación a medias), (c) lotes en espera de más de 1 día sin publicación encolada (una petición que murió preparando). *Limpieza*: tandas de 250 filas, también en segundo plano; una generación superada se borra por completo con su manifiesto y su espera (cascada).

## Regeneraciones en segundo plano
Hotel, servicio, vuelo y salida llaman `generarTarifario(id, enSegundoPlano(inicio))` (`porLotes + segundoPlano + inicioMs`): ya **no** quedan sujetas al límite de 30 s del monolítico, porque una vez que los lotes están en la base la publicación continúa sola. `inicioMs` es el inicio de la **acción** que llama, así varias regeneraciones en bucle (`for (const hid of tocados)`) comparten una sola ventana en vez de una por paquete. Si no alcanza ni para preparar los lotes, la regeneración en segundo plano **marca el fallo** (`fallido`, mensaje fijo) en vez de quedar «recalculando» en falso; lo publicado antes sigue visible. Cada página que aloja estas acciones declara `export const maxDuration = 60` (literal; una prueba de cableado lo exige y lo compara con `VENTANA_PETICION_MS`).

## Invalidación diferencial de hoteles
Una tarifa o vigencia nueva que **no cruza** ninguna fila publicada, o que **no cambia la ganadora**, deja visible la oferta anterior. Si cambia el resultado efectivo (neto total o procedencia) se oculta **de inmediato solo la combinación afectada** (`tarifario_fila_oculta`). La base recalcula con el mismo criterio que el motor (`lib/calc/paquetes.ts`: prioridad, desempate por `(orden, id)`, rangos menos blackouts, compra, régimen, noche gratis). Probado contra el motor real: **273 y 274 escenarios aleatorios (semillas 21 y 31), 0 inseguros y 0 innecesarios**. Cambios de alcance paquete (vuelos, servicios, armado) siguen bloqueando el paquete entero, como en la 181. *Residual:* las filas publicadas por el monolítico no traen `neto_hotel` → no son verificables y se ocultan por prudencia cuando cambia su clave, hasta regenerar (la regeneración es automática tras editar).
**Cambia el comportamiento aunque la bandera esté apagada:** UPDATE/DELETE de tarifas ya no bloquean el paquete entero (menos ocultamiento) pero un INSERT puede ocultar combinaciones heredadas no verificables (más que antes, y se rehacen solas).

## Desempate de vigencias por `(orden, id)` — AUDITAR antes de desplegar
Los cuatro cargadores de `hotel_temporadas` (generador, cotización, reserva y vigencia) ahora ordenan `ORDER BY orden, id`; antes cargaban sin orden y ante **igual prioridad** ganaba la que Postgres devolviera primero. **Esto puede cambiar un precio aunque la bandera esté apagada** si existen vigencias empatadas. `supabase/scripts/auditoria_empates_vigencia.sql` (un solo `SELECT`, solo lectura) enumera cada empate real y compara el ganador nuevo contra los dos órdenes anteriores plausibles (físico `ctid` e inserción `id`): `REVISAR · cambia el PRECIO` / `REVISAR · cambia solo la etiqueta` / `sin cambio · mismo ganador` / `SIN EMPATES`. Probada con 10 escenarios y comprobando que no escribe (`AUDITORIA=1`). **Aún no corrió contra la base real: no se puede afirmar que los precios reales no cambian hasta ver ese resultado.** Un `REVISAR` es una decisión de negocio (qué vigencia debe ganar), que se corrige ajustando `prioridad`/`orden`; nunca se tocan precios desde la auditoría.

## El publicador de siempre casi no paga la migración (medido)
Un primer diseño (disparador por fila que sellaba la generación, índice nuevo y llaves foráneas en cascada) encarecía el publicador monolítico **+25 % a CPU plena y +70 % con la CPU limitada** (24 s → 41 s para 12.669 filas: rebasaba el límite de 30 s del paquete 73 aun con la bandera apagada). La batería de lotes no lo detectaba porque calibra la CPU contra el monolítico *ya con la 260*. Rediseño: sin disparador por fila (un disparador **por paquete**, `tarifario_pub_monolitica`, apaga la bandera cuando el puntero avanza a una generación sin manifiesto), sin índice nuevo, sin FK en las tablas laterales (se limpian por conjuntos), sin columna `ord` (ids explícitos de la secuencia). Resultado (`test_260_monolitico.sh`, mismas bases con/sin la 260, alternando): **+1,8 % a CPU plena y +2,2 % con CPU limitada** (mediana de 7 rondas, 18,7 s → 19,1 s; una lectura de reloj corrupta de la ronda 7 se descartó). La prueba de regresión del monolítico es parte de la batería.

## Entorno combinado con el hotfix 255/256/258 (punto 1)
Copia en el scratchpad (sin tocar ninguno de los dos worktrees): código del hotfix + esta rama, `git merge-file` por archivo, `actions.ts` resuelto a mano. **Hallazgos para la integración real:** (1) el hotfix nació antes de #416 y de la 259: su `actions.ts` usa `diagnosticoGeneracion` donde esta rama usa `cronometroGeneracion` (5 conflictos); (2) el diagnóstico de la 256 y la composición de la 258 se calculan hoy *después* de publicar: con continuación automática ya no hay «paso posterior» garantizado, así que **el diagnóstico se calcula antes y viaja en el manifiesto** (la activación lo escribe junto con el puntero) y la composición usa `REGLA_COMPOSICION_PUBLICADA` del hotfix; (3) `registrar_composicion_publicada`/`registrar_diagnostico_tarifario` del hotfix quedan redundantes pero inofensivos en la vía por lotes.
Servicio **112 incluido** con tarifa en 16 de las 32 salidas (misma publicación): publicación por lotes completa (22.401 filas); fechas CON tarifa idénticas a la referencia «112 en todas»; fechas SIN tarifa idénticas a la referencia «112 en ninguna» (el 112 se omite del precio); composición `[112]` ×16 y `[]` ×16 acreditadas por la generación publicada; diagnóstico escrito por la activación; el publicador monolítico del hotfix da exactamente las mismas filas y composición; la consulta pública (visitante anónimo) devuelve el precio con y sin 112; la compuerta real de cotización/reserva (`verificarComposicionPublicada`) acepta ambos casos y rechaza la discrepancia en los dos sentidos. **No ejecutado:** el cómputo completo `computarReserva` (cotización/reserva de punta a punta).

## Duración en Vercel (punto 5)
Documentación (consulta del 2026-10-30): sin Fluid el máximo configurable es 60 s; con Fluid 300 s (Hobby) / 800 s (Pro). Por eso **todas** las páginas que alojan estas acciones y la ruta de continuación declaran `maxDuration = 60` (literal, válido en toda configuración; lo exige una prueba). Presupuesto por petición: ventana 60 s − 6 s de holgura, contada desde el inicio de la acción; antes de cada paso se exige que quepa el peor medido × 1,3 más la activación. Medido con CPU estrangulada: petición con 23 lotes ≈ 47–53 s (preparar 23 lotes: Σ 5–7 s, máx 0,6 s; paso más lento 3,3 s; una corrida aislada tuvo un paso de 22 s, aún < 30 s). **NO verificado:** plan y Fluid de ESTE proyecto (sin `.vercel`, CLI ni acceso). Indicio: `vercel.json` ya declara 3 crons (según la documentación Hobby admite 2), lo que sugiere Pro. Para confirmarlo: Vercel → Deployment → pestaña *Functions* (duración máxima por función desplegada) y *Settings → Functions*.

## Pruebas y resultados (2026-10-31, PostgreSQL 15.8 local, límites 30 s / 8 s intactos)
| Prueba | Comando | Resultado |
|---|---|---|
| Cola, trabajador, reintentos, huérfanos, composición 112, lectura por rol, heredado, monolítico sobre lotes + 3 escenarios multi-sesión (incl. **pg_cron 1.6 real**) | `test_260_cola.sh` | 53 comprobaciones, 0 fallas; escenarios OK |
| Aplicar, reaplicar, postcheck, uso, rollback negado/permitido, huella idéntica, reaplicar | `test_260_rollback.sh` | todo pasó |
| Ruta de Vercel (`GET` real, 503/401/200, cola vacía, sin sesión) | `RUTA=1 …test_259_publicador_limite.sh` | todo pasó |
| Auditoría de empates (10 escenarios, no escribe) | `AUDITORIA=1 …` | todo pasó |
| Recorrido paquete 73 combinado y propio | `RECORRIDO=1 …` | todo pasó (ambos) |
| Batería de lotes (60 SQL, controlador real, estrés de limpieza, diferencial 273 escenarios, monolítico 22.401 = 57014 a 31 s) | `LOTES=1 …` | todo pasó salvo 2 comprobaciones de T2/T3 (prueba que simulaba manipulación; corregida). La parte SQL (60/60) se repitió; la batería larga completa NO se repitió tras esa corrección |
| Tamaño de lote | `TAMANO=1 …` | 1.000 filas: lote más lento 5,0 s (6× de margen); 1.500: 9,0 s (3,3×). Se mantiene 1.000 |
| Regresión del monolítico | `test_260_monolitico.sh` | +2,2 % |
| Unitarias `npm run test:unit` | | 17 fallos = los 17 de la línea base (mismos nombres); +59 pruebas nuevas |
| Interfaz `npm run test:react` | | 1.303 / 1.303 |
| `tsc --noEmit` y `npm run build` | | sin errores; el build incluye la ruta nueva |

## NO verificado / riesgos
1. **pg_cron en la base compartida** (no se ejecuta SQL remoto): correr `lectura_pg_cron_260.sql`. Sin él, la continuación depende de la ruta (necesita `CRON_SECRET`).
2. **Empates de vigencia reales:** correr `auditoria_empates_vigencia.sql`; no se afirma que los precios no cambien hasta ver ese resultado.
3. Plan/Fluid de Vercel y que el `maxDuration` de la página rija las Server Actions en este proyecto.
4. `computarReserva` completo; integración real con el hotfix (conflictos de `actions.ts`; la 260 reemplaza por huella la vista de la 256, la política de la 182 y `tarifario_invalidar` de la 181: si el hotfix las cambia, la 260 aborta a propósito).
5. Los disparadores por sentencia de hoteles cambian el comportamiento desde que se aplica la 260, con la bandera apagada: UPDATE/DELETE ya no bloquean el paquete entero; un INSERT puede ocultar combinaciones heredadas sin `neto_hotel` hasta regenerar.
6. Tiempos medidos con CPU limitada y tabla sembrada, no con la base real; el ruido entre corridas es ±25 %.
7. Corregidos de paso respecto del prototipo: exponía el costo neto del hotel por la vista; la política de la tabla base dejaba leer generaciones no publicadas; un paquete heredado mostraba filas a medias de su primera generación; el rollback fallaba por la vista dependiente `tarifario_resumen`.


## Guardas por huella exacta e integración con el hotfix real

- La 260 reemplaza tres definiciones (`tarifario_invalidar` 181, vista 256, política 182). Migración, preflight, postcheck y rollback aceptan **solo** las huellas md5 exactas de la definición anterior auditada o de la propia 260 (invalidar 181 `8f8437d9…`/260 `444686e7…`; vista 256 `882ad9b8…`/260 `04f7b9f1…`; política 182 `89bc2fd3…`/260 `585e5a47…`). No hay respaldos `LIKE '%…%'`: un cambio ajeno que conserve las palabras da REVISAR y aborta sin alterar objetos.
- Prueba: `supabase/scripts/test_260_guardas.sh` (escenarios A1–A3 antes de la 260, B1–B3 sobre la 260, R1 rollback, postcheck exacto, controles de aplicar/reaplicar).
- Integración probada sobre el HEAD real `877b97ba` de `hotfix/traslados-tarifas-franja` (un solo conflicto, en `paquetes/actions.ts`: se conserva el cálculo de incluidos omitidos del hotfix, regla `REGLA_COMPOSICION_PUBLICADA`, y el diagnóstico de la 256 viaja en el manifiesto). Ese HEAD **no incluye aún** la corrección del postcheck 258 (cambios sin commit en su worktree): repetir la integración cuando se confirme.
