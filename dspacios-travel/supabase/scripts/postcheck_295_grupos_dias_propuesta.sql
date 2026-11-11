-- POSTCHECK 295 (#43/#60 incremento 3) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 295.
-- Todo OK; la huella (control 12) debe ser IDÉNTICA a la del preflight (control 10).
with post as (
  select
    (to_regclass('public.hotel_grupo_tarifa_propuesta') is not null)::int as tabla,
    (select relrowsecurity::int from pg_class where oid = to_regclass('public.hotel_grupo_tarifa_propuesta')) as rls,
    (select count(*) from pg_policies where tablename = 'hotel_grupo_tarifa_propuesta' and cmd = 'SELECT')::int as politica_lectura,
    (select count(*) from pg_policies where tablename = 'hotel_grupo_tarifa_propuesta')::int as politicas,
    (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
      where table_name = 'hotel_grupo_tarifa_propuesta' and grantee = 'authenticated') as priv_authenticated,
    (select count(*) from information_schema.role_table_grants
      where table_name = 'hotel_grupo_tarifa_propuesta' and grantee in ('anon', 'public'))::int as priv_anon,
    (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and (
        tgname in ('trg_hotel_temporada_grupos_tipo_43', 'trg_hotel_temporadas_tipo_grupos_43')
        or (tgname = 'trg_auditoria' and tgrelid = to_regclass('public.hotel_grupo_tarifa_propuesta'))))::int as triggers,
    (select count(*) from pg_proc p where p.proname in ('grupos_dias_config','grupos_dias_guardar','grupos_dias_guardar_propuesta','grupos_dias_borrar')
      and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))::int as rpc_ok,
    (select count(*) from pg_proc p where p.proname in ('_grupos_43_autorizar','_grupos_43_config','_grupos_43_bloquear_y_comparar',
      'tg_hotel_temporada_grupos_tipo_43','tg_hotel_temporadas_tipo_grupos_43')
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')))::int as internas_expuestas,
    (select count(*) from pg_constraint where conname = 'hotel_temporada_grupos_inactivos_43' and convalidated
      and pg_get_constraintdef(oid) = 'CHECK ((NOT activo))')::int as candado_293,
    (select count(*) from public.hotel_temporada_grupos where activo)::bigint as grupos_activos,
    (select count(*) from public.tarifa_hotel where grupo_id is not null)::bigint as tarifas_con_grupo,
    (select count(*) from public.hotel_grupo_tarifa_propuesta)::bigint as propuestas,
    (select count(*) from public.tarifa_hotel)::bigint as tarifas,
    (select md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '')) from public.tarifa_hotel t) as huella_tarifas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Tabla de propuesta con RLS' as control, tabla::text || ' / ' || coalesce(rls::text, '∅') as observado, '1 / 1' as esperado,
         case when tabla = 1 and rls = 1 then 'OK' else 'REVISAR' end as estado from post
  union all select 2, 'Políticas: solo lectura para internos', politicas::text || ' / ' || politica_lectura::text, '1 / 1',
         case when politicas = 1 and politica_lectura = 1 then 'OK' else 'REVISAR' end from post
  union all select 3, 'authenticated solo SELECT (escrituras únicamente por RPC)', coalesce(priv_authenticated, '∅'), 'SELECT',
         case when priv_authenticated = 'SELECT' then 'OK' else 'REVISAR' end from post
  union all select 4, 'Privilegios de anon/public sobre la tabla', priv_anon::text, '0', case when priv_anon = 0 then 'OK' else 'REVISAR' end from post
  union all select 5, 'Triggers (tipo ×2, auditoría) habilitados', triggers::text, '3', case when triggers = 3 then 'OK' else 'REVISAR' end from post
  union all select 6, 'RPC ejecutables por authenticated y no por anon', rpc_ok::text, '4', case when rpc_ok = 4 then 'OK' else 'REVISAR' end from post
  union all select 7, 'Funciones internas expuestas a authenticated/anon', internas_expuestas::text, '0', case when internas_expuestas = 0 then 'OK' else 'REVISAR' end from post
  union all select 8, 'Candado de inactividad de la 293 intacto', candado_293::text, '1', case when candado_293 = 1 then 'OK' else 'REVISAR' end from post
  union all select 9, 'Grupos activos', grupos_activos::text, '0', case when grupos_activos = 0 then 'OK' else 'REVISAR' end from post
  union all select 10, 'Tarifas con grupo en tarifa_hotel', tarifas_con_grupo::text, '0', case when tarifas_con_grupo = 0 then 'OK' else 'REVISAR' end from post
  union all select 11, 'Propuestas guardadas', propuestas::text, '0', case when propuestas = 0 then 'OK' else 'REVISAR' end from post
  union all select 12, 'Huella de tarifas (igual al preflight, control 10)', huella_tarifas, 'igual al preflight', 'INFO' from post
  union all select 13, 'Tarifas de hotel (filas; igual al preflight, control 11)', tarifas::text, 'igual al preflight', 'INFO' from post
) r order by orden;
