-- PREFLIGHT 298 (#43/#60 3b, número PROVISIONAL) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 298.
-- Todo OK; las huellas (controles 7, 8 y 9) deben ser IDÉNTICAS en el postcheck (11, 12 y 13).
with pre as (
  select
    (to_regprocedure('public.grupos_dias_guardar_calculadora(bigint, text, uuid, text, bigint, bigint, jsonb, jsonb)') is not null
     and to_regclass('public.hotel_calculadora_grupo_bases') is not null
     and exists (select 1 from information_schema.columns where table_name = 'hotel_calculadora' and column_name = 'version'))::int as base_297,
    (exists (select 1 from pg_constraint where conname = 'hotel_temporada_grupos_inactivos_43' and convalidated))::int as candado_293,
    (select count(*) from public.hotel_temporada_grupos where activo)::bigint as grupos_activos,
    (select count(*) from public.tarifa_hotel where grupo_id is not null)::bigint as tarifas_con_grupo,
    (select count(*) from information_schema.columns where table_name = 'hotel_calculadora_grupo_bases' and column_name = 'generales')::int as columna,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and p.proname in ('grupos_dias_guardar_calculadora_grupo', '_calc_grupos_43_validar_generales', 'tg_calc_grupo_generales_43'))::int as funciones_nuevas,
    (select md5(coalesce(string_agg(to_jsonb(b)::text, E'\n' order by b.id), '')) from public.hotel_calculadora_grupo_bases b) as huella_bases,
    (select md5(coalesce(string_agg(concat_ws('|', c.id, c.hotel_id, c.tipo, c.version, c.params::text), E'\n' order by c.id), '')) from public.hotel_calculadora c) as huella_calculadoras,
    (select md5(coalesce(string_agg(to_jsonb(p)::text, E'\n' order by p.id), '')) from public.hotel_grupo_tarifa_propuesta p) as huella_propuestas,
    (select count(*) from public.hotel_calculadora_grupo_bases)::bigint as bases
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, '297 aplicada (RPC, tabla de bases, versión)' as control, base_297::text as observado, '1' as esperado,
         case when base_297 = 1 then 'OK' else 'REVISAR' end as estado from pre
  union all select 2, 'Candado de inactividad de la 293', candado_293::text, '1', case when candado_293 = 1 then 'OK' else 'REVISAR' end from pre
  union all select 3, 'Grupos activos', grupos_activos::text, '0', case when grupos_activos = 0 then 'OK' else 'REVISAR' end from pre
  union all select 4, 'Tarifas con grupo en tarifa_hotel', tarifas_con_grupo::text, '0', case when tarifas_con_grupo = 0 then 'OK' else 'REVISAR' end from pre
  union all select 5, 'Columna generales ya existe', columna::text, '0', case when columna = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 6, 'Funciones de la 298 ya existen', funciones_nuevas::text, '0', case when funciones_nuevas = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 7, 'Huella de las bases por grupo (igual en el postcheck, control 11)', huella_bases, 'anotar', 'INFO' from pre
  union all select 8, 'Huella de calculadoras con versión (igual en el postcheck, control 12)', huella_calculadoras, 'anotar', 'INFO' from pre
  union all select 9, 'Huella de propuestas (igual en el postcheck, control 13)', huella_propuestas, 'anotar', 'INFO' from pre
  union all select 10, 'Bases por grupo guardadas (filas)', bases::text, 'anotar', 'INFO' from pre
) r order by orden;
