-- PREFLIGHT 333 (conversión: redondeo exacto + copia editada del hotel) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 333.
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Existen la conversión pública y sus funciones de apoyo (la 288)' as control,
         (to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)') is not null and to_regprocedure('p75_priv.convertir_cotizacion_base(bigint,uuid)') is not null
          and to_regprocedure('p75_priv.trasladar_cxp_a_previstas(text)') is not null and to_regprocedure('p75_priv.normalizar_abonos_previos(text)') is not null)::text as observado, 'true' as esperado,
         case when to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)') is not null and to_regprocedure('p75_priv.convertir_cotizacion_base(bigint,uuid)') is not null
                and to_regprocedure('p75_priv.trasladar_cxp_a_previstas(text)') is not null and to_regprocedure('p75_priv.normalizar_abonos_previos(text)') is not null then 'OK' else 'REVISAR' end as estado
  union all select 2, 'La conversión pública tiene la forma de la 288 (base + trasladar CxP + normalizar abonos) y aún NO tiene el paso de la 333',
         coalesce((select (prosrc like '%p75_priv.convertir_cotizacion_base%' and prosrc like '%p75_priv.trasladar_cxp_a_previstas%' and prosrc like '%p75_priv.normalizar_abonos_previos%' and prosrc not like '%completar_conversion_manual%')::text
                     from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), 'sin función'), 'true',
         case when coalesce((select (prosrc like '%p75_priv.convertir_cotizacion_base%' and prosrc like '%p75_priv.trasladar_cxp_a_previstas%' and prosrc like '%p75_priv.normalizar_abonos_previos%' and prosrc not like '%completar_conversion_manual%')
                               from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), false) then 'OK' else 'REVISAR' end
  union all select 3, 'Existen contrato_items, cotizacion_neto y cotizaciones',
         (select count(*) from unnest(array['contrato_items', 'cotizacion_neto', 'cotizaciones']) t where to_regclass('public.' || t) is not null)::text, '3',
         case when (select count(*) from unnest(array['contrato_items', 'cotizacion_neto', 'cotizaciones']) t where to_regclass('public.' || t) is not null) = 3 then 'OK' else 'REVISAR' end
  union all select 4, 'La función auxiliar aún NO existe (la crea la 333)', (to_regprocedure('p75_priv.completar_conversion_manual(bigint,text)') is not null)::text, 'false',
         case when to_regprocedure('p75_priv.completar_conversion_manual(bigint,text)') is null then 'OK' else 'REVISAR' end
  union all select 5, 'Contratos de cotización dinámica cuyas líneas por persona NO suman su precio hoy (anotar; la 333 NO los reescribe: solo cuadra las conversiones nuevas)',
         (select count(*) from public.ventas v where v.tipo_paquete = 'dinamico' and v.cotizacion_id is not null
             and abs(coalesce(v.precio_venta, 0) - coalesce((select sum(i.adultos * i.tarifa_adulto + i.ninos * i.tarifa_nino) from public.contrato_items i where i.numero_contrato = v.numero_contrato and coalesce(i.modo_precio, 'por_persona') = 'por_persona'), 0)) > 0.004)::text,
         'anotar', 'INFO'
  union all select 6, 'Contratos de cotización dinámica convertidos hasta hoy (anotar)', (select count(*) from public.ventas v where v.tipo_paquete = 'dinamico' and v.cotizacion_id is not null)::text, 'anotar', 'INFO'
) r order by orden;
