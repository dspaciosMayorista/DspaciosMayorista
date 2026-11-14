-- POSTCHECK 299 (#43/#60 entrega 3c) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 299.
-- Todo OK; las huellas 13 a 15 deben ser IDÉNTICAS a las 8 a 10 del preflight (la migración no cambia datos).
with post as (
  select
    (not exists (select 1 from pg_constraint where conname = 'hotel_temporada_grupos_inactivos_43'))::int as candado_retirado,
    (select count(*) from pg_trigger where tgname = 'trg_empates_43' and tgconstraint <> 0 and tgdeferrable and tginitdeferred)::int as empates_diferidos,
    (select count(*) from pg_trigger where tgname in ('trg_tarifa_hotel_grupo_rpc_43', 'trg_hotel_temporada_grupos_activo_43', 'trg_43_empates_marca'))::int as guardas,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (
      'grupos_dias_alcance', 'grupos_dias_activar', 'grupos_dias_descartar', 'grupos_dias_volver_todos'))::int as rpc_nuevas,
    (has_function_privilege('authenticated', 'public.grupos_dias_activar(bigint, text, jsonb)', 'execute')
     and not has_function_privilege('anon', 'public.grupos_dias_activar(bigint, text, jsonb)', 'execute')
     and has_function_privilege('authenticated', 'public.grupos_dias_alcance(bigint)', 'execute')
     and not has_function_privilege('anon', 'public.grupos_dias_alcance(bigint)', 'execute'))::int as permisos_rpc,
    (not has_function_privilege('authenticated', 'public._grupos_43_empates(bigint, bigint)', 'execute')
     and not has_function_privilege('authenticated', 'public._grupos_43_bloquear(bigint, text, boolean)', 'execute'))::int as internas_privadas,
    (not has_table_privilege('authenticated', 'public.hotel_temporada_grupos', 'insert')
     and not has_table_privilege('authenticated', 'public.hotel_temporada_grupos', 'update')
     and not has_table_privilege('authenticated', 'public.hotel_temporada_grupos', 'delete')
     and has_table_privilege('authenticated', 'public.hotel_temporada_grupos', 'select'))::int as grupos_solo_lectura,
    (select count(*) from public.hotel_temporada_grupos where activo)::bigint as grupos_activos,
    (select count(*) from public.tarifa_hotel where grupo_id is not null)::bigint as tarifas_con_grupo,
    (select count(*) from (select distinct t.hotel_id from public.hotel_temporadas t) h
      where jsonb_array_length(public._grupos_43_empates(h.hotel_id, null)) > 0)::bigint as hoteles_con_empate,
    (select md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '')) from public.tarifa_hotel t) as huella_tarifas,
    (select md5(coalesce(string_agg(to_jsonb(p)::text, E'\n' order by p.id), '')) from public.hotel_grupo_tarifa_propuesta p) as huella_propuestas,
    (select md5(coalesce(string_agg(to_jsonb(g)::text, E'\n' order by g.id), '')) from public.hotel_temporada_grupos g) as huella_grupos
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Candado de inactividad retirado' as control, candado_retirado::text as observado, '1' as esperado,
         case when candado_retirado = 1 then 'OK' else 'REVISAR' end as estado from post
  union all select 2, 'Comprobación de empates diferida en tarifas, vigencias y grupos', empates_diferidos::text, '3', case when empates_diferidos = 3 then 'OK' else 'REVISAR' end from post
  union all select 3, 'Guardas de escritura (tarifas por grupo, activación y marca de empates en 3 tablas)', guardas::text, '5', case when guardas = 5 then 'OK' else 'REVISAR' end from post
  union all select 4, 'RPC nuevas', rpc_nuevas::text, '4', case when rpc_nuevas = 4 then 'OK' else 'REVISAR' end from post
  union all select 5, 'RPC: authenticated sí, anon no', permisos_rpc::text, '1', case when permisos_rpc = 1 then 'OK' else 'REVISAR' end from post
  union all select 6, 'Funciones internas no ejecutables por authenticated', internas_privadas::text, '1', case when internas_privadas = 1 then 'OK' else 'REVISAR' end from post
  union all select 7, 'Grupos: authenticated solo lee (escrituras por RPC)', grupos_solo_lectura::text, '1', case when grupos_solo_lectura = 1 then 'OK' else 'REVISAR' end from post
  union all select 8, 'Grupos activos (nada se activa al migrar)', grupos_activos::text, '0', case when grupos_activos = 0 then 'OK' else 'REVISAR' end from post
  union all select 9, 'Tarifas con grupo (nada se escribe al migrar)', tarifas_con_grupo::text, '0', case when tarifas_con_grupo = 0 then 'OK' else 'REVISAR' end from post
  union all select 10, 'Hoteles con empates (sin grupos activos no hay)', hoteles_con_empate::text, '0', case when hoteles_con_empate = 0 then 'OK' else 'REVISAR' end from post
  union all select 13, 'Huella de tarifas (= preflight 8)', huella_tarifas, 'igual', 'INFO' from post
  union all select 14, 'Huella de propuestas (= preflight 9)', huella_propuestas, 'igual', 'INFO' from post
  union all select 15, 'Huella de grupos (= preflight 10)', huella_grupos, 'igual', 'INFO' from post
) r order by orden;
