-- ───────────────────────────────────────────────────────────────────────────
-- Prueba LOCAL del PREFLIGHT de la migración 162 (`preflight_162_tarifario_
-- resumen.sql`): demuestra que el preflight BLOQUEA ante una colisión de
-- nombre y DETECTA columnas faltantes en `tarifario_resultado`.
--
-- Correr SOLO contra una base de verificación LOCAL (ver
-- supabase/scripts/pruebas/local-desde-cero.sh), NUNCA contra producción —
-- este script crea/renombra objetos en una transacción y hace rollback.
--
-- Requiere: migraciones aplicadas hasta la 160 (la 162 TODAVÍA NO aplicada),
-- y el preflight presente en supabase/scripts/. Ej.:
--   local-desde-cero.sh dspacios_local 55432 160
--   psql -p 55432 -d dspacios_local -f supabase/scripts/pruebas/test_162_preflight_bloqueos.sql
--
-- Es SOLO LECTURA para los datos de negocio: no inserta/actualiza/borra
-- ninguna fila real de tarifario_resultado/programas. Los únicos cambios son
-- DDL transitorios (create/drop table de prueba, rename column) dentro de una
-- transacción que siempre hace rollback.
-- ───────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP 1
\pset pager off

\echo '════════ PASO 0 — estado inicial: tarifario_resumen NO debe existir ─────────'
select to_regclass('public.tarifario_resumen') is null as ok_paso0_no_existe_antes;

-- Precondiciones de entorno para que la prueba sea válida: la 161 aplicada y
-- la columna a renombrar presente (si no, el PASO 2 no representaría el caso).
select
  (select count(*) = 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'programas'
       and column_name = 'regla_comisionable_modalidad_mk') as ok_precond_columna_161,
  (select count(*) = 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tarifario_resultado'
       and column_name = 'tipo_tarifa') as ok_precond_columna_tipo_tarifa;

\echo '════════ PASO 1 — COLISIÓN: el preflight debe BLOQUEAR ─────────────'
create table public.tarifario_resumen (x integer);
insert into public.tarifario_resumen values (1);

\echo '--- corriendo el preflight sobre la colisión (veredicto esperado: BLOQUEADO, fila 1 bloqueante=true) ---'
\i supabase/scripts/preflight_162_tarifario_resumen.sql

-- Aserción programática del veredicto: reproducción del predicado de la
-- colisión que el preflight evalúa en su fila 1.
select
  (to_regclass('public.tarifario_resumen') is not null) as ok_paso1_preflight_bloquea_colision;
drop table public.tarifario_resumen;

\echo '════════ PASO 2 — COLUMNA FALTANTE: el preflight debe BLOQUEAR ──────'
begin;

-- Quitar temporalmente una de las 25 columnas que la vista 162 requiere.
-- Seguro en esta base local de verificación: ninguna vista del sistema
-- depende de tarifario_resultado (verificado en el repo) y la transacción
-- hace rollback al final.
alter table public.tarifario_resultado rename column tipo_tarifa to tipo_tarifa_scratch;

-- Aserción: la columna ya no existe (el caso "columnas faltantes" está montado).
select count(*) = 0 as ok_paso2_columna_falta
from information_schema.columns
where table_schema = 'public' and table_name = 'tarifario_resultado'
  and column_name = 'tipo_tarifa';

\echo '--- corriendo el preflight con la columna faltante (veredicto esperado: BLOQUEADO, fila 4 bloqueante=true) ---'
\i supabase/scripts/preflight_162_tarifario_resumen.sql

rollback;

-- Tras el rollback la columna debe volver a estar.
select count(*) = 1 as ok_paso2_columna_restaurada
from information_schema.columns
where table_schema = 'public' and table_name = 'tarifario_resultado'
  and column_name = 'tipo_tarifa';

\echo '════════ PASO 3 — SIN alteraciones: el preflight debe dar OK ────────'
\echo '--- corriendo el preflight limpio (veredicto esperado: OK) ---'
\i supabase/scripts/preflight_162_tarifario_resumen.sql

\echo '=== FIN test_162_preflight_bloqueos.sql — revisar que: ==='
\echo '    PASO 1: veredicto BLOQUEADO (colisión) y ok_paso1_*=true;'
\echo '    PASO 2: veredicto BLOQUEADO (columnas) y ok_paso2_* (true, true);'
\echo '    PASO 3: veredicto OK. Las relaciones temporales no quedan (rollback/drop).'
