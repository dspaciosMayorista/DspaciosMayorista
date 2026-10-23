-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 193 · Registro y aprobación B2B endurecidos — SOLO LECTURA.
--
-- Correr en producción DESPUÉS de la migración 193. Es UNA sola consulta
-- SELECT sobre el catálogo: no crea, no modifica, no bloquea nada, y no
-- devuelve datos personales (ni correos, ni nombres, ni ids de usuario): solo
-- metadatos del esquema y CONTEOS.
--
-- Resultado: una fila por verificación (`ok` true/false + detalle) y una fila
-- final `RESUMEN`. Todo tiene que dar `ok = true`. Si algo da false, NO
-- desplegar el código de la 193 hasta entender por qué.
--
-- Los md5 de los cuerpos de función son los de la 193 tal como está en el
-- repositorio (sin retornos de carro). Si la 193 se edita, hay que
-- recalcularlos — supabase/scripts/pruebas/test_193_registro_b2b.sh lo
-- comprueba contra la migración real en una base local.
-- ───────────────────────────────────────────────────────────────────────────
with
fn as (
  select p.oid, p.proname,
         pg_get_function_identity_arguments(p.oid)  as args,
         pg_get_function_result(p.oid)               as resultado,
         p.prosecdef, p.proconfig, p.provolatile, p.pronargdefaults, p.pronargs, p.prorettype,
         l.lanname, r.rolname as owner, p.proowner,
         coalesce(p.proacl, acldefault('f', p.proowner)) as acl,
         md5(replace(p.prosrc, chr(13), ''))          as cuerpo_md5,
         p.prosrc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language  l on l.oid = p.prolang
    join pg_roles     r on r.oid = p.proowner
   where n.nspname = 'public'
     and p.proname in ('handle_new_user', 'aprobar_solicitud_b2b', 'rechazar_solicitud_b2b', 'mi_rol')
),
tablas as (
  select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relowner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('usuarios', 'b2b_solicitudes', 'aliados')
),
seq as (select pg_get_serial_sequence('public.b2b_solicitudes', 'id') as nombre),
trg as (
  select t.tgname, t.tgenabled, t.tgtype, t.tgfoid
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
),
-- Policies REALES de b2b_solicitudes y usuarios, con su forma completa.
-- El texto de USING/WITH CHECK lo arma Postgres según el search_path de la
-- sesión (`uid()` o `auth.uid()`, `rol_usuario` o `public.rol_usuario`): se
-- normaliza (minúsculas, sin espacios, sin prefijos public./auth./pg_catalog.)
-- para que el resultado no dependa de desde dónde se corra. Y para que quitar
-- prefijos no deje pasar una función homónima de OTRO esquema, se compara
-- además de qué funciones depende cada policy, POR OID (pg_depend).
pol as (
  select c.relname as tabla, p.polname, p.polcmd, p.polpermissive,
         p.polroles = array[0::oid] as solo_public,
         regexp_replace(lower(coalesce(pg_get_expr(p.polqual, p.polrelid), '<null>')),
                        '\s+|public\.|auth\.|pg_catalog\.', '', 'g') as using_norm,
         regexp_replace(lower(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '<null>')),
                        '\s+|public\.|auth\.|pg_catalog\.', '', 'g') as check_norm,
         array(select distinct d.refobjid from pg_depend d
                where d.classid = 'pg_policy'::regclass and d.objid = p.oid
                  and d.refclassid = 'pg_proc'::regclass
                order by 1) as funciones
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('b2b_solicitudes', 'usuarios')
),
-- Forma EXACTA esperada (polcmd: r = SELECT, * = ALL). Todas PERMISSIVE, rol
-- PUBLIC, sin WITH CHECK. Ninguna policy de más, ninguna de menos.
esperadas(tabla, polname, polcmd, using_norm, check_norm, funciones) as (
  values
  ('b2b_solicitudes', 'b2b_solicitudes: lectura admin', 'r'::"char",
   '(mi_rol()=any(array[''superadmin''::rol_usuario,''administracion''::rol_usuario,''gerencia''::rol_usuario]))',
   '<null>', array[to_regprocedure('public.mi_rol()')::oid]),
  ('usuarios', 'usuarios: superadmin gestiona', '*'::"char",
   '(mi_rol()=''superadmin''::rol_usuario)',
   '<null>', array[to_regprocedure('public.mi_rol()')::oid]),
  ('usuarios', 'usuarios: ver propio perfil', 'r'::"char",
   '((id=uid())or(mi_rol()=''superadmin''::rol_usuario))',
   '<null>', array(select x from unnest(array[to_regprocedure('public.mi_rol()')::oid,
                                              to_regprocedure('auth.uid()')::oid]) x order by 1))
),
-- Una fila por diferencia: policy que falta, policy de más, o policy con otra forma.
diferencias as (
  select coalesce(e.tabla, p.tabla) as tabla,
         coalesce(e.polname, p.polname) as polname,
         case
           when p.polname is null then 'falta'
           when e.polname is null then 'policy de más'
           when p.polcmd <> e.polcmd then 'comando distinto'
           when not p.polpermissive then 'no es PERMISSIVE'
           when not p.solo_public then 'roles distintos de PUBLIC'
           when p.using_norm <> e.using_norm then 'USING distinto'
           when p.check_norm <> e.check_norm then 'WITH CHECK distinto'
           when p.funciones <> e.funciones then 'depende de otras funciones'
         end as problema
    from esperadas e
    full join pol p on p.tabla = e.tabla and p.polname = e.polname
),
-- Privilegios EXPLÍCITOS de tabla (ACL) y de columna en b2b_solicitudes.
acl_tabla as (
  select coalesce(r.rolname, 'PUBLIC') as rol, a.privilege_type
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    left join pg_roles r on r.oid = a.grantee
   where c.oid = to_regclass('public.b2b_solicitudes')
),
acl_columna as (
  select coalesce(r.rolname, 'PUBLIC') as rol, at.attname, a.privilege_type
    from pg_attribute at
    cross join lateral aclexplode(at.attacl) a
    left join pg_roles r on r.oid = a.grantee
   where at.attrelid = to_regclass('public.b2b_solicitudes') and at.attnum > 0 and not at.attisdropped
),
-- Exige que el dueño de una función pueda operar sobre las tablas que toca sin
-- depender de la RLS: superusuario, BYPASSRLS, o dueño de esas tablas sin
-- FORCE ROW LEVEL SECURITY. (En Supabase todo lo crea `postgres`.)
duenos as (
  select f.proname,
         (rr.rolsuper or rr.rolbypassrls
          or not exists (select 1 from tablas t
                          where t.relowner <> f.proowner or t.relforcerowsecurity)) as opera_sin_rls,
         has_table_privilege(f.proowner, 'auth.users', 'SELECT') as lee_auth_users
    from fn f join pg_roles rr on rr.oid = f.proowner
   where f.proname in ('handle_new_user', 'aprobar_solicitud_b2b', 'rechazar_solicitud_b2b')
),
-- Conteo de cuentas con la bandera. La columna puede no existir (193 sin
-- aplicar): la consulta se arma solo si existe, para que el postcheck siempre
-- devuelva su tabla en vez de abortar. `query_to_xml` ejecuta un SELECT; no
-- escribe nada. Devuelve un número, nunca filas de usuarios.
legacy as (
  select (xpath('/row/c/text()',
                query_to_xml('select count(*) as c from public.usuarios where acceso_legacy_nombre is distinct from false',
                             false, true, '')))[1]::text::bigint as c
   where exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'usuarios' and column_name = 'acceso_legacy_nombre')
),
checks(n, verificacion, ok, detalle) as (
  -- ── Trigger de alta ────────────────────────────────────────────────────
  select 1, 'handle_new_user(): SECURITY DEFINER, search_path vacío, plpgsql, devuelve trigger, única',
         (select count(*) = 1 and bool_and(args = '' and prosecdef and proconfig = array['search_path=""']
                                           and lanname = 'plpgsql' and resultado = 'trigger')
            from fn where proname = 'handle_new_user'),
         (select coalesce(string_agg(format('args=%s secdef=%s config=%s lang=%s', args, prosecdef, proconfig, lanname), '; '), 'no existe')
            from fn where proname = 'handle_new_user')
  union all
  select 2, 'handle_new_user(): cuerpo idéntico al de la 193',
         (select bool_and(cuerpo_md5 = '730f8e26fca93bd343e97e153fe2ce95') from fn where proname = 'handle_new_user'),
         (select coalesce(string_agg(cuerpo_md5, ','), 'no existe') from fn where proname = 'handle_new_user')
  union all
  select 3, 'handle_new_user(): no conoce superadmin, no castea el rol de la metadata, crea perfiles inactivos',
         (select bool_and(prosrc not ilike '%superadmin%'
                          and prosrc not ilike '%->>''rol'')::%'
                          and prosrc ilike '%''cliente_final''%'
                          and prosrc ilike '%v_rol,%false%')
            from fn where proname = 'handle_new_user'),
         'revisión textual del cuerpo (complementa el md5)'
  union all
  select 4, 'auth.users: on_auth_user_created es AFTER INSERT FOR EACH ROW, habilitado, y llama a public.handle_new_user()',
         exists (select 1 from trg
                  where tgname = 'on_auth_user_created'
                    and tgenabled in ('O', 'A')
                    and tgfoid = to_regprocedure('public.handle_new_user()')
                    and (tgtype & 1) = 1      -- FOR EACH ROW
                    and (tgtype & 2) = 0      -- AFTER (no BEFORE)
                    and (tgtype & 64) = 0     -- no INSTEAD OF
                    and (tgtype & 4) = 4      -- INSERT
                    and (tgtype & (8 | 16 | 32)) = 0),
         (select coalesce(string_agg(format('%s enabled=%s tgtype=%s', tgname, tgenabled, tgtype), '; '), 'sin triggers') from trg)
  union all
  select 5, 'auth.users: ningún trigger propio en UPDATE (cambiar la metadata no toca el perfil)',
         not exists (select 1 from trg where (tgtype & 16) = 16),
         (select count(*)::text || ' trigger(s) de UPDATE' from trg where (tgtype & 16) = 16)
  -- ── Columna y decisión de backfill ─────────────────────────────────────
  union all
  select 6, 'usuarios.acceso_legacy_nombre: boolean, NOT NULL, default false',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'usuarios' and column_name = 'acceso_legacy_nombre'
                    and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'),
         (select coalesce(string_agg(format('%s nullable=%s default=%s', data_type, is_nullable, column_default), ''), 'no existe')
            from information_schema.columns
           where table_schema = 'public' and table_name = 'usuarios' and column_name = 'acceso_legacy_nombre')
  union all
  select 7, 'usuarios.acceso_legacy_nombre: ninguna cuenta la tiene (decisión: sin backfill)',
         coalesce((select c = 0 from legacy), false),
         coalesce((select c::text || ' cuenta(s) con la bandera' from legacy), 'la columna no existe')
  -- ── b2b_solicitudes: RLS, policy, privilegios ─────────────────────────
  union all
  select 8, 'b2b_solicitudes: RLS activada',
         coalesce((select relrowsecurity from tablas where relname = 'b2b_solicitudes'), false),
         'relrowsecurity'
  union all
  select 9, 'b2b_solicitudes: exactamente 1 policy — "lectura admin", SELECT, PERMISSIVE, PUBLIC, USING mi_rol() in (superadmin, administracion, gerencia), sin WITH CHECK',
         not exists (select 1 from diferencias where tabla = 'b2b_solicitudes' and problema is not null),
         coalesce((select string_agg(format('%s: %s', polname, problema), '; ' order by polname)
                     from diferencias where tabla = 'b2b_solicitudes' and problema is not null),
                  'forma exacta')
  union all
  select 10, 'b2b_solicitudes: anon y PUBLIC sin ningún privilegio de tabla (ni explícito ni efectivo)',
         not exists (select 1 from acl_tabla where rol in ('anon', 'PUBLIC'))
         and not (has_table_privilege('anon', 'public.b2b_solicitudes', 'SELECT')
              or has_table_privilege('anon', 'public.b2b_solicitudes', 'INSERT')
              or has_table_privilege('anon', 'public.b2b_solicitudes', 'UPDATE')
              or has_table_privilege('anon', 'public.b2b_solicitudes', 'DELETE')
              or has_table_privilege('anon', 'public.b2b_solicitudes', 'TRUNCATE')
              or has_table_privilege('anon', 'public.b2b_solicitudes', 'REFERENCES')
              or has_table_privilege('anon', 'public.b2b_solicitudes', 'TRIGGER')
              or (current_setting('server_version_num')::int >= 170000
                  and has_table_privilege('anon', 'public.b2b_solicitudes', 'MAINTAIN'))),
         coalesce((select string_agg(rol || ':' || privilege_type, ',' order by rol, privilege_type)
                     from acl_tabla where rol in ('anon', 'PUBLIC')), 'sin grants')
  union all
  select 11, 'b2b_solicitudes: authenticated EXACTAMENTE SELECT (sin INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN)',
         coalesce((select array_agg(privilege_type order by privilege_type) = array['SELECT']
                     from acl_tabla where rol = 'authenticated'), false)
         and has_table_privilege('authenticated', 'public.b2b_solicitudes', 'SELECT')
         and not (has_table_privilege('authenticated', 'public.b2b_solicitudes', 'INSERT')
                  or has_table_privilege('authenticated', 'public.b2b_solicitudes', 'UPDATE')
                  or has_table_privilege('authenticated', 'public.b2b_solicitudes', 'DELETE')
                  or has_table_privilege('authenticated', 'public.b2b_solicitudes', 'TRUNCATE')
                  or has_table_privilege('authenticated', 'public.b2b_solicitudes', 'REFERENCES')
                  or has_table_privilege('authenticated', 'public.b2b_solicitudes', 'TRIGGER')
                  or (current_setting('server_version_num')::int >= 170000
                      and has_table_privilege('authenticated', 'public.b2b_solicitudes', 'MAINTAIN'))),
         coalesce((select string_agg(privilege_type, ',' order by privilege_type)
                     from acl_tabla where rol = 'authenticated'), 'sin grants')
  union all
  select 12, 'b2b_solicitudes: service_role conserva SELECT e INSERT (lo usa el registro)',
         has_table_privilege('service_role', 'public.b2b_solicitudes', 'SELECT')
         and has_table_privilege('service_role', 'public.b2b_solicitudes', 'INSERT'),
         'has_table_privilege(service_role, ...)'
  union all
  select 13, 'secuencia de b2b_solicitudes.id: sin USAGE/SELECT/UPDATE para anon ni authenticated',
         (select nombre is not null
                 and not (has_sequence_privilege('anon', nombre, 'USAGE') or has_sequence_privilege('anon', nombre, 'SELECT')
                          or has_sequence_privilege('anon', nombre, 'UPDATE')
                          or has_sequence_privilege('authenticated', nombre, 'USAGE')
                          or has_sequence_privilege('authenticated', nombre, 'SELECT')
                          or has_sequence_privilege('authenticated', nombre, 'UPDATE'))
            from seq),
         (select coalesce(nombre, 'sin secuencia') from seq)
  -- ── RPC de aprobación ─────────────────────────────────────────────────
  union all
  select 14, 'aprobar_solicitud_b2b(p_id bigint, p_modo text, p_aliado_id bigint): única, SECURITY DEFINER, search_path vacío, plpgsql, VOLATILE, devuelve jsonb, 2 defaults',
         (select count(*) = 1 and bool_and(args = 'p_id bigint, p_modo text, p_aliado_id bigint' and prosecdef
                                           and proconfig = array['search_path=""'] and lanname = 'plpgsql'
                                           and provolatile = 'v' and resultado = 'jsonb' and pronargdefaults = 2)
            from fn where proname = 'aprobar_solicitud_b2b'),
         (select coalesce(string_agg(format('(%s) -> %s secdef=%s config=%s vol=%s defaults=%s', args, resultado, prosecdef, proconfig, provolatile, pronargdefaults), '; '), 'no existe')
            from fn where proname = 'aprobar_solicitud_b2b')
  union all
  select 15, 'aprobar_solicitud_b2b: cuerpo idéntico al de la 193',
         (select bool_and(cuerpo_md5 = 'a8845600c76adf4f068bdc2b21bb1869') from fn where proname = 'aprobar_solicitud_b2b'),
         (select coalesce(string_agg(cuerpo_md5, ','), 'no existe') from fn where proname = 'aprobar_solicitud_b2b')
  union all
  select 16, 'aprobar_solicitud_b2b: EXECUTE para authenticated; NO para PUBLIC ni anon',
         (select bool_and(
                   has_function_privilege('authenticated', oid, 'EXECUTE')
                   and not has_function_privilege('anon', oid, 'EXECUTE')
                   and not exists (select 1 from aclexplode(acl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
            from fn where proname = 'aprobar_solicitud_b2b'),
         (select coalesce(string_agg(acl::text, ''), 'no existe') from fn where proname = 'aprobar_solicitud_b2b')
  -- ── RPC de rechazo ────────────────────────────────────────────────────
  union all
  select 17, 'rechazar_solicitud_b2b(p_id bigint): única, SECURITY DEFINER, search_path vacío, plpgsql, VOLATILE, devuelve void',
         (select count(*) = 1 and bool_and(args = 'p_id bigint' and prosecdef and proconfig = array['search_path=""']
                                           and lanname = 'plpgsql' and provolatile = 'v' and resultado = 'void'
                                           and pronargdefaults = 0)
            from fn where proname = 'rechazar_solicitud_b2b'),
         (select coalesce(string_agg(format('(%s) -> %s secdef=%s config=%s vol=%s', args, resultado, prosecdef, proconfig, provolatile), '; '), 'no existe')
            from fn where proname = 'rechazar_solicitud_b2b')
  union all
  select 18, 'rechazar_solicitud_b2b: cuerpo idéntico al de la 193',
         (select bool_and(cuerpo_md5 = 'f53f68b5e9afd54f70eff94db1208142') from fn where proname = 'rechazar_solicitud_b2b'),
         (select coalesce(string_agg(cuerpo_md5, ','), 'no existe') from fn where proname = 'rechazar_solicitud_b2b')
  union all
  select 19, 'rechazar_solicitud_b2b: EXECUTE para authenticated; NO para PUBLIC ni anon',
         (select bool_and(
                   has_function_privilege('authenticated', oid, 'EXECUTE')
                   and not has_function_privilege('anon', oid, 'EXECUTE')
                   and not exists (select 1 from aclexplode(acl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
            from fn where proname = 'rechazar_solicitud_b2b'),
         (select coalesce(string_agg(acl::text, ''), 'no existe') from fn where proname = 'rechazar_solicitud_b2b')
  -- ── Dependencias que la 193 da por sentadas ───────────────────────────
  union all
  select 20, 'dueño de las 3 funciones: opera sin depender de RLS (superusuario, BYPASSRLS o dueño de las tablas sin FORCE RLS)',
         (select count(*) = 3 and bool_and(opera_sin_rls) from duenos),
         (select string_agg(format('%s opera_sin_rls=%s', proname, opera_sin_rls), '; ' order by proname) from duenos)
  union all
  select 21, 'dueño de aprobar_solicitud_b2b puede leer auth.users (compara el correo)',
         coalesce((select lee_auth_users from duenos where proname = 'aprobar_solicitud_b2b'), false),
         'has_table_privilege(dueño, auth.users, SELECT)'
  union all
  select 22, 'mi_rol(): idéntica a la migración 140 (sql, SECURITY DEFINER, STABLE, devuelve rol_usuario, cuerpo exacto con "and activo")',
         (select count(*) = 1
                 and bool_and(lanname = 'sql' and prosecdef and provolatile = 's' and proconfig is null
                              and pronargs = 0 and prorettype = to_regtype('public.rol_usuario')
                              -- El cuerpo EXACTO de la 140 (md5): un comentario o un
                              -- "or true" con la palabra "activo" no pasan.
                              and cuerpo_md5 = 'e25da39e1885be9a04fe8e28d6dab4b4')
            from fn where proname = 'mi_rol'),
         (select coalesce(string_agg(format('lang=%s secdef=%s vol=%s config=%s md5=%s', lanname, prosecdef, provolatile, proconfig, cuerpo_md5), '; '), 'no existe')
            from fn where proname = 'mi_rol')
  union all
  select 23, 'usuarios: RLS activa y EXACTAMENTE sus 2 policies de la 005 ("superadmin gestiona" ALL y "ver propio perfil" SELECT), sin policies extra',
         coalesce((select relrowsecurity from tablas where relname = 'usuarios'), false)
         and not exists (select 1 from diferencias where tabla = 'usuarios' and problema is not null),
         coalesce((select string_agg(format('%s: %s', polname, problema), '; ' order by polname)
                     from diferencias where tabla = 'usuarios' and problema is not null),
                  'forma exacta')
  union all
  select 24, 'b2b_solicitudes: sin privilegios por columna para anon, authenticated ni PUBLIC',
         not exists (select 1 from acl_columna where rol in ('anon', 'authenticated', 'PUBLIC')),
         coalesce((select string_agg(format('%s:%s(%s)', rol, privilege_type, attname), ',' order by rol, attname)
                     from acl_columna where rol in ('anon', 'authenticated', 'PUBLIC')), 'sin grants por columna')
)
select n, verificacion, coalesce(ok, false) as ok, detalle
  from checks
union all
select 99, 'RESUMEN', bool_and(coalesce(ok, false)),
       count(*) filter (where not coalesce(ok, false))::text || ' verificación(es) en falso de ' || count(*)::text
  from checks
 order by n;
