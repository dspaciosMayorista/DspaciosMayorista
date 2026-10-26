-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK de la migración 243 (fn_dashboard_cupos_activos, #118).
-- SOLO LECTURA. Correr DESPUÉS de aplicar la 243. Una sola consulta con todos
-- los controles como filas (control · valor · esperado · estado OK/REVISAR/INFO).
-- Compatible con el SQL Editor de Supabase. Si la 243 NO está aplicada falla con
-- «function ... does not exist» (señal suficiente: correrlo solo después de aplicarla).
-- ───────────────────────────────────────────────────────────────────────────
with
f as (
  select p.oid, p.prosecdef, p.provolatile, p.proconfig, p.proacl,
         pg_get_function_result(p.oid) as resultado,
         pg_get_function_identity_arguments(p.oid) as argumentos
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'fn_dashboard_cupos_activos'
),
hoy as (select (now() at time zone 'America/Bogota')::date as d),
-- Solo se evalúa si la función existe (to_regprocedure): si falta, el control 1 ya lo marca.
r as (
  select * from public.fn_dashboard_cupos_activos((select d from hoy))
   where to_regprocedure('public.fn_dashboard_cupos_activos(date)') is not null
),
publico as (
  select coalesce(bool_or(a.grantee = 0), false) as ejecuta
    from f, aclexplode(coalesce(f.proacl, acldefault('f', (select proowner from pg_proc where oid = f.oid)))) a
   where a.privilege_type = 'EXECUTE'
),
si as (
  select coalesce((select o.option_value from pg_class c, pg_options_to_table(c.reloptions) o
                    where c.relname = 'cupos_por_bloqueo' and c.relnamespace = 'public'::regnamespace
                      and o.option_name = 'security_invoker'), 'no definido') as v
),
vista_activa as (
  select coalesce(sum(greatest(cupos_disponibles, 0)), 0) as sillas
    from public.cupos_por_bloqueo
   where fecha_ida is null or fecha_ida >= (select d from hoy)
),
controles as (
  select 1 as orden, 'existe exactamente una fn_dashboard_cupos_activos'::text as control,
         (select count(*)::text from f) as valor, '1'::text as esperado,
         case when (select count(*) from f) = 1 then 'OK' else 'REVISAR' end as estado
  union all
  select 2, 'firma: argumentos', coalesce((select argumentos from f), 'n/d'), 'p_hoy date',
         case when (select argumentos from f) = 'p_hoy date' then 'OK' else 'REVISAR' end
  union all
  select 3, 'devuelve las 6 columnas esperadas', coalesce((select resultado from f), 'n/d'),
         'TABLE(capacidad bigint, ocupados bigint, disponibles bigint, records_disponibles bigint, proximos_disponibles bigint, proximos_records bigint)',
         case when (select resultado from f) =
              'TABLE(capacidad bigint, ocupados bigint, disponibles bigint, records_disponibles bigint, proximos_disponibles bigint, proximos_records bigint)'
              then 'OK' else 'REVISAR' end
  union all
  select 4, 'SECURITY INVOKER (no DEFINER: la RLS del llamador aplica)',
         coalesce((select case when prosecdef then 'DEFINER' else 'INVOKER' end from f), 'n/d'), 'INVOKER',
         case when (select prosecdef from f) is false then 'OK' else 'REVISAR' end
  union all
  select 5, 'STABLE', coalesce((select provolatile::text from f), 'n/d'), 's',
         case when (select provolatile from f) = 's' then 'OK' else 'REVISAR' end
  union all
  select 6, 'search_path fijado a public', coalesce((select array_to_string(proconfig, ',') from f), 'sin config'),
         'search_path=public',
         case when coalesce((select 'search_path=public' = any (proconfig) from f), false) then 'OK' else 'REVISAR' end
  union all
  select 7, 'EXECUTE: anon NO, public NO',
         'anon=' || has_function_privilege('anon', 'public.fn_dashboard_cupos_activos(date)', 'execute')::text
           || ', public=' || (select ejecuta::text from publico),
         'anon=false, public=false',
         case when not has_function_privilege('anon', 'public.fn_dashboard_cupos_activos(date)', 'execute')
               and not (select ejecuta from publico) then 'OK' else 'REVISAR' end
  union all
  select 8, 'EXECUTE: authenticated SI, service_role SI',
         'authenticated=' || has_function_privilege('authenticated', 'public.fn_dashboard_cupos_activos(date)', 'execute')::text
           || ', service_role=' || has_function_privilege('service_role', 'public.fn_dashboard_cupos_activos(date)', 'execute')::text,
         'authenticated=true, service_role=true',
         case when has_function_privilege('authenticated', 'public.fn_dashboard_cupos_activos(date)', 'execute')
               and has_function_privilege('service_role', 'public.fn_dashboard_cupos_activos(date)', 'execute')
              then 'OK' else 'REVISAR' end
  union all
  select 9, 'la vista conserva security_invoker = true', (select v from si), 'true',
         case when (select v from si) = 'true' then 'OK' else 'REVISAR' end
  union all
  select 10, 'la 186 sigue intacta: fn_dashboard_cupos_resumen() presente',
         coalesce(to_regprocedure('public.fn_dashboard_cupos_resumen()')::text, 'no existe'), 'existe',
         case when to_regprocedure('public.fn_dashboard_cupos_resumen()') is not null then 'OK' else 'REVISAR' end
  union all
  select 11, 'ejecución real: devuelve exactamente 1 fila', (select count(*)::text from r), '1',
         case when (select count(*) from r) = 1 then 'OK' else 'REVISAR' end
  union all
  select 12, 'coherencia: próximos <= totales y records <= sillas',
         coalesce((select format('próximos %s/%s sillas · records %s/%s próximos/con sillas, %s sillas', proximos_disponibles, disponibles, proximos_records, records_disponibles, disponibles) from r), 'n/d'),
         'proximos_disponibles <= disponibles; proximos_records <= records_disponibles <= disponibles',
         case when (select proximos_disponibles <= disponibles and proximos_records <= records_disponibles
                           and records_disponibles <= disponibles from r) then 'OK' else 'REVISAR' end
  union all
  select 13, 'paridad con la vista (suma a mano de los records activos, mismo día de Bogotá)',
         coalesce((select format('función %s sillas / vista %s sillas', r.disponibles, v.sillas) from r, vista_activa v), 'n/d'),
         'iguales',
         case when (select r.disponibles = v.sillas from r, vista_activa v) then 'OK' else 'REVISAR' end
  union all
  select 14, 'INFO resultado de hoy (día de Bogotá ' || (select d::text from hoy) || ')',
         coalesce((select format('%s sillas en %s records · próximos 14 días: %s sillas en %s records', disponibles, records_disponibles, proximos_disponibles, proximos_records) from r), 'n/d'),
         'dato', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
