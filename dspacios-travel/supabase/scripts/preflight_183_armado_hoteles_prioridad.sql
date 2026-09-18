-- Preflight 183 — SOLO LECTURA. Corre ANTES de aplicar la migración 183.
-- Objetivo: confirmar que no hay nada que la migración pudiera romper (es
-- puramente aditiva: una columna + un CHECK + un índice único parcial) y
-- dimensionar cuántas filas de armado_hoteles existen hoy (todas quedarán
-- con prioridad = null, sin backfill).

-- 1) La columna NO debe existir todavía.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'armado_hoteles'
  and column_name = 'prioridad';
-- Esperado: 0 filas.

-- 2) Volumen de filas afectadas (todas quedarán con prioridad = null).
select count(*) as total_filas_armado_hoteles from public.armado_hoteles;

-- 3) Confirmar que no hay ningún CHECK previo con el mismo nombre EN ESTA
--    TABLA. Filtrado por `conrelid`: el nombre de un constraint es único por
--    tabla en Postgres, no global.
select conname
from pg_constraint
where conrelid = 'public.armado_hoteles'::regclass
  and conname = 'armado_hoteles_prioridad_rango_check';
-- Esperado: 0 filas.

-- 4) El índice único parcial no debe existir todavía.
select indexname
from pg_indexes
where schemaname = 'public' and tablename = 'armado_hoteles'
  and indexname = 'armado_hoteles_paquete_prioridad_unica';
-- Esperado: 0 filas.

-- 5) Diagnóstico informativo: paquetes con más de 6 hoteles asociados hoy
--    (no bloquea la migración — el límite de 6 solo aplica a los
--    RECOMENDADOS, nunca al total de hoteles asociados al paquete — pero es
--    útil saber cuántos paquetes tienen inventario grande antes de empezar a
--    marcar recomendados).
select paquete_id, count(*) as hoteles_asociados
from public.armado_hoteles
group by paquete_id
having count(*) > 6
order by hoteles_asociados desc
limit 20;
