-- PREFLIGHT 319 (#32 logo del aliado) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 319.
with t as (
  select to_regclass('public.aliado_logos') as tabla,
         (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))::int as roles,
         (select count(*) from storage.buckets where id = 'aliado-logos')::int as bucket,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('registrar_logo_aliado', 'retirar_logo_aliado', 'p319_actor_puede'))::int as funciones,
         to_regclass('public.aliados') as aliados, to_regclass('public.comision_plan') as plan,
         to_regprocedure('public.fn_auditoria()') as fn_aud
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La tabla public.aliado_logos aún NO existe (existe si la 319 ya se corrió)' as control, coalesce(tabla::text, 'no existe') as observado, 'no existe antes de la 319' as esperado, case when tabla is null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'El bucket aliado-logos aún no existe (si ya existe, vacío, de una aplicación anterior: la 319 lo reutiliza)', bucket::text, '0', case when bucket = 0 then 'OK' else 'INFO' end from t
  union all select 3, 'Las funciones de la 319 aún no existen', funciones::text, '0', case when funciones = 0 then 'OK' else 'REVISAR' end from t
  union all select 4, 'Existe public.aliados (FK) y la función de auditoría fn_auditoria()', coalesce(aliados::text, 'no existe') || ' / ' || coalesce(fn_aud::text, 'no existe'), 'ambas existen', case when aliados is not null and fn_aud is not null then 'OK' else 'REVISAR' end from t
  union all select 5, 'Existe public.comision_plan (la 319 le añade un índice por cotización)', coalesce(plan::text, 'no existe'), 'existe', case when plan is not null then 'OK' else 'REVISAR' end from t
  union all select 6, 'Existen los roles anon, authenticated y service_role', roles::text, '3', case when roles = 3 then 'OK' else 'REVISAR' end from t
) r order by orden;
