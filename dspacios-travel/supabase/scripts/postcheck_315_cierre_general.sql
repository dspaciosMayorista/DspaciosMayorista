-- Postcheck 315 (solo lectura, UNA consulta; columna estado por control). Esperado: todo OK.
-- La 315 NO oculta nada al aplicarse: solo actúa cuando se guarda, edita o borra un cierre general. Tras guardar uno, las filas que ocultó se cuentan con:
--   select count(*) from public.tarifario_fila_oculta where motivo = 'cierre general del hotel';
with f as (
  select p.oid, p.prosecdef, p.proconfig
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('tarifario_estadia_cerrada_general','tarifario_fila_cerrada_general','tarifario_cierre_general_aplicar','tarifario_trg_cierre_ins','tarifario_trg_cierre_upd','tarifario_trg_cierre_del')
)
select n, control, actual, esperado, case when estado_sql then 'OK' else 'FALLA' end as estado
from (
  select 1 as n, '3 disparadores sobre hotel_blackouts (ins/upd/del, por sentencia)' as control,
         (select count(*) from pg_trigger where not tgisinternal and tgrelid = 'public.hotel_blackouts'::regclass and tgname in ('tarifario_trg_hotel_blackouts_ins','tarifario_trg_hotel_blackouts_upd','tarifario_trg_hotel_blackouts_del'))::text as actual,
         '3' as esperado,
         (select count(*) from pg_trigger where not tgisinternal and tgrelid = 'public.hotel_blackouts'::regclass and tgname in ('tarifario_trg_hotel_blackouts_ins','tarifario_trg_hotel_blackouts_upd','tarifario_trg_hotel_blackouts_del')) = 3 as estado_sql
  union all select 2, '6 funciones presentes', (select count(*) from f)::text, '6', (select count(*) from f) = 6
  union all select 3, 'ninguna función de la 315 ejecutable por anon/authenticated (todas son internas)',
         (select count(*) from f where has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute'))::text, '0',
         (select count(*) from f where has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute')) = 0
  union all select 4, 'las 6 funciones son SECURITY DEFINER con search_path fijo',
         (select count(*) from f where prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%'))::text, '6',
         (select count(*) from f where prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%')) = 6
) q order by n;
