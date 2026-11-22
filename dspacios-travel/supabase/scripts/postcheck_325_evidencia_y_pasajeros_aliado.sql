-- POSTCHECK 325 — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 325.
with f as (
  select p.oid as fid, p.proname, p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('f325_cotizacion_propia', 'evidencia_cotizacion_registrar', 'evidencia_cotizacion_verificar', 'evidencia_cotizacion_retirar', 'cotizacion_pasajeros_aliado_guardar')
), c as (
  select (select relrowsecurity from pg_class where oid = to_regclass('public.cotizacion_evidencias')) as rls_e,
         (select relrowsecurity from pg_class where oid = to_regclass('public.cotizacion_pasajeros_aliado')) as rls_p,
         (select count(*) from pg_policies where schemaname = 'public' and tablename in ('cotizacion_evidencias', 'cotizacion_pasajeros_aliado'))::int as politicas,
         (select count(*) from f)::int as funciones,
         (select count(*) from f where prosecdef and exists (select 1 from unnest(proconfig) x where x like 'search_path=%'))::int as definer_ok,
         (select count(*) from f where proname <> 'f325_cotizacion_propia' and has_function_privilege('service_role', fid, 'execute'))::int as service_exec,
         (select count(*) from f where has_function_privilege('anon', fid, 'execute') or has_function_privilege('authenticated', fid, 'execute'))::int as clientes_ejecutan,
         (has_table_privilege('anon', 'public.cotizacion_evidencias', 'select, insert, update, delete') or has_table_privilege('authenticated', 'public.cotizacion_evidencias', 'insert, update, delete')
          or has_table_privilege('anon', 'public.cotizacion_pasajeros_aliado', 'select, insert, update, delete') or has_table_privilege('authenticated', 'public.cotizacion_pasajeros_aliado', 'insert, update, delete')) as clientes_escriben,
         (select count(*) from storage.buckets where id = 'evidencias-cotizacion' and public is false)::int as bucket_privado,
         (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') like '%evidencias-cotizacion%' or coalesce(with_check, '') like '%evidencias-cotizacion%'))::int as pol_storage,
         (select count(*) from public.cotizacion_evidencias)::int as n_evid, (select count(*) from public.cotizacion_pasajeros_aliado)::int as n_pas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Las dos tablas existen con RLS activa' as control, coalesce(rls_e::text, 'no existe') || ' / ' || coalesce(rls_p::text, 'no existe') as observado, 'true / true' as esperado, case when rls_e is true and rls_p is true then 'OK' else 'REVISAR' end as estado from c
  union all select 2, 'Dos políticas de lectura interna (una por tabla), ninguna de escritura', politicas::text, '2', case when politicas = 2 then 'OK' else 'REVISAR' end from c
  union all select 3, 'Las 5 funciones existen, SECURITY DEFINER con search_path fijo', funciones::text || ' / ' || definer_ok::text, '5 / 5', case when funciones = 5 and definer_ok = 5 then 'OK' else 'REVISAR' end from c
  union all select 4, 'service_role ejecuta las 4 funciones públicas', service_exec::text, '4', case when service_exec = 4 then 'OK' else 'REVISAR' end from c
  union all select 5, 'anon y authenticated NO ejecutan ninguna función', clientes_ejecutan::text, '0', case when clientes_ejecutan = 0 then 'OK' else 'REVISAR' end from c
  union all select 6, 'anon y authenticated NO escriben (ni anon lee) las tablas', clientes_escriben::text, 'false', case when clientes_escriben is false then 'OK' else 'REVISAR' end from c
  union all select 7, 'Bucket evidencias-cotizacion privado y SIN ninguna policy en storage.objects', bucket_privado::text || ' / ' || pol_storage::text, '1 / 0', case when bucket_privado = 1 and pol_storage = 0 then 'OK' else 'REVISAR' end from c
  union all select 8, 'Filas recién creadas (evidencias / pasajeros)', n_evid::text || ' / ' || n_pas::text, '0 / 0', case when n_evid = 0 and n_pas = 0 then 'OK' else 'INFO' end from c
) r order by orden;
