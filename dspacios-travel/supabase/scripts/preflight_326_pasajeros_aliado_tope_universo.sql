-- PREFLIGHT 326 (tope de pasajeros adicionales del aliado según el universo declarado) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 326.
with f as (
  select p.oid as fid, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as dueno, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cotizacion_pasajeros_aliado_guardar'
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Existe la función de la 325 (cotizacion_pasajeros_aliado_guardar)' as control, count(*)::text as observado, '1' as esperado, case when count(*) = 1 then 'OK' else 'REVISAR' end as estado from f
  union all select 2, 'Aún tiene el tope de la 325 (máximo de los pax); la 326 lo reemplaza', coalesce((select (prosrc not like '%v_unidades%')::text from f), 'sin función'), 'true', case when coalesce((select prosrc not like '%v_unidades%' from f), false) then 'OK' else 'REVISAR' end
  union all select 3, 'SECURITY DEFINER con search_path fijo', coalesce((select (prosecdef and exists (select 1 from unnest(proconfig) x where x like 'search_path=%'))::text from f), 'sin función'), 'true', case when coalesce((select prosecdef and exists (select 1 from unnest(proconfig) x where x like 'search_path=%') from f), false) then 'OK' else 'REVISAR' end
  union all select 4, 'service_role ejecuta; anon y authenticated NO', coalesce((select (has_function_privilege('service_role', fid, 'execute') and not has_function_privilege('anon', fid, 'execute') and not has_function_privilege('authenticated', fid, 'execute'))::text from f), 'sin función'), 'true', case when coalesce((select has_function_privilege('service_role', fid, 'execute') and not has_function_privilege('anon', fid, 'execute') and not has_function_privilege('authenticated', fid, 'execute') from f), false) then 'OK' else 'REVISAR' end
  union all select 5, 'Dueño de la función (se conserva)', coalesce((select dueno from f), 'sin función'), 'anotar', 'INFO'
  union all select 6, 'Listas de pasajeros guardadas por aliados (no se tocan)', (select count(*) from public.cotizacion_pasajeros_aliado)::text, 'anotar', 'INFO'
) r order by orden;
