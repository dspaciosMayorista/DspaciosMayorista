-- POSTCHECK de la migración 304 (#94). SOLO LECTURA. UNA consulta integral: pegar completa DESPUÉS de aplicarla. Si algún control dice REVISAR, ejecutar rollback_304_contrato_resumen_precios.sql.
select * from (
  select 1 as o, 'dtm_reuso_bloqueos es la versión 304 (cuerpo de la 289 + contrato_resumen_precios en la lista de preparación)' as control,
         coalesce((select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.dtm_reuso_bloqueos(text,boolean)')), 'NO EXISTE') as valor,
         'e417b53ecf0de9523e222f9c45debd9a' as esperado,
         case when (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.dtm_reuso_bloqueos(text,boolean)')) = 'e417b53ecf0de9523e222f9c45debd9a' then 'OK' else 'REVISAR' end as estado
  union all select 2, 'Permisos de dtm_reuso_bloqueos conservados (sin EXECUTE para anon/authenticated) y sigue SECURITY DEFINER',
         (not has_function_privilege('anon', 'public.dtm_reuso_bloqueos(text,boolean)', 'execute') and not has_function_privilege('authenticated', 'public.dtm_reuso_bloqueos(text,boolean)', 'execute')
           and (select prosecdef from pg_proc where oid = 'public.dtm_reuso_bloqueos(text,boolean)'::regprocedure))::text, 'true',
         case when not has_function_privilege('anon', 'public.dtm_reuso_bloqueos(text,boolean)', 'execute') and not has_function_privilege('authenticated', 'public.dtm_reuso_bloqueos(text,boolean)', 'execute')
               and (select prosecdef from pg_proc where oid = 'public.dtm_reuso_bloqueos(text,boolean)'::regprocedure) then 'OK' else 'REVISAR' end
  union all select 3, 'ESTADO DEL REUSO sin cambios (compara con el control 4 del preflight; en producción: true)',
         coalesce((select habilitado::text from public.dtm_reuso_config limit 1), 'sin fila'), '(el mismo que antes)', 'INFO'
  union all select 4, 'La tabla existe con RLS, UNA policy de lectura y sin escritura para authenticated/anon',
         (select c.relrowsecurity::text from pg_class c where c.oid = to_regclass('public.contrato_resumen_precios')) || '|' ||
         (select count(*)::text from pg_policies where tablename = 'contrato_resumen_precios') || '|' ||
         (has_table_privilege('authenticated', 'public.contrato_resumen_precios', 'insert') or has_table_privilege('authenticated', 'public.contrato_resumen_precios', 'update') or has_table_privilege('authenticated', 'public.contrato_resumen_precios', 'delete') or has_table_privilege('anon', 'public.contrato_resumen_precios', 'select'))::text,
         'true|1|false',
         case when (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.contrato_resumen_precios')) and (select count(*) from pg_policies where tablename = 'contrato_resumen_precios') = 1
               and not (has_table_privilege('authenticated', 'public.contrato_resumen_precios', 'insert') or has_table_privilege('authenticated', 'public.contrato_resumen_precios', 'update') or has_table_privilege('authenticated', 'public.contrato_resumen_precios', 'delete') or has_table_privilege('anon', 'public.contrato_resumen_precios', 'select')) then 'OK' else 'REVISAR' end
  union all select 5, 'service_role tiene lectura y escritura',
         (has_table_privilege('service_role', 'public.contrato_resumen_precios', 'select') and has_table_privilege('service_role', 'public.contrato_resumen_precios', 'insert') and has_table_privilege('service_role', 'public.contrato_resumen_precios', 'update') and has_table_privilege('service_role', 'public.contrato_resumen_precios', 'delete'))::text, 'true',
         case when has_table_privilege('service_role', 'public.contrato_resumen_precios', 'select') and has_table_privilege('service_role', 'public.contrato_resumen_precios', 'insert') and has_table_privilege('service_role', 'public.contrato_resumen_precios', 'update') and has_table_privilege('service_role', 'public.contrato_resumen_precios', 'delete') then 'OK' else 'REVISAR' end
  union all select 6, 'CHECK estricto presente y rechaza un resumen incompleto',
         (select count(*)::text from pg_constraint where conrelid = to_regclass('public.contrato_resumen_precios') and conname = 'contrato_resumen_precios_valido' and contype = 'c') || '|' || public.p94_resumen_valido('{"version":1,"modalidad":"pvp","moneda":null,"totalCentavos":0,"unidades":[]}'::jsonb)::text,
         '1|false',
         case when (select count(*) from pg_constraint where conrelid = to_regclass('public.contrato_resumen_precios') and conname = 'contrato_resumen_precios_valido' and contype = 'c') = 1 and public.p94_resumen_valido('{"version":1,"modalidad":"pvp","moneda":null,"totalCentavos":0,"unidades":[]}'::jsonb) = false then 'OK' else 'REVISAR' end
  union all select 7, 'Guarda de identidad estricta instalada en la tabla',
         coalesce((select g.modo from public.contrato_guardas_config g where g.tabla = 'contrato_resumen_precios'), 'sin clasificar') || '|' || (select count(*)::text from pg_trigger t where t.tgrelid = to_regclass('public.contrato_resumen_precios') and t.tgname = 'trg_contrato_guarda'),
         'estricto|1',
         case when coalesce((select g.modo from public.contrato_guardas_config g where g.tabla = 'contrato_resumen_precios'), '') = 'estricto' and (select count(*) from pg_trigger t where t.tgrelid = to_regclass('public.contrato_resumen_precios') and t.tgname = 'trg_contrato_guarda') = 1 then 'OK' else 'REVISAR' end
  union all select 8, 'Elegibilidad de reuso: el resumen NO bloquea (ningún contrato DTM tiene RELACION_CONTRATO_RESUMEN_PRECIOS ni lecturas fallidas)',
         (select count(*)::text from public.ventas v where v.numero_contrato ~ '^DTM-' and exists (select 1 from unnest(public.dtm_reuso_bloqueos(v.numero_contrato, true)) m where m = 'RELACION_CONTRATO_RESUMEN_PRECIOS' or m like 'LECTURA_FALLIDA%')), '0',
         case when (select count(*) from public.ventas v where v.numero_contrato ~ '^DTM-' and exists (select 1 from unnest(public.dtm_reuso_bloqueos(v.numero_contrato, true)) m where m = 'RELACION_CONTRATO_RESUMEN_PRECIOS' or m like 'LECTURA_FALLIDA%')) = 0 then 'OK' else 'REVISAR' end
  union all select 9, 'Contratos históricos: la tabla nace VACÍA (sin reparto inventado)',
         (select count(*)::text from public.contrato_resumen_precios), '0',
         case when (select count(*) from public.contrato_resumen_precios) = 0 then 'OK' else 'INFO (ya hay conversiones nuevas)' end
) q order by o;
