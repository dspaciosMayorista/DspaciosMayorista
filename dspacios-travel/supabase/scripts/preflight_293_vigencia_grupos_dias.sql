-- PREFLIGHT 293 (#43/#60 incremento 1) — UNA sola consulta, SOLO LECTURA.
-- Correr ANTES de la migración. Todos los controles con estado OK; los INFO se anotan
-- (la «huella de tarifas» debe coincidir EXACTAMENTE con la del postcheck: prueba que
-- ningún precio ni dato de tarifa cambió).
with
pre as (
  select
    (to_regclass('public.tarifa_hotel') is not null and to_regclass('public.hotel_temporadas') is not null
     and to_regclass('public.hoteles') is not null and to_regclass('public.tarifa_hotel_historial') is not null)::int as tablas,
    (to_regprocedure('public.fn_auditoria()') is not null and to_regprocedure('public.mi_rol()') is not null
     and to_regprocedure('public.puede_escribir_catalogo_global()') is not null
     and to_regprocedure('public.fn_tarifa_hotel_historial()') is not null)::int as funciones,
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'hoteles' and column_name = 'modelo_tarifario')::int as col_modelo,
    (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'hotel_temporadas' and column_name = 'id') as tipo_id_vigencia,
    (to_regclass('public.hotel_temporada_grupos') is not null)::int as tabla_grupos,
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'tarifa_hotel' and column_name in ('grupo_id','grupo_dias'))::int as cols_nuevas,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('t43_60_candado_hotel','tg_hotel_temporada_grupos_validar',
        'tg_hotel_temporada_grupos_propagar_dias','tg_tarifa_hotel_grupo_43','tg_hotel_temporadas_grupos_43',
        'tg_hoteles_modelo_grupos_43'))::int as funciones_nuevas,
    (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_tarifa_hotel_grupo_43',
        'trg_hotel_temporadas_grupos_43','trg_hoteles_modelo_grupos_43'))::int as triggers_nuevos,
    -- Prueba de huella: la historia de la 203 guarda to_jsonb(old) completo.
    (select count(*) from pg_proc where proname = 'fn_tarifa_hotel_historial'
      and prosrc like '%to_jsonb(old)%')::int as historial_fila_completa,
    (select count(*) from public.tarifa_hotel)::bigint as tarifas,
    (select md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '')) from public.tarifa_hotel t) as huella_tarifas,
    (select count(*) from (select hotel_id, btrim(nombre) from public.hotel_temporadas
       group by 1, 2 having count(*) > 1) x)::bigint as vigencias_nombre_repetido,
    (select count(*) from public.hoteles where modelo_tarifario = 'unidad')::bigint as hoteles_unidad
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Tablas base del tarifario de hoteles' as control, tablas::text as observado, '1' as esperado,
         case when tablas = 1 then 'OK' else 'REVISAR' end as estado from pre
  union all select 2, 'Funciones base (fn_auditoria, mi_rol, puede_escribir_catalogo_global, historial 203)',
         funciones::text, '1', case when funciones = 1 then 'OK' else 'REVISAR' end from pre
  union all select 3, 'hoteles.modelo_tarifario existe', col_modelo::text, '1',
         case when col_modelo = 1 then 'OK' else 'REVISAR' end from pre
  union all select 4, 'Tipo de hotel_temporadas.id', coalesce(tipo_id_vigencia, '∅'), 'bigint',
         case when tipo_id_vigencia = 'bigint' then 'OK' else 'REVISAR' end from pre
  union all select 5, 'Tabla hotel_temporada_grupos ya existe', tabla_grupos::text, '0',
         case when tabla_grupos = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 6, 'Columnas tarifa_hotel.grupo_id / grupo_dias ya existen', cols_nuevas::text, '0',
         case when cols_nuevas = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 7, 'Funciones de la 293 ya existen', funciones_nuevas::text, '0',
         case when funciones_nuevas = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 8, 'Triggers de la 293 ya existen', triggers_nuevos::text, '0',
         case when triggers_nuevos = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 9, 'Historial 203 guarda la fila completa (to_jsonb(old))', historial_fila_completa::text, '1',
         case when historial_fila_completa = 1 then 'OK' else 'REVISAR (el historial no conservaría grupo_dias)' end from pre
  union all select 10, 'Tarifas de hotel (filas)', tarifas::text, 'anotar', 'INFO' from pre
  union all select 11, 'Huella de tarifas (comparar con el postcheck, control 13)', huella_tarifas, 'anotar', 'INFO' from pre
  union all select 12, 'Vigencias con nombre repetido en su hotel (no podrán tener grupos)', vigencias_nombre_repetido::text,
         'informativo', 'INFO' from pre
  union all select 13, 'Hoteles de modelo por unidad (no podrán tener grupos)', hoteles_unidad::text, 'informativo', 'INFO' from pre
) r
order by orden;
