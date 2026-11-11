-- POSTCHECK de la migración 289. SOLO LECTURA. UNA consulta integral: pegar completa DESPUÉS de aplicarla. REVISAR = no continuar.
select * from (
  select 1 as o, 'dtm_reuso_bloqueos(text,boolean) devuelve text[] y tiene la clasificación de preparación' as control,
         (pg_get_function_result('public.dtm_reuso_bloqueos(text,boolean)'::regprocedure) || '|' || (position('prep' in (select prosrc from pg_proc where oid = 'public.dtm_reuso_bloqueos(text,boolean)'::regprocedure)) > 0)::text) as valor, 'text[]|true' as esperado,
         case when pg_get_function_result('public.dtm_reuso_bloqueos(text,boolean)'::regprocedure) = 'text[]' and position('prep' in (select prosrc from pg_proc where oid = 'public.dtm_reuso_bloqueos(text,boolean)'::regprocedure)) > 0 then 'OK' else 'REVISAR' end as estado
  union all select 2, 'eliminar_contrato(text,boolean) borra avisos y plan de comisión con la marca de transacción',
         (select (position('app.p75_eliminando' in prosrc) > 0 and position('public.avisos' in prosrc) > 0)::text from pg_proc where oid = 'public.eliminar_contrato(text,boolean)'::regprocedure), 'true',
         case when (select position('app.p75_eliminando' in prosrc) > 0 and position('public.avisos' in prosrc) > 0 from pg_proc where oid = 'public.eliminar_contrato(text,boolean)'::regprocedure) then 'OK' else 'REVISAR' end
  union all select 3, 'Permisos: dtm_reuso_bloqueos NO ejecutable por anon/authenticated; eliminar_contrato conserva authenticated',
         (not has_function_privilege('anon', 'public.dtm_reuso_bloqueos(text,boolean)', 'execute') and not has_function_privilege('authenticated', 'public.dtm_reuso_bloqueos(text,boolean)', 'execute') and has_function_privilege('authenticated', 'public.eliminar_contrato(text,boolean)', 'execute'))::text, 'true',
         case when not has_function_privilege('anon', 'public.dtm_reuso_bloqueos(text,boolean)', 'execute') and not has_function_privilege('authenticated', 'public.dtm_reuso_bloqueos(text,boolean)', 'execute') and has_function_privilege('authenticated', 'public.eliminar_contrato(text,boolean)', 'execute') then 'OK' else 'REVISAR' end
  union all select 4, 'Comportamiento SIN escrituras: número inexistente → NO_EXISTE; número no DTM → NO_ES_DTM',
         (public.dtm_reuso_bloqueos('DTM-0000000', true)::text || '|' || public.dtm_reuso_bloqueos('MIN-0001', true)::text), '{NO_EXISTE}|{NO_ES_DTM}',
         case when public.dtm_reuso_bloqueos('DTM-0000000', true)::text = '{NO_EXISTE}' and public.dtm_reuso_bloqueos('MIN-0001', true)::text = '{NO_ES_DTM}' then 'OK' else 'REVISAR' end
  union all select 5, 'El REUSO sigue APAGADO',
         coalesce((select habilitado::text from public.dtm_reuso_config limit 1), 'sin fila'), 'false',
         case when coalesce((select habilitado from public.dtm_reuso_config limit 1), false) then 'REVISAR' else 'OK' end
  union all select 6, 'Todo contrato DTM existente: la clasificación responde sin error de lectura (ningún LECTURA_FALLIDA)',
         (select count(*)::text from public.ventas v where v.numero_contrato ~ '^DTM-' and exists (select 1 from unnest(public.dtm_reuso_bloqueos(v.numero_contrato, true)) m where m like 'LECTURA_FALLIDA%')), '0',
         case when (select count(*) from public.ventas v where v.numero_contrato ~ '^DTM-' and exists (select 1 from unnest(public.dtm_reuso_bloqueos(v.numero_contrato, true)) m where m like 'LECTURA_FALLIDA%')) = 0 then 'OK' else 'REVISAR' end
  union all select 6.5, 'INFO #97: versión de la liberación del plan (esperada LIBERACION_PLAN_V2 cuando la 286 está aplicada)',
         coalesce((select left(coalesce(obj_description(p.oid, 'pg_proc'), 'sin versión'), 20) from pg_proc p where p.oid = to_regprocedure('p97_priv.tg_solo_insercion()')), 'la 286 no está aplicada'), 'LIBERACION_PLAN_V2:', 'INFO'
  union all select 7, 'INFO: contratos DTM que hoy no tendrían más motivo que REUSO_DESHABILITADO (candidatos si se habilitara el reuso)',
         (select count(*)::text from public.ventas v where v.numero_contrato ~ '^DTM-' and not exists (select 1 from unnest(public.dtm_reuso_bloqueos(v.numero_contrato, true)) m where m <> 'REUSO_DESHABILITADO')), '(informativo)', 'INFO'
  union all select 8, 'INFO: contratos DTM bloqueados por historia inmutable (p63_aceptacion / persona_capturas) — decisión abierta del dueño',
         (select count(*)::text from public.ventas v where v.numero_contrato ~ '^DTM-' and exists (select 1 from unnest(public.dtm_reuso_bloqueos(v.numero_contrato, true)) m where m in ('RELACION_P63_ACEPTACION','RELACION_PERSONA_CAPTURAS'))), '(informativo)', 'INFO'
) q order by o;
