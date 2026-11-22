-- PREFLIGHT 322 (#76/#77: libreta de clientes del aliado) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 322.
with t as (
  select to_regclass('public.aliado_clientes') as tabla,
         to_regclass('public.aliados') as aliados,
         to_regprocedure('public.fn_auditoria()') as auditoria,
         (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))::int as roles
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La tabla public.aliado_clientes aún NO existe (existe si la 322 ya se corrió)' as control, coalesce(tabla::text, 'no existe') as observado, 'no existe antes de la 322' as esperado, case when tabla is null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'Existe public.aliados (la libreta apunta a su id)', coalesce(aliados::text, 'no existe'), 'public.aliados', case when aliados is not null then 'OK' else 'REVISAR' end from t
  union all select 3, 'Existen los roles anon, authenticated y service_role', roles::text, '3', case when roles = 3 then 'OK' else 'REVISAR' end from t
  union all select 4, 'Existe fn_auditoria() (sin ella la tabla se crea pero sin auditoría)', coalesce(auditoria::text, 'no existe'), 'public.fn_auditoria()', case when auditoria is not null then 'OK' else 'REVISAR' end from t
) r order by orden;
