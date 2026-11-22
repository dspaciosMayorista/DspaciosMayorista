-- PREFLIGHT 316 (#62 B4: recuperaciones consumidas en tabla del servidor) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 316.
with t as (
  select to_regclass('public.recuperaciones_consumidas') as tabla,
         (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))::int as roles
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La tabla public.recuperaciones_consumidas aún NO existe (existe si la 316 ya se corrió)' as control, coalesce(tabla::text, 'no existe') as observado, 'no existe antes de la 316' as esperado, case when tabla is null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'Existen los roles anon, authenticated y service_role', roles::text, '3', case when roles = 3 then 'OK' else 'REVISAR' end from t
) r order by orden;
