-- POSTCHECK 318 (#98) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 318. Sin filas en FALLO/REVISAR = correcta.
with t as (
  select
    (select relrowsecurity from pg_class where oid = 'public.aliado_firmas'::regclass) as rls_f,
    (select relrowsecurity from pg_class where oid = 'public.cuenta_cobro_aceptaciones'::regclass) as rls_a,
    (select count(*) from pg_policies where schemaname = 'public' and tablename in ('aliado_firmas', 'cuenta_cobro_aceptaciones'))::int as politicas,
    (select count(*) from pg_constraint where conrelid = 'public.cuenta_cobro_aceptaciones'::regclass and conname in ('cuenta_cobro_aceptaciones_version_uk', 'cuenta_cobro_aceptaciones_hash_uk'))::int as unicas,
    (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'aliado_firmas_una_vigente')::int as indice_vigente,
    (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_aliado_firmas_inmutable', 'trg_cuenta_cobro_aceptaciones_inmutable'))::int as inmutables,
    (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_auditoria' and tgrelid in ('public.aliado_firmas'::regclass, 'public.cuenta_cobro_aceptaciones'::regclass))::int as auditoria,
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('aceptar_cuenta_cobro', 'registrar_firma_aliado') and p.prosecdef)::int as definer,
    has_function_privilege('service_role', 'public.aceptar_cuenta_cobro(text,bigint,jsonb,text,uuid)', 'execute') as sr_aceptar,
    has_function_privilege('service_role', 'public.registrar_firma_aliado(bigint,text,text,text,integer,uuid)', 'execute') as sr_firma,
    (has_function_privilege('anon', 'public.aceptar_cuenta_cobro(text,bigint,jsonb,text,uuid)', 'execute') or has_function_privilege('authenticated', 'public.aceptar_cuenta_cobro(text,bigint,jsonb,text,uuid)', 'execute')
      or has_function_privilege('anon', 'public.registrar_firma_aliado(bigint,text,text,text,integer,uuid)', 'execute') or has_function_privilege('authenticated', 'public.registrar_firma_aliado(bigint,text,text,text,integer,uuid)', 'execute')) as cliente_ejecuta,
    (has_table_privilege('anon', 'public.aliado_firmas', 'select') or has_table_privilege('authenticated', 'public.aliado_firmas', 'select')
      or has_table_privilege('anon', 'public.cuenta_cobro_aceptaciones', 'select') or has_table_privilege('authenticated', 'public.cuenta_cobro_aceptaciones', 'select')) as cliente_lee,
    (select count(*) from storage.buckets where id = 'aliado-firmas' and public = false and file_size_limit = 524288)::int as bucket_privado,
    (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') like '%aliado-firmas%' or coalesce(with_check, '') like '%aliado-firmas%'))::int as pol_storage,
    (select count(*) from public.aliado_firmas)::int as n_firmas, (select count(*) from public.cuenta_cobro_aceptaciones)::int as n_aceptaciones
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'RLS activa en las dos tablas' as control, concat_ws(' / ', rls_f::text, rls_a::text) as observado, 'true / true' as esperado, case when rls_f and rls_a then 'OK' else 'FALLO' end as estado from t
  union all select 2, 'Sin políticas RLS (solo service_role)', politicas::text, '0', case when politicas = 0 then 'OK' else 'FALLO' end from t
  union all select 3, 'Únicas (clave,version) y (clave,hash) + una sola firma vigente por aliado', concat_ws(' / ', unicas::text, indice_vigente::text), '2 / 1', case when unicas = 2 and indice_vigente = 1 then 'OK' else 'FALLO' end from t
  union all select 4, 'Triggers de inmutabilidad y de auditoría', concat_ws(' / ', inmutables::text, auditoria::text), '2 / 2', case when inmutables = 2 and auditoria = 2 then 'OK' else 'FALLO' end from t
  union all select 5, 'Las dos RPC son SECURITY DEFINER', definer::text, '2', case when definer = 2 then 'OK' else 'FALLO' end from t
  union all select 6, 'service_role ejecuta las RPC; anon/authenticated NO', concat_ws(' / ', sr_aceptar::text, sr_firma::text, cliente_ejecuta::text), 'true / true / false', case when sr_aceptar and sr_firma and not cliente_ejecuta then 'OK' else 'FALLO' end from t
  union all select 7, 'anon/authenticated NO leen las tablas', cliente_lee::text, 'false', case when not cliente_lee then 'OK' else 'FALLO' end from t
  union all select 8, 'Bucket aliado-firmas privado, 512 KB, sin políticas de storage propias', concat_ws(' / ', bucket_privado::text, pol_storage::text), '1 / 0', case when bucket_privado = 1 and pol_storage = 0 then 'OK' else 'FALLO' end from t
  union all select 9, 'INFO: filas existentes (firmas / aceptaciones)', concat_ws(' / ', n_firmas::text, n_aceptaciones::text), '0 / 0 recién aplicada', 'INFO' from t
) r order by orden;
