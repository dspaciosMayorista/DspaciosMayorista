-- POSTCHECK de la migración 283 (guardado atómico de «Mi perfil»). Una consulta, un resultado, SIN ESCRIBIR NADA:
-- las dos llamadas de humo usan casos que la función rechaza antes de tocar datos (actor nulo / actor inexistente).
-- Columnas: control | observado | esperado | estado.  Última fila: VEREDICTO («CORRECTA» solo si no hay ninguna FALLA).
with f as (
  select p.oid, p.prosecdef, p.proconfig, p.proowner
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'guardar_perfil_portal'
),
v(orden, control, obs, esp, critico) as (
  values
    (1, 'existe exactamente una función guardar_perfil_portal', (select count(*)::text from f), '1', true),
    (2, 'firma (uuid, text, text, jsonb, jsonb)',
        (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'guardar_perfil_portal'
           and pg_get_function_identity_arguments(p.oid) = 'p_actor_id uuid, p_actor_email text, p_seccion text, p_cambios jsonb, p_esperado jsonb'), '1', true),
    (3, 'retorna jsonb',
        (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'guardar_perfil_portal' and p.prorettype = 'jsonb'::regtype), '1', true),
    (4, 'es SECURITY DEFINER', (select coalesce(bool_and(prosecdef), false)::text from f), 'true', true),
    (5, 'search_path fijado (public, pg_temp)', (select coalesce(bool_and(proconfig @> array['search_path=public, pg_temp']), false)::text from f), 'true', true),
    (6, 'service_role puede ejecutarla', (select coalesce(bool_and(has_function_privilege('service_role', oid, 'execute')), false)::text from f), 'true', true),
    (7, 'anon NO puede ejecutarla', (select coalesce(bool_or(has_function_privilege('anon', oid, 'execute')), false)::text from f), 'false', true),
    (8, 'authenticated NO puede ejecutarla', (select coalesce(bool_or(has_function_privilege('authenticated', oid, 'execute')), false)::text from f), 'false', true),
    (9, 'PUBLIC no tiene EXECUTE (ACL)',
        (select count(*)::text from f, aclexplode(coalesce((select proacl from pg_proc where oid = f.oid), acldefault('f', f.proowner))) a where a.grantee = 0), '0', true),
    -- Las llamadas se arman con query_to_xml (SQL dinámico) y solo se ejecutan si la función existe: sin ella esta consulta
    -- responde FALLA en vez de abortar por «function does not exist».
    (10, 'llamada de humo con actor nulo → solicitud_invalida (sin escribir)',
         (select case when (select count(*) from f) = 1 then
            (xpath('//c/text()', query_to_xml($q$select public.guardar_perfil_portal(null, null, 'ficha', '{}'::jsonb, '{}'::jsonb) ->> 'codigo' as c$q$, false, true, '')))[1]::text
          else 'la función no existe' end), 'solicitud_invalida', true),
    (11, 'llamada de humo con actor inexistente → no_autorizado (sin escribir)',
         (select case when (select count(*) from f) = 1 then
            (xpath('//c/text()', query_to_xml($q$select public.guardar_perfil_portal('00000000-0000-0000-0000-000000000000'::uuid, null, 'ficha', '{"telefono":"3000000000"}'::jsonb, '{}'::jsonb) ->> 'codigo' as c$q$, false, true, '')))[1]::text
          else 'la función no existe' end), 'no_autorizado', true),
    (12, 'la función tiene comentario',
         (select (obj_description(oid, 'pg_proc') is not null)::text from f), 'true', true),
    (13, 'INFO · filas de auditoría escritas por el portal (antes de usar la función deben ser 0)',
         (select count(*)::text from public.auditoria where despues ->> '_via' = 'portal_b2b_perfil'), '0 antes del primer uso', false)
),
r as (
  select orden, control, obs as observado, esp as esperado,
         case when not critico then 'INFO' when obs is not distinct from esp then 'OK' else 'FALLA' end as estado
  from v
)
select orden, control, observado, esperado, estado from r
union all
select 99, 'VEREDICTO', (select count(*) from r where estado = 'FALLA')::text || ' falla(s)', '0 fallas',
       case when (select count(*) from r where estado = 'FALLA') = 0 then 'CORRECTA' else 'REVISAR / REVERTIR' end
order by orden;
