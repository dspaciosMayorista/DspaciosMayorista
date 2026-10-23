-- DIAGNÓSTICO DE ZONA HORARIA — SOLO LECTURA (una sola sentencia SELECT; no
-- modifica nada y no necesita transacción).
--
-- Para qué: medir en qué zona horaria evalúa Postgres `current_date` en los
-- caminos reales de la app, en vez de suponer UTC. La migración 198 no depende
-- de esto (usa `at time zone 'America/Bogota'`, que ignora el TimeZone de la
-- sesión), pero el resultado dice:
--   · si el desfase histórico de las funciones SQL de la 164 y de los defaults
--     `current_date` existió de verdad en producción;
--   · si los defaults `current_date` que quedan fuera de la 198 siguen afectados.
--
-- Cómo: pegarlo en el editor SQL de Supabase y ejecutarlo. Devuelve una tabla
-- clave/valor.
--
-- Cómo leerlo: el editor entra como `postgres`, pero la app entra por PostgREST
-- como `authenticator` y luego hace SET ROLE a `authenticated`/`service_role`.
-- SET ROLE NO cambia el TimeZone; un `ALTER ROLE … SET timezone` solo rige para
-- el rol con que se INICIA sesión. Para la app cuenta, en este orden: el
-- override de `authenticator` (filas rol_config / db_role_setting), el de la
-- base, y si no hay ninguno, el valor del servidor (fila pg_settings). Si
-- ninguna fila de override menciona timezone, la app usa el mismo valor que
-- esta sesión.

select seccion, clave, valor
from (
  -- 1) Esta sesión y su reloj.
  select 1 as orden, 'sesion' as seccion, 'rol' as clave, current_user::text as valor
  union all select 2, 'sesion', 'TimeZone', current_setting('TimeZone')
  union all select 3, 'sesion', 'now()', now()::text
  union all select 4, 'sesion', 'current_date', current_date::text
  union all select 5, 'sesion', 'dia_bogota', ((now() at time zone 'America/Bogota')::date)::text
  union all select 6, 'sesion', 'current_date_desfasado_ahora',
                   (current_date <> (now() at time zone 'America/Bogota')::date)::text
  union all select 7, 'sesion', 'offset_vs_utc_horas',
                   (extract(epoch from (now() at time zone current_setting('TimeZone')) - (now() at time zone 'UTC')) / 3600)::text
  -- 2) Origen del valor efectivo (archivo de configuración, base, rol, cliente…).
  union all
  select 10, 'pg_settings', name, format('setting=%s source=%s file=%s boot=%s reset=%s',
                                         setting, source, coalesce(sourcefile, '-'), boot_val, reset_val)
  from pg_settings where name in ('TimeZone', 'log_timezone')
  -- 3) Overrides persistidos por base y/o rol (ALTER DATABASE/ROLE … SET).
  union all
  select 20, 'db_role_setting',
         coalesce(r.rolname, '(todos los roles)') || ' @ ' || coalesce(d.datname, '(todas las bases)'),
         c
  from pg_db_role_setting s
  left join pg_roles r on r.oid = s.setrole
  left join pg_database d on d.oid = s.setdatabase
  cross join lateral unnest(s.setconfig) as c
  where c ilike 'timezone=%'
  -- 4) Configuración de los roles por los que entra la app.
  union all
  select 30, 'rol_config', rolname || case when rolcanlogin then ' (login)' else '' end,
         coalesce(array_to_string(rolconfig, ', '), '(sin configuración)')
  from pg_roles
  where rolname in ('postgres', 'authenticator', 'authenticated', 'anon', 'service_role', 'supabase_admin')
  -- 5) Funciones de public que fijan su propia zona (debería no haber ninguna).
  union all
  select 40, 'funcion_con_timezone', n.nspname || '.' || p.proname, array_to_string(p.proconfig, ', ')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and exists (select 1 from unnest(p.proconfig) c where c ilike 'timezone=%')
  -- 6) Defaults de columnas date que dependen del reloj.
  union all
  select 50, 'default_fecha', table_name || '.' || column_name, column_default
  from information_schema.columns
  where table_schema = 'public' and data_type = 'date'
    and (column_default ilike '%current_date%' or column_default ilike '%now()%' or column_default ilike '%fecha_negocio%')
  -- 7) ¿Está aplicada la 198?
  union all
  -- (sin llamarla: si no existe, la consulta entera fallaría al analizarse)
  select 60, 'migracion_198', 'public.fecha_negocio(timestamptz)',
         case when to_regprocedure('public.fecha_negocio(timestamptz)') is null then 'NO aplicada' else 'aplicada' end
) t
order by orden, clave;
