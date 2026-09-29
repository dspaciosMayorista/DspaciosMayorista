-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la migración 191 — SOLO LECTURA.
-- Ejecutar cada SELECT por separado en el editor SQL de Supabase ANTES de 191
-- y compartir los resultados. Nunca devuelve valores sensibles: solo conteos,
-- nombres de objetos y una huella (md5) para comparar con el postcheck.
--
-- Resultado esperado para poder aplicar 191:
--   P1  todo true.            P5  cero filas.
--   P2  0 y 0.                P6  cero filas.
--   P3  dos triggers legacy + trg_auditoria, sin otros.
--   P4  las 4 policies de la 189 (lectura transitoria + 3 de escritura).
--   P7  tabla_sensible_truncate = false (proveedores_truncate es informativo).
--   P8  sin sesiones con locks sobre proveedores (elegir otra ventana si hay).
--   P9  solo informativo.     P9b 0.
-- ───────────────────────────────────────────────────────────────────────────

-- P1. Estado previo: 189 y 190 aplicadas; 191 todavía no.
select to_regclass('public.proveedores_datos_sensibles') is not null as existe_tabla_sensible,
       to_regprocedure('public.guardar_proveedor(jsonb, bigint)') is not null as existe_rpc,
       not (select prosecdef from pg_proc
            where oid = 'public.guardar_proveedor(jsonb, bigint)'::regprocedure) as rpc_security_invoker,
       to_regprocedure('public.sincronizar_proveedor_sensible_legacy()') is not null as existe_sync_legacy,
       (select count(*) = 8 from information_schema.columns
        where table_schema = 'public' and table_name = 'proveedores'
          and column_name in ('nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
                              'numero_cuenta', 'politica_reservas', 'voucher_contacto')) as columnas_legacy_presentes,
       not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'proveedores' and policyname = 'proveedores: lectura catalogo') as policy_191_ausente;

-- P2. Paridad fila a fila. La 191 aborta si alguno es > 0.
select count(*) filter (where s.proveedor_id is null) as sin_fila_sensible,
       count(*) filter (
         where s.proveedor_id is not null
           and row(p.nit, p.razon_social, p.datos_pago, p.banco,
                   p.tipo_cuenta, p.numero_cuenta, p.politica_reservas,
                   p.voucher_contacto)
               is distinct from
               row(s.nit, s.razon_social, s.datos_pago, s.banco,
                   s.tipo_cuenta, s.numero_cuenta, s.politica_reservas,
                   s.voucher_contacto)) as con_valores_distintos,
       count(*) as proveedores,
       count(*) filter (where s.datos_pago is not null) as con_datos_pago
from public.proveedores p
left join public.proveedores_datos_sensibles s
  on s.proveedor_id = p.id and s.tenant = 'mayorista';

-- P3. Triggers sobre proveedores. Uno distinto de los tres esperados que lea
-- columnas antiguas rompería al retirarlas.
select tgname as trigger, tgenabled as habilitado, pg_get_triggerdef(oid) as definicion
from pg_trigger
where tgrelid = 'public.proveedores'::regclass and not tgisinternal
order by tgname;

-- P4. Policies actuales del catálogo.
select policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'proveedores'
order by policyname;

-- P5. Cualquier objeto que dependa de las ocho columnas (vistas, índices,
-- restricciones, policies, triggers por columna...). Solo deben aparecer los
-- dos triggers legacy; cualquier otro hace fallar la 191 (va sin CASCADE).
select d.classid::regclass as catalogo,
       coalesce(
         (select 'vista ' || r.ev_class::regclass::text from pg_rewrite r where d.classid = 'pg_rewrite'::regclass and r.oid = d.objid),
         (select 'trigger ' || t.tgname from pg_trigger t where d.classid = 'pg_trigger'::regclass and t.oid = d.objid),
         (select 'policy ' || pol.polname from pg_policy pol where d.classid = 'pg_policy'::regclass and pol.oid = d.objid),
         (select 'restriccion ' || c.conname from pg_constraint c where d.classid = 'pg_constraint'::regclass and c.oid = d.objid),
         (select 'relacion ' || cl.oid::regclass::text from pg_class cl where d.classid = 'pg_class'::regclass and cl.oid = d.objid),
         d.objid::text
       ) as objeto,
       a.attname as columna,
       d.deptype
