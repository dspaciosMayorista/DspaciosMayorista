-- PREFLIGHT 297 (#43/#60 entrega 3b, número PROVISIONAL) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 297.
-- Todo OK; anotar los INFO: las huellas (controles 9 y 10) deben ser IDÉNTICAS en el postcheck (12 y 13).
with pre as (
  select
    (to_regprocedure('public.grupos_dias_guardar_propuesta(bigint, text, text, uuid, jsonb)') is not null
     and to_regprocedure('public._grupos_43_autorizar(boolean)') is not null
     and to_regclass('public.hotel_grupo_tarifa_propuesta') is not null)::int as base_295,
    (exists (select 1 from pg_constraint where conname = 'hotel_temporada_grupos_inactivos_43' and convalidated))::int as candado_293,
    (select count(*) from public.hotel_temporada_grupos where activo)::bigint as grupos_activos,
    (select count(*) from public.tarifa_hotel where grupo_id is not null)::bigint as tarifas_con_grupo,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_calculadora' and column_name = 'version')::int as columna_version,
    (to_regclass('public.hotel_calculadora_grupo_bases') is not null)::int as tabla_nueva,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (
      'grupos_dias_guardar_calculadora', 'grupos_dias_config_bases', 'grupos_dias_borrar_con_bases', '_calc_grupos_43_bases_de', 'tg_version_fila_43', '_calc_grupos_43_numero', '_calc_grupos_43_validar_lista', '_calc_grupos_43_validar_bases'))::int as funciones_nuevas,
    -- Unicidad de hotel_calculadora.hotel_id (los escritores condicionan por hotel + versión).
    (select count(*) from (select hotel_id from public.hotel_calculadora group by hotel_id having count(*) > 1) x)::bigint as calculadoras_duplicadas,
    (select count(*) from public.hotel_calculadora)::bigint as calculadoras,
    (select md5(coalesce(string_agg(concat_ws('|', c.id, c.hotel_id, c.tipo, c.params::text), E'\n' order by c.id), '')) from public.hotel_calculadora c) as huella_calculadoras,
    (select md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '')) from public.tarifa_hotel t) as huella_tarifas,
    (select md5(coalesce(string_agg(to_jsonb(p)::text, E'\n' order by p.id), '')) from public.hotel_grupo_tarifa_propuesta p) as huella_propuestas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, '295 aplicada (RPC de propuesta y autorización)' as control, base_295::text as observado, '1' as esperado,
         case when base_295 = 1 then 'OK' else 'REVISAR' end as estado from pre
  union all select 2, 'Candado de inactividad de la 293', candado_293::text, '1', case when candado_293 = 1 then 'OK' else 'REVISAR' end from pre
  union all select 3, 'Grupos activos', grupos_activos::text, '0', case when grupos_activos = 0 then 'OK' else 'REVISAR' end from pre
  union all select 4, 'Tarifas con grupo en tarifa_hotel', tarifas_con_grupo::text, '0', case when tarifas_con_grupo = 0 then 'OK' else 'REVISAR' end from pre
  union all select 5, 'Columna hotel_calculadora.version ya existe', columna_version::text, '0', case when columna_version = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 6, 'Tabla hotel_calculadora_grupo_bases ya existe', tabla_nueva::text, '0', case when tabla_nueva = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 7, 'Funciones de la 297 ya existen', funciones_nuevas::text, '0', case when funciones_nuevas = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 8, 'Hoteles con más de una calculadora', calculadoras_duplicadas::text, '0', case when calculadoras_duplicadas = 0 then 'OK' else 'REVISAR' end from pre
  union all select 9, 'Huella de calculadoras (id, hotel, tipo, params; igual en el postcheck, control 12)', huella_calculadoras, 'anotar', 'INFO' from pre
  union all select 10, 'Huella de tarifas (igual en el postcheck, control 13)', huella_tarifas, 'anotar', 'INFO' from pre
  union all select 11, 'Huella de propuestas (igual en el postcheck, control 14)', huella_propuestas, 'anotar', 'INFO' from pre
  union all select 12, 'Calculadoras (filas)', calculadoras::text, 'anotar', 'INFO' from pre
) r order by orden;
