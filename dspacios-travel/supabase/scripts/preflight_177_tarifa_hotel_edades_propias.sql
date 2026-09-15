-- Preflight 177 — SOLO LECTURA. Corre ANTES de aplicar la migración 177.
-- Objetivo: confirmar que no hay nada que la migración pudiera romper (es
-- puramente aditiva) y dimensionar cuántas filas de tarifa_hotel existen hoy
-- (todas quedarán con las 4 columnas nuevas en NULL = fallback histórico).
--
-- ⚠️ Paso 1 de 4 del orden OBLIGATORIO de despliegue — ver la cabecera de
-- 20260601000177_tarifa_hotel_edades_propias.sql: preflight (este script,
-- REMOTO) → migración 177 (REMOTO) → postcheck (REMOTO) → recién ahí
-- desplegar el código. `computarReserva` (computo.ts) y el buscador público
-- (cotizar.ts) consultan estas columnas para CUALQUIER hotel "persona" —
-- desplegar el código antes de correr la migración rompe TODAS las reservas/
-- búsquedas de hotel de ese entorno, no solo las que usan edades propias.

-- 1) Las 4 columnas NO deben existir todavía (si ya existen, la migración es
--    un no-op seguro por los `if not exists`, pero es bueno saberlo antes).
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'tarifa_hotel'
  and column_name in ('edad_infante_min', 'edad_infante_max', 'edad_nino_min', 'edad_nino_max');
-- Esperado: 0 filas (columnas nuevas, todavía no existen).

-- 2) Volumen de filas afectadas (todas quedarán en NULL tras la migración —
--    dimensiona el trabajo de configurar "edades propias" después, si se
--    quiere).
select count(*) as total_filas_tarifa_hotel from public.tarifa_hotel;

-- 3) Confirmar que no hay ningún CHECK previo con el mismo nombre EN ESTA
--    TABLA (evita un error de "constraint ya existe" con un cuerpo distinto
--    al esperado). Filtrado por `conrelid`: el nombre de un constraint es
--    único por tabla en Postgres, no global — sin este filtro, una
--    restricción con el mismo nombre en OTRA tabla aparecería acá sin ser
--    relevante para esta migración.
select conname
from pg_constraint
where conrelid = 'public.tarifa_hotel'::regclass
  and conname in ('tarifa_hotel_edades_todas_o_ninguna_check', 'tarifa_hotel_edades_rangos_check');
-- Esperado: 0 filas.
