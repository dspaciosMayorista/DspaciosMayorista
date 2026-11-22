-- PREFLIGHT 314 (#35: aliado obligatorio en comparativas manuales B2B nuevas) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 314.
-- Los INFO se anotan: el postcheck debe dar las MISMAS cifras (la 314 no cambia ninguna fila). El control 6 cuenta comparativas históricas B2B sin aliado: se conservan tal cual, no se corrigen por inferencia.
with pre as (
  select
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'crear_cotizacion_comparativa')::int as funciones,
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'crear_cotizacion_comparativa' limit 1) as oid_fn,
    (to_regclass('public.cotizaciones') is not null) as tabla
), det as (
  select pre.*,
    case when oid_fn is null then null else position('una comparativa B2B necesita un aliado del catálogo' in pg_get_functiondef(oid_fn)) > 0 end as ya_tiene_guarda,
    case when oid_fn is null then null else has_function_privilege('service_role', oid_fn, 'execute') end as service_role_ejecuta,
    case when oid_fn is null then null else (has_function_privilege('anon', oid_fn, 'execute') or has_function_privilege('authenticated', oid_fn, 'execute')) end as expuesta_a_clientes
  from pre
), hist as (
  select
    (select count(*) from public.cotizaciones where tipo = 'comparativa_manual')::bigint as manuales,
    (select count(*) from public.cotizaciones where tipo = 'comparativa_manual' and aliado_id is not null)::bigint as con_aliado,
    (select count(*) from public.cotizaciones where tipo = 'comparativa_manual' and aliado_id is null
        and coalesce(payload->>'tipoAsesor', 'interno') in ('agencia', 'freelance'))::bigint as b2b_sin_aliado
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Existe exactamente UNA función public.crear_cotizacion_comparativa' as control, funciones::text as observado, '1' as esperado, case when funciones = 1 then 'OK' else 'REVISAR' end as estado from det
  union all select 2, 'Tabla cotizaciones presente', tabla::text, 'true', case when tabla then 'OK' else 'REVISAR' end from det
  union all select 3, 'La función aún NO trae la guarda de la 314 (false antes; true si ya se corrió)', coalesce(ya_tiene_guarda::text, 'sin función'), 'false antes de la 314', case when ya_tiene_guarda is not null then 'OK' else 'REVISAR' end from det
  union all select 4, 'Solo service_role ejecuta la función (grants de la 211)', coalesce(service_role_ejecuta::text, 'sin función'), 'true', case when service_role_ejecuta is true then 'OK' else 'REVISAR' end from det
  union all select 5, 'anon/authenticated NO pueden ejecutarla', coalesce(expuesta_a_clientes::text, 'sin función'), 'false', case when expuesta_a_clientes is false then 'OK' else 'REVISAR' end from det
  union all select 6, 'Comparativas manuales: total / con aliado / B2B sin aliado (histórico; anotar, igual en el postcheck)', manuales::text || ' / ' || con_aliado::text || ' / ' || b2b_sin_aliado::text, 'anotar', 'INFO' from hist
) r order by orden;
