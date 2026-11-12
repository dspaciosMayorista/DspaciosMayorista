-- POSTCHECK 297 (#43/#60 entrega 3b) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 297.
-- Todo OK; las huellas (12, 13, 14) deben ser IDÉNTICAS a las del preflight (9, 10, 11).
with post as (
  select
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_calculadora'
       and column_name = 'version' and is_nullable = 'NO')::int as columna_version,
    (select count(*) from public.hotel_calculadora where version is distinct from 1)::bigint as versiones_distintas_de_1,
    (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and (
        (tgname = 'trg_hotel_calculadora_version_43' and tgrelid = to_regclass('public.hotel_calculadora'))
        or (tgname in ('trg_hotel_calculadora_grupo_bases_version_43', 'trg_auditoria') and tgrelid = to_regclass('public.hotel_calculadora_grupo_bases'))))::int as triggers,
    (to_regclass('public.hotel_calculadora_grupo_bases') is not null)::int as tabla,
    (select relrowsecurity::int from pg_class where oid = to_regclass('public.hotel_calculadora_grupo_bases')) as rls,
    (select count(*) from pg_policies where tablename = 'hotel_calculadora_grupo_bases')::int as politicas,
    (select count(*) from pg_policies where tablename = 'hotel_calculadora_grupo_bases' and cmd = 'SELECT')::int as politica_lectura,
    (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
      where table_name = 'hotel_calculadora_grupo_bases' and grantee = 'authenticated') as priv_authenticated,
    (select count(*) from information_schema.role_table_grants
      where table_name = 'hotel_calculadora_grupo_bases' and grantee in ('anon', 'public'))::int as priv_anon,
    (select count(*) from pg_constraint where conrelid = to_regclass('public.hotel_calculadora_grupo_bases') and contype = 'f'
       and confrelid = to_regclass('public.hotel_temporada_grupos') and confdeltype = 'r')::int as fk_restrict,
    (select count(*) from pg_proc p where p.proname in ('grupos_dias_guardar_calculadora', 'grupos_dias_config_bases', 'grupos_dias_borrar_con_bases') and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))::int as rpc_ok,
    (select count(*) from pg_proc p where p.proname in ('tg_version_fila_43', '_calc_grupos_43_numero', '_calc_grupos_43_validar_lista', '_calc_grupos_43_validar_bases', '_calc_grupos_43_bases_de')
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')))::int as internas_expuestas,
    (select count(*) from pg_constraint where conname = 'hotel_temporada_grupos_inactivos_43' and convalidated
      and pg_get_constraintdef(oid) = 'CHECK ((NOT activo))')::int as candado_293,
    (select count(*) from public.hotel_temporada_grupos where activo)::bigint as grupos_activos,
    (select count(*) from public.tarifa_hotel where grupo_id is not null)::bigint as tarifas_con_grupo,
    (select count(*) from public.hotel_calculadora_grupo_bases)::bigint as bases,
    (select count(*) from public.hotel_calculadora)::bigint as calculadoras,
    (select md5(coalesce(string_agg(concat_ws('|', c.id, c.hotel_id, c.tipo, c.params::text), E'\n' order by c.id), '')) from public.hotel_calculadora c) as huella_calculadoras,
    (select md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '')) from public.tarifa_hotel t) as huella_tarifas,
    (select md5(coalesce(string_agg(to_jsonb(p)::text, E'\n' order by p.id), '')) from public.hotel_grupo_tarifa_propuesta p) as huella_propuestas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Columna version (no nula) y todas las calculadoras en 1' as control,
         columna_version::text || ' / ' || versiones_distintas_de_1::text as observado, '1 / 0' as esperado,
         case when columna_version = 1 and versiones_distintas_de_1 = 0 then 'OK' else 'REVISAR' end as estado from post
  union all select 2, 'Triggers de versión (×2) y auditoría habilitados', triggers::text, '3', case when triggers = 3 then 'OK' else 'REVISAR' end from post
  union all select 3, 'Tabla de bases con RLS', tabla::text || ' / ' || coalesce(rls::text, '∅'), '1 / 1',
         case when tabla = 1 and rls = 1 then 'OK' else 'REVISAR' end from post
  union all select 4, 'Políticas: solo lectura para internos', politicas::text || ' / ' || politica_lectura::text, '1 / 1',
         case when politicas = 1 and politica_lectura = 1 then 'OK' else 'REVISAR' end from post
  union all select 5, 'authenticated solo SELECT sobre las bases', coalesce(priv_authenticated, '∅'), 'SELECT',
         case when priv_authenticated = 'SELECT' then 'OK' else 'REVISAR' end from post
  union all select 6, 'Privilegios de anon/public sobre las bases', priv_anon::text, '0', case when priv_anon = 0 then 'OK' else 'REVISAR' end from post
  union all select 7, 'Bases protegidas: FK al grupo restrictiva (el borrado de la 295 no se las lleva)', fk_restrict::text, '1', case when fk_restrict = 1 then 'OK' else 'REVISAR' end from post
  union all select 8, 'RPC (guardar, leer con bases, borrar con bases) security definer: authenticated sí, anon no', rpc_ok::text, '3', case when rpc_ok = 3 then 'OK' else 'REVISAR' end from post
  union all select 9, 'Funciones internas expuestas', internas_expuestas::text, '0', case when internas_expuestas = 0 then 'OK' else 'REVISAR' end from post
  union all select 10, 'Candado 293 intacto / grupos activos / tarifas con grupo', candado_293::text || ' / ' || grupos_activos::text || ' / ' || tarifas_con_grupo::text, '1 / 0 / 0',
         case when candado_293 = 1 and grupos_activos = 0 and tarifas_con_grupo = 0 then 'OK' else 'REVISAR' end from post
  union all select 11, 'Bases guardadas', bases::text, '0', case when bases = 0 then 'OK' else 'REVISAR' end from post
  union all select 12, 'Huella de calculadoras (igual al preflight, control 9)', huella_calculadoras, 'igual al preflight', 'INFO' from post
  union all select 13, 'Huella de tarifas (igual al preflight, control 10)', huella_tarifas, 'igual al preflight', 'INFO' from post
  union all select 14, 'Huella de propuestas (igual al preflight, control 11)', huella_propuestas, 'igual al preflight', 'INFO' from post
  union all select 15, 'Calculadoras (filas; igual al preflight, control 12)', calculadoras::text, 'igual al preflight', 'INFO' from post
) r order by orden;
