# Publicador del tarifario · límite propio y acotado (migración 259)

> Hoja técnica de la corrección del timeout al **publicar** el tarifario de paquetes grandes (paquete 73: 12.669 filas). Cómo está armado, qué se midió y por qué se eligió este límite.
> Archivos: `supabase/migrations/20260601000259_publicador_tarifario_limite_acotado.sql`, `lib/tarifario/filasPublicacion.ts`, `app/(dashboard)/dashboard/paquetes/actions.ts` (`generarTarifario`).

## Síntoma (medición real en Preview)
Paquete 73, generación 8: `resultado=timeout`, `etapa=publicar`, `ms_etapa=19845`, `filas_calculadas=12669`, cálculo 662 ms. Paquete 33: 3.187 filas, publicación 3.283 ms. PostgreSQL: `statement_timeout=8s` y `lock_timeout=8s` para `authenticated`/`authenticator`.
Los 19.845 ms son de la **llamada completa** (subida del cuerpo, PostgREST, SQL, respuesta), no de SQL.

## Cómo viaja una publicación
`generarTarifario` → `sb.rpc("publicar_tarifario_resultado" | "_63")` → PostgREST ejecuta **una sentencia** con el cuerpo JSON completo → `publicar_tarifario_resultado` (fachada) → `publicar_tarifario_resultado_interno`: `FOR UPDATE` del paquete, rechazo por generación/revisión, `DELETE` + `INSERT … SELECT` set-based de todas las filas, `UPDATE` del estado. Todo en una transacción: si algo falla, las filas anteriores y la generación publicada quedan intactas.

## Qué se midió (PostgreSQL local con PostgREST delante; CPU del contenedor limitada)
Reparto del SQL con 12.669 filas (sin limitar CPU): texto→jsonb del cuerpo 348 ms · 6 llaves foráneas 180 ms · 4 CHECK de procedencia 130 ms · parseo a filas 123 ms · 5 índices 70 ms · dos pasadas de validación 57 ms · `DELETE` 23 ms. SQL total ≈ 0,70 s (por HTTP ≈ 1,25 s).
Para reproducir el síntoma se limita la CPU del contenedor hasta que el 33 tarda lo que en producción (≈ 3,3 s): el 73 se cancela con `57014` a los ≈ 8,5 s.

| Filas | Antes (rol 8 s) | 259 (función 30 s) | 259 + payload compacto |
|---|---|---|---|
| 3.187 (paquete 33) | 2,5–2,7 s | 2,5 s | 1,6 s |
| 7.413 | 5,1 s | 5,6 s | 4,3 s |
| 12.669 (paquete 73) | **cancelado a 8,6 s (57014)** | 10,3 s | 7,4 s |

Repetible con `supabase/scripts/test_259_publicador_limite.sh`.

## Qué cambia
1. **Menos trabajo por fila (app):** `compactarFilasPublicacion` quita las claves `null` de cada fila (el servidor lee `f.v->>'clave'`, que da NULL igual con la clave ausente): −22 % de bytes, ≈ −30 % del parseo. Con el 73 sola no alcanza para quedar bajo 8 s con margen. Se evaluó y descartó fusionar las dos pasadas de validación (−3 %) y tocar las restricciones (FK/CHECK/índices: son integridad).
2. **Límite propio (BD):** `ALTER FUNCTION … SET statement_timeout = '30s' SET lock_timeout = '8s'` en `publicar_tarifario_resultado` y `publicar_tarifario_resultado_63`.
   - PostgREST aplica la configuración de la función **antes** de la sentencia, así que el temporizador nace en 30 s. Por **SQL directo** un `SET` de función no reprograma una sentencia ya iniciada: rige el 8 s del rol (probado).
   - `lock_timeout = 8 s` explícito: la espera por la fila del paquete sigue acotada (error `55P03 lock timeout`, distinto de `57014 statement timeout`). Probado que manda el de la función (con 3 s en la función falla a ~3 s).
   - 30 s ≈ 1,5 × la peor llamada completa observada (19,8 s, cota superior del SQL) y ≈ 3 × lo medido en el entorno calibrado para el 73. Es un techo, no un objetivo.

