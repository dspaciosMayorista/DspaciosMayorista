-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK de la migración 175 (`hotel_tarifas_unidad.comision_pct`).
-- SOLO LECTURA. Correr DESPUÉS de aplicar la 175.
--
-- Verifica lo que la migración PROMETE:
--   A) la columna existe: numeric, NULLABLE, SIN default;
--   B) el CHECK permite null o exige [0, 100);
--   C) NINGUNA fila existente cambió de valor por la migración (todas las
--      filas preexistentes quedan en comision_pct = null — la migración NO
--      inventa ningún porcentaje);
--   D) la migración NO tocó `hoteles` ni `tarifa_hotel` (conteos intactos);
--   E) el comentario de columna documenta la ausencia de backfill y el
--      espejo con el payload.
--
--   psql -d <base> -v ON_ERROR_STOP=1 -f postcheck_175_tarifas_alojamiento_unidad_comision.sql
-- ───────────────────────────────────────────────────────────────────────────

\echo '=== A) columna: tipo, nullability y default ==='
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'hotel_tarifas_unidad' and column_name = 'comision_pct';
\echo 'esperado: comision_pct | numeric | YES | (null)'

\echo '=== B) CHECK: null permitido, o en [0, 100) ==='
select con.conname, pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
where con.conrelid = 'public.hotel_tarifas_unidad'::regclass and con.conname = 'hotel_tarifas_unidad_comision_pct_check';
\echo 'esperado: CHECK (((comision_pct IS NULL) OR ((comision_pct >= (0)::numeric) AND (comision_pct < (100)::numeric))))'

\echo '=== C) ninguna fila existente quedo con un porcentaje inventado ==='
select
  count(*) as filas_totales,
  count(*) filter (where comision_pct is null) as filas_sin_comision,
  count(*) filter (where comision_pct is not null) as filas_con_comision
from public.hotel_tarifas_unidad;
\echo 'esperado: filas_con_comision = 0 si no se cargo ninguna fila nueva entre el preflight y este postcheck (la migracion NO backfillea).'
\echo 'si filas_con_comision > 0 aqui mismo despues de la migracion (sin haber editado nada), ALGO invento datos -- revisar antes de confiar en esta columna.'

\echo '=== D) hoteles y tarifa_hotel sin cambios ==='
select
  (select count(*) from public.hoteles)      as hoteles_total,
  (select count(*) from public.tarifa_hotel) as tarifa_hotel_total;
\echo 'esperado: los mismos conteos que antes de la 175 -- esta migracion no las toca'

\echo '=== E) el comentario documenta ausencia de backfill y el espejo con el payload ==='
select
  coalesce(
    col_description('public.hotel_tarifas_unidad'::regclass,
      (select ordinal_position from information_schema.columns
        where table_schema = 'public' and table_name = 'hotel_tarifas_unidad' and column_name = 'comision_pct')),
    ''
  ) ilike '%nullable sin backfill%' as documenta_sin_backfill,
  coalesce(
    col_description('public.hotel_tarifas_unidad'::regclass,
      (select ordinal_position from information_schema.columns
        where table_schema = 'public' and table_name = 'hotel_tarifas_unidad' and column_name = 'comision_pct')),
    ''
  ) ilike '%payload.comisionPct%' as documenta_espejo_payload;
\echo 'esperado: las dos en t'
