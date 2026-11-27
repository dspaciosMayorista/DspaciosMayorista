-- PREFLIGHT 347 — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 347. Todo debe estar en OK (o INFO). Control · observado · esperado · veredicto.
with f as (select oid as fid, prosrc from pg_proc where oid = to_regprocedure('p75_priv.completar_conversion_manual(bigint,text)')),
     c as (select count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'contrato_hoteles' and column_name in ('categoria', 'proveedor', 'compra_origen', 'plataforma'))
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La 333 está aplicada (existe completar_conversion_manual con su forma)' as control,
         coalesce((select (prosrc like '%Ajuste de redondeo del reparto del hotel%' and prosrc like '%plan_nombre%')::text from f), 'sin función') as observado, 'true' as esperado,
         case when coalesce((select prosrc like '%Ajuste de redondeo del reparto del hotel%' and prosrc like '%plan_nombre%' from f), false) then 'OK' else 'REVISAR' end as estado
  union all select 2, 'La 347 aún NO está aplicada (la función no escribe contrato_hoteles)',
         coalesce((select (prosrc like '%contrato_hoteles%')::text from f), 'sin función'), 'false',
         case when coalesce((select prosrc not like '%contrato_hoteles%' from f), false) then 'OK' else 'REVISAR' end
  union all select 3, 'La 346 está aplicada: contrato_hoteles tiene categoria, proveedor, compra_origen y plataforma', (select n::text from c), '4', case when (select n from c) = 4 then 'OK' else 'REVISAR' end
  union all select 4, 'La conversión pública llama a la auxiliar (no se pierde el gancho de la 333)',
         coalesce((select (prosrc like '%p75_priv.completar_conversion_manual%')::text from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), 'sin función'), 'true',
         case when coalesce((select prosrc like '%p75_priv.completar_conversion_manual%' from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), false) then 'OK' else 'REVISAR' end
  union all select 5, 'Contratos dinámicos convertidos que ya existen sin hoteles (la 347 NO los reescribe; solo afecta conversiones nuevas)',
         (select count(*) from public.ventas v where v.tipo_paquete = 'dinamico' and v.cotizacion_id is not null and not exists (select 1 from public.contrato_hoteles h where h.numero_contrato = v.numero_contrato))::text, 'informativo', 'INFO'
) r order by orden;
