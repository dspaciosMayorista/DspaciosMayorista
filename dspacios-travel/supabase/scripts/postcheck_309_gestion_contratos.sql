-- POSTCHECK 309 (#106 gestión integral de contratos) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 309. Todo debe decir OK; los INFO se comparan con el preflight.
with pos as (
  select
    (to_regclass('public.contrato_seguimiento') is not null) as tabla,
    (select relrowsecurity from pg_class where oid = to_regclass('public.contrato_seguimiento')) as rls,
    (select string_agg(policyname || ':' || cmd, ',' order by policyname) from pg_policies where schemaname = 'public' and tablename = 'contrato_seguimiento') as policies,
    (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'contrato_seguimiento' and grantee = 'authenticated') as priv_auth,
    (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'contrato_seguimiento' and grantee in ('anon', 'PUBLIC'))::int as priv_anon,
    (select count(*) from pg_trigger where tgrelid = to_regclass('public.contrato_seguimiento') and not tgisinternal and tgname in ('trg_auditoria', 'trg_contrato_guarda', 'trg_contrato_seguimiento_inmutable'))::int as triggers,
    (select modo from public.contrato_guardas_config where tabla = 'contrato_seguimiento') as guarda,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('fn_gestion_contratos', 'registrar_seguimiento_contrato', 'seguimiento_referencia'))::int as funciones,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('fn_gestion_contratos', 'registrar_seguimiento_contrato')
       and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))::int as ejecutables,
    (select not has_function_privilege('authenticated', to_regprocedure('public.seguimiento_referencia(text,text)'), 'execute')) as ref_privada,
    (select count(*) from public.contrato_seguimiento)::bigint as acuses,
    (select count(*) from public.ventas)::bigint as ventas,
    (select count(*) from public.abonos)::bigint as abonos,
    (select count(*) from public.vouchers)::bigint as vouchers,
    (select count(*) from public.ventas where tenant = 'mayorista')::bigint as mayorista,
    (select count(*) from public.ventas where tenant = 'minorista')::bigint as minorista
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Tabla contrato_seguimiento creada' as control, tabla::text as observado, 'true' as esperado, case when tabla then 'OK' else 'REVISAR' end as estado from pos
  union all select 2, 'RLS activa y UNA sola policy (lectura superadmin)', rls::text || ' · ' || coalesce(policies, 'ninguna'), 'true · contrato_seguimiento: lectura superadmin:SELECT',
         case when rls and policies = 'contrato_seguimiento: lectura superadmin:SELECT' then 'OK' else 'REVISAR' end from pos
  union all select 3, 'authenticated solo puede LEER la tabla; anon/PUBLIC nada', coalesce(priv_auth, 'nada') || ' · anon/PUBLIC=' || priv_anon::text, 'SELECT · anon/PUBLIC=0', case when priv_auth = 'SELECT' and priv_anon = 0 then 'OK' else 'REVISAR' end from pos
  union all select 4, 'Triggers: auditoría, guarda de identidad e inmutabilidad', triggers::text, '3', case when triggers = 3 then 'OK' else 'REVISAR' end from pos
  union all select 5, 'Guarda de identidad clasificada como estricta (284)', coalesce(guarda, 'SIN CLASIFICAR'), 'estricto', case when guarda = 'estricto' then 'OK' else 'REVISAR' end from pos
  union all select 6, 'Las tres funciones existen', funciones::text, '3', case when funciones = 3 then 'OK' else 'REVISAR' end from pos
  union all select 7, 'RPC SECURITY DEFINER ejecutables por authenticated y NO por anon', ejecutables::text, '2', case when ejecutables = 2 then 'OK' else 'REVISAR' end from pos
  union all select 8, 'seguimiento_referencia NO es ejecutable por la API', ref_privada::text, 'true', case when ref_privada then 'OK' else 'REVISAR' end from pos
  union all select 9, 'Sin acuses al estrenar (nada se infiere ni se rellena)', acuses::text, '0', case when acuses = 0 then 'OK' else 'REVISAR' end from pos
  union all select 10, 'Contratos Mayorista / Minorista (igual que el preflight)', mayorista::text || ' / ' || minorista::text, 'igual que el preflight', 'INFO' from pos
  union all select 11, 'Total contratos, abonos y vouchers (igual que el preflight)', ventas::text || ' / ' || abonos::text || ' / ' || vouchers::text, 'igual que el preflight', 'INFO' from pos
) r order by orden;