## Guarda final de la migración (no sobrescribe configuración ajena)
Cada una de las dos entradas debe estar en uno de dos estados; cualquier otro aborta la 259 con «259 ABORTADA (REVISAR)» **sin cambiar nada** (la transacción se revierte):
- **SIN_LIMITES:** su configuración es solo `search_path=public, pg_temp`.
- **APLICADA_259:** además exactamente `lock_timeout=8s` y `statement_timeout=30s` (reaplicar es un no-op).
- **AJENA:** otro `statement_timeout`, un `lock_timeout` suelto, `work_mem`…, o un `search_path` distinto. También aborta si falta la función o dejó de ser SECURITY DEFINER.

El preflight reporta el mismo estado por función y da el veredicto REVISAR si alguna es AJENA. La migración no trae `COMMENT ON` y el `notify pgrst` va dentro de la transacción (si aborta, no se envía).

## Rollback
`rollback_259_…` considera «exactamente la 259» solo la configuración **completa**: `search_path=public, pg_temp` + `statement_timeout=30s` + `lock_timeout=8s`. Por función, de forma independiente:
- configuración completa de la 259 → `RESET statement_timeout RESET lock_timeout`;
- sin límites propios → no hace nada;
- cualquier otra cosa (un límite cambiado después, o un `search_path` que cambió después de la 259) → **no la toca** y avisa con WARNING; la otra función sí se revierte si sigue exactamente en estado 259.

Al final emite `ROLLBACK 259 COMPLETO` (notice) o `ROLLBACK 259 INCOMPLETO` (warning, con la lista de funciones sin tocar): un rollback parcial no debe darse por terminado.

## Volumen del paquete 73 y cota sintética
Se midió con los archivos 256 y 258 del hotfix de traslados aplicados a la base local (leídos desde su worktree, sin copiarlos al repo).
- **Dato real (Preview, generación 8, ANTES de la 256):** 12.669 filas = 12.668 de bloqueo + 1 de servicio. El paquete 73 tiene el **servicio 112 como incluido**; la 256 lo trata por fecha (cubre 3 de las 19 salidas) y el servicio de asistencia es opcional.
- **Qué NO está demostrado:** cuántas filas genera el 73 **bajo la 256 real**. La 256 puede **aumentar** las filas: al conservar salidas que antes se bloqueaban por no tener el servicio incluido, aparecen filas de hotel que antes no existían. Ese número solo se conoce generando el 73 de verdad con la 256 desplegada.
- **Prueba sintética de 22.401 filas:** es una **cota teórica**, no una generación real. Se construye con la forma del 73 (32 vuelos × 100 combinaciones × 7 acomodaciones = 22.400 de bloqueo + 1 de servicio) y sirve para demostrar que, si la 256 llevara el 73 hasta ese máximo, la publicación sigue cabiendo en 30 s con margen. No prueba que el 73 real llegue a ese volumen ni que se quede en 12.669. Un paquete con más vuelos o combinaciones tendría que volver a medirse.

Mediciones (CPU calibrada para que el 33 tarde ≈ 3,3 s; tiempos de la llamada completa por PostgREST):

| Caso | Filas | Tiempo |
|---|---|---|
| Antes de la 259 (rol 8 s) | 12.669 | cancelado a 8,8 s (`57014`) |
| 259, payload completo | 12.669 | 11,9 s |
| 259 + payload compacto | 12.669 | 9,0 s |
| 259 + payload compacto (**cota**) | 22.401 | 18,3 s → margen 1,64× frente a 30 s |

Tras publicar: `registrar_composicion_publicada` (19 filas) 86 ms y `registrar_diagnostico_tarifario` 14 ms. Con 22.401 filas ya publicadas, un timeout y un error de FK dejan intactas las filas anteriores y la generación publicada.

