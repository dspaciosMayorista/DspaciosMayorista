-- POSTCHECK 260 — SOLO LECTURA (UNA consulta, columna «estado»). Pegar dentro de:  begin read only;  <consulta>  rollback;
-- Todo debe decir OK antes de encender TARIFARIO_PUBLICACION_POR_LOTES=1. «REVISAR» en pg_cron no bloquea (la continuación pasa a la ruta /api/cron/publicacion-tarifario).
select c.comprobacion, c.observado, c.esperado, c.estado from (
  select 1 as o, 'las 8 tablas nuevas existen, con RLS activa' as comprobacion,
         (select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relrowsecurity and relname in
           ('tarifario_manifiesto','tarifario_manifiesto_lote','tarifario_lote_control','tarifario_lote_espera','tarifario_publicacion_cola','tarifario_fila_oculta','tarifario_cambio_fuente','tarifario_resultado_neto'))::text as observado,
         '8' as esperado,
         case when (select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relrowsecurity and relname in
           ('tarifario_manifiesto','tarifario_manifiesto_lote','tarifario_lote_control','tarifario_lote_espera','tarifario_publicacion_cola','tarifario_fila_oculta','tarifario_cambio_fuente','tarifario_resultado_neto')) = 8 then 'OK' else 'FALLA' end as estado
  union all
  select 2, 'anon y authenticated SIN ningún privilegio directo sobre esas 8 tablas',
         (select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relname in
           ('tarifario_manifiesto','tarifario_manifiesto_lote','tarifario_lote_control','tarifario_lote_espera','tarifario_publicacion_cola','tarifario_fila_oculta','tarifario_cambio_fuente','tarifario_resultado_neto')
            and (has_table_privilege('anon', c.oid, 'select,insert,update,delete') or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')))::text, '0',
         case when (select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relname in
           ('tarifario_manifiesto','tarifario_manifiesto_lote','tarifario_lote_control','tarifario_lote_espera','tarifario_publicacion_cola','tarifario_fila_oculta','tarifario_cambio_fuente','tarifario_resultado_neto')
            and (has_table_privilege('anon', c.oid, 'select,insert,update,delete') or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'))) = 0 then 'OK' else 'FALLA: hay acceso directo' end
  union all
  select 3, 'columnas de generación en tarifario_resultado (generacion, revision_fuente, lote) y armado_paquetes.tarifario_por_generacion',
         ((select count(*) from information_schema.columns where table_schema='public' and table_name='tarifario_resultado' and column_name in ('generacion','revision_fuente','lote'))
          + (select count(*) from information_schema.columns where table_schema='public' and table_name='armado_paquetes' and column_name='tarifario_por_generacion'))::text, '4',
         case when ((select count(*) from information_schema.columns where table_schema='public' and table_name='tarifario_resultado' and column_name in ('generacion','revision_fuente','lote'))
                  + (select count(*) from information_schema.columns where table_schema='public' and table_name='armado_paquetes' and column_name='tarifario_por_generacion')) = 4 then 'OK' else 'FALLA' end
  union all
  select 4, 'el costo neto del hotel NO está en la tabla legible ni en la vista (neto_hotel)',
         (select count(*) from information_schema.columns where table_schema='public' and table_name in ('tarifario_resultado','tarifario_resultado_publicable') and column_name = 'neto_hotel')::text, '0',
         case when (select count(*) from information_schema.columns where table_schema='public' and table_name in ('tarifario_resultado','tarifario_resultado_publicable') and column_name = 'neto_hotel') = 0 then 'OK' else 'FALLA: se filtraría el costo neto' end
  union all
  select 5, 'la vista es EXACTAMENTE la de la 260 (huella) y oculta los metadatos de generación',
         ((md5(pg_get_viewdef('public.tarifario_resultado_publicable'::regclass, true)) = '04f7b9f1b8e7053ef45335ce9cce0688')
          and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='tarifario_resultado_publicable' and column_name in ('generacion','lote','revision_fuente')))::text, 'true',
         case when (md5(pg_get_viewdef('public.tarifario_resultado_publicable'::regclass, true)) = '04f7b9f1b8e7053ef45335ce9cce0688')
                   and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='tarifario_resultado_publicable' and column_name in ('generacion','lote','revision_fuente')) then 'OK' else 'FALLA' end
  union all
  select 6, 'la vista conserva sus opciones (security_barrier) y sus permisos de lectura (anon, authenticated, service_role)',
         (coalesce((select 'security_barrier=true' = any (reloptions) from pg_class where oid = 'public.tarifario_resultado_publicable'::regclass), false)
          and has_table_privilege('anon','public.tarifario_resultado_publicable','select') and has_table_privilege('authenticated','public.tarifario_resultado_publicable','select')
          and has_table_privilege('service_role','public.tarifario_resultado_publicable','select'))::text, 'true',
         case when coalesce((select 'security_barrier=true' = any (reloptions) from pg_class where oid = 'public.tarifario_resultado_publicable'::regclass), false)
                   and has_table_privilege('anon','public.tarifario_resultado_publicable','select') and has_table_privilege('authenticated','public.tarifario_resultado_publicable','select')
                   and has_table_privilege('service_role','public.tarifario_resultado_publicable','select') then 'OK' else 'FALLA' end
  union all
  select 7, 'la política de lectura de la tabla base es EXACTAMENTE la de la 260 (huella)',
         coalesce((select (md5(pg_get_expr(pl.polqual, pl.polrelid)) = '585e5a4716a0e2ed88e09462d126e6e4')::text from pg_policy pl where pl.polrelid='public.tarifario_resultado'::regclass and pl.polname='tarifario_resultado: lectura'), 'ausente'), 'true',
         case when exists (select 1 from pg_policy pl where pl.polrelid='public.tarifario_resultado'::regclass and pl.polname='tarifario_resultado: lectura' and md5(pg_get_expr(pl.polqual, pl.polrelid)) = '585e5a4716a0e2ed88e09462d126e6e4') then 'OK' else 'FALLA' end
  union all
  select 8, 'disparadores: 6 nuevos por sentencia y ya NO los 2 por fila de la 181',
         ((select count(*) from pg_trigger where not tgisinternal and tgname in ('tarifario_trg_tarifa_hotel_ins','tarifario_trg_tarifa_hotel_upd','tarifario_trg_tarifa_hotel_del','tarifario_trg_hotel_temporadas_ins','tarifario_trg_hotel_temporadas_upd','tarifario_trg_hotel_temporadas_del'))::text
          || ' nuevos · ' || (select count(*) from pg_trigger where not tgisinternal and tgname in ('tarifario_trg_tarifa_hotel','tarifario_trg_hotel_temporadas'))::text || ' viejos'), '6 nuevos · 0 viejos',
         case when (select count(*) from pg_trigger where not tgisinternal and tgname in ('tarifario_trg_tarifa_hotel_ins','tarifario_trg_tarifa_hotel_upd','tarifario_trg_tarifa_hotel_del','tarifario_trg_hotel_temporadas_ins','tarifario_trg_hotel_temporadas_upd','tarifario_trg_hotel_temporadas_del')) = 6
                   and (select count(*) from pg_trigger where not tgisinternal and tgname in ('tarifario_trg_tarifa_hotel','tarifario_trg_hotel_temporadas')) = 0 then 'OK' else 'FALLA' end
  union all
  select 9, 'funciones públicas (authenticated sí, anon no): manifiesto, lote_agregar, activar, limpiar, espera_guardar, encolar, avanzar, estado, pendiente',
         (select count(*) from unnest(array['tarifario_manifiesto_crear(bigint,bigint,bigint,text,jsonb,jsonb,smallint,text,numeric,text)','tarifario_lote_agregar(bigint,bigint,integer,text)','tarifario_lote_activar(bigint,bigint)',
            'tarifario_lote_limpiar(bigint,integer)','tarifario_lote_espera_guardar(bigint,bigint,integer,text)','tarifario_publicacion_encolar(bigint,bigint)','tarifario_publicacion_avanzar(bigint,bigint)',
            'tarifario_publicacion_estado(bigint,bigint)','tarifario_publicacion_pendiente(bigint)']) f
          where to_regprocedure('public.' || f) is not null and has_function_privilege('authenticated', to_regprocedure('public.' || f), 'execute') and not has_function_privilege('anon', to_regprocedure('public.' || f), 'execute'))::text, '9',
         case when (select count(*) from unnest(array['tarifario_manifiesto_crear(bigint,bigint,bigint,text,jsonb,jsonb,smallint,text,numeric,text)','tarifario_lote_agregar(bigint,bigint,integer,text)','tarifario_lote_activar(bigint,bigint)',
            'tarifario_lote_limpiar(bigint,integer)','tarifario_lote_espera_guardar(bigint,bigint,integer,text)','tarifario_publicacion_encolar(bigint,bigint)','tarifario_publicacion_avanzar(bigint,bigint)',
            'tarifario_publicacion_estado(bigint,bigint)','tarifario_publicacion_pendiente(bigint)']) f
          where to_regprocedure('public.' || f) is not null and has_function_privilege('authenticated', to_regprocedure('public.' || f), 'execute') and not has_function_privilege('anon', to_regprocedure('public.' || f), 'execute')) = 9 then 'OK' else 'FALLA' end
  union all
  select 10, 'funciones internas (_i) y el trabajador: NO invocables por anon ni authenticated; el trabajador solo por service_role',
         (select count(*) from unnest(array['tarifario_lote_agregar_i(bigint,bigint,integer,text)','tarifario_lote_activar_i(bigint,bigint)','tarifario_lote_limpiar_i(bigint,integer)','tarifario_publicacion_avanzar_i(bigint,bigint)','tarifario_cola_correr(integer)']) f
          where to_regprocedure('public.' || f) is not null and not has_function_privilege('anon', to_regprocedure('public.' || f), 'execute') and not has_function_privilege('authenticated', to_regprocedure('public.' || f), 'execute'))::text
         || ' · service_role ejecuta el trabajador: ' || coalesce(has_function_privilege('service_role', to_regprocedure('public.tarifario_cola_correr(integer)'), 'execute')::text, 'ausente'), '5 · true',
         case when (select count(*) from unnest(array['tarifario_lote_agregar_i(bigint,bigint,integer,text)','tarifario_lote_activar_i(bigint,bigint)','tarifario_lote_limpiar_i(bigint,integer)','tarifario_publicacion_avanzar_i(bigint,bigint)','tarifario_cola_correr(integer)']) f
          where to_regprocedure('public.' || f) is not null and not has_function_privilege('anon', to_regprocedure('public.' || f), 'execute') and not has_function_privilege('authenticated', to_regprocedure('public.' || f), 'execute')) = 5
                   and coalesce(has_function_privilege('service_role', to_regprocedure('public.tarifario_cola_correr(integer)'), 'execute'), false) then 'OK' else 'FALLA' end
  union all
  select 11, 'las funciones de lotes conservan SUS límites (statement_timeout=30s y lock_timeout=8s); nada se subió a nivel de rol',
         (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('tarifario_manifiesto_crear','tarifario_lote_agregar','tarifario_lote_agregar_i','tarifario_lote_activar','tarifario_lote_activar_i',
            'tarifario_lote_limpiar','tarifario_lote_limpiar_i','tarifario_lote_espera_guardar','tarifario_publicacion_encolar','tarifario_publicacion_avanzar','tarifario_publicacion_avanzar_i','tarifario_cola_correr')
            and 'statement_timeout=30s' = any (p.proconfig) and 'lock_timeout=8s' = any (p.proconfig) and p.prosecdef)::text, '12',
         case when (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('tarifario_manifiesto_crear','tarifario_lote_agregar','tarifario_lote_agregar_i','tarifario_lote_activar','tarifario_lote_activar_i',
            'tarifario_lote_limpiar','tarifario_lote_limpiar_i','tarifario_lote_espera_guardar','tarifario_publicacion_encolar','tarifario_publicacion_avanzar','tarifario_publicacion_avanzar_i','tarifario_cola_correr')
            and 'statement_timeout=30s' = any (p.proconfig) and 'lock_timeout=8s' = any (p.proconfig) and p.prosecdef) = 12 then 'OK' else 'FALLA' end
  union all
  select 12, 'el publicador monolítico (259) sigue con su límite de 30 s',
         exists (select 1 from pg_proc p where p.proname='publicar_tarifario_resultado' and p.pronamespace='public'::regnamespace and 'statement_timeout=30s' = any (p.proconfig))::text, 'true',
         case when exists (select 1 from pg_proc p where p.proname='publicar_tarifario_resultado' and p.pronamespace='public'::regnamespace and 'statement_timeout=30s' = any (p.proconfig)) then 'OK' else 'FALLA' end
  union all
  select 13, 'NINGÚN paquete publicado quedó invisible por la migración (los que no usan lotes siguen mostrando todas sus filas)',
         (select count(*) from public.armado_paquetes ap where ap.tarifario_snapshot_publicable and ap.activo and not ap.tarifario_por_generacion
             and exists (select 1 from public.tarifario_resultado r where r.paquete_id = ap.id)
             and not exists (select 1 from public.tarifario_resultado_publicable v where v.paquete_id = ap.id))::text, '0',
         case when (select count(*) from public.armado_paquetes ap where ap.tarifario_snapshot_publicable and ap.activo and not ap.tarifario_por_generacion
             and exists (select 1 from public.tarifario_resultado r where r.paquete_id = ap.id)
             and not exists (select 1 from public.tarifario_resultado_publicable v where v.paquete_id = ap.id)) = 0 then 'OK' else 'FALLA: un paquete publicado dejó de verse' end
  union all
  select 14, 'cola de publicación vacía o solo con trabajo normal (sin «fallida»)', (select count(*) filter (where estado = 'fallida') || ' fallidas de ' || count(*) from public.tarifario_publicacion_cola), '0 fallidas',
         case when (select count(*) from public.tarifario_publicacion_cola where estado = 'fallida') = 0 then 'OK' else 'REVISAR: hay publicaciones fallidas (ver ultimo_error)' end
  union all
  select 15, 'continuación sin navegador: trabajos de pg_cron «tarifario_cola_correr» (cada 10 s) y «tarifario_cola_purga» (diario)',
         case when to_regclass('cron.job') is null then 'pg_cron no habilitado'
              else (xpath('/row/n/text()', query_to_xml('select coalesce(string_agg(jobname || '' ['' || schedule || '']'' || case when active then '''' else '' INACTIVO'' end, '' · '' order by jobname), ''ninguno'') as n from cron.job where jobname in (''tarifario_cola_correr'', ''tarifario_cola_purga'')', false, true, '')))[1]::text end,
         '2 trabajos activos (o, sin pg_cron, la ruta /api/cron/publicacion-tarifario)',
         case when to_regclass('cron.job') is not null and (xpath('/row/n/text()', query_to_xml('select count(*) as n from cron.job where active and ((jobname = ''tarifario_cola_correr'' and schedule = ''10 seconds'') or jobname = ''tarifario_cola_purga'')', false, true, '')))[1]::text = '2' then 'OK'
              else 'REVISAR: sin pg_cron la continuación depende de la ruta de Vercel (CRON_SECRET configurada y el cron/empujón activos)' end
  union all
  select 16, 'el publicador monolítico NO paga la migración: ningún disparador de la 260 por fila sobre tarifario_resultado, ni índice de generación, ni llave foránea desde las tablas laterales; sí el disparador por PAQUETE',
         ((select count(*) from pg_trigger where tgrelid = 'public.tarifario_resultado'::regclass and not tgisinternal and tgname like 'tarifario\_%')::text || ' disparadores por fila · ' ||
          (select count(*) from pg_index where indrelid = 'public.tarifario_resultado'::regclass and indexrelid::regclass::text like '%paquete_generacion%')::text || ' índice de generación · ' ||
          (select count(*) from pg_constraint where contype = 'f' and confrelid = 'public.tarifario_resultado'::regclass and conrelid in ('public.tarifario_resultado_neto'::regclass, 'public.tarifario_fila_oculta'::regclass))::text || ' FK laterales · ' ||
          (select count(*) from pg_trigger where tgrelid = 'public.armado_paquetes'::regclass and not tgisinternal and tgname = 'tarifario_pub_monolitica')::text || ' disparador por paquete'),
         '0 · 0 · 0 · 1',
         case when (select count(*) from pg_trigger where tgrelid = 'public.tarifario_resultado'::regclass and not tgisinternal and tgname like 'tarifario\_%') = 0
                   and (select count(*) from pg_index where indrelid = 'public.tarifario_resultado'::regclass and indexrelid::regclass::text like '%paquete_generacion%') = 0
                   and (select count(*) from pg_constraint where contype = 'f' and confrelid = 'public.tarifario_resultado'::regclass and conrelid in ('public.tarifario_resultado_neto'::regclass, 'public.tarifario_fila_oculta'::regclass)) = 0
                   and (select count(*) from pg_trigger where tgrelid = 'public.armado_paquetes'::regclass and not tgisinternal and tgname = 'tarifario_pub_monolitica') = 1 then 'OK' else 'FALLA' end
  union all
  select 17, 'tarifario_invalidar es EXACTAMENTE la definición de la 260 (huella)',
         md5(replace((select prosrc from pg_proc where oid = to_regprocedure('public.tarifario_invalidar(bigint[],boolean)')), chr(13), '')), '444686e7dee9843b80da3dcca7f54da5',
         case when md5(replace((select prosrc from pg_proc where oid = to_regprocedure('public.tarifario_invalidar(bigint[],boolean)')), chr(13), '')) = '444686e7dee9843b80da3dcca7f54da5' then 'OK' else 'FALLA' end
) c order by c.o;
