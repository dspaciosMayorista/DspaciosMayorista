-- POSTCHECK 333 — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 333. Compara con el preflight: la 333 no reescribe ningún contrato existente.
with f as (select oid as fid, prosecdef, proconfig, prosrc from pg_proc where oid = to_regprocedure('p75_priv.completar_conversion_manual(bigint,text)')),
     w as (select prosrc, prosecdef from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)'))
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La función auxiliar existe, es SECURITY DEFINER con search_path fijo' as control,
         coalesce((select (prosecdef and exists (select 1 from unnest(proconfig) x where x like 'search_path=%'))::text from f), 'sin función') as observado, 'true' as esperado,
         case when coalesce((select prosecdef and exists (select 1 from unnest(proconfig) x where x like 'search_path=%') from f), false) then 'OK' else 'REVISAR' end as estado
  union all select 2, 'Solo service_role la ejecuta (ni anon ni authenticated)',
         coalesce((select (has_function_privilege('service_role', fid, 'execute') and not has_function_privilege('anon', fid, 'execute') and not has_function_privilege('authenticated', fid, 'execute'))::text from f), 'sin función'), 'true',
         case when coalesce((select has_function_privilege('service_role', fid, 'execute') and not has_function_privilege('anon', fid, 'execute') and not has_function_privilege('authenticated', fid, 'execute') from f), false) then 'OK' else 'REVISAR' end
  union all select 3, 'La conversión pública llama a la auxiliar y conserva base + trasladar CxP + normalizar abonos; sigue SECURITY INVOKER',
         coalesce((select (prosrc like '%p75_priv.completar_conversion_manual%' and prosrc like '%p75_priv.convertir_cotizacion_base%' and prosrc like '%p75_priv.trasladar_cxp_a_previstas%' and prosrc like '%p75_priv.normalizar_abonos_previos%' and not prosecdef)::text from w), 'sin función'), 'true',
         case when coalesce((select prosrc like '%p75_priv.completar_conversion_manual%' and prosrc like '%p75_priv.convertir_cotizacion_base%' and prosrc like '%p75_priv.trasladar_cxp_a_previstas%' and prosrc like '%p75_priv.normalizar_abonos_previos%' and not prosecdef from w), false) then 'OK' else 'REVISAR' end
  union all select 4, 'La conversión pública conserva sus permisos (la 164): solo service_role la ejecuta; ni anon ni authenticated',
         (has_function_privilege('service_role', 'public.convertir_cotizacion_a_contrato(bigint,uuid)', 'execute') and not has_function_privilege('authenticated', 'public.convertir_cotizacion_a_contrato(bigint,uuid)', 'execute')
          and not has_function_privilege('anon', 'public.convertir_cotizacion_a_contrato(bigint,uuid)', 'execute'))::text, 'true',
         case when has_function_privilege('service_role', 'public.convertir_cotizacion_a_contrato(bigint,uuid)', 'execute') and not has_function_privilege('authenticated', 'public.convertir_cotizacion_a_contrato(bigint,uuid)', 'execute')
                and not has_function_privilege('anon', 'public.convertir_cotizacion_a_contrato(bigint,uuid)', 'execute') then 'OK' else 'REVISAR' end
  union all select 5, 'Contratos dinámicos con líneas que no suman su precio (debe ser IGUAL que en el preflight: la 333 no reescribe lo existente)',
         (select count(*) from public.ventas v where v.tipo_paquete = 'dinamico' and v.cotizacion_id is not null
             and abs(coalesce(v.precio_venta, 0) - coalesce((select sum(i.adultos * i.tarifa_adulto + i.ninos * i.tarifa_nino) from public.contrato_items i where i.numero_contrato = v.numero_contrato and coalesce(i.modo_precio, 'por_persona') = 'por_persona'), 0)) > 0.004)::text,
         'igual que en el preflight', 'INFO'
  union all select 6, 'Líneas «Ajuste de redondeo del reparto del hotel» en contratos dinámicos (0 si aún no se convirtió ninguno después de la 333)',
         (select count(*) from public.contrato_items i join public.ventas v on v.numero_contrato = i.numero_contrato where v.tipo_paquete = 'dinamico' and v.cotizacion_id is not null and i.descripcion = 'Ajuste de redondeo del reparto del hotel')::text, 'anotar', 'INFO'
) r order by orden;
