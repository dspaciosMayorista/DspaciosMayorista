-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la migración 174 (`hoteles.modelo_tarifario`).
-- SOLO LECTURA — no modifica nada. Correr ANTES de aplicar la 174.
--
-- La 174 agrega UNA columna nueva a `hoteles` (con default y CHECK). No toca
-- `tarifa_hotel` ni `hotel_tarifas_unidad`. Precondiciones:
--
--   1) `public.hoteles` existe.
--   2) La columna `modelo_tarifario` todavía NO existe (si existe, la 174 ya
--      se aplicó — es idempotente, reaplicar es un no-op, pero conviene saber
--      por qué se está corriendo de nuevo).
--   3) El nombre del CHECK no está ocupado por otra cosa.
--   4) Conteos informativos de hoteles/tarifa_hotel/hotel_tarifas_unidad para
--      comparar contra el postcheck y confirmar que la 174 no movió ninguna
--      fila de esas tablas.
--
--   psql -d <base> -v ON_ERROR_STOP=1 -f preflight_174_hotel_modelo_tarifario.sql
-- ───────────────────────────────────────────────────────────────────────────

\echo '=== 1) hoteles existe ==='
select to_regclass('public.hoteles') is not null as tabla_hoteles_existe;
\echo 'esperado: tabla_hoteles_existe = t'

\echo '=== 2) la columna modelo_tarifario todavia no existe ==='
select count(*) as columnas_modelo_tarifario_ya_definidas
from information_schema.columns
where table_schema = 'public' and table_name = 'hoteles' and column_name = 'modelo_tarifario';
\echo 'esperado: 0 (si es > 0, la 174 ya se aplico; reaplicar es no-op, pero confirmar por que)'

\echo '=== 3) el nombre del CHECK esta libre ==='
select count(*) as constraint_ya_definida
from pg_constraint
where conname = 'hoteles_modelo_tarifario_check' and conrelid = 'public.hoteles'::regclass;
\echo 'esperado: 0'

\echo '=== 4) contexto: conteos para comparar contra el postcheck ==='
-- `hotel_tarifas_unidad` (migración 173) puede no existir todavía en una base
-- que aún no la corrió. Una referencia ESTÁTICA a esa tabla dentro de un
-- `case`/subconsulta falla en tiempo de PARSEO aunque la rama sea
-- inalcanzable (Postgres resuelve los nombres de tabla al planear la
-- consulta completa, no al ejecutar la rama) — por eso el conteo se resuelve
-- con SQL dinámico dentro de un bloque PL/pgSQL, que sí difiere esa
-- resolución hasta que el `if` ya decidió si la tabla existe.
drop table if exists pg_temp._preflight_174_ctx;
create temp table _preflight_174_ctx (hoteles_total bigint, tarifa_hotel_total bigint, hotel_tarifas_unidad_total bigint);
do $$
declare
  v_hotel_tarifas_unidad_total bigint := -1;
begin
  if to_regclass('public.hotel_tarifas_unidad') is not null then
    execute 'select count(*) from public.hotel_tarifas_unidad' into v_hotel_tarifas_unidad_total;
  end if;
  insert into _preflight_174_ctx
    select (select count(*) from public.hoteles), (select count(*) from public.tarifa_hotel), v_hotel_tarifas_unidad_total;
end $$;
select * from _preflight_174_ctx;
\echo 'esperado: hotel_tarifas_unidad_total = -1 si la 173 no se aplico todavia en esta base, o el conteo real si ya se aplico'