## Pruebas locales
- `supabase/scripts/test_259_configuracion.sh <base> [contenedor] [plantilla]`: 47 comprobaciones — aplicación y reaplicación, límite previo (`lock_timeout`, `statement_timeout`, `work_mem`, `search_path`, ajeno solo en `_63`), cambio posterior antes del rollback, **259 aplicada → cambia el `search_path` → rollback** (la función alterada queda intacta, la otra se revierte, el resultado es INCOMPLETO), rollback exacto e idempotente.
- `supabase/scripts/test_259_publicador_limite.sh`: gate con PostgREST. Variables: `MIGRACIONES_PREVIAS` (rutas separadas por espacio, p. ej. 256 y 258) y `COTA=1` (publica las 22.401 filas).

## Reevaluación con la medición real del 73 (generación 9)

**Medición real (Preview, 259 puesta):** `resultado=ok`, 12.669 filas, `publicar` = 23.829 ms, total 24.988 ms → 1,88 ms/fila. El 33 (3.187 filas, 3.283 ms) daba 1,03 ms/fila: el 73 es **más lento por fila que el 33**, es decir, la curva no es lineal. Con el límite de 30 s el 73 pasa con 1,26× de margen en tiempo, pero solo ≈ 1,1–1,3× en filas.

### Cuántas filas producirá el 73 con la 256 (acotado, no medido)
- `generarTarifario` publica **todo vuelo seleccionado con ambas fechas y destino aéreo permitido** (`bloqueoAporta`); la fecha futura solo la filtra la **lectura** del tarifario (`hoyISO()` = fecha de negocio de Bogotá). Por eso «19 salidas futuras» (inventario de la 256) **no** acota lo que se publica: el 73 tiene 32 vuelos seleccionados y las 12.668 filas actuales ya pueden cubrirlos.
- La 256 no cambia cuántos vuelos, hoteles ni acomodaciones entran; cambia qué pasa con un incluido sin vigencia (se omite del servicio en esa salida en vez de bloquearla). Solo puede **sumar** filas si hoy alguna estadía queda fuera por ese motivo.
- **Cota dura sin datos nuevos:** 32 vuelos × 100 combinaciones × 7 acomodaciones = 22.400 (+1 de servicio) = **22.401**. Es un techo teórico (la configuración del 73 que dio el diagnóstico), no una generación real bajo la 256. La **cota con datos** sale de `supabase/scripts/lectura_capacidad_publicador_73.sql` (filas 4–6), de solo lectura y sin depender de `pg_stat_statements`.
- Antes de generar el 73 con la 256 hay que correr esa lectura: si «distintos publicados» ya es igual a «con ambas fechas» y la cota de la fila 6 queda ≲ 17.000, un solo envío cabe con margen; si no, ver «Recomendación».

### Separación SQL / transferencia / espera
- **Inferencia de las mediciones reales (no es una medición directa):** en la generación 8 la base cortó la sentencia a los 8 s y la llamada de la app duró 19,8 s. Esos **≥ 11,8 s quedaron fuera del temporizador de la sentencia** (serialización, subida del cuerpo de ≈ 10–12 MB, lectura por PostgREST, respuesta). Con el cuerpo compactado (−22 %) esa parte baja, pero no desaparece.
- **Espera por candado:** sin evidencia en la 9; el `lock_timeout` de 8 s la acota.
- **Medirlo de verdad:** localmente la limitación de CPU mezcla SQL y transferencia y no se pueden separar con fidelidad. En producción, `pg_stat_statements` da el tiempo de SQL **agregado** (`lectura_capacidad_publicador_73_pgss.sql`, opcional): son todas las llamadas al publicador desde el último reinicio, **no** la generación 9, y **no se restan** de sus 23.829 ms. Sirven como orden de magnitud.

### Pruebas locales (`CAPACIDAD=1 … test_259_publicador_limite.sh`, `test_259_capacidad.mjs`)
CPU del contenedor limitada hasta que 12.669 filas tarden lo medido en producción (22,7–25,8 s frente a 23,8 s reales). Cuatro corridas completas; el ruido entre corridas es grande (±25 %, p. ej. 22.401 filas con límite alto tardó 38,0–65,4 s). Tiempos de la llamada completa por PostgREST.

