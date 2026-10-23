-- 228 · POSTCHECK (correr DESPUÉS de la migración). SOLO LECTURA (SELECT): devuelve conteos y sumas agregados, nunca filas de negocio.

-- Los conteos del POSTCHECK 2 deben coincidir con los del PREFLIGHT 5.

-- ▼ POSTCHECK 1 · objetos, atributos y permisos
select p.proname as funcion, p.prosecdef as security_definer,
       exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c = 'search_path=""') as search_path_vacio,
       has_function_privilege('anon', p.oid, 'execute') as anon_ejecuta,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_ejecuta,
       obj_description(p.oid, 'pg_proc') like '228 ·%' as marca_228
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('cxp_tolerancia', 'cxp_roles_contables', 'cxp_origen_peticion', 'cxp_rechazo_rls', 'trg_cxp_guarda_saldo_hija', 'trg_cxp_guarda_valor')
 order by p.proname;

select c.relname as tabla, t.tgname as trigger, t.tgenabled as habilitado
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where t.tgname in ('cxp_pagos_guarda_saldo', 'retenciones_cxp_guarda_saldo', 'cxp_guarda_valor')
 order by c.relname;

-- ▼ POSTCHECK 1B · R1: privilegios de anon sobre las tablas hijas (informativo; la defensa real es el
-- trigger). Debe documentarse el resultado: si anon tiene INSERT, el trigger es la única barrera.
select t.tabla,
       has_table_privilege('anon', t.tabla, 'INSERT') as anon_insert,
       has_table_privilege('anon', t.tabla, 'UPDATE') as anon_update,
       has_table_privilege('authenticated', t.tabla, 'INSERT') as authenticated_insert
  from (values ('public.cxp_pagos'), ('public.retenciones_cxp')) as t(tabla);

-- ▼ POSTCHECK 1C · R4: la lista de roles del trigger frente a las policies vivas. Una fila con
-- coincide = false indica que una policy cambió (o que el trigger quedó desfasado). Se revisan los
-- roles internos conocidos; ninguna fila debe salir con coincide = false.
select t.tabla, r.rol,
       r.rol = any (public.cxp_roles_contables(t.tabla)) as en_lista_del_trigger,
       exists (select 1 from pg_policies p
                where p.schemaname = 'public' and p.tablename = t.tabla and p.cmd in ('ALL', 'INSERT')
                  and coalesce(p.with_check, p.qual, '') like '%' || quote_literal(r.rol) || '%') as en_policy_de_insercion,
       (r.rol = any (public.cxp_roles_contables(t.tabla))) =
       exists (select 1 from pg_policies p
                where p.schemaname = 'public' and p.tablename = t.tabla and p.cmd in ('ALL', 'INSERT')
                  and coalesce(p.with_check, p.qual, '') like '%' || quote_literal(r.rol) || '%') as coincide
  from (values ('cxp_pagos'), ('retenciones_cxp')) as t(tabla)
  cross join (values ('superadmin'), ('gerencia'), ('administracion'), ('operaciones'), ('venta'),
                     ('agencia'), ('freelance'), ('cliente_final'), ('control_vuelo'), ('admin')) as r(rol)
 order by t.tabla, r.rol;

-- ▼ POSTCHECK 2 · los datos no cambiaron (comparar con PREFLIGHT 5 y con el control de sobreasignadas)
select (select count(*) from public.cuentas_por_pagar) as cxp,
       (select count(*) from public.cxp_pagos) as pagos,
       (select count(*) from public.retenciones_cxp) as retenciones;