from pg_depend d
join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
where d.refobjid = 'public.proveedores'::regclass
  and a.attname in ('nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
                    'numero_cuenta', 'politica_reservas', 'voucher_contacto')
  and not exists (
    select 1 from pg_trigger t
    where d.classid = 'pg_trigger'::regclass and t.oid = d.objid
      and t.tgname = 'proveedores_sensibles_legacy_update')
order by objeto, columna;

-- P6. Funciones cuyo cuerpo menciona proveedores y alguna columna antigua.
-- Los cuerpos PL/pgSQL no generan dependencias: si una lee p.nit, fallará en
-- tiempo de ejecución, no al migrar. Solo deben quedar fuera las conocidas.
select p.oid::regprocedure as funcion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and p.prosrc ~* '\mproveedores\M'
  and p.prosrc ~* '\m(nit|razon_social|datos_pago|banco|tipo_cuenta|numero_cuenta|politica_reservas|voucher_contacto)\M'
  and p.oid not in (
    'public.guardar_proveedor(jsonb, bigint)'::regprocedure,
    'public.sincronizar_proveedor_sensible_legacy()'::regprocedure,
    'public.redactar_auditoria_proveedor()'::regprocedure)
order by 1;

-- P7. Privilegios. TRUNCATE en la tabla sensible debe seguir en false (lo
-- exige la 191); el de proveedores es informativo: la 191 lo revoca.
select has_table_privilege('anon', 'public.proveedores', 'TRUNCATE') as proveedores_truncate_anon,
       has_table_privilege('authenticated', 'public.proveedores', 'TRUNCATE') as proveedores_truncate_authenticated,
       has_table_privilege('anon', 'public.proveedores_datos_sensibles', 'TRUNCATE')
         or has_table_privilege('authenticated', 'public.proveedores_datos_sensibles', 'TRUNCATE') as tabla_sensible_truncate,
       has_function_privilege('anon', 'public.guardar_proveedor(jsonb, bigint)', 'EXECUTE') as rpc_anon,
       has_function_privilege('authenticated', 'public.guardar_proveedor(jsonb, bigint)', 'EXECUTE') as rpc_authenticated;

-- P8. Sesiones con locks sobre el catálogo ahora mismo (la 191 espera como
-- máximo 5 s y aborta).
select l.pid, l.mode, l.granted, a.state, now() - a.xact_start as en_transaccion_desde
from pg_locks l
join pg_stat_activity a on a.pid = l.pid
where l.relation in ('public.proveedores'::regclass, 'public.proveedores_datos_sensibles'::regclass)
  and l.pid <> pg_backend_pid();

-- P9. Quién GANA lectura del catálogo base con la 191 (hoy no la tiene): solo
-- personal interno de Minorista. Ningún rol externo gana acceso.
-- Solo cuenta usuarios; no lista nombres ni correos.
select u.rol, u.tenant, count(*) as usuarios_activos
from public.usuarios u
where u.activo
  and u.rol in ('administracion', 'operaciones', 'venta', 'control_vuelo')
  and u.tenant <> 'mayorista'
group by u.rol, u.tenant
order by u.rol, u.tenant;

-- P9b. Busqueda de nombres de roles externos en las lecturas actuales. Si da
-- > 0, algo distinto a la 189 les esta dando lectura: revisar P4. Es solo una
-- busqueda de nombres: un USING (true) no nombra roles y no aparece aqui; eso
-- lo revisa P4 a ojo y, de forma exacta, el guard de la propia 191 (aborta
-- si alguna policy no tiene la forma esperada).
select count(*) as lecturas_con_roles_externos
from pg_policies
where schemaname = 'public'
  and tablename in ('proveedores', 'proveedores_datos_sensibles')
  and cmd in ('SELECT', 'ALL')
  and coalesce(qual, '') ~ '(agencia|freelance|cliente_final)';

-- P10. Huella de la tabla sensible. Debe salir IGUAL en el postcheck (la 191
-- no la modifica), salvo que alguien guarde un proveedor en medio.
select count(*) as filas_sensibles,
       md5(string_agg(row(s.*)::text, '|' order by s.proveedor_id, s.tenant)) as huella_tabla_sensible
from public.proveedores_datos_sensibles s;
