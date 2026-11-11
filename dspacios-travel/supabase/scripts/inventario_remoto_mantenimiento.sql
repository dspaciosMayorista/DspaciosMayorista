-- INVENTARIO REMOTO para la ventana de mantenimiento (#75+#97 · migración 294). SOLO LECTURA: UNA consulta, un resultado. No cambia nada.
-- Pegar entero en el editor SQL de Supabase (como postgres). Estado: OK · REVISAR (decide el dueño antes de activar) · INFO.
-- LÍMITE: solo ve lo DETECTABLE desde la base. No descarta integraciones externas que usen las claves de la API sin dejar rastro aquí
-- (n8n/Zapier/Make, scripts locales, otro proyecto con las mismas claves): esas se confirman fuera (Vercel, Supabase → API keys/logs, el equipo).
with
q(orden, control, observado, esperado) as (
  -- 1) configuración previa de PostgREST (lo que la activación encadena y restaura)
  select 10, 'pgrst.* en authenticator (nivel rol y por base)',
         coalesce((select string_agg(case when d.setdatabase = 0 then 'rol' else 'base=' || (select datname from pg_database where oid = d.setdatabase) end || ': ' || s, ' ; ' order by d.setdatabase, s)
                     from pg_db_role_setting d, unnest(d.setconfig) s where d.setrole = (select oid from pg_roles where rolname = 'authenticator') and s like 'pgrst.%'), '(ninguna)'), null
  union all
  select 11, 'pgrst.db_pre_request vigente (base > rol) y si la función existe',
         coalesce((select v || ' → ' || coalesce(to_regproc(v)::text, 'NO EXISTE') from (
            select coalesce(
              (select substr(s, 22) from pg_db_role_setting d, unnest(d.setconfig) s where d.setrole = (select oid from pg_roles where rolname = 'authenticator') and d.setdatabase = (select oid from pg_database where datname = current_database()) and s like 'pgrst.db_pre_request=%'),
              (select substr(s, 22) from pg_db_role_setting d, unnest(d.setconfig) s where d.setrole = (select oid from pg_roles where rolname = 'authenticator') and d.setdatabase = 0 and s like 'pgrst.db_pre_request=%')) v) x where v is not null), '(sin filtro previo)'), '(sin filtro previo) o una función existente'
  union all
  select 12, 'detalle del filtro previo (SECURITY DEFINER?, dueño, search_path propio)',
         coalesce((select p.oid::regprocedure::text || ' definer=' || p.prosecdef || ' dueño=' || pg_get_userbyid(p.proowner) || ' config=' || coalesce(array_to_string(p.proconfig, ','), '-')
                     from pg_proc p where p.oid = to_regproc((select substr(s, 22) from pg_db_role_setting d, unnest(d.setconfig) s where d.setrole = (select oid from pg_roles where rolname = 'authenticator') and s like 'pgrst.db_pre_request=%' order by d.setdatabase desc limit 1))), '-'), null
  -- 2) privilegios necesarios para activar/desactivar
  union all select 20, 'current_user puede alterar authenticator (superuser o CREATEROLE)',
         (select (rolsuper or rolcreaterole)::text from pg_roles where rolname = current_user), 'true'
  union all select 21, 'current_user puede terminar sesiones ajenas (superuser o miembro de pg_signal_backend)',
         (select (rolsuper or pg_has_role(current_user, 'pg_signal_backend', 'MEMBER'))::text from pg_roles where rolname = current_user), 'true'
  -- 3) Storage: ¿se puede crear el trigger de la 294?
  union all select 30, 'dueño de storage.objects', coalesce((select pg_get_userbyid(relowner) from pg_class where oid = to_regclass('storage.objects')), 'NO EXISTE'), null
  union all select 31, 'current_user puede crear triggers en storage.objects (dueño o privilegio TRIGGER)',
         case when to_regclass('storage.objects') is null then 'false'
              else (pg_has_role(current_user, (select relowner from pg_class where oid = 'storage.objects'::regclass), 'MEMBER') or has_table_privilege(current_user, 'storage.objects', 'TRIGGER'))::text end, 'true'
  union all select 32, 'triggers existentes en storage.objects',
         coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger where tgrelid = to_regclass('storage.objects') and not tgisinternal), '(ninguno)'), null
  union all select 33, 'buckets (nombre:público)', coalesce((select string_agg(id || ':' || public, ', ' order by id) from storage.buckets), '(ninguno)'), null
  -- 4) escritores DETECTABLES
  union all select 40, 'pg_cron: jobs (nombre:activo)',
         case when to_regclass('cron.job') is null then '(pg_cron no instalado)'
              else (xpath('/row/v/text()', query_to_xml('select coalesce(string_agg(jobname || '':'' || active, '' ; '' order by jobid), ''(ninguno)'') v from cron.job', false, true, '')))[1]::text end, null
  union all select 41, 'funciones que llaman a la red (net.http_* / http_request) y triggers que las usan',
         coalesce((select string_agg(p.oid::regprocedure::text || coalesce(' ← ' || (select string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ',') from pg_trigger t where t.tgfoid = p.oid), ''), ' ; ')
                     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname not in ('pg_catalog', 'information_schema', 'net', 'extensions', 'supabase_functions') and (p.prosrc ilike '%net.http_%' or p.prosrc ilike '%http_request%')), '(ninguna)'), null
  union all select 42, 'Database Webhooks (supabase_functions.hooks)',
         case when to_regclass('supabase_functions.hooks') is null then '(no existe)'
              else (xpath('/row/v/text()', query_to_xml('select count(*)::text v from supabase_functions.hooks', false, true, '')))[1]::text end, null
  union all select 43, 'roles de LOGIN no estándar de Supabase (posibles conexiones directas)',
         coalesce((select string_agg(rolname, ', ' order by rolname) from pg_roles where rolcanlogin and rolname not in
           ('postgres', 'authenticator', 'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin', 'supabase_replication_admin', 'supabase_read_only_user', 'pgbouncer',
            'supabase_realtime_admin', 'supabase_functions_admin', 'dashboard_user', 'supabase_etl_admin', 'supabase_privileged_role') and rolname not like 'pg\_%'), '(ninguno)'), null
  union all select 44, 'conexiones abiertas AHORA por usuario/aplicación (instantánea)',
         coalesce((select string_agg(usename || '/' || coalesce(nullif(application_name, ''), '-') || '=' || n, ' ; ' order by n desc) from (
            select usename, application_name, count(*) n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() group by 1, 2) a), '(ninguna)'), null
  union all select 45, 'publicaciones / suscripciones / servidores externos (FDW)',
         (select count(*) from pg_publication)::text || ' / ' || (select count(*) from pg_subscription)::text || ' / ' || (select count(*) from pg_foreign_server)::text, null
  union all select 46, 'tablas de public SIN trigger de auditoría (sus escrituras no se ven en la comprobación de reapertura)',
         coalesce((select string_agg(c.relname, ', ' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relkind = 'r' and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'trg_auditoria')), '(ninguna)'), null
  -- 5) registro y estado de la 294
  union all select 50, 'log_statement / log_min_error_statement (una sentencia FALLIDA queda registrada con su texto: nunca escribir el secreto en SQL)',
         current_setting('log_statement') || ' / ' || current_setting('log_min_error_statement'), null
  union all select 51, '294 aplicada (esquema mant_priv)', (to_regnamespace('mant_priv') is not null)::text, null
  union all select 52, 'mantenimiento activo ahora',
         case when to_regclass('mant_priv.config') is null then 'false'
              else (xpath('/row/v/text()', query_to_xml('select activo::text v from mant_priv.config', false, true, '')))[1]::text end, 'false'
  union all select 53, 'reuso DTM apagado', coalesce((select habilitado::text from public.dtm_reuso_config limit 1), 'sin fila'), 'false'
)
select orden, control, observado, esperado,
       case when esperado is null then 'INFO'
            when orden = 11 then case when observado = '(sin filtro previo)' or observado !~ 'NO EXISTE$' then 'OK' else 'REVISAR' end
            when observado = esperado then 'OK' else 'REVISAR' end as estado
  from q
union all
select 99, 'VEREDICTO', 'puntos a revisar antes de activar', '0',
       (select count(*) from q where esperado is not null and not (case when orden = 11 then observado = '(sin filtro previo)' or observado !~ 'NO EXISTE$' else observado = esperado end))::text
order by orden;
