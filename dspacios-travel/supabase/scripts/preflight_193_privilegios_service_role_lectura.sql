-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 193 · PRIVILEGIOS DE service_role — SOLO LECTURA.
--
-- Correr en Producción ANTES de la 193. Una sola consulta SELECT sobre el
-- catálogo: no crea, no cambia permisos, no devuelve datos personales.
--
-- Por qué: la verificación 12 del postcheck exige que `service_role` tenga
-- SELECT e INSERT en `b2b_solicitudes` (el registro inserta con el cliente
-- service-role). La 193 NO concede esos permisos: los presupone. Y además
-- revoca todo a PUBLIC en la tabla y en su secuencia, así que si hoy
-- `service_role` solo los tuviera A TRAVÉS de PUBLIC, la 193 se los quitaría.
--
-- Columnas:
--   efectivo_hoy      → has_*_privilege('service_role', …) tal como está hoy.
--   via_public        → hay un grant a PUBLIC con ese privilegio (lo retira la
--                       193 en b2b_solicitudes y su secuencia).
--   propio            → grant explícito a service_role o a un rol que
--                       service_role hereda (no cuenta PUBLIC).
--   efectivo_tras_193 → lo que quedará: `propio` en b2b_solicitudes/secuencia
--                       (la 193 quita PUBLIC); `efectivo_hoy` en el resto (la
--                       193 no toca esas tablas).
--   ok                → efectivo_tras_193 = true.
-- Las filas "contexto" son tablas que el código de la 193 usa con service-role
-- (registro, portal, documentos); no las toca la 193, pero si faltan, ese
-- código ya falla hoy.
-- ───────────────────────────────────────────────────────────────────────────
with
sr as (select oid, rolsuper, rolbypassrls, rolinherit from pg_roles where rolname = 'service_role'),
objetivos(orden, alcance, objeto, tipo, privilegio, quita_public_la_193) as (
  values
  (1,  'b2b_solicitudes', 'public.b2b_solicitudes', 'tabla', 'SELECT', true),
  (2,  'b2b_solicitudes', 'public.b2b_solicitudes', 'tabla', 'INSERT', true),
  (3,  'b2b_solicitudes', coalesce(pg_get_serial_sequence('public.b2b_solicitudes', 'id'), 'public.b2b_solicitudes_id_seq'), 'secuencia', 'USAGE', true),
  (10, 'contexto',        'public.usuarios',    'tabla', 'SELECT', false),
  (11, 'contexto',        'public.usuarios',    'tabla', 'UPDATE', false),
  (12, 'contexto',        'public.usuarios',    'tabla', 'INSERT', false),
  (13, 'contexto',        'public.aliados',     'tabla', 'SELECT', false),
  (14, 'contexto',        'public.ventas',      'tabla', 'SELECT', false),
  (15, 'contexto',        'public.aliados_b2b', 'tabla', 'SELECT', false),
  (16, 'contexto',        'public.abonos',      'tabla', 'SELECT', false),
  (17, 'contexto',        'public.cuotas',      'tabla', 'SELECT', false)
),
eval as (
  select o.*,
         c.oid as relid,
         coalesce(c.relacl, acldefault(case when o.tipo = 'secuencia' then 's'::"char" else 'r'::"char" end, c.relowner)) as acl
    from objetivos o
    left join pg_class c on c.oid = to_regclass(o.objeto)
),
res as (
  select e.orden, e.alcance, e.objeto, e.privilegio, e.quita_public_la_193,
         e.relid is not null as existe,
         case when e.relid is null then null
              when e.tipo = 'secuencia' then has_sequence_privilege('service_role', e.relid, e.privilegio)
              else has_table_privilege('service_role', e.relid, e.privilegio) end as efectivo_hoy,
         exists (select 1 from aclexplode(e.acl) a
                  where a.grantee = 0 and a.privilege_type = e.privilegio) as via_public,
         exists (select 1 from aclexplode(e.acl) a, sr
                  where a.grantee <> 0 and a.privilege_type = e.privilegio
                    and pg_has_role(sr.oid, a.grantee, 'USAGE')) as propio
    from eval e
)
select orden, alcance, objeto, privilegio, existe, efectivo_hoy, via_public, propio,
       case when quita_public_la_193 then propio else efectivo_hoy end as efectivo_tras_193,
       coalesce(case when quita_public_la_193 then propio else efectivo_hoy end, false) as ok
  from res
union all
select 90, 'rol', 'service_role', 'atributos', (select count(*) = 1 from sr), null, null, null, null,
       coalesce((select rolbypassrls and rolinherit from sr), false)
union all
select 99, 'RESUMEN', 'b2b_solicitudes + secuencia (bloquea la 193)', '',
       null, null, null, null, null,
       coalesce((select bool_and(case when quita_public_la_193 then propio else efectivo_hoy end)
                   from res where alcance = 'b2b_solicitudes'), false)
order by orden;
