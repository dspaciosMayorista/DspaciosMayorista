-- PREFLIGHT de la migración 294 (mantenimiento). SOLO LECTURA: una consulta, un resultado. Última fila: VEREDICTO («APLICAR» solo sin REVISAR).
-- Comprueba dependencias, privilegios para INSTALAR (y, aparte, los que pedirá la ACTIVACIÓN), y que los nombres estén libres.
-- No sustituye al inventario operativo (inventario_remoto_mantenimiento.sql), que revisa escritores y configuración antes de la ventana.
with v(orden, control, observado, esperado) as (
  values
  -- dependencias
  (1,  'existe storage.objects', (to_regclass('storage.objects') is not null)::text, 'true'),
  (2,  'existe public.usuarios con id uuid, activo boolean y rol',
        (select (count(*) = 3)::text from information_schema.columns where table_schema = 'public' and table_name = 'usuarios'
          and ((column_name = 'id' and data_type = 'uuid') or (column_name = 'activo' and data_type = 'boolean') or column_name = 'rol')), 'true'),
  (3,  'el tipo de usuarios.rol admite superadmin y administracion',
        (select (count(*) = 2)::text from pg_enum e join pg_attribute a on a.atttypid = e.enumtypid
          where a.attrelid = to_regclass('public.usuarios') and a.attname = 'rol' and e.enumlabel in ('superadmin', 'administracion')), 'true'),
  (4,  'sha256() disponible (PostgreSQL ≥ 11)', (to_regprocedure('pg_catalog.sha256(bytea)') is not null)::text, 'true'),
  (5,  'existen los roles anon, authenticated, service_role y authenticator',
        (select (count(*) = 4)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role', 'authenticator')), 'true'),
  -- privilegios para INSTALAR
  (10, 'current_user puede crear esquemas en esta base', has_database_privilege(current_database(), 'CREATE')::text, 'true'),
  (11, 'current_user puede crear triggers en storage.objects (dueño o privilegio TRIGGER)',
        case when to_regclass('storage.objects') is null then 'false'
             else (pg_has_role(current_user, (select relowner from pg_class where oid = 'storage.objects'::regclass), 'MEMBER')
                   or has_table_privilege(current_user, 'storage.objects', 'TRIGGER'))::text end, 'true'),
  (12, 'current_user puede crear funciones en public', has_schema_privilege('public', 'CREATE')::text, 'true'),
  -- privilegios que pedirá la ACTIVACIÓN (no la instalación): si faltan, la 294 se instala pero no se podrá activar
  (20, 'ACTIVACIÓN: current_user puede alterar authenticator (superuser o CREATEROLE)',
        (select (rolsuper or rolcreaterole)::text from pg_roles where rolname = current_user), 'true'),
  (21, 'ACTIVACIÓN: current_user puede terminar sesiones ajenas (superuser o pg_signal_backend)',
        (select (rolsuper or pg_has_role(current_user, 'pg_signal_backend', 'MEMBER'))::text from pg_roles where rolname = current_user), 'true'),
  -- nombres libres (no aplicada antes, sin choques)
  (30, 'esquema mant_priv libre', (to_regnamespace('mant_priv') is null)::text, 'true'),
  (31, 'public.mantenimiento_pre_request() libre', (to_regprocedure('public.mantenimiento_pre_request()') is null)::text, 'true'),
  (32, 'public.mantenimiento_sonda() libre', (to_regprocedure('public.mantenimiento_sonda()') is null)::text, 'true'),
  (33, 'trigger mantenimiento_storage libre en storage.objects',
        (not exists (select 1 from pg_trigger where tgname = 'mantenimiento_storage' and tgrelid = to_regclass('storage.objects')))::text, 'true'),
  -- estado de partida
  (40, 'ningún pgrst.db_pre_request apunta ya a un filtro de mantenimiento',
        (not exists (select 1 from pg_db_role_setting d, unnest(d.setconfig) s where s ilike 'pgrst.db_pre_request=%mantenimiento%'))::text, 'true'),
  (41, 'INFO: filtro previo de authenticator (lo encadenará la activación)',
        coalesce((select string_agg(case when d.setdatabase = 0 then 'rol' else 'base' end || '=' || substr(s, 22), ' ; ') from pg_db_role_setting d, unnest(d.setconfig) s
                   where d.setrole = (select oid from pg_roles where rolname = 'authenticator') and s like 'pgrst.db_pre_request=%'), '(ninguno)'), null)
),
r as (select orden, control, observado, esperado, case when esperado is null then 'INFO' when observado = esperado then 'OK' else 'REVISAR' end as estado from v)
select orden, control, observado, esperado, estado from r
union all
select 99, 'VEREDICTO', (select count(*) from r where estado = 'REVISAR')::text || ' punto(s) a revisar', '0',
       case when (select count(*) from r where estado = 'REVISAR') = 0 then 'APLICAR' else 'NO APLICAR' end
order by orden;
