-- POSTCHECK 298 (#43/#60 3b) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 298.
-- Todo OK; las huellas (11, 12, 13) deben ser IDÉNTICAS a las del preflight (7, 8, 9): la 298 no cambia
-- ninguna fila (las bases ya guardadas quedan con generales = null = los del hotel, sin subir de versión).
with post as (
  select
    (select count(*) from information_schema.columns where table_name = 'hotel_calculadora_grupo_bases'
       and column_name = 'generales' and data_type = 'jsonb')::int as columna,
    (select count(*) from public.hotel_calculadora_grupo_bases where generales is not null)::bigint as con_generales,
    (select count(*) from pg_constraint where conname = 'hotel_calculadora_grupo_bases_generales_forma')::int as check_forma,
    (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname = 'trg_calc_grupo_generales_43'
       and tgrelid = to_regclass('public.hotel_calculadora_grupo_bases'))::int as trigger_generales,
    (select count(*) from pg_proc p where p.proname = 'grupos_dias_guardar_calculadora_grupo' and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))::int as rpc_ok,
    (select count(*) from pg_proc p where p.proname in ('_calc_grupos_43_validar_generales', 'tg_calc_grupo_generales_43', '_calc_grupos_43_bases_de')
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')))::int as internas_expuestas,
    (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
      where table_name = 'hotel_calculadora_grupo_bases' and grantee = 'authenticated') as priv_authenticated,
    (select count(*) from pg_constraint where conname = 'hotel_temporada_grupos_inactivos_43' and convalidated)::int as candado_293,
    (select count(*) from public.hotel_temporada_grupos where activo)::bigint as grupos_activos,
    (select count(*) from public.tarifa_hotel where grupo_id is not null)::bigint as tarifas_con_grupo,
    (select md5(coalesce(string_agg(to_jsonb(b)::text, E'\n' order by b.id), '')) from (
       select id, grupo_id, tipo, bases, version, updated_at, updated_by from public.hotel_calculadora_grupo_bases) b) as huella_bases,
    (select md5(coalesce(string_agg(concat_ws('|', c.id, c.hotel_id, c.tipo, c.version, c.params::text), E'\n' order by c.id), '')) from public.hotel_calculadora c) as huella_calculadoras,
    (select md5(coalesce(string_agg(to_jsonb(p)::text, E'\n' order by p.id), '')) from public.hotel_grupo_tarifa_propuesta p) as huella_propuestas,
    (select count(*) from public.hotel_calculadora_grupo_bases)::bigint as bases
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Columna generales (jsonb)' as control, columna::text as observado, '1' as esperado,
         case when columna = 1 then 'OK' else 'REVISAR' end as estado from post
  union all select 2, 'Bases existentes con generales propios (deben quedar en null = los del hotel)', con_generales::text, '0',
         case when con_generales = 0 then 'OK' else 'REVISAR' end from post
  union all select 3, 'Restricción de forma (objeto o null)', check_forma::text, '1', case when check_forma = 1 then 'OK' else 'REVISAR' end from post
  union all select 4, 'Trigger: otra escritura deja los generales en null', trigger_generales::text, '1', case when trigger_generales = 1 then 'OK' else 'REVISAR' end from post
  union all select 5, 'RPC nueva security definer: authenticated sí, anon no', rpc_ok::text, '1', case when rpc_ok = 1 then 'OK' else 'REVISAR' end from post
  union all select 6, 'Funciones internas expuestas', internas_expuestas::text, '0', case when internas_expuestas = 0 then 'OK' else 'REVISAR' end from post
  union all select 7, 'authenticated sigue solo con SELECT sobre las bases', coalesce(priv_authenticated, '∅'), 'SELECT',
         case when priv_authenticated = 'SELECT' then 'OK' else 'REVISAR' end from post
  union all select 8, 'Candado 293 intacto', candado_293::text, '1', case when candado_293 = 1 then 'OK' else 'REVISAR' end from post
  union all select 9, 'Grupos activos', grupos_activos::text, '0', case when grupos_activos = 0 then 'OK' else 'REVISAR' end from post
  union all select 10, 'Tarifas con grupo en tarifa_hotel', tarifas_con_grupo::text, '0', case when tarifas_con_grupo = 0 then 'OK' else 'REVISAR' end from post
  union all select 11, 'Huella de las bases sin la columna nueva (igual al preflight, control 7)', huella_bases, 'igual al preflight', 'INFO' from post
  union all select 12, 'Huella de calculadoras con versión (igual al preflight, control 8)', huella_calculadoras, 'igual al preflight', 'INFO' from post
  union all select 13, 'Huella de propuestas (igual al preflight, control 9)', huella_propuestas, 'igual al preflight', 'INFO' from post
  union all select 14, 'Bases por grupo (filas; igual al preflight, control 10)', bases::text, 'igual al preflight', 'INFO' from post
) r order by orden;
