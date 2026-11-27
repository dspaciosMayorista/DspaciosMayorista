-- Schema signature for the #103 lifecycle check (read-only, ONE row per object class + a global md5). Compares before/after a migration/rollback on a DISPOSABLE database.
-- Covers: tables+columns, constraints, indexes, triggers, policies, grants, function signatures + body hash, the identity-guard configuration (contrato_guardas_config) and the installed guard triggers.
with objetos as (
  select 'columna' as clase, c.table_name || '.' || c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || coalesce(c.column_default, '') as k from information_schema.columns c where c.table_schema = 'public'
  union all select 'restriccion', conrelid::regclass::text || ':' || conname || ':' || contype::text || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
  union all select 'indice', tablename || ':' || indexname || ':' || indexdef from pg_indexes where schemaname = 'public'
  union all select 'disparador', tgrelid::regclass::text || ':' || tgname || ':' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  union all select 'politica', tablename || ':' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') from pg_policies where schemaname = 'public'
  union all select 'permiso', table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants where table_schema = 'public'
  union all select 'funcion', p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all select 'guarda_config', g.tabla || ':' || g.modo from public.contrato_guardas_config g
)
select clase, count(*) as objetos, md5(coalesce(string_agg(k, E'\n' order by k), '')) as huella from objetos group by clase
union all select 'GLOBAL', count(*), md5(coalesce(string_agg(clase || k, E'\n' order by clase, k), '')) from objetos
order by 1;
