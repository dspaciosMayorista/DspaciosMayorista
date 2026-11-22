-- POSTCHECK 314 (#35: aliado obligatorio en comparativas manuales B2B nuevas) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 314.
-- Todo debe decir OK; el INFO del control 6 debe ser IGUAL al del preflight (la 314 no cambia filas).
with pos as (
  select p.oid as oid_fn, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'crear_cotizacion_comparativa'
), det as (
  select
    (select count(*) from pos)::int as funciones,
    (select position('una comparativa B2B necesita un aliado del catálogo' in def) > 0 from pos limit 1) as tiene_guarda,
    (select position('se permite, queda sin propietario B2B' in def) > 0 from pos limit 1) as conserva_rama_vieja,
    (select position('security definer' in lower(def)) > 0 and position('search_path' in lower(def)) > 0 from pos limit 1) as definer_y_search_path,
    (select has_function_privilege('service_role', oid_fn, 'execute') from pos limit 1) as service_role_ejecuta,
    (select has_function_privilege('anon', oid_fn, 'execute') or has_function_privilege('authenticated', oid_fn, 'execute') from pos limit 1) as expuesta_a_clientes
), hist as (
  select
    (select count(*) from public.cotizaciones where tipo = 'comparativa_manual')::bigint as manuales,
    (select count(*) from public.cotizaciones where tipo = 'comparativa_manual' and aliado_id is not null)::bigint as con_aliado,
    (select count(*) from public.cotizaciones where tipo = 'comparativa_manual' and aliado_id is null
        and coalesce(payload->>'tipoAsesor', 'interno') in ('agencia', 'freelance'))::bigint as b2b_sin_aliado
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Existe exactamente UNA función crear_cotizacion_comparativa' as control, funciones::text as observado, '1' as esperado, case when funciones = 1 then 'OK' else 'REVISAR' end as estado from det
  union all select 2, 'La función trae la guarda de la 314', coalesce(tiene_guarda::text, 'sin función'), 'true', case when tiene_guarda is true then 'OK' else 'REVISAR' end from det
  union all select 3, 'Ya no conserva la rama permisiva de la 211', coalesce(conserva_rama_vieja::text, 'sin función'), 'false', case when conserva_rama_vieja is false then 'OK' else 'REVISAR' end from det
  union all select 4, 'Sigue siendo SECURITY DEFINER con search_path fijo', coalesce(definer_y_search_path::text, 'sin función'), 'true', case when definer_y_search_path is true then 'OK' else 'REVISAR' end from det
  union all select 5, 'service_role ejecuta; anon/authenticated no (grants intactos)', coalesce(service_role_ejecuta::text, '?') || ' / ' || coalesce(expuesta_a_clientes::text, '?'), 'true / false', case when service_role_ejecuta is true and expuesta_a_clientes is false then 'OK' else 'REVISAR' end from det
  union all select 6, 'Comparativas manuales: total / con aliado / B2B sin aliado (IGUAL al preflight)', manuales::text || ' / ' || con_aliado::text || ' / ' || b2b_sin_aliado::text, 'igual al preflight', 'INFO' from hist
) r order by orden;
