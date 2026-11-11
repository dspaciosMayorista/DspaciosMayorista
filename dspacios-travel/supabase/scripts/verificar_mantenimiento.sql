-- VERIFICAR el estado del mantenimiento (294). SOLO LECTURA: una consulta con estado. Úsese después de activar, de cortar, de habilitar y de desactivar.
with c as (select * from mant_priv.config where id),
reg as (select coalesce(string_agg(case when d.setdatabase = 0 then 'rol' else 'base' end || '=' || substr(s, 22), ' ; '), '(ninguno)') v
          from pg_db_role_setting d, unnest(d.setconfig) s where d.setrole = (select oid from pg_roles where rolname = coalesce((select rol_filtro from c), 'authenticator')) and s like 'pgrst.db_pre_request=%'),
q(orden, control, observado, esperado) as (
  select 1, 'mantenimiento activo', (select activo::text from c), null
  union all select 2, 'filtro registrado (activo: el de mantenimiento en el nivel guardado; apagado: el previo restaurado)', (select v from reg),
         case when (select activo from c) then (select nivel from c) || '=public.mantenimiento_pre_request' end
  union all select 3, 'filtro previo encadenado', coalesce((select previo_efectivo::text from c), '(ninguno)'), null
  union all select 4, 'excepción habilitada (hash cargado)', (select (clave_sha256 is not null)::text from c), null
  union all select 5, 'operadores autorizados: todos activos superadmin/administracion',
         (select cardinality(operadores) || ' / válidos ' || (select count(*) from public.usuarios u where u.id = any (c.operadores) and u.activo and u.rol::text in ('superadmin', 'administracion')) from c), null
  union all select 6, 'transacciones de PostgREST/Storage abiertas desde ANTES de activar (deben ser 0)',
         (select count(*)::text from pg_stat_activity, c where c.activo and usename in (c.rol_filtro, 'supabase_storage_admin') and state <> 'idle' and xact_start < c.desde), '0'
  union all select 7, 'trigger de Storage habilitado', (select (tgenabled = 'O')::text from pg_trigger where tgname = 'mantenimiento_storage' and tgrelid = 'storage.objects'::regclass), 'true'
  union all select 8, 'jobs pausados por la activación',
         coalesce((select string_agg(j::text, ',') from c, unnest(c.cron_pausados) j), '(ninguno)'), null
)
select orden, control, observado, esperado, case when esperado is null then 'INFO' when observado = esperado then 'OK' else 'REVISAR' end estado from q
union all
select 99, 'RESUMEN', case when (select activo from c) then case when (select clave_sha256 is not null from c) then 'ACTIVO con excepción de validación' else 'ACTIVO (nadie escribe)' end else 'apagado' end, null,
       (select count(*) from q where esperado is not null and observado is distinct from esperado)::text || ' a revisar'
order by orden;
