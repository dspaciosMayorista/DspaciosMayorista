-- PREFLIGHT 260 — SOLO LECTURA (UNA consulta, columna «estado»). Pegar dentro de:  begin read only;  <consulta>  rollback;
-- BLOQUEA = no aplicar la 260 todavía. REVISAR = decide el dueño. INFO = dato para planear.
-- La 260 REEMPLAZA tres definiciones existentes (tarifario_invalidar de la 181, la vista de la 256 y la política de lectura de la 182) y los dos disparadores por fila de la 181 sobre
-- tarifa_hotel/hotel_temporadas; todo lo demás es aditivo. Por eso este preflight exige que esas definiciones sean EXACTAMENTE las auditadas.
-- Orden: 255 → 256 → 258 (hotfix de traslados) → 259 (ya aplicada) → ESTE PREFLIGHT → 260 → postcheck_260. Hasta que el postcheck pase, TARIFARIO_PUBLICACION_POR_LOTES queda apagada.
select c.comprobacion, c.observado, c.esperado, c.estado from (
  select 1 as o, '256 aplicada (fechas_disponibles + tarifario_diagnostico)' as comprobacion,
         (exists (select 1 from information_schema.columns where table_schema='public' and table_name='tarifario_resultado' and column_name='fechas_disponibles')
          and exists (select 1 from information_schema.columns where table_schema='public' and table_name='armado_paquetes' and column_name='tarifario_diagnostico'))::text as observado,
         'true' as esperado,
         case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='tarifario_resultado' and column_name='fechas_disponibles')
                   and exists (select 1 from information_schema.columns where table_schema='public' and table_name='armado_paquetes' and column_name='tarifario_diagnostico')
              then 'OK' else 'BLOQUEA: aplica antes 255, 256 y 258' end as estado
  union all
  select 2, '258 aplicada (tarifario_composicion_publicada)', (to_regclass('public.tarifario_composicion_publicada') is not null)::text, 'true',
         case when to_regclass('public.tarifario_composicion_publicada') is not null then 'OK' else 'BLOQUEA: aplica antes la 258' end
  union all
  select 3, '259 aplicada (publicar_tarifario_resultado con statement_timeout=30s)',
         exists (select 1 from pg_proc p where p.proname='publicar_tarifario_resultado' and p.pronamespace='public'::regnamespace and 'statement_timeout=30s' = any (p.proconfig))::text, 'true',
         case when exists (select 1 from pg_proc p where p.proname='publicar_tarifario_resultado' and p.pronamespace='public'::regnamespace and 'statement_timeout=30s' = any (p.proconfig))
              then 'OK' else 'BLOQUEA: falta la 259' end
  union all
  select 4, 'objetos de 181/182/234 (tarifario_oferta_63, p63_requiere_trm, iniciar_generacion_tarifario, mi_rol, tarifario_paquete_publicable)',
         (to_regclass('public.tarifario_oferta_63') is not null and to_regprocedure('public.p63_requiere_trm(bigint)') is not null and to_regprocedure('public.iniciar_generacion_tarifario(bigint)') is not null
          and to_regprocedure('public.mi_rol()') is not null and to_regprocedure('public.tarifario_paquete_publicable(bigint)') is not null)::text, 'true',
         case when to_regclass('public.tarifario_oferta_63') is not null and to_regprocedure('public.p63_requiere_trm(bigint)') is not null and to_regprocedure('public.iniciar_generacion_tarifario(bigint)') is not null
                   and to_regprocedure('public.mi_rol()') is not null and to_regprocedure('public.tarifario_paquete_publicable(bigint)') is not null then 'OK' else 'BLOQUEA: faltan objetos previos' end
  union all
  select 5, 'huella de tarifario_invalidar (definición auditada de la 181, o la de la propia 260)',
         md5(replace((select prosrc from pg_proc where oid = to_regprocedure('public.tarifario_invalidar(bigint[],boolean)')), chr(13), '')),
         '8f8437d94500208538697508f06e0a3e (181) o 444686e7dee9843b80da3dcca7f54da5 (260)',
         case when md5(replace((select prosrc from pg_proc where oid = to_regprocedure('public.tarifario_invalidar(bigint[],boolean)')), chr(13), '')) in ('8f8437d94500208538697508f06e0a3e', '444686e7dee9843b80da3dcca7f54da5')
              then 'OK' else 'REVISAR: cambio ajeno en tarifario_invalidar; la 260 abortaría sin cambiar nada' end
  union all
  select 6, 'huella de la vista tarifario_resultado_publicable (256, o la de la propia 260)', md5(pg_get_viewdef('public.tarifario_resultado_publicable'::regclass, true)),
         '882ad9b869dae2ffdf58a746f24d9631 (256) o 04f7b9f1b8e7053ef45335ce9cce0688 (260)',
         case when md5(pg_get_viewdef('public.tarifario_resultado_publicable'::regclass, true)) in ('882ad9b869dae2ffdf58a746f24d9631', '04f7b9f1b8e7053ef45335ce9cce0688')
              then 'OK' else 'REVISAR: cambio ajeno en la vista; la 260 abortaría sin cambiar nada' end
  union all
  select 7, 'huella de la política "tarifario_resultado: lectura" (182, o la de la propia 260)',
         coalesce((select md5(pg_get_expr(pl.polqual, pl.polrelid)) from pg_policy pl where pl.polrelid='public.tarifario_resultado'::regclass and pl.polname='tarifario_resultado: lectura'), 'ausente'),
         '89bc2fd35e941386c2449ea9536fa449 (182) o 585e5a4716a0e2ed88e09462d126e6e4 (260)',
         case when exists (select 1 from pg_policy pl where pl.polrelid='public.tarifario_resultado'::regclass and pl.polname='tarifario_resultado: lectura'
                             and md5(pg_get_expr(pl.polqual, pl.polrelid)) in ('89bc2fd35e941386c2449ea9536fa449', '585e5a4716a0e2ed88e09462d126e6e4'))
              then 'OK' else 'REVISAR: cambio ajeno en la política de lectura (o falta); la 260 abortaría sin cambiar nada' end
  union all
  select 8, 'disparadores de la 181 sobre tarifa_hotel/hotel_temporadas (los que la 260 reemplaza)',
         (select count(*) from pg_trigger where not tgisinternal and tgname in ('tarifario_trg_tarifa_hotel','tarifario_trg_hotel_temporadas'))::text, '2 (181) o 0 si la 260 ya está aplicada',
         case when (select count(*) from pg_trigger where not tgisinternal and tgname in ('tarifario_trg_tarifa_hotel','tarifario_trg_hotel_temporadas')) in (0, 2) then 'OK' else 'REVISAR: estado intermedio' end
  union all
  select 9, 'paquetes con una publicación EN CURSO (tarifario_estado = recalculando)', (select count(*) from public.armado_paquetes where tarifario_estado = 'recalculando')::text, '0',
         case when (select count(*) from public.armado_paquetes where tarifario_estado = 'recalculando') = 0 then 'OK' else 'REVISAR: espera a que terminen o aplica fuera de horario' end
  union all
  select 10, 'filas actuales de tarifario_resultado / tamaño (el índice nuevo toma un candado breve de lectura)',
         (select count(*) from public.tarifario_resultado)::text || ' filas · ' || pg_size_pretty(pg_total_relation_size('public.tarifario_resultado')), 'cualquiera', 'INFO: aplicar fuera de horario'
  union all
  select 11, 'pg_cron disponible en la base (extensión instalada)',
         'versión disponible: ' || coalesce((select default_version from pg_available_extensions where name = 'pg_cron'), 'ninguna') || ' · habilitada: ' || exists (select 1 from pg_extension where extname = 'pg_cron')::text,
         'habilitada = true para la continuación sin navegador por la base',
         case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'OK: la 260 programará el trabajador cada 10 s'
              when exists (select 1 from pg_available_extensions where name = 'pg_cron') then 'REVISAR: disponible pero no habilitada (Database → Extensions → pg_cron). Sin ella la continuación depende de /api/cron/publicacion-tarifario'
              else 'REVISAR: pg_cron no existe en este proyecto; la continuación depende de /api/cron/publicacion-tarifario' end
  union all
  select 12, 'tablas de la 260 ya existentes (reaplicación)', (select count(*) from pg_class where relnamespace='public'::regnamespace and relname in
           ('tarifario_manifiesto','tarifario_manifiesto_lote','tarifario_lote_control','tarifario_lote_espera','tarifario_publicacion_cola','tarifario_fila_oculta','tarifario_cambio_fuente','tarifario_resultado_neto'))::text,
         '0 (primera vez) u 8 (reaplicación idempotente)',
         case when (select count(*) from pg_class where relnamespace='public'::regnamespace and relname in
           ('tarifario_manifiesto','tarifario_manifiesto_lote','tarifario_lote_control','tarifario_lote_espera','tarifario_publicacion_cola','tarifario_fila_oculta','tarifario_cambio_fuente','tarifario_resultado_neto')) in (0, 8)
              then 'OK' else 'REVISAR: aplicación parcial previa' end
  union all
  select 13, 'versión 260 ya registrada en supabase_migrations (si se lleva ese registro)',
         case when to_regclass('supabase_migrations.schema_migrations') is null then 'n/a'
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from supabase_migrations.schema_migrations where version = ''20260601000260''', false, true, '')))[1]::text end,
         '0 o n/a', 'INFO'
  union all
  select 14, 'DESEMPATE por (orden, id): ejecutar ADEMÁS supabase/scripts/auditoria_empates_vigencia.sql y revisar que no haya filas REVISAR', '', 'sin filas REVISAR',
         'INFO: el nuevo desempate puede cambiar un precio si hay vigencias empatadas; la auditoría lo mide antes de desplegar'
) c order by c.o;
