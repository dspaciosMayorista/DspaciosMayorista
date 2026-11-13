-- POSTCHECK 300 (#43/#60 entrega 4) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 300.
-- Todo OK. Las huellas 9 y 10 deben ser IDÉNTICAS a las del preflight (controles 5 y 6): ninguna fila cambió.
with post as (
  select
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_temporadas'
       and column_name in ('promo_base_id', 'descuento_unidad', 'noche_gratis_regla', 'dias_promo'))::int as columnas,
    (to_regclass('public.hotel_promocion_reglas') is not null)::int as tabla,
    (select relrowsecurity from pg_class where oid = 'public.hotel_promocion_reglas'::regclass)::int as rls,
    (select count(*) from pg_trigger where not tgisinternal and tgname in (
       'trg_hotel_temporadas_promo_300', 'trg_hotel_promocion_reglas_300', 'trg_hotel_temporada_grupos_promo_300', 'trg_promo_300_conflictos'))::int as triggers,
    (to_regprocedure('public._grupos_43_config_299(bigint)') is not null and to_regprocedure('public._grupos_43_config(bigint)') is not null)::int as envoltorio,
    (to_regprocedure('public.promocion_guardar_reglas(bigint, bigint, jsonb, jsonb)') is not null)::int as rpc,
    (has_table_privilege('anon', 'public.hotel_promocion_reglas', 'select'))::int as anon_lee,
    (select count(*) from public.hotel_temporadas where promo_base_id is not null or descuento_unidad is not null
       or noche_gratis_regla is not null or dias_promo is not null)::bigint as vigencias_marcadas,
    (select count(*) from public.hotel_promocion_reglas)::bigint as reglas,
    (select md5(coalesce(string_agg((to_jsonb(t) - 'promo_base_id' - 'descuento_unidad' - 'noche_gratis_regla' - 'dias_promo')::text, E'\n' order by t.id), ''))
       from public.hotel_temporadas t) as huella_vigencias,
    (select md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '')) from public.tarifa_hotel t) as huella_tarifas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Columnas nuevas en hotel_temporadas' as control, columnas::text as observado, '4' as esperado,
         case when columnas = 4 then 'OK' else 'REVISAR' end as estado from post
  union all select 2, 'Tabla hotel_promocion_reglas', tabla::text, '1', case when tabla = 1 then 'OK' else 'REVISAR' end from post
  union all select 3, 'RLS activa en hotel_promocion_reglas', rls::text, '1', case when rls = 1 then 'OK' else 'REVISAR' end from post
  union all select 4, 'Triggers de integridad (3 + 2 de restricción diferidos)', triggers::text, '5', case when triggers = 5 then 'OK' else 'REVISAR' end from post
  union all select 5, 'RPC promocion_guardar_reglas', rpc::text, '1', case when rpc = 1 then 'OK' else 'REVISAR' end from post
  union all select 6, 'anon puede leer las reglas', anon_lee::text, '0', case when anon_lee = 0 then 'OK' else 'REVISAR' end from post
  union all select 7, 'Vigencias con algún campo nuevo (al aplicar)', vigencias_marcadas::text, '0', case when vigencias_marcadas = 0 then 'OK' else 'REVISAR' end from post
  union all select 8, 'Reglas (al aplicar)', reglas::text, '0', case when reglas = 0 then 'OK' else 'REVISAR' end from post
  union all select 11, 'Configuración de grupos (299) envuelta con las promociones', envoltorio::text, '1', case when envoltorio = 1 then 'OK' else 'REVISAR' end from post
  union all select 9, 'Huella de vigencias sin columnas nuevas (= preflight 5)', huella_vigencias, 'igual al preflight', 'COMPARAR' from post
  union all select 10, 'Huella de tarifas (= preflight 6)', huella_tarifas, 'igual al preflight', 'COMPARAR' from post
) r order by orden;
