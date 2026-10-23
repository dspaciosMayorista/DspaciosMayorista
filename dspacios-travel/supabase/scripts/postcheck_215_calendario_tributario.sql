-- ============================================================================
-- Postcheck 215 — Calendario tributario (#43-1a). SOLO LECTURA.
-- Ejecutar DESPUES de aplicar la migracion. Esperado: todas las filas en OK.
-- Uso: psql $DATABASE_URL -v ON_ERROR_STOP=1 -f postcheck_215_calendario_tributario.sql
-- ============================================================================

\echo '--- 1. Tablas con RLS activa y forzada ---'
select t as tabla,
       case when c.oid is null then 'FALLA  no existe'
            when not c.relrowsecurity then 'FALLA  RLS desactivada'
            when not c.relforcerowsecurity then 'FALLA  RLS no forzada'
            else 'OK' end as estado
from unnest(array['obligacion_tributaria', 'obligacion_vencimiento', 'obligacion_cumplimiento']) t
left join pg_class c on c.oid = to_regclass('public.' || t);

\echo ''
\echo '--- 2. Privilegios: anon sin nada; authenticated sin TRUNCATE ---'
select t as tabla,
       case when has_table_privilege('anon', 'public.' || t, 'select')
              or has_table_privilege('anon', 'public.' || t, 'insert')
              or has_table_privilege('anon', 'public.' || t, 'update')
              or has_table_privilege('anon', 'public.' || t, 'delete')
            then 'FALLA  anon tiene privilegios' else 'OK    anon sin privilegios' end as anon,
       case when has_table_privilege('authenticated', 'public.' || t, 'truncate')
            then 'FALLA  authenticated puede TRUNCATE' else 'OK    sin TRUNCATE' end as truncate
from unnest(array['obligacion_tributaria', 'obligacion_vencimiento', 'obligacion_cumplimiento']) t;

\echo ''
\echo '--- 3. Policies: ver + configurar/registrar en cada tabla, ninguna para anon ---'
select tablename as tabla, count(*) as policies,
       case when count(*) = 2 and bool_and(roles = '{authenticated}') then 'OK'
            else 'FALLA  se esperaban 2 policies solo para authenticated' end as estado
from pg_policies
where schemaname = 'public'
  and tablename in ('obligacion_tributaria', 'obligacion_vencimiento', 'obligacion_cumplimiento')
group by tablename order by tablename;

\echo ''
\echo '--- 4. Helpers: security definer con search_path fijo; anon sin ejecutar ---'
select p.proname as funcion,
       case when not p.prosecdef then 'FALLA  no es security definer'
            when not (p.proconfig @> array['search_path=public, pg_temp']) then 'FALLA  search_path no fijado'
            when has_function_privilege('anon', p.oid, 'execute') then 'FALLA  anon puede ejecutarlo'
            else 'OK' end as estado
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('calendario_puede_ver', 'calendario_puede_configurar', 'calendario_puede_registrar')
order by p.proname;

\echo ''
\echo '--- 5. Ver: solo area contable y administracion (ningun otro rol) ---'
select case when pg_get_functiondef('public.calendario_puede_ver(text)'::regprocedure)
                 ~* '''(venta|operaciones|control_vuelo|agencia|freelance|cliente_final)'''
            then 'FALLA  incluye un rol fuera del area contable'
            else 'OK' end as calendario_puede_ver;

\echo ''
\echo '--- 6. Triggers de validacion y auditoria ---'
select x.tabla, x.trigger,
       case when exists (select 1 from pg_trigger tg
                          where tg.tgrelid = to_regclass('public.' || x.tabla)
                            and tg.tgname = x.trigger and not tg.tgisinternal)
            then 'OK' else 'FALLA  falta' end as estado
from (values
  ('obligacion_tributaria', 'obligacion_tributaria_proteger'),
  ('obligacion_vencimiento', 'obligacion_vencimiento_validar'),
  ('obligacion_cumplimiento', 'obligacion_cumplimiento_validar'),
  ('obligacion_tributaria', 'trg_auditoria'),
  ('obligacion_vencimiento', 'trg_auditoria'),
  ('obligacion_cumplimiento', 'trg_auditoria')) x(tabla, trigger);

\echo ''
\echo '--- 7. FK compuestas (obligacion_id, tenant): una fecha no cambia de agencia ---'
select x.conname,
       case when exists (select 1 from pg_constraint c where c.conname = x.conname and c.contype = 'f'
                           and array_length(c.conkey, 1) = 2)
            then 'OK' else 'FALLA  falta o no es compuesta' end as estado
from (values ('fk_vencimiento_obligacion'), ('fk_cumplimiento_obligacion')) x(conname);

\echo ''
\echo '=== FIN POSTCHECK 215 ==='
