-- PREFLIGHT 300 (#43/#60 entrega 4, número PROVISIONAL) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 300.
-- Todo OK; anotar los INFO: las huellas (controles 5 y 6) deben ser IDÉNTICAS en el postcheck (controles 9 y 10).
with pre as (
  select
    (to_regclass('public.hotel_temporada_grupos') is not null)::int as base_293,
    (to_regprocedure('public.grupos_dias_activar(bigint, text, jsonb)') is not null)::int as base_299,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_temporadas'
       and column_name in ('promo_base_id', 'descuento_unidad', 'noche_gratis_regla', 'dias_promo'))::int as columnas_nuevas,
    ((to_regclass('public.hotel_promocion_reglas') is not null) or (to_regprocedure('public._grupos_43_config_299(bigint)') is not null))::int as tabla_nueva,
    (select md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '')) from public.hotel_temporadas t) as huella_vigencias,
    (select md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '')) from public.tarifa_hotel t) as huella_tarifas,
    (select count(*) from public.hotel_temporadas where coalesce(tipo, 'tarifa') = 'promo_noche_gratis')::bigint as noche_gratis,
    (select count(*) from public.hotel_temporadas where coalesce(tipo, 'tarifa') = 'descuento_monto')::bigint as montos,
    (select count(*) from public.hotel_temporadas where coalesce(tipo, 'tarifa') = 'descuento_pct')::bigint as porcentajes
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, '293 aplicada' as control, base_293::text as observado, '1' as esperado,
         case when base_293 = 1 then 'OK' else 'REVISAR' end as estado from pre
  union all select 2, '299 aplicada', base_299::text, '1', case when base_299 = 1 then 'OK' else 'REVISAR' end from pre
  union all select 3, 'Columnas de la 300 ya existen en hotel_temporadas', columnas_nuevas::text, '0', case when columnas_nuevas = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 4, 'Tabla hotel_promocion_reglas o envoltorio de la 299 ya existen', tabla_nueva::text, '0', case when tabla_nueva = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 5, 'Huella de vigencias (igual en el postcheck, control 9, sin las columnas nuevas)', huella_vigencias, 'anotar', 'INFO' from pre
  union all select 6, 'Huella de tarifas (igual en el postcheck, control 10)', huella_tarifas, 'anotar', 'INFO' from pre
  union all select 7, 'Promociones «N noches, 1 gratis» existentes (quedan con promedio heredado)', noche_gratis::text, 'anotar', 'INFO' from pre
  union all select 8, 'Promociones de monto fijo existentes (quedan con «unidad anterior»)', montos::text, 'anotar', 'INFO' from pre
  union all select 9, 'Promociones de porcentaje existentes (sin cambios)', porcentajes::text, 'anotar', 'INFO' from pre
) r order by orden;
