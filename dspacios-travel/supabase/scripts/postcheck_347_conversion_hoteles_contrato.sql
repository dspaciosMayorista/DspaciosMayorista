-- POSTCHECK 347 — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 347. Control · observado · esperado · veredicto.
with f as (select oid as fid, prosecdef, proconfig, prosrc from pg_proc where oid = to_regprocedure('p75_priv.completar_conversion_manual(bigint,text)'))
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La función auxiliar existe, es SECURITY DEFINER con search_path fijo' as control,
         coalesce((select (prosecdef and exists (select 1 from unnest(proconfig) x where x like 'search_path=%'))::text from f), 'sin función') as observado, 'true' as esperado,
         case when coalesce((select prosecdef and exists (select 1 from unnest(proconfig) x where x like 'search_path=%') from f), false) then 'OK' else 'REVISAR' end as estado
  union all select 2, 'Solo service_role la ejecuta (ni anon ni authenticated)',
         coalesce((select (has_function_privilege('service_role', fid, 'execute') and not has_function_privilege('anon', fid, 'execute') and not has_function_privilege('authenticated', fid, 'execute'))::text from f), 'sin función'), 'true',
         case when coalesce((select has_function_privilege('service_role', fid, 'execute') and not has_function_privilege('anon', fid, 'execute') and not has_function_privilege('authenticated', fid, 'execute') from f), false) then 'OK' else 'REVISAR' end
  union all select 3, 'La función conserva el ajuste de redondeo y el «Servicio / Plan» de la 333 y ahora escribe contrato_hoteles',
         coalesce((select (prosrc like '%Ajuste de redondeo del reparto del hotel%' and prosrc like '%plan_nombre%' and prosrc like '%contrato_hoteles%')::text from f), 'sin función'), 'true',
         case when coalesce((select prosrc like '%Ajuste de redondeo del reparto del hotel%' and prosrc like '%plan_nombre%' and prosrc like '%contrato_hoteles%' from f), false) then 'OK' else 'REVISAR' end
  union all select 4, 'La conversión pública sigue llamándola y conserva sus permisos (solo service_role)',
         (coalesce((select prosrc like '%p75_priv.completar_conversion_manual%' from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), false)
          and has_function_privilege('service_role', 'public.convertir_cotizacion_a_contrato(bigint,uuid)', 'execute') and not has_function_privilege('authenticated', 'public.convertir_cotizacion_a_contrato(bigint,uuid)', 'execute')
          and not has_function_privilege('anon', 'public.convertir_cotizacion_a_contrato(bigint,uuid)', 'execute'))::text, 'true',
         case when coalesce((select prosrc like '%p75_priv.completar_conversion_manual%' from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), false)
                and has_function_privilege('service_role', 'public.convertir_cotizacion_a_contrato(bigint,uuid)', 'execute') and not has_function_privilege('authenticated', 'public.convertir_cotizacion_a_contrato(bigint,uuid)', 'execute')
                and not has_function_privilege('anon', 'public.convertir_cotizacion_a_contrato(bigint,uuid)', 'execute') then 'OK' else 'REVISAR' end
  union all select 5, 'Contratos dinámicos convertidos sin hoteles (igual que en el preflight: la 347 no reescribe lo existente)',
         (select count(*) from public.ventas v where v.tipo_paquete = 'dinamico' and v.cotizacion_id is not null and not exists (select 1 from public.contrato_hoteles h where h.numero_contrato = v.numero_contrato))::text, 'igual que en el preflight', 'INFO'
) r order by orden;