| Caso | Resultado |
|---|---|
| 14.000–17.000 filas, límite 30 s | en el borde: según la corrida publica (25,8–30,7 s) o da 57014 |
| 22.401 filas, límite 30 s | **57014 a los ≈ 31 s** (cuatro de cuatro), rollback: la publicación anterior queda intacta |
| 17.000 / 20.000 / 22.401 filas, límite 45 s | publican en 37,6 / 45,8 / 42,7 s (una corrida; otras corridas con límites mayores dieron 44,5–65,4 s para 22.401) |
| 22.401 filas, límite 90–120 s (informativo) | publica en 38,0–65,4 s |
| 22.401 filas por lotes de 2.000 | subida 17,8–30,3 s (cada lote ≤ 6,1 s); **activación atómica 52–55 s** |

- **Por lotes con activación atómica no evita un límite largo:** la activación (insertar con todas sus llaves, CHECK e índices, borrar lo anterior, todo atómico) tarda lo mismo que la llamada única. Partirla rompería la atomicidad o exigiría que todos los lectores filtren por generación; además requiere tabla de paso, tres RPC y reimplementar las guardas del publicador, que la 256 redefine.
- **Calcular según la búsqueda:** rediseño del tarifario publicado, fuera de alcance.

### Qué está comprobado y qué no
| Tema | Estado |
|---|---|
| Supabase documenta **60 s como máximo configurable** para consultas por el Dashboard y la Client API; más tiempo se pide por pooler o conexión directa (supabase.com/docs/guides/database/postgres/timeouts) | **Comprobado en la documentación** |
| `statement_timeout` por función (`ALTER FUNCTION … SET`) se aplica a llamadas por la Client API (ejemplo de la documentación, 4 s) | **Comprobado** en la documentación y localmente con PostgREST |
| La 259 (30 s) está dentro de lo documentado | **Comprobado** |
| Un `statement_timeout` de **120 s** (o 90 s) por función se respeta por la Client API de Supabase y la petición HTTP no se corta antes | **NO comprobado**: contradice el máximo documentado de 60 s; localmente no hay gateway. **Necesita confirmación de Supabase** (soporte) antes de usarlo |
| Vercel con Fluid Compute (activo por defecto): duración por defecto **300 s** en Hobby y Pro (máx. 800 s en Pro); `maxDuration` en la página rige para sus Server Actions | **Comprobado** en la documentación de Vercel y de Next 16 |
| El proyecto D'spacios tiene Fluid Compute activo y qué «Default Max Duration» tiene | **NO verificado** (no hay `.vercel`, ni CLI, ni `vercel.json` con `functions`). Indicio: la generación 9 corrió 25 s, más que el defecto de 15 s sin Fluid. Confirmar en el panel (Settings → Functions) |

### Recomendación (dentro de lo comprobado)
1. **No usar 120 s ni 90 s.** Superan el máximo documentado de 60 s y no están comprobados por la Client API.
2. **No fijar `maxDuration = 180`:** con Fluid Compute el defecto es 300 s; 180 lo **reduciría**. Si el panel dice otra cosa (p. ej. 15–60 s), fijar `maxDuration` al valor del panel o mayor (≥ 120 s alcanza para una llamada ≤ 60 s); si dice 300 s, no tocar nada.
3. **Migración 260 (opcional, solo si hace falta margen):** subir `statement_timeout` de las dos entradas de 30 s a **45 s** (`lock_timeout` sigue en 8 s). Está dentro de lo documentado y deja ≥ 15 s de los 60 s de la petición para subida y respuesta (la inferencia de la generación 8 da ≈ 9–12 s con el cuerpo compactado). Con 45 s el borde de una sola publicación sube de ≈ 15.000–17.000 a ≈ 20.000 filas. Misma guarda que la 259 (solo cambia una entrada exactamente en estado 259; lo ajeno aborta).
4. **Si la cota con datos supera ≈ 20.000 filas**, una sola llamada **no** cabe con garantía dentro de lo comprobado, y 255/256/258 no deben desplegarse para ese paquete hasta decidir una de estas salidas: reducir combinaciones o vuelos en el armado del 73 (operativa), dividirlo en dos paquetes, o diseñar la publicación en particiones independientes (decisión de producto: cada partición atómica, el paquete se publica completo cuando todas lo están). Una guarda en la app que rechace antes de subir más de N filas (con un mensaje claro) evita pagar 30–45 s para fallar con 57014.
5. **Riesgo operativo a tener presente:** tras la 258, las filas publicadas antes se rechazan al reservar hasta regenerar el paquete. Si la regeneración del 73 falla (57014), el 73 queda sin poder venderse bloqueo/dinámico hasta que una regeneración pase. Por eso conviene tener los datos de la lectura **antes** de desplegar 258.

