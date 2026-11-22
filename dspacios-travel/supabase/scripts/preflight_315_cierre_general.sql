-- Preflight 315 (solo lectura, UNA consulta; columna estado por control). Esperado: ningún REVISAR/FALLA antes de aplicar.
select n, control, actual, esperado,
       case when estado_sql then 'OK' else coalesce(fallo, 'FALLA') end as estado
from (
  select 1 as n, '064/145 aplicadas (hotel_blackouts con columna categorias)' as control,
         (to_regclass('public.hotel_blackouts') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hotel_blackouts' and column_name = 'categorias'))::text as actual,
         'true' as esperado,
         (to_regclass('public.hotel_blackouts') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hotel_blackouts' and column_name = 'categorias')) as estado_sql, null::text as fallo
  union all select 2, '260 aplicada (tarifario_fila_oculta)', (to_regclass('public.tarifario_fila_oculta') is not null)::text, 'true', to_regclass('public.tarifario_fila_oculta') is not null, null
  union all select 3, 'tarifario_invalidar(bigint[], boolean) presente (181/260)', (to_regprocedure('public.tarifario_invalidar(bigint[],boolean)') is not null)::text, 'true', to_regprocedure('public.tarifario_invalidar(bigint[],boolean)') is not null, null
  union all select 4, 'tarifario_resultado.desde_entrada presente (302)', (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'desde_entrada'))::text, 'true',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'desde_entrada'), null
  union all select 5, 'disparadores de la 315 ya presentes (0 = primera vez, 3 = reaplicación idempotente)',
         (select count(*) from pg_trigger where not tgisinternal and tgname in ('tarifario_trg_hotel_blackouts_ins','tarifario_trg_hotel_blackouts_upd','tarifario_trg_hotel_blackouts_del'))::text, '0 o 3',
         (select count(*) from pg_trigger where not tgisinternal and tgname in ('tarifario_trg_hotel_blackouts_ins','tarifario_trg_hotel_blackouts_upd','tarifario_trg_hotel_blackouts_del')) in (0, 3), null
  union all select 6, 'cierres generales vigentes hoy o a futuro (informativo: la 315 no oculta nada al aplicarse; actúa cuando se guarda, edita o borra un cierre)',
         (select count(*) from public.hotel_blackouts where fecha_fin >= (now() at time zone 'America/Bogota')::date)::text, 'cualquiera', true, null
  union all select 7, 'transacciones abiertas sin actividad > 1 min (retendrían el candado del CREATE TRIGGER)',
         (select count(*) from pg_stat_activity where state = 'idle in transaction' and now() - state_change > interval '1 minute')::text, '0',
         (select count(*) from pg_stat_activity where state = 'idle in transaction' and now() - state_change > interval '1 minute') = 0, 'REVISAR'
) q order by n;
