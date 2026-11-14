# Migraciones 303 · 304 · 305 · 306 — orden, dependencias y controles (2026-11-13; estado actualizado 2026-11-14)

> **Estado (registrado 2026-11-14): las cuatro (303, 304, 305 y 306) están APLICADAS en Producción según los resultados del dueño.** Son **inmutables**: no se editan sus SQL, no se reaplican y no se renumeran. Este documento (cuyo nombre conserva «pendientes»
> porque otros textos lo referencian) queda como referencia del orden, las dependencias y los controles con que se aplicaron. No se anotan aquí los resultados individuales de cada postcheck: la fuente es el registro del dueño.
> Cada una es **aditiva e idempotente**, con su `preflight_`, `postcheck_` y `rollback_` en `supabase/scripts/`. Cada preflight/postcheck es **UNA consulta integral** con una columna `estado` (OK / REVISAR / INFO).
> Los `rollback_` se conservan como recurso de emergencia: **no se ejecutan sin decisión expresa del dueño** (ver §3).
> `build304.log` y `build305.log` (logs de sesiones anteriores, sin seguimiento) **no forman parte de ninguna entrega**: no se incluyen ni se borran.

## 1. Estado: cadena previa y 303–306, todo aplicado
Según los resultados del dueño, en Producción están aplicadas **284, 285, 286, 287, 288, 289, 290, 291, 292, 293–302 y 303–306**. Eso incluye:
- la cadena **#75/#97** completa (**288 → 292 → 286 → 289 → 290 → 291**) con el **ciclo #97 encendido**;
- las de **#43/#60**, 298–302 (aplicadas en ese orden; eran «provisionales» antes de aplicarse y **ya no lo son**);
- las **303–306** de este bloque, con el **reuso de bloqueos ENCENDIDO** (la 304 lo conserva; no toca `dtm_reuso_config.habilitado`).

Los preflights de este bloque **comprobaron** la cadena previa, no pidieron reejecutarla: `preflight_304` (la 289 aplicada y `dtm_reuso_bloqueos` exactamente la que reemplaza, por md5; 284 y 289), `preflight_305` (la 286 aplicada y `registrar_comision_b2b_reserva` exactamente la suya, por md5), `preflight_303` (tabla `hotel_categorias`) y `preflight_306` (tabla `cotizaciones`). Si en algún entorno nuevo un control dice **REVISAR**, no se aplica la migración y no se «completa» la cadena desde este bloque.

## 2. Orden y controles con que se aplicaron (una migración por vez)
| # | Migración | Qué hace | Exige (lo verificó su preflight) | Controles |
|---|---|---|---|---|
| 1 | **303** `hotel_categoria_descripcion` (#16/#45) | 2 columnas nullable en `hotel_categorias` (descripción y «qué incluye» por categoría y hotel) | tabla `hotel_categorias` (017) | `preflight_303` → `postcheck_303` → `rollback_303` |
| 2 | **304** `contrato_resumen_precios` (#94) | tabla `contrato_resumen_precios` (resumen de cara al cliente congelado por contrato) + `dtm_reuso_bloqueos` con ese nombre en la lista de preparación | **284** (guardas de identidad) y **289** (lista de preparación; md5). **Conserva el reuso ENCENDIDO** | `preflight_304` (7 controles; anota el estado del reuso) → `postcheck_304` (8; compara que el reuso siga como estaba) → `rollback_304` (se niega si hay resúmenes que perder) · `test_304_resumen_contrato.sh` (34/0) · `test_304_conversion_resumen.sh` · `test_304_estado_reuso.sh` (18/0) |
| 3 | **305** `recobro_comision_reserva` (#14-A) | `registrar_comision_b2b_reserva` lee `ventas.recobro_*` y aplica la regla de #97 (recobro fuera de la base con participación; NETO descuenta ordinaria + participación). Sin recobro, byte a byte la de la 286 | **286** (md5 de la función = el de la 286; el postcheck reconoce el de la 305) y las columnas de recobro de `ventas` (086). *No* depende de la 304 | `preflight_305` (5) → `postcheck_305` → `rollback_305` (restaura la 286 por md5) · `test_305_recobro_reserva.sh` (20/0) |
| 4 | **306** `cotizacion_clave_envio` (#14-A) | `cotizaciones.clave_envio uuid` + `huella_envio text` (SHA-256 del contenido, 64 hex) + `actor_envio text` (usuario o «anon»), restricción `cotizaciones_clave_envio_completa_chk` (con clave, huella y actor son obligatorios) e índice **único parcial** `uq_cotizaciones_clave_envio` (una cotización por intención de envío: mismo usuario y mismo contenido) | tabla `cotizaciones` (sin otras) | `preflight_306` (3) → `postcheck_306` (3) → `rollback_306` · pruebas 102 · R21a–i |

Secuencia seguida: preflight → migración → postcheck, de a una, en el orden 303 → 304 → 305 → 306, sin saltar pasos ni aplicar dos juntas.

## 3. Código y rollback
El código de este bloque **necesita las cuatro** (la conversión escribe `contrato_resumen_precios` —304—, la reserva B2B con recobro usa la función de la 305, el checkout manda `clave_envio` —306— y la ficha de hotel lee las columnas de la 303). Como las migraciones ya están aplicadas, **la condición «migraciones antes que código» ya se cumple**: el código puede fusionarse y desplegarse, y después se valida en Producción con un usuario real (cotizar con recobro, convertir, confirmar; dos pestañas).
Rollback (solo con decisión del dueño): **primero el código**, luego 306 → 305 → 304 → 303, cada uno con su script; el de la 304 se niega si hay resúmenes guardados y el de la 305 conserva lo ya registrado. Nunca se hace rollback de la cadena previa desde este bloque. Con las migraciones ya aplicadas, un rollback de base SIN retirar antes el código deja el código apuntando a objetos que ya no existen.

## 4. Correcciones a lo dicho antes en este bloque
- **(2026-11-14)** Se registran 303–306 como **aplicadas en Producción según los resultados del dueño**, sin editar sus SQL (ni el encabezado de la 303, cuyo comentario «298–302 provisionales» quedó como se escribió).
- **(2026-11-14)** Una versión anterior presentaba la cadena #75/#97 (288, 292, 286, 289, 290, 291) como no aplicada y como paso 0, e indicaba aplicarla antes de 303. Era incorrecto: ya estaba aplicada (con el reuso encendido). Las menciones históricas que presentaban 298–302 como «provisionales» o «sin aplicar» (diseño y especificación de #43/#60, índice de `docs/tecnico/README.md`, auditoría final) se anotaron con «aplicada en Producción 2026-11-13»; los SQL de 298–302 no se tocan (inmutables).
- La 305 exige la **286**, no la 304 (la sección 14 del diseño de #14-A decía lo contrario; corregida el 2026-11-14).
- La 306 se añadió a este tramo por el hallazgo de las dos pestañas (R21a: sin clave, dos envíos simultáneos crean dos cotizaciones); estaba fuera del alcance «303, 304, 305».
- El humo compilado exige `NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-local-304` y, en esta máquina, `NODE_OPTIONS=--max-old-space-size=6144` para `next build` (el chequeo de tipos supera los 2 GB de heap por defecto con la suite de pruebas actual).
