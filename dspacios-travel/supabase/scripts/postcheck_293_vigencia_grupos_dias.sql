-- POSTCHECK 293 (#43/#60 incremento 1) — UNA sola consulta, SOLO LECTURA.
-- Correr DESPUÉS de la migración. Todo OK; la huella (control 13) debe ser IDÉNTICA a la
-- del preflight (control 11): las columnas nuevas se excluyen y el resto de cada fila
-- de tarifa debe seguir igual.
with
post as (
  select
    (to_regclass('public.hotel_temporada_grupos') is not null)::int as tabla,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tarifa_hotel'
      and ((column_name = 'grupo_id' and data_type = 'uuid') or (column_name = 'grupo_dias' and data_type = 'ARRAY')))::int as cols,
    (select count(*) from pg_constraint where conrelid = to_regclass('public.hotel_temporada_grupos')
      and conname = 'hotel_temporada_grupos_inactivos_43' and convalidated
      and pg_get_constraintdef(oid) = 'CHECK ((NOT activo))')::int as candado,
    (select count(*) from pg_constraint where conrelid = 'public.tarifa_hotel'::regclass
      and conname = 'tarifa_hotel_grupo_dias_coherente' and convalidated)::int as coherencia,
    (select count(*) from pg_constraint c where c.contype = 'f' and c.confdeltype = 'r'
      and ((c.conrelid = 'public.tarifa_hotel'::regclass and c.confrelid = to_regclass('public.hotel_temporada_grupos'))
        or (c.conrelid = to_regclass('public.hotel_temporada_grupos') and c.confrelid = 'public.hotel_temporadas'::regclass)))::int as fks_restrict,
    (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in (
      'trg_hotel_temporada_grupos_validar','trg_hotel_temporada_grupos_propagar_dias','trg_tarifa_hotel_grupo_43',
      'trg_hotel_temporadas_grupos_43','trg_hoteles_modelo_grupos_43')
      or (not tgisinternal and tgname = 'trg_auditoria' and tgrelid = to_regclass('public.hotel_temporada_grupos')))::int as triggers,
    (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('tarifa_hotel_grupo_clave_uq',
      'tarifa_hotel_grupo_idx','hotel_temporada_grupos_nombre_uq','hotel_temporada_grupos_temporada_idx'))::int as indices,
    (select count(*) from pg_indexes where indexname = 'tarifa_hotel_grupo_clave_uq'
      and indexdef like '%UNIQUE%' and indexdef like '%WHERE (grupo_id IS NOT NULL)%')::int as indice_parcial,
    (select relrowsecurity::int from pg_class where oid = to_regclass('public.hotel_temporada_grupos')) as rls,
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'hotel_temporada_grupos')::int as politicas,
    (select count(*) from information_schema.role_table_grants where table_schema = 'public'
      and table_name = 'hotel_temporada_grupos' and grantee in ('anon','public'))::int as privilegios_anon,
    (select count(*) from public.hotel_temporada_grupos)::bigint as grupos,
    (select count(*) from public.hotel_temporada_grupos where activo)::bigint as grupos_activos,
    (select count(*) from public.tarifa_hotel where grupo_id is not null or grupo_dias is not null)::bigint as tarifas_con_grupo,
    (select count(*) from public.tarifa_hotel)::bigint as tarifas,
    (select md5(coalesce(string_agg((to_jsonb(t) - 'grupo_id' - 'grupo_dias')::text, E'\n' order by t.id), ''))
       from public.tarifa_hotel t) as huella_tarifas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Tabla hotel_temporada_grupos' as control, tabla::text as observado, '1' as esperado,
         case when tabla = 1 then 'OK' else 'REVISAR' end as estado from post
  union all select 2, 'Columnas tarifa_hotel.grupo_id (uuid) y grupo_dias (arreglo)', cols::text, '2',
         case when cols = 2 then 'OK' else 'REVISAR' end from post
  union all select 3, 'Candado de inactividad (check NOT activo, validado)', candado::text, '1',
         case when candado = 1 then 'OK' else 'REVISAR' end from post
  union all select 4, 'Check grupo_id ↔ grupo_dias', coherencia::text, '1',
         case when coherencia = 1 then 'OK' else 'REVISAR' end from post
  union all select 5, 'FK on delete restrict (tarifa→grupo, grupo→vigencia)', fks_restrict::text, '2',
         case when fks_restrict = 2 then 'OK' else 'REVISAR' end from post
  union all select 6, 'Triggers de control y auditoría habilitados', triggers::text, '6',
         case when triggers = 6 then 'OK' else 'REVISAR' end from post
  union all select 7, 'Índices (4) y el único es parcial (solo filas con grupo)', indices::text || ' / ' || indice_parcial::text, '4 / 1',
         case when indices = 4 and indice_parcial = 1 then 'OK' else 'REVISAR' end from post
  union all select 8, 'RLS activa y 4 políticas (interno + 3 restrictivas de catálogo)', rls::text || ' / ' || politicas::text, '1 / 4',
         case when rls = 1 and politicas = 4 then 'OK' else 'REVISAR' end from post
  union all select 9, 'Privilegios de anon/public sobre la tabla', privilegios_anon::text, '0',
         case when privilegios_anon = 0 then 'OK' else 'REVISAR' end from post
  union all select 10, 'Grupos creados / activos', grupos::text || ' / ' || grupos_activos::text, '0 / 0',
         case when grupos = 0 and grupos_activos = 0 then 'OK' else 'REVISAR' end from post
  union all select 11, 'Tarifas con grupo', tarifas_con_grupo::text, '0',
         case when tarifas_con_grupo = 0 then 'OK' else 'REVISAR' end from post
  union all select 12, 'Tarifas de hotel (filas; igual al preflight, control 10)', tarifas::text, 'igual al preflight', 'INFO' from post
  union all select 13, 'Huella de tarifas sin las columnas nuevas (igual al preflight, control 11)', huella_tarifas,
         'igual al preflight', 'INFO' from post
) r
order by orden;
