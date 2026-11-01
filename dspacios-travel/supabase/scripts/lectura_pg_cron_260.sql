-- LECTURA 260 · ¿está disponible pg_cron en la base COMPARTIDA para la continuación automática? — SOLO LECTURA (UNA consulta). Pegar dentro de:  begin read only;  <consulta>  rollback;
-- Decide cómo continúa sola una publicación del tarifario cuando se cierra la pestaña:
--   · veredicto «pg_cron LISTO»: la migración 260 programa sola el trabajador cada 10 s; no hace falta nada más.
--   · «pg_cron DISPONIBLE, falta habilitar»: Dashboard de Supabase → Database → Extensions → pg_cron → Enable; luego correr la 260 (o, si ya estaba corrida, volver a correrla: es idempotente).
--   · «NO viable»: la continuación depende de la ruta /api/cron/publicacion-tarifario (Vercel): exige CRON_SECRET configurada y el despliegue de vercel.json.
select c.comprobacion, c.observado, c.esperado, c.estado from (
  select 1 as o, 'pg_cron disponible para instalar en este proyecto' as comprobacion,
         coalesce((select default_version from pg_available_extensions where name = 'pg_cron'), 'no disponible') as observado, 'una versión (>= 1.5 para «N seconds»)' as esperado,
         case when (select default_version from pg_available_extensions where name = 'pg_cron') is null then 'NO viable: pg_cron no existe en este proyecto'
              when string_to_array((select default_version from pg_available_extensions where name = 'pg_cron'), '.')::int[] >= array[1,5] then 'OK'
              else 'REVISAR: versión anterior a 1.5; usar un intervalo de 1 minuto (cron.schedule(..., ''* * * * *'', ...))' end as estado
  union all
  select 2, 'pg_cron habilitada (instalada)', coalesce((select extversion from pg_extension where extname = 'pg_cron'), 'no habilitada'), 'una versión',
         case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'OK' else 'PENDIENTE: pg_cron DISPONIBLE, falta habilitar (Database → Extensions)' end
  union all
  select 3, 'la base actual es la que ejecuta los trabajos de pg_cron (cron.database_name)', current_database() || ' / cron.database_name=' || coalesce(current_setting('cron.database_name', true), '(no definido)'),
         'iguales',
         case when current_setting('cron.database_name', true) is null then 'INFO: sin la extensión no se puede leer'
              when current_setting('cron.database_name', true) = current_database() then 'OK' else 'REVISAR: pg_cron corre en otra base; la 260 no programaría el trabajo aquí' end
  union all
  select 4, 'pg_cron precargada (shared_preload_libraries)', coalesce(current_setting('shared_preload_libraries', true), ''), 'contiene pg_cron',
         case when coalesce(current_setting('shared_preload_libraries', true), '') like '%pg_cron%' then 'OK' else 'REVISAR: sin precarga el trabajador de pg_cron no corre' end
  union all
  select 5, 'trabajos de pg_cron ya existentes del tarifario',
         case when to_regclass('cron.job') is null then 'n/a (esquema cron ausente)'
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from cron.job where jobname in (''tarifario_cola_correr'', ''tarifario_cola_purga'')', false, true, '')))[1]::text end,
         '0 antes de la 260; 2 después', 'INFO'
  union all
  select 6, 'este rol puede usar el esquema cron (programar trabajos)',
         case when to_regnamespace('cron') is null then 'n/a' else has_schema_privilege(current_user, 'cron', 'usage')::text end, 'true',
         case when to_regnamespace('cron') is null then 'INFO: sin la extensión no se puede leer' when has_schema_privilege(current_user, 'cron', 'usage') then 'OK' else 'REVISAR: ejecutar la 260 con el rol postgres del editor SQL' end
  union all
  select 7, 'ejecuciones recientes de pg_cron (cualquier trabajo): fallidas en las últimas 24 h',
         case when to_regclass('cron.job_run_details') is null then 'n/a'
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from cron.job_run_details where status = ''failed'' and start_time > now() - interval ''24 hours''', false, true, '')))[1]::text end,
         '0', 'INFO'
  union all
  select 8, 'resumen', '', '',
         case when exists (select 1 from pg_extension where extname = 'pg_cron') and coalesce(current_setting('cron.database_name', true), '') = current_database() then 'pg_cron LISTO'
              when exists (select 1 from pg_available_extensions where name = 'pg_cron') then 'pg_cron DISPONIBLE, falta habilitar'
              else 'NO viable: usar /api/cron/publicacion-tarifario' end
) c order by c.o;
