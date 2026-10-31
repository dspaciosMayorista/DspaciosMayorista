# Traslados por alcance — esquema de base de datos (migraciones 262–265, PROVISIONALES)

> **Alcance de este documento:** el esquema (4 migraciones), sus controles (preflight/postcheck/rollback), los gates de prueba y el orden de aplicación. El código de venta (búsqueda, carrito, conversión, CxP) y la consulta de pendientes se documentan en el PR de la aplicación.
>
> **Estado:** las cuatro migraciones están escritas y probadas en PostgreSQL + PostgREST locales (esquema completo, 255 a 265); **NO están aplicadas** en ninguna base compartida. Los números son provisionales: 257 (`65-portal-b2b`), 260 (`publicar-lotes`) y 261 (`api-b2b-etapa1`) existen solo como archivos en worktrees locales sin publicar. Verificado frente a `origin/main` (`4da74d17`, con #421) y a las 40 ramas remotas: 262–265 están libres y ninguna rama remota trae migraciones ≥ 255 que no estén en `main`. Antes de aplicar hay que confirmarlos con quienes llevan esas ramas (si alguno cambia, renombrar el archivo y los scripts `*_26x_*`; las huellas no dependen del número).
>
> **Prerrequisitos en `main`:** las migraciones 255, 256, 258 y 259 (el preflight 262 exige la 255).

## Qué resuelve
Un traslado se vende por **llegada**, **salida** o **ida y regreso**, con precio **propio** para «un trayecto» y para «ida y regreso» (por vigencia y rango de pasajeros); nunca se calcula uno a partir del otro. La vigencia `GENERAL` es histórica y no se vende. El alcance vendido queda enlazado, con una clave estable, entre la línea del contrato y su cuenta por pagar.

## Las cuatro migraciones (en este orden; cada una depende de la anterior; permanecen separadas)
| N.º | Archivo | Qué agrega | Rollback |
|---|---|---|---|
| 262 | `supabase/migrations/20260601000262_servicio_tipo_alcance_rangos_suplemento.sql` | `servicios_adicionales.tipo_receptivo` (tour · traslado · asistencia_medica · combo; NULL = sin clasificar, todo el legado) + `combo_incluye_traslado`/`combo_traslado_alcance` (con CHECK); tabla `servicio_precio_alcance` (RLS, trigger de rangos); `servicio_suplementos_franja.pax_desde/pax_hasta`; `contrato_servicios.alcance_traslado` | `supabase/scripts/rollback_262_servicio_tipo_alcance.sql` |
| 263 | `supabase/migrations/20260601000263_reemplazar_precios_alcance.sql` | RPC `reemplazar_precios_alcance(vigencia, filas)`: borra e inserta en UNA transacción (un fallo en cualquier fila deja la configuración anterior íntegra). SECURITY INVOKER, EXECUTE solo `authenticated`, rechaza GENERAL | `supabase/scripts/rollback_263_reemplazar_precios_alcance.sql` |
| 264 | `supabase/migrations/20260601000264_cxp_enlace_servicio_alcance.sql` | `contrato_servicios.servicio_id`; `cuentas_por_pagar.alcance_traslado` y `contrato_servicio_id` (FK + índice único parcial); trigger de enlace por descripción | `supabase/scripts/rollback_264_cxp_enlace_servicio_alcance.sql` |
| 265 | `supabase/migrations/20260601000265_enlace_cxp_clave_estable.sql` | `contrato_servicios.clave_enlace` (uuid único), 4 triggers y la función `corregir_enlace_cxp_alcance`; **retira el trigger de la 264** (el enlace pasa de la descripción a la clave) | `supabase/scripts/rollback_265_enlace_cxp_clave_estable.sql` |

### Objetos de la 265 (contrato del esquema)
No se reemplaza `registrar_financiero_contrato` (redefinida en 10 migraciones, inserta con columnas fijas, delega en `p63_registrar_financiero`). La clave viaja como sufijo ` · enlace:<uuid>` de `cuentas_por_pagar.observaciones`, que ambas rutas copian tal cual:
- `cxp_enlace_por_clave` (BEFORE INSERT): verifica línea existente, mismo contrato y servicio, con alcance y sin otra CxP; si no cuadra **lanza excepción** y revierte la RPC. Una CxP no puede traer vínculo ni alcance sin clave verificable.
- `cxp_enlace_inmutable`: alcance y vínculo de una CxP emitida no cambian por UPDATE; solo con `corregir_enlace_cxp_alcance` (superadmin/gerencia; valida contrato, servicio, alcance y unicidad; queda en `auditoria`).
- `linea_enlazada_protegida`: una línea con CxP enlazada no cambia de alcance/servicio/clave ni se borra mientras exista su contrato.
- `ventas_completo_exige_enlaces`: el contrato no pasa a financiero `completo` si una línea con alcance y costo > 0 quedó sin CxP (cubre también la ruta de oferta #63).
- Datos legados: sin clave no hay enlace (nada se infiere por descripción). Las huellas de `registrar_financiero_contrato` y `p63_registrar_financiero` quedan **idénticas** (lo verifica el postcheck 265).

## Orden de aplicación (Preview y Producción comparten base)
1. Confirmar la numeración (257/260/261). 2. `supabase/scripts/huellas_262_lectura.sql` y `supabase/scripts/preflight_262_servicio_tipo_alcance.sql` (APTO PARA APLICAR).
3. Aplicar la **262**. 4. `supabase/scripts/postcheck_262_servicio_tipo_alcance.sql` (OK). 5. `supabase/scripts/inventario_262_servicios_por_clasificar.sql` (solo lectura): lista los servicios a clasificar; la «sugerencia por nombre» es solo una pista.
6. Aplicar la **263**. 7. Aplicar la **264**.
8. `supabase/scripts/preflight_265_enlace_cxp_clave.sql` (APTO PARA APLICAR). 9. Aplicar la **265**. 10. `supabase/scripts/postcheck_265_enlace_cxp_clave.sql` (OK; incluye la comparación de huellas de las dos RPC financieras).
11. Recién entonces desplegar el código de la aplicación (PR aparte). Cada migración se aplica una sola vez, en su propia ejecución; las cuatro quedan como archivos separados y en ese orden.

Reaplicar es idempotente (el preflight/postcheck lo reportan como «ya aplicada»). Rollback en orden inverso: 265 → 264 → 263 → 262; cada rollback conserva los datos de contratos y CxP, y el de la 262 aborta si hay datos que la usan.

## Controles y gates (todos en Docker local, nunca la base compartida)
- `supabase/scripts/entorno_262_local.sh`: arma una base desde una plantilla con el esquema hasta la 254, aplica 255, 256, 258, 259 y 262–265 con preflight/postcheck, levanta un PostgREST propio y limpia lo que crea (no se ejecuta solo).
- `supabase/scripts/test_262_gates.sh <contenedor> completo <plantilla>` (con `supabase/scripts/test_262_servicio_tipo_alcance.sql`): huellas de 25 objetos, preflight/postcheck, reaplicación, concurrencia, rollback (con y sin datos) y permisos efectivos.
- `supabase/scripts/test_263_reemplazar_precios.sh <contenedor>`: atomicidad de la RPC (fallo intermedio, repetición, roles, concurrencia, control negativo).
- `supabase/scripts/test_262_263_postgrest.sh <base> <contenedor> <plantilla>` (con `pruebas/postgrest262_263.pg.mjs`): RPC, RLS, permisos y concurrencia por HTTP con JWT.
- `supabase/scripts/test_265_enlace_cxp.sh <base> <contenedor> <plantilla>` (con `pruebas/enlace265.pg.mjs`): clave estable, duplicados, edición por rol, `corregir_enlace_cxp_alcance`, `eliminar_contrato`/`fn_renumerar_contrato`, actualización desde la 264 con datos legados, rollback y reaplicación.
- Resultados de referencia (esquema completo, 255 a 265): gates 0 fallas; 263: 34 correctas; PostgREST: 73 correctas; enlace 265: 91 correctas, 0 fallas (fases A y C, 0 fallas).

## Permisos efectivos
`authenticated` sobre `servicio_precio_alcance`: solo SELECT, INSERT, UPDATE y DELETE (con la RLS de roles internos); `anon` nada; sin TRUNCATE/REFERENCES/TRIGGER. `reemplazar_precios_alcance` y `corregir_enlace_cxp_alcance`: EXECUTE solo `authenticated` (esta última exige superadmin/gerencia dentro de la función). Las funciones de trigger no son ejecutables por `anon`/`authenticated` ni se exponen como RPC.

## Límites del esquema
- La 265 deja sin efecto el trigger de la 264; las dos se aplican en su orden y por separado.
- Hallazgo previo a este trabajo: la tabla `servicio_suplementos_franja` (255) conserva los privilegios por defecto de Supabase (incluidos TRUNCATE/REFERENCES/TRIGGER para `authenticated`); estas migraciones no la modifican.
- `administracion` puede editar otras columnas de su propia CxP por la RLS de siempre; el alcance y el vínculo quedan protegidos por los triggers de la 265.
