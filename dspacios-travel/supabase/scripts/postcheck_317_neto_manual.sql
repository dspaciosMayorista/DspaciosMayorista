-- POSTCHECK 317 (#48) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 317. Todos los controles deben dar OK; el INFO 8 debe ser IGUAL al del preflight.
with f as (
  select
    to_regprocedure('public.crear_cotizacion_manual_neto(uuid,text,jsonb,jsonb,bigint,boolean,boolean)') as nueva,
    to_regprocedure('p50_priv.sellar_hija(bigint,text,boolean,boolean,uuid)') as sellar,
    to_regprocedure('p39_priv.bloquear_para_editar(bigint,uuid,integer,text)') as bloquear
), t as (
  select f.*,
    (select prosrc from pg_proc where oid = f.sellar) as src_sellar,
    (select prosrc from pg_proc where oid = f.bloquear) as src_bloquear
  from f
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Existe public.crear_cotizacion_manual_neto' as control, (nueva is not null)::text as observado, 'true' as esperado, case when nueva is not null then 'OK' else 'FALLO' end as estado from t
  union all select 2, 'Solo service_role la ejecuta (ni anon ni authenticated ni PUBLIC)',
         case when nueva is null then 'sin función' else (has_function_privilege('service_role', nueva, 'execute'))::text || '/' || (has_function_privilege('anon', nueva, 'execute') or has_function_privilege('authenticated', nueva, 'execute'))::text end,
         'true/false', case when nueva is not null and has_function_privilege('service_role', nueva, 'execute') and not has_function_privilege('anon', nueva, 'execute') and not has_function_privilege('authenticated', nueva, 'execute') then 'OK' else 'FALLO' end from t
  union all select 3, 'La función es SECURITY DEFINER con search_path fijo',
         coalesce((select (prosecdef::text || '/' || coalesce(array_to_string(proconfig, ','), '')) from pg_proc where oid = nueva), 'sin función'), 'true/search_path=public, pg_temp…',
         case when exists (select 1 from pg_proc where oid = nueva and prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%')) then 'OK' else 'FALLO' end from t
  union all select 4, 'sellar_hija trae la guarda nueva y ya no la de «solo hijas»',
         (position('h.paquete_din_id is not null' in src_sellar) > 0)::text || '/' || (position('h.cotizacion_origen_id is null or h.tipo is distinct from ''manual''' in src_sellar) = 0)::text, 'true/true',
         case when position('h.paquete_din_id is not null' in src_sellar) > 0 and position('h.cotizacion_origen_id is null or h.tipo is distinct from ''manual''' in src_sellar) = 0 then 'OK' else 'FALLO' end from t
  union all select 5, 'bloquear_para_editar trae la guarda de NETO fijado y conserva las de la 216',
         (position('NETO fijado' in src_bloquear) > 0)::text || '/' || (position('EDICION_39_CONGELADA' in src_bloquear) > 0 and position('EDICION_39_CON_PAGOS' in src_bloquear) > 0)::text, 'true/true',
         case when position('NETO fijado' in src_bloquear) > 0 and position('EDICION_39_CONGELADA' in src_bloquear) > 0 and position('EDICION_39_CON_PAGOS' in src_bloquear) > 0 then 'OK' else 'FALLO' end from t
  union all select 6, 'sellar_hija y bloquear_para_editar NO son ejecutables desde la API (anon/authenticated/service_role)',
         (has_function_privilege('authenticated', sellar, 'execute') or has_function_privilege('service_role', sellar, 'execute') or has_function_privilege('authenticated', bloquear, 'execute') or has_function_privilege('service_role', bloquear, 'execute'))::text, 'false',
         case when not (has_function_privilege('authenticated', sellar, 'execute') or has_function_privilege('service_role', sellar, 'execute') or has_function_privilege('authenticated', bloquear, 'execute') or has_function_privilege('service_role', bloquear, 'execute')) then 'OK' else 'FALLO' end from t
  union all select 7, 'La frontera de #39 sigue activa', coalesce((select p39_priv.frontera_activa())::text, 'sin frontera'), 'true',
         case when coalesce((select p39_priv.frontera_activa()), false) then 'OK' else 'FALLO' end from t
  union all select 8, 'Sellos NETO existentes: total / de cotizaciones SIN origen de comparativa (igual al preflight: la 317 no cambia filas)',
         (select count(*) from public.cotizacion_neto where modalidad = 'neto')::text || ' / ' ||
         (select count(*) from public.cotizacion_neto n join public.cotizaciones c on c.id = n.cotizacion_id where n.modalidad = 'neto' and c.cotizacion_origen_id is null)::text,
         'igual al preflight', 'INFO' from t
) r order by orden;
