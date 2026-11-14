-- PREFLIGHT 299 (#43/#60 entrega 3c, número PROVISIONAL) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 299.
-- Todo OK; anotar los INFO: las huellas (controles 8 a 10) deben ser IDÉNTICAS en el postcheck (controles 13 a 15).
with pre as (
  select
    (to_regprocedure('public.grupos_dias_guardar_propuesta(bigint, text, text, uuid, jsonb)') is not null
     and to_regprocedure('public._grupos_43_config(bigint)') is not null)::int as base_295,
    (to_regprocedure('public.grupos_dias_guardar_calculadora(bigint, text, uuid, text, bigint, bigint, jsonb, jsonb)') is not null
     and to_regclass('public.hotel_calculadora_grupo_bases') is not null)::int as base_297,
    (exists (select 1 from pg_constraint where conname = 'hotel_temporada_grupos_inactivos_43'))::int as candado_293,
    (select count(*) from public.hotel_temporada_grupos where activo)::bigint as grupos_activos,
    (select count(*) from public.tarifa_hotel where grupo_id is not null)::bigint as tarifas_con_grupo,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (
      'grupos_dias_alcance', 'grupos_dias_activar', 'grupos_dias_descartar', 'grupos_dias_volver_todos', '_grupos_43_empates',
      '_grupos_43_bloquear', 'tg_empates_43', 'tg_tarifa_hotel_grupo_rpc_43', 'tg_hotel_temporada_grupos_activo_43'))::int as funciones_nuevas,
    (select count(*) from pg_trigger where tgname in ('trg_empates_43', 'trg_tarifa_hotel_grupo_rpc_43', 'trg_hotel_temporada_grupos_activo_43', 'trg_43_empates_marca'))::int as triggers_nuevos,
    (select md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '')) from public.tarifa_hotel t) as huella_tarifas,
    (select md5(coalesce(string_agg(to_jsonb(p)::text, E'\n' order by p.id), '')) from public.hotel_grupo_tarifa_propuesta p) as huella_propuestas,
    (select md5(coalesce(string_agg(to_jsonb(g)::text, E'\n' order by g.id), '')) from public.hotel_temporada_grupos g) as huella_grupos,
    (select count(*) from public.hotel_temporada_grupos)::bigint as grupos,
    (select count(*) from public.hotel_grupo_tarifa_propuesta)::bigint as propuestas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, '295 aplicada' as control, base_295::text as observado, '1' as esperado,
         case when base_295 = 1 then 'OK' else 'REVISAR' end as estado from pre
  union all select 2, '297 aplicada', base_297::text, '1', case when base_297 = 1 then 'OK' else 'REVISAR' end from pre
  union all select 3, 'Candado de inactividad de la 293 (se retira en la 299)', candado_293::text, '1', case when candado_293 = 1 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 4, 'Grupos activos', grupos_activos::text, '0', case when grupos_activos = 0 then 'OK' else 'REVISAR' end from pre
  union all select 5, 'Tarifas con grupo en tarifa_hotel', tarifas_con_grupo::text, '0', case when tarifas_con_grupo = 0 then 'OK' else 'REVISAR' end from pre
  union all select 6, 'Funciones de la 299 ya existen', funciones_nuevas::text, '0', case when funciones_nuevas = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 7, 'Triggers de la 299 ya existen', triggers_nuevos::text, '0', case when triggers_nuevos = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 8, 'Huella de tarifas (igual en el postcheck, control 13)', huella_tarifas, 'anotar', 'INFO' from pre
  union all select 9, 'Huella de propuestas (igual en el postcheck, control 14)', huella_propuestas, 'anotar', 'INFO' from pre
  union all select 10, 'Huella de grupos (igual en el postcheck, control 15)', huella_grupos, 'anotar', 'INFO' from pre
  union all select 11, 'Grupos preparados (filas)', grupos::text, 'anotar', 'INFO' from pre
  union all select 12, 'Propuestas (filas)', propuestas::text, 'anotar', 'INFO' from pre
) r order by orden;
