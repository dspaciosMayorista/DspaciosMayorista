-- POSTCHECK 324 — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 324.
with t as (
  select to_regclass('public.registro_b2b_estado') as tabla
), f as (
  select p.oid as fid, p.proowner, p.proname, p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('p324_correo_confirmado', 'p324_borrar_sin_verificar', 'registro_b2b_iniciar', 'registro_b2b_reclamar_intento', 'registro_b2b_resolver_intento', 'registro_b2b_descartar', 'registro_b2b_permitir_reenvio', 'registro_b2b_completar')
), c as (
  select
    (select relrowsecurity from pg_class where oid = to_regclass('public.registro_b2b_estado')) as rls,
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'registro_b2b_estado')::int as politicas,
    (select count(*) from f)::int as funciones,
    (select count(*) from f where prosecdef and exists (select 1 from unnest(proconfig) x where x like 'search_path=%pg_temp%'))::int as definer_ok,
    (select count(*) from f where has_function_privilege('service_role', fid, 'execute'))::int as service_exec,
    (select count(*) from f where has_function_privilege('anon', fid, 'execute') or has_function_privilege('authenticated', fid, 'execute'))::int as clientes_ejecutan,
    has_table_privilege('service_role', 'public.registro_b2b_estado', 'select, insert, update, delete') as service_tabla,
    (has_table_privilege('anon', 'public.registro_b2b_estado', 'select, insert, update, delete') or has_table_privilege('authenticated', 'public.registro_b2b_estado', 'select, insert, update, delete')) as clientes_tabla,
    (select count(*) from public.registro_b2b_estado)::bigint as filas,
    (select bool_and(has_table_privilege(proowner::regrole::text, 'auth.users', 'delete')) from f) as duenos_borran
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La tabla existe' as control, coalesce(t.tabla::text, 'no existe') as observado, 'public.registro_b2b_estado' as esperado, case when t.tabla is not null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'RLS activa y sin políticas (solo service_role entra)', c.rls::text || ' / ' || c.politicas::text, 'true / 0', case when c.rls is true and c.politicas = 0 then 'OK' else 'REVISAR' end from c
  union all select 3, 'Las 8 funciones existen y son SECURITY DEFINER con search_path fijo (pg_temp al final)', c.funciones::text || ' / ' || c.definer_ok::text, '8 / 8', case when c.funciones = 8 and c.definer_ok = 8 then 'OK' else 'REVISAR' end from c
  union all select 4, 'service_role ejecuta las 8 funciones y opera la tabla', c.service_exec::text || ' / ' || c.service_tabla::text, '8 / true', case when c.service_exec = 8 and c.service_tabla then 'OK' else 'REVISAR' end from c
  union all select 5, 'anon y authenticated NO ejecutan ninguna función', c.clientes_ejecutan::text, '0', case when c.clientes_ejecutan = 0 then 'OK' else 'REVISAR' end from c
  union all select 6, 'anon y authenticated NO tienen ningún permiso sobre la tabla', c.clientes_tabla::text, 'false', case when c.clientes_tabla is false then 'OK' else 'REVISAR' end from c
  union all select 7, 'El dueño de las funciones puede borrar de auth.users (descarte atómico)', coalesce(c.duenos_borran::text, 'null'), 'true', case when c.duenos_borran is true then 'OK' else 'REVISAR' end from c
  union all select 8, 'Filas de estado (esperado 0 recién creada; cuentas anteriores se crean al usarse)', c.filas::text, 'anotar', 'INFO' from c
) r order by orden;
