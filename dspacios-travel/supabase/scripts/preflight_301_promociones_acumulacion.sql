-- PREFLIGHT 301 (#43/#60 entrega 5, número PROVISIONAL) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 301 (y después de la 300).
-- Todo OK; anotar los INFO: las huellas (controles 5 y 6) deben ser IDÉNTICAS en el postcheck (controles 9 y 10).
with pre as (
  select
    ((to_regclass('public.hotel_promocion_reglas') is not null) and (to_regprocedure('public.promocion_guardar_reglas(bigint, bigint, jsonb, jsonb)') is not null))::int as base_300,
    (to_regclass('public.hotel_reglas_descuento') is not null)::int as base_278,
    (to_regprocedure('public.fecha_negocio(timestamptz)') is not null)::int as fecha_negocio,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_reglas_descuento'
       and column_name in ('autorizada', 'propuesta'))::int as columnas_nuevas,
    (to_regclass('public.hotel_promocion_combinacion') is not null)::int as tabla_nueva,
    (select md5(coalesce(string_agg(to_jsonb(r)::text, E'\n' order by r.id), '')) from public.hotel_reglas_descuento r) as huella_reglas,
    (select md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '')) from public.hotel_temporadas t) as huella_vigencias,
    (select count(*) from public.hotel_reglas_descuento where activa)::bigint as reglas_activas,
    (select count(*) from public.hotel_temporadas where coalesce(tipo, 'tarifa') <> 'tarifa')::bigint as promociones,
    (select count(distinct t.hotel_id) from public.hotel_temporadas t join public.hotel_reglas_descuento r on r.hotel_id = t.hotel_id and r.activa
     where coalesce(t.tipo, 'tarifa') <> 'tarifa')::bigint as hoteles_con_ambas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, '300 aplicada (reglas por grupo + su RPC)' as control, base_300::text as observado, '1' as esperado,
         case when base_300 = 1 then 'OK' else 'REVISAR' end as estado from pre
  union all select 2, '278 aplicada (reglas EBB / Long Stay)', base_278::text, '1', case when base_278 = 1 then 'OK' else 'REVISAR' end from pre
  union all select 3, 'fecha_negocio() disponible (198)', fecha_negocio::text, '1', case when fecha_negocio = 1 then 'OK' else 'REVISAR' end from pre
  union all select 4, 'Columnas autorizada/propuesta o tabla hotel_promocion_combinacion ya existen', (columnas_nuevas + tabla_nueva)::text, '0',
         case when columnas_nuevas + tabla_nueva = 0 then 'OK' else 'REVISAR (¿ya aplicada?)' end from pre
  union all select 5, 'Huella de reglas EBB / Long Stay (igual en el postcheck, control 9, sin las columnas nuevas)', huella_reglas, 'anotar', 'INFO' from pre
  union all select 6, 'Huella de vigencias (igual en el postcheck, control 10)', huella_vigencias, 'anotar', 'INFO' from pre
  union all select 7, 'Reglas activas', reglas_activas::text, 'anotar', 'INFO' from pre
  union all select 8, 'Promociones (vigencias que no son tarifa)', promociones::text, 'anotar', 'INFO' from pre
  union all select 9, 'Hoteles con promociones y reglas activas (candidatos a «heredada»)', hoteles_con_ambas::text, 'anotar', 'INFO' from pre
) r order by orden;
