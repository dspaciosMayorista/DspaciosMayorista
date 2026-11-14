-- PREFLIGHT de la migración 304 (#94, resumen de precios en el contrato). SOLO LECTURA. UNA consulta integral: pegar completa ANTES de aplicarla. Si algún control dice REVISAR, NO aplicar.
-- La 304 REDEFINE dtm_reuso_bloqueos (cuerpo de la 289 + contrato_resumen_precios como preparación). El estado del REUSO (dtm_reuso_config.habilitado) NO se toca: anota el valor
-- del control 4 y compáralo con el del postcheck (en producción el reuso está ENCENDIDO y debe seguir encendido).
select * from (
  select 1 as o, 'La 289 está aplicada y dtm_reuso_bloqueos es EXACTAMENTE la que la 304 reemplaza (md5)' as control,
         coalesce((select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.dtm_reuso_bloqueos(text,boolean)')), 'NO EXISTE') as valor,
         '9335ed80ca236f434802527daaeeb10d' as esperado,
         case when (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.dtm_reuso_bloqueos(text,boolean)')) = '9335ed80ca236f434802527daaeeb10d' then 'OK'
              when (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.dtm_reuso_bloqueos(text,boolean)')) = 'e417b53ecf0de9523e222f9c45debd9a' then 'YA APLICADA (304)'
              else 'REVISAR' end as estado
  union all select 2, 'La 284 (guardas de identidad) y la 289 (lista de preparación) están aplicadas',
         (to_regclass('public.contrato_guardas_config') is not null and (select position('prep' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.dtm_reuso_bloqueos(text,boolean)')))::text, 'true',
         case when to_regclass('public.contrato_guardas_config') is not null and coalesce((select position('prep' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.dtm_reuso_bloqueos(text,boolean)')), false) then 'OK' else 'REVISAR' end
  union all select 3, 'La tabla contrato_resumen_precios NO existe todavía',
         (to_regclass('public.contrato_resumen_precios') is not null)::text, 'false',
         case when to_regclass('public.contrato_resumen_precios') is null then 'OK' else 'YA APLICADA (304)' end
  union all select 4, 'ESTADO DEL REUSO (la 304 no lo cambia): anótalo y compáralo con el postcheck',
         coalesce((select habilitado::text from public.dtm_reuso_config limit 1), 'sin fila'), '(el mismo después)', 'INFO'
  union all select 5, 'Permisos actuales de dtm_reuso_bloqueos (no ejecutable por anon/authenticated); la 304 los conserva',
         (not has_function_privilege('anon', 'public.dtm_reuso_bloqueos(text,boolean)', 'execute') and not has_function_privilege('authenticated', 'public.dtm_reuso_bloqueos(text,boolean)', 'execute'))::text, 'true',
         case when not has_function_privilege('anon', 'public.dtm_reuso_bloqueos(text,boolean)', 'execute') and not has_function_privilege('authenticated', 'public.dtm_reuso_bloqueos(text,boolean)', 'execute') then 'OK' else 'REVISAR' end
  union all select 6, 'Toda tabla con numero_contrato ya está clasificada en las guardas de identidad (la instalación de la 304 aborta si no)',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
           where c.relkind in ('r', 'p') and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attname in ('numero_contrato', 'contrato_numero'))
             and not exists (select 1 from public.contrato_guardas_config g where g.tabla = c.relname::text)), '0',
         case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
           where c.relkind in ('r', 'p') and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attname in ('numero_contrato', 'contrato_numero'))
             and not exists (select 1 from public.contrato_guardas_config g where g.tabla = c.relname::text)) = 0 then 'OK' else 'REVISAR' end
  union all select 7, 'DIAGNÓSTICO: contratos DTM pendientes hoy (solo cuenta; no modifica nada)',
         (select count(*)::text from public.ventas where estado = 'pendiente' and numero_contrato ~ '^DTM-'), '(informativo)', 'INFO'
) q order by o;
