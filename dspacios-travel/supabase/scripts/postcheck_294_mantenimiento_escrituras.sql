-- POSTCHECK de la migración 294 (mantenimiento). SOLO LECTURA: una consulta, un resultado. Última fila: VEREDICTO («CORRECTA» solo sin FALLA).
-- Comprueba objetos, firmas, modo de seguridad, search_path, permisos, trigger habilitado y que la instalación dejó el mantenimiento APAGADO.
with fn(nombre, oid) as (
  select x, to_regprocedure(x) from unnest(array[
    'mant_priv.excepcion(text,text)', 'mant_priv.decidir()', 'mant_priv.previo()', 'mant_priv.tg_storage()',
    'mant_priv.valor_filtro(name,oid)', 'mant_priv.activar(uuid[],name)', 'mant_priv.habilitar_excepcion(text)', 'mant_priv.desactivar()', 'mant_priv.cortar_en_curso()',
    'public.mantenimiento_pre_request()', 'public.mantenimiento_sonda()']) x
),
api(rol) as (values ('anon'), ('authenticated'), ('service_role')),
pub(nombre) as (values ('mant_priv.decidir()'), ('mant_priv.previo()'), ('public.mantenimiento_pre_request()'), ('public.mantenimiento_sonda()')),
v(orden, control, observado, esperado) as (
  values
  (1,  'esquema mant_priv y tabla mant_priv.config', ((to_regnamespace('mant_priv') is not null) and (to_regclass('mant_priv.config') is not null))::text, 'true'),
  (2,  'las 11 funciones existen con su firma exacta', (select count(*)::text from fn where oid is not null), '11'),
  (3,  'DEFINER con search_path = pg_catalog, pg_temp: excepcion, decidir, previo, tg_storage',
        (select count(*)::text from pg_proc p where p.oid in (select oid from fn where nombre in ('mant_priv.excepcion(text,text)', 'mant_priv.decidir()', 'mant_priv.previo()', 'mant_priv.tg_storage()'))
          and p.prosecdef and p.proconfig @> array['search_path=pg_catalog, pg_temp']), '4'),
  (4,  'filtro público INVOKER y SIN cláusulas SET (el filtro previo conserva su contexto)',
        (select (not p.prosecdef and p.proconfig is null)::text from pg_proc p where p.oid = to_regprocedure('public.mantenimiento_pre_request()')), 'true'),
  (5,  'sonda INVOKER y que no escribe (lenguaje sql, sin INSERT/UPDATE/DELETE)',
        (select (not p.prosecdef and p.prosrc !~* '\m(insert|update|delete)\M')::text from pg_proc p where p.oid = to_regprocedure('public.mantenimiento_sonda()')), 'true'),
  (6,  'la excepción comprueba en cada petición que el operador siga activo y sea superadmin/administracion',
        (select (p.prosrc like '%u.activo and u.rol::text in (''superadmin'', ''administracion'')%')::text from pg_proc p where p.oid = to_regprocedure('mant_priv.excepcion(text,text)')), 'true'),
  (10, 'EXECUTE para anon/authenticated/service_role SOLO en decidir, previo, filtro y sonda (4 × 3 = 12)',
        (select count(*)::text from fn, api where fn.oid is not null and has_function_privilege(api.rol, fn.oid, 'EXECUTE')), '12'),
  (11, 'esas 12 son exactamente las previstas',
        (select (count(*) = 12)::text from fn, api where fn.nombre in (select nombre from pub) and has_function_privilege(api.rol, fn.oid, 'EXECUTE')), 'true'),
  (12, 'mant_priv.config sin ningún privilegio para los roles de la API',
        (select (not bool_or(has_table_privilege(rol, 'mant_priv.config', 'SELECT') or has_table_privilege(rol, 'mant_priv.config', 'INSERT')
                 or has_table_privilege(rol, 'mant_priv.config', 'UPDATE') or has_table_privilege(rol, 'mant_priv.config', 'DELETE')))::text from api), 'true'),
  (13, 'mant_priv: USAGE para la API y sin CREATE',
        (select (bool_and(has_schema_privilege(rol, 'mant_priv', 'USAGE')) and not bool_or(has_schema_privilege(rol, 'mant_priv', 'CREATE')))::text from api), 'true'),
  (14, 'mant_priv no está expuesto por PostgREST (no figura en pgrst.db_schemas de authenticator)',
        (not exists (select 1 from pg_db_role_setting d, unnest(d.setconfig) s where d.setrole = (select oid from pg_roles where rolname = 'authenticator')
                       and s like 'pgrst.db_schemas=%' and s like '%mant_priv%'))::text, 'true'),
  (20, 'trigger mantenimiento_storage: habilitado, BEFORE, por fila, en INSERT/UPDATE/DELETE de storage.objects',
        (select (t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and (t.tgtype & 8) = 8 and (t.tgtype & 16) = 16
                 and t.tgfoid = to_regprocedure('mant_priv.tg_storage()'))::text
           from pg_trigger t where t.tgname = 'mantenimiento_storage' and t.tgrelid = 'storage.objects'::regclass), 'true'),
  (30, 'instalación con el mantenimiento APAGADO (fila única, activo = false, sin hash, sin operadores, sin jobs pausados)',
        (select (count(*) = 1 and bool_and(not activo and clave_sha256 is null and cardinality(operadores) = 0 and cardinality(cron_pausados) = 0 and previo_efectivo is null))::text from mant_priv.config), 'true'),
  (31, 'ningún pgrst.db_pre_request registrado apunta al filtro de mantenimiento (la instalación no lo activa)',
        (not exists (select 1 from pg_db_role_setting d, unnest(d.setconfig) s where s ilike 'pgrst.db_pre_request=%mantenimiento%'))::text, 'true')
),
r as (select orden, control, observado, esperado, case when observado = esperado then 'OK' else 'FALLA' end as estado from v)
select orden, control, observado, esperado, estado from r
union all
select 99, 'VEREDICTO', (select count(*) from r where estado = 'FALLA')::text || ' falla(s)', '0 fallas',
       case when (select count(*) from r where estado = 'FALLA') = 0 then 'CORRECTA' else 'REVISAR' end
order by orden;
