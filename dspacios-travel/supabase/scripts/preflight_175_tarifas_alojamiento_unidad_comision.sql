-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la migración 175 (`hotel_tarifas_unidad.comision_pct`).
-- SOLO LECTURA — no modifica nada. Correr ANTES de aplicar la 175.
--
-- La 175 agrega UNA columna nueva a `hotel_tarifas_unidad` (nullable, sin
-- backfill, con CHECK). No toca `hoteles` ni `tarifa_hotel`. Precondiciones:
--
--   1) `public.hotel_tarifas_unidad` existe (migración 173 ya aplicada).
--   2) La columna `comision_pct` todavía NO existe (si existe, la 175 ya se
--      aplicó — idempotente, reaplicar es un no-op, pero conviene saber por
--      qué se está corriendo de nuevo).
--   3) El nombre del CHECK está libre.
--   4) INFORMATIVO — cuántas filas existentes de `hotel_tarifas_unidad`
--      quedarían SIN comisión (comision_pct = null) tras aplicar la 175.
--      Esto NO es un error ni algo que la migración deba corregir — es
--      exactamente lo esperado (sin backfill, a propósito, ver el archivo
--      de la migración) — pero quien la aplica debe saberlo de antemano:
--      esas filas seguirán existiendo en la base pero el adaptador
--      (`lib/calc/tarifaAlojamientoPersistida.ts`) las rechazará al leerlas
--      (payload sin `comisionPct`) hasta que alguien las edite con el
--      porcentaje real.
--
--   psql -d <base> -v ON_ERROR_STOP=1 -f preflight_175_tarifas_alojamiento_unidad_comision.sql
-- ───────────────────────────────────────────────────────────────────────────

\echo '=== 1) hotel_tarifas_unidad existe (migracion 173 aplicada) ==='
select to_regclass('public.hotel_tarifas_unidad') is not null as tabla_existe;
\echo 'esperado: tabla_existe = t (si es f, aplicar primero la 173)'

\echo '=== 2) la columna comision_pct todavia no existe ==='
select count(*) as columnas_comision_pct_ya_definidas
from information_schema.columns
where table_schema = 'public' and table_name = 'hotel_tarifas_unidad' and column_name = 'comision_pct';
\echo 'esperado: 0 (si es > 0, la 175 ya se aplico; reaplicar es no-op, pero confirmar por que)'

\echo '=== 3) el nombre del CHECK esta libre ==='
select count(*) as constraint_ya_definida
from pg_constraint
where conname = 'hotel_tarifas_unidad_comision_pct_check' and conrelid = 'public.hotel_tarifas_unidad'::regclass;
\echo 'esperado: 0'

\echo '=== 4) INFORMATIVO: filas existentes que quedaran SIN comision (esperado, sin backfill) ==='
select
  count(*) as filas_totales,
  count(*) filter (where payload ? 'comisionPct') as filas_con_comisionPct_en_payload,
  count(*) filter (where not (payload ? 'comisionPct')) as filas_sin_comisionPct_en_payload
from public.hotel_tarifas_unidad;
\echo 'esperado: filas_sin_comisionPct_en_payload = filas cargadas antes de esta ronda — NO se inventa ningun porcentaje para ellas.'
\echo 'esas filas seguiran en la base con comision_pct = null tras la 175, y el adaptador las rechazara al leerlas hasta que se editen con el porcentaje real.'
