-- POSTCHECK 256 · SOLO LECTURA · UNA consulta integral: n · control · observado · esperado · veredicto.
-- Pegar COMPLETA en el editor SQL de Supabase DESPUÉS de correr la migración 256, SIN envolver en begin/rollback.
-- Veredictos: OK · FALLA · INFO. La ÚLTIMA fila (n = 99) es el VEREDICTO GLOBAL. Si la 256 no está aplicada, los controles dan FALLA (no lanza error).
with
hi as (select md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')), chr(13), '')) as h),
hv as (select md5(pg_get_viewdef(to_regclass('public.tarifario_resultado_publicable'), true)) as h),
vc as (
  select string_agg(column_name, ',' order by ordinal_position) as s,
         (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado_publicable' order by ordinal_position desc limit 1) as ultima
    from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado_publicable'
),
p259 as (
  select count(*) as n from pg_proc p
   where p.oid in (to_regprocedure('public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)'),
                   to_regprocedure('public.publicar_tarifario_resultado_63(bigint,bigint,bigint,text,jsonb,text,numeric)'))
     and coalesce(p.proconfig, '{}'::text[]) @> array['statement_timeout=30s', 'lock_timeout=8s']::text[]
),
c as (
  select 1 as n, 'tarifario_resultado.fechas_disponibles: jsonb, nulable' as control,
         coalesce((select data_type || ':' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'fechas_disponibles'), 'ausente') as observado,
         'jsonb:YES' as esperado,
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'fechas_disponibles' and data_type = 'jsonb' and is_nullable = 'YES') then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'armado_paquetes.tarifario_diagnostico: text, nulable',
         coalesce((select data_type || ':' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'tarifario_diagnostico'), 'ausente'), 'text:YES',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'tarifario_diagnostico' and data_type = 'text' and is_nullable = 'YES') then 'OK' else 'FALLA' end
  union all
  select 3, 'CHECK tarifario_resultado_fechas_disponibles_chk validado y limitado a filas del módulo servicios',
         coalesce((select convalidated::text || ' · menciona servicios=' || (pg_get_constraintdef(oid) like '%servicios%')::text || ' · array=' || (pg_get_constraintdef(oid) like '%array%')::text from pg_constraint where conname = 'tarifario_resultado_fechas_disponibles_chk' and conrelid = to_regclass('public.tarifario_resultado')), 'ausente'),
         'true · menciona servicios=true · array=true',
         case when exists (select 1 from pg_constraint where conname = 'tarifario_resultado_fechas_disponibles_chk' and conrelid = to_regclass('public.tarifario_resultado') and convalidated and pg_get_constraintdef(oid) like '%servicios%' and pg_get_constraintdef(oid) like '%array%') then 'OK' else 'FALLA' end
  union all
  select 4, 'publicador interno = definición exacta de la 256 (huella fdea10…)', coalesce((select h from hi), 'función ausente'), 'fdea107e195de51abca78e34b3e90c9b',
         case when (select h from hi) = 'fdea107e195de51abca78e34b3e90c9b' then 'OK' else 'FALLA' end
  union all
  select 5, 'publicador interno: SECURITY DEFINER, search_path fijo, sin EXECUTE para anon ni authenticated',
         coalesce('secdef=' || (select prosecdef::text from pg_proc where oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')) ||
                  ' sp=' || (select (coalesce(proconfig, '{}'::text[]) @> array['search_path=public, pg_temp']::text[])::text from pg_proc where oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')) ||
                  ' anon=' || has_function_privilege('anon', to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')::oid, 'execute')::text ||
                  ' auth=' || has_function_privilege('authenticated', to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')::oid, 'execute')::text, 'función ausente'),
         'secdef=true sp=true anon=false auth=false',
         case when (select prosecdef from pg_proc where oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)'))
               and (select coalesce(proconfig, '{}'::text[]) @> array['search_path=public, pg_temp']::text[] from pg_proc where oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)'))
               and not has_function_privilege('anon', to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')::oid, 'execute')
               and not has_function_privilege('authenticated', to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')::oid, 'execute') then 'OK' else 'FALLA' end
  union all
  select 6, 'vista publicable = definición exacta de la 256 (huella 882ad9…)', coalesce((select h from hv), 'vista ausente'), '882ad9b869dae2ffdf58a746f24d9631',
         case when (select h from hv) = '882ad9b869dae2ffdf58a746f24d9631' then 'OK' else 'FALLA' end
  union all
  select 7, 'vista publicable: expone fechas_disponibles AL FINAL, conserva opciones y SELECT de anon, authenticated y service_role',
         'última columna=' || coalesce((select ultima from vc), '-') || ' · ' || coalesce((select array_to_string(reloptions, ',') from pg_class where oid = to_regclass('public.tarifario_resultado_publicable')), '-') ||
         ' · anon=' || coalesce(has_table_privilege('anon', to_regclass('public.tarifario_resultado_publicable'), 'select')::text, '-') ||
         ' auth=' || coalesce(has_table_privilege('authenticated', to_regclass('public.tarifario_resultado_publicable'), 'select')::text, '-') ||
         ' service=' || coalesce(has_table_privilege('service_role', to_regclass('public.tarifario_resultado_publicable'), 'select')::text, '-'),
         'última columna=fechas_disponibles · security_barrier=true,security_invoker=false · anon=true auth=true service=true',
         case when (select ultima from vc) = 'fechas_disponibles'
               and (select coalesce(reloptions, '{}') @> array['security_barrier=true', 'security_invoker=false']::text[] from pg_class where oid = to_regclass('public.tarifario_resultado_publicable'))
               and has_table_privilege('anon', to_regclass('public.tarifario_resultado_publicable'), 'select')
               and has_table_privilege('authenticated', to_regclass('public.tarifario_resultado_publicable'), 'select')
               and has_table_privilege('service_role', to_regclass('public.tarifario_resultado_publicable'), 'select') then 'OK' else 'FALLA' end
  union all
  select 8, 'registrar_diagnostico_tarifario: SECURITY INVOKER, anon NO puede ejecutar, authenticated SÍ',
         coalesce('secdef=' || (select prosecdef::text from pg_proc where oid = to_regprocedure('public.registrar_diagnostico_tarifario(bigint,bigint,text)')) ||
                  ' anon=' || has_function_privilege('anon', to_regprocedure('public.registrar_diagnostico_tarifario(bigint,bigint,text)')::oid, 'execute')::text ||
                  ' auth=' || has_function_privilege('authenticated', to_regprocedure('public.registrar_diagnostico_tarifario(bigint,bigint,text)')::oid, 'execute')::text, 'función ausente'),
         'secdef=false anon=false auth=true',
         case when (select not prosecdef from pg_proc where oid = to_regprocedure('public.registrar_diagnostico_tarifario(bigint,bigint,text)'))
               and not has_function_privilege('anon', to_regprocedure('public.registrar_diagnostico_tarifario(bigint,bigint,text)')::oid, 'execute')
               and has_function_privilege('authenticated', to_regprocedure('public.registrar_diagnostico_tarifario(bigint,bigint,text)')::oid, 'execute') then 'OK' else 'FALLA' end
  union all
  select 9, 'la 259 sigue intacta: las 2 entradas con statement_timeout=30s y lock_timeout=8s, y delegan en el interno',
         (select n from p259)::text || ' · delegan=' || (select count(*) from pg_proc p where p.oid in (to_regprocedure('public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)'), to_regprocedure('public.publicar_tarifario_resultado_63(bigint,bigint,bigint,text,jsonb,text,numeric)')) and position('publicar_tarifario_resultado_interno' in p.prosrc) > 0)::text,
         '2 · delegan=2',
         case when (select n from p259) = 2 and (select count(*) from pg_proc p where p.oid in (to_regprocedure('public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)'), to_regprocedure('public.publicar_tarifario_resultado_63(bigint,bigint,bigint,text,jsonb,text,numeric)')) and position('publicar_tarifario_resultado_interno' in p.prosrc) > 0) = 2 then 'OK' else 'FALLA' end
  union all
  select 10, 'la 255 no se tocó (tabla, trigger y policy siguen)',
         (to_regclass('public.servicio_suplementos_franja') is not null)::text || ' · trigger=' || (exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.servicio_suplementos_franja') and t.tgname = 'servicio_suplementos_franja_solape' and not t.tgisinternal))::text,
         'true · trigger=true',
         case when to_regclass('public.servicio_suplementos_franja') is not null and exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.servicio_suplementos_franja') and t.tgname = 'servicio_suplementos_franja_solape' and not t.tgisinternal) then 'OK' else 'FALLA' end
  union all
  select 11, 'datos intactos: filas con fechas_disponibles (recién aplicada = 0) · paquetes con diagnóstico (= 0)',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'fechas_disponibles' )
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'tarifario_diagnostico')
              then (xpath('/row/r/text()', query_to_xml('select (select count(*) from public.tarifario_resultado where fechas_disponibles is not null)::text || '' · '' || (select count(*) from public.armado_paquetes where tarifario_diagnostico is not null)::text as r', false, true, '')))[1]::text
              else 'columnas ausentes' end,
         '0 · 0 recién aplicada',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'fechas_disponibles' )
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'tarifario_diagnostico')
              then 'INFO' else 'FALLA' end
  union all
  select 12, 'línea base DEBE ser igual a la del preflight: filas / paquetes en tarifario_resultado / filas en la vista publicable',
         (select count(*) from public.tarifario_resultado)::text || ' / ' || (select count(distinct paquete_id) from public.tarifario_resultado)::text || ' / ' || (select count(*) from public.tarifario_resultado_publicable)::text,
         'igual al preflight (fila 13)', 'INFO'
  union all
  select 13, 'paquetes atascados en recalculando',
         (select count(*) from public.armado_paquetes where tarifario_estado = 'recalculando')::text, '0',
         case when (select count(*) from public.armado_paquetes where tarifario_estado = 'recalculando') = 0 then 'OK' else 'FALLA' end
)
select n, control, observado, esperado, veredicto from c
union all
select 99, 'VEREDICTO GLOBAL', 'controles con problema: ' || (select count(*) from c where veredicto = 'FALLA')::text, '0',
       case when (select count(*) from c where veredicto = 'FALLA') = 0 then 'MIGRACIÓN 256 VERIFICADA (falta comparar la fila 12 con la 13 del preflight)' else 'FALLA: NO CONTINUAR A LA 258' end
order by n;
