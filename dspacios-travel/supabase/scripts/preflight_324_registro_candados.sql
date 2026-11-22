-- PREFLIGHT 324 (#62 B5/B6: coordinación del registro B2B) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 324.
with t as (
  select to_regclass('public.registro_b2b_estado') as tabla,
         to_regclass('public.usuarios') as usuarios,
         to_regclass('public.b2b_solicitudes') as solicitudes,
         to_regclass('public.aliados') as aliados,
         (select count(*) from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name in ('email_confirmed_at', 'raw_app_meta_data', 'email'))::int as cols_auth,
         (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))::int as roles,
         has_table_privilege(current_user, 'auth.users', 'delete') as borra_auth
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La tabla public.registro_b2b_estado aún NO existe (existe si la 324 ya se corrió)' as control, coalesce(tabla::text, 'no existe') as observado, 'no existe antes de la 324' as esperado, case when tabla is null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'Existen public.usuarios, public.b2b_solicitudes y public.aliados', concat_ws(' / ', usuarios::text, solicitudes::text, aliados::text), 'las tres', case when usuarios is not null and solicitudes is not null and aliados is not null then 'OK' else 'REVISAR' end from t
  union all select 3, 'auth.users expone email, email_confirmed_at y raw_app_meta_data (las funciones leen la verificación de Auth)', cols_auth::text, '3', case when cols_auth = 3 then 'OK' else 'REVISAR' end from t
  union all select 4, 'Existen los roles anon, authenticated y service_role', roles::text, '3', case when roles = 3 then 'OK' else 'REVISAR' end from t
  union all select 5, 'El rol que corre la migración (dueño de las funciones) puede BORRAR de auth.users: el descarte atómico lo necesita', borra_auth::text, 'true', case when borra_auth then 'OK' else 'REVISAR' end from t
) r order by orden;