## Efecto colateral conocido
Una publicación larga mantiene el `FOR UPDATE` del paquete: otra escritura sobre **esa fila** (un nuevo «Generar», un cambio de fuente que invalida el tarifario) espera hasta `lock_timeout` (8 s) y falla con `55P03` si la publicación sigue. Medido: esperas de 4–6 s con una publicación de ≈ 10 s. Solo afecta a paquetes que hoy no publican. Los **lectores** no esperan (MVCC).

## Reglas para no perder el límite
- `CREATE OR REPLACE FUNCTION` de cualquiera de las dos entradas **borra** sus `SET`: toda migración posterior que las re-cree debe repetir `statement_timeout` y `lock_timeout` (lo vigila `pruebas/publicadorLimite259.test.ts`).
- Nunca `RESET ALL` sobre estas funciones: borra también el `search_path` de las SECURITY DEFINER. El rollback usa `RESET statement_timeout RESET lock_timeout`.
- La 259 no toca cuerpos: la 256 (hotfix de traslados) puede redefinir el interno sin conflicto.

## Integración con la instrumentación de #416
#416 (`investigacion/timeout-tarifario-73`) no está en `main` ni en la base de esta rama. Ambos cambios tocan `generarTarifario` en `app/(dashboard)/dashboard/paquetes/actions.ts` y el conflicto es trivial (dos hunks): conservar el import de `cronometroGeneracion` **y** el de `filasPublicacion`, y dejar `cron.etapa("publicar");` **antes** de `const filasPublicar = compactarFilasPublicacion(filas);` (así la medición de la etapa «publicar» incluye el costo de compactar). Además `pruebas/cronometroGeneracion.test.ts` (de #416) debe esperar `p_filas: filasPublicar as unknown as Json` en vez de `p_filas: filas as unknown as Json`. Probado en un worktree desechable: `tsc` limpio y 115 de 115 pruebas focales.

## Despliegue (base única para Preview y Producción)
1. Preflight (`preflight_259_…`): cualquier función AJENA = REVISAR, no correr. Guardar las huellas md5.
2. Migración 259. 3. Postcheck: ambas APLICADA_259 y huellas md5 iguales a las del preflight. 4. Esperar la recarga de PostgREST.
5. Desplegar el código (compatible hacia atrás: el servidor acepta claves ausentes). Si #416 aún no está en la base, integrarlo antes (ver arriba).
6. **Medir el paquete 73** (es el que falló; el 33 **no** cierra el fallo original): un único «Generar tarifario» del 73 con la 259, la 256 (si ya está desplegada) y el código nuevo. Copiar la línea `generarTarifario: medicion …` de Vercel Logs. Criterio de cierre: `resultado=ok`, `filas_calculadas` registrado (es el volumen real bajo la 256) y `ms_etapa` de «publicar» claramente por debajo de 30 s; si el volumen real supera ~22.000 filas o el tiempo se acerca a 30 s, reabrir.
7. El **33** se usa solo como control de no regresión (tarda ≈ 3 s); que pase no demuestra nada sobre el 73.
Scripts: `preflight_259_…`, `postcheck_259_…`, `rollback_259_…` en `supabase/scripts/`. Rollback: si dice `ROLLBACK 259 INCOMPLETO`, no está terminado.
