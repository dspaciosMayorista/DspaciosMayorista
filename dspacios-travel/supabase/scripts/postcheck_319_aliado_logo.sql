-- POSTCHECK 319 (#32) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 319.
with c as (
  select to_regclass('public.aliado_logos') as tabla,
    (select relrowsecurity from pg_class where oid = to_regclass('public.aliado_logos')) as rls,
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'aliado_logos')::int as politicas,
    (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'aliado_logos' and indexname = 'uq_aliado_logo_vigente')::int as idx_vigente,
    has_table_privilege('service_role', 'public.aliado_logos', 'select, insert, update') as service_ok,
    (has_table_privilege('anon', 'public.aliado_logos', 'select, insert, update, delete') or has_table_privilege('authenticated', 'public.aliado_logos', 'select, insert, update, delete')) as clientes_tocan,
    (select count(*) from pg_trigger where tgrelid = to_regclass('public.aliado_logos') and tgname = 'trg_auditoria' and not tgisinternal)::int as auditoria,
    (select count(*) from storage.buckets where id = 'aliado-logos' and public is false and file_size_limit = 1048576)::int as bucket_privado,
    (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') like '%aliado-logos%' or coalesce(with_check, '') like '%aliado-logos%'))::int as politicas_storage,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('registrar_logo_aliado', 'retirar_logo_aliado', 'p319_actor_puede'))::int as funciones,
    (has_function_privilege('anon', 'public.registrar_logo_aliado(uuid,bigint,text,text,integer,text)', 'execute')
      or has_function_privilege('authenticated', 'public.registrar_logo_aliado(uuid,bigint,text,text,integer,text)', 'execute')
      or has_function_privilege('authenticated', 'public.retirar_logo_aliado(uuid,bigint)', 'execute')
      or has_function_privilege('authenticated', 'public.p319_actor_puede(uuid,bigint)', 'execute')) as clientes_ejecutan,
    has_function_privilege('service_role', 'public.registrar_logo_aliado(uuid,bigint,text,text,integer,text)', 'execute') as service_ejecuta,
    (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'comision_plan' and indexname = 'idx_comision_plan_cotizacion')::int as idx_plan,
    (select count(*) from public.aliado_logos)::bigint as filas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La tabla existe' as control, coalesce(tabla::text, 'no existe') as observado, 'public.aliado_logos' as esperado, case when tabla is not null then 'OK' else 'REVISAR' end as estado from c
  union all select 2, 'RLS activa y sin políticas (solo service_role entra)', rls::text || ' / ' || politicas::text, 'true / 0', case when rls is true and politicas = 0 then 'OK' else 'REVISAR' end from c
  union all select 3, 'Índice único: a lo sumo un logo vigente por aliado', idx_vigente::text, '1', case when idx_vigente = 1 then 'OK' else 'REVISAR' end from c
  union all select 4, 'service_role opera la tabla; anon y authenticated NO', service_ok::text || ' / ' || clientes_tocan::text, 'true / false', case when service_ok and clientes_tocan is false then 'OK' else 'REVISAR' end from c
  union all select 5, 'Trigger de auditoría presente', auditoria::text, '1', case when auditoria = 1 then 'OK' else 'REVISAR' end from c
  union all select 6, 'Bucket aliado-logos privado, límite 1 MB, SIN políticas de storage', bucket_privado::text || ' / ' || politicas_storage::text, '1 / 0', case when bucket_privado = 1 and politicas_storage = 0 then 'OK' else 'REVISAR' end from c
  union all select 7, 'Funciones de la 319 existen y solo service_role las ejecuta', funciones::text || ' / ' || clientes_ejecutan::text || ' / ' || service_ejecuta::text, '3 / false / true', case when funciones = 3 and clientes_ejecutan is false and service_ejecuta then 'OK' else 'REVISAR' end from c
  union all select 8, 'Índice por cotización en comision_plan (resolución del aliado de una cotización)', idx_plan::text, '1', case when idx_plan = 1 then 'OK' else 'REVISAR' end from c
  union all select 9, 'Filas (esperado 0 recién creada)', filas::text, 'anotar', 'INFO' from c
) r order by orden;
