-- PREFLIGHT 295 (#43/#60 incremento 3) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 295.
-- Todo OK; anotar los INFO: la huella de tarifas (control 10) debe ser IDÉNTICA en el postcheck.
with pre as (
  select
    (to_regclass('public.hotel_temporada_grupos') is not null
     and exists (select 1 from pg_constraint where conname = 'hotel_temporada_grupos_inactivos_43' and convalidated))::int as candado_293,
    (to_regprocedure('public.t43_60_candado_hotel(bigint, boolean)') is not null and to_regprocedure('public.fn_auditoria()') is not null
     and to_regprocedure('public.mi_rol()') is not null and to_regprocedure('public.puede_escribir_catalogo_global()') is not null)::int as funciones_base,
    (select count(*) from public.hotel_temporada_grupos where activo)::bigint as grupos_activos,
    (select count(*) from public.tarifa_hotel where grupo_id is not null)::bigint as tarifas_con_grupo,
    (to_regclass('public.hotel_grupo_tarifa_propuesta') is not null)::int as tabla_nueva,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (
      'grupos_dias_config','grupos_dias_guardar','grupos_dias_guardar_propuesta','grupos_dias_borrar',
      '_grupos_43_autorizar','_grupos_43_config','_grupos_43_bloquear_y_comparar',
      'tg_hotel_temporada_grupos_tipo_43','tg_hotel_temporadas_tipo_grupos_43'))::int as funciones_nuevas,
    (select count(*) from pg_trigger where not tgisinternal
      and tgname in ('trg_hotel_temporada_grupos_tipo_43','trg_hotel_temporadas_tipo_grupos_43'))::int as triggers_nuevos,
    -- La regla nueva (grupos solo en vigencias 'tarifa') no se aplica hacia atrás: no debe haber casos.
    (select count(*) from public.hotel_temporada_grupos g join public.hotel_temporadas t on t.id = g.temporada_id
      where coalesce(t.tipo, 'tarifa') <> 'tarifa')::bigint as grupos_en_promocion,
    (select count(*) from public.hotel_temporada_grupos)::bigint as grupos,
    (select count(*) from public.tarifa_hotel)::bigint as tarifas,
    (select md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '')) from public.tarifa_hotel t) as huella_tarifas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, '293 aplicada con su candado de inactividad' as control, candado_293::text as observado, '1' as esperado,
         case when candado_293 = 1 then 'OK' else 'REVISAR' end as estado from pre
  union all select 2, 'Funciones base (candado 293, auditoría, mi_rol, catálogo global)', funciones_base::text, '1',
         case when funciones_base = 1 then 'OK' else 'REVISAR' end from pre
  union all select 3, 'Grupos activos', grupos_activos::text, '0', case when grupos_activos = 0 then 'OK' else 'REVISAR' end from pre
  union all select 4, 'Tarifas con grupo en tarifa_hotel', tarifas_con_grupo::text, '0', case when tarifas_con_grupo = 0 then 'OK' else 'REVISAR' end from pre
  union all select 5, 'Tabla hotel_grupo_tarifa_propuesta ya existe', tabla_nueva::text, '0', case when tabla_nueva = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 6, 'Funciones de la 295 ya existen', funciones_nuevas::text, '0', case when funciones_nuevas = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 7, 'Triggers de la 295 ya existen', triggers_nuevos::text, '0', case when triggers_nuevos = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 8, 'Grupos en vigencias que no son de tarifa', grupos_en_promocion::text, '0', case when grupos_en_promocion = 0 then 'OK' else 'REVISAR' end from pre
  union all select 9, 'Grupos preparados (inactivos)', grupos::text, 'informativo', 'INFO' from pre
  union all select 10, 'Huella de tarifas (igual en el postcheck, control 12)', huella_tarifas, 'anotar', 'INFO' from pre
  union all select 11, 'Tarifas de hotel (filas)', tarifas::text, 'anotar', 'INFO' from pre
) r order by orden;
