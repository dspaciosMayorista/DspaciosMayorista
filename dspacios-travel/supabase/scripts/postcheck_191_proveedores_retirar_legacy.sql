-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK de la migración 191 — SOLO LECTURA.
-- Ejecutar cada SELECT por separado en el editor SQL de Supabase DESPUÉS de
-- 191. Nunca devuelve valores sensibles.
--
-- Resultado esperado:
--   Q1  todo true.
--   Q2  exactamente 4 filas: lectura catalogo (SELECT) + las 3 de escritura
--       de la 189, sin cambios en su texto.
--   Q3  las 4 policies de la tabla sensible, idénticas a la 189; RLS activa.
--   Q4  todo false salvo rpc_authenticated = true.
--   Q5  sin_fila_sensible = 0.
--   Q6  3 triggers habilitados.
--   Q7  0.
--   Q8  mismos valores que P10 del preflight (si nadie guardó en medio).
--   Q9  0. OJO: es solo una busqueda de nombres de rol; NO demuestra por si
--       sola que no haya acceso externo (un USING (true) no nombra roles).
--   Q10 cero filas. Detecta la forma peligrosa sin depender de nombres de rol.
--       La comparacion EXACTA de la forma de las 8 policies la hace la propia
--       migracion 191 al aplicarse (aborta si no coincide).
-- ───────────────────────────────────────────────────────────────────────────

-- Q1. Estructura.
select not exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'proveedores'
           and column_name in ('nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
                               'numero_cuenta', 'politica_reservas', 'voucher_contacto')) as sin_columnas_legacy,
       (select count(*) = 8 from information_schema.columns
        where table_schema = 'public' and table_name = 'proveedores_datos_sensibles'
          and column_name in ('nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
                              'numero_cuenta', 'politica_reservas', 'voucher_contacto')) as tabla_sensible_completa,
       to_regprocedure('public.sincronizar_proveedor_sensible_legacy()') is null as sin_funcion_legacy,
       not exists (select 1 from pg_trigger where tgrelid = 'public.proveedores'::regclass
                   and tgname like 'proveedores_sensibles_legacy%') as sin_triggers_legacy,
       not (select prosecdef from pg_proc
            where oid = 'public.guardar_proveedor(jsonb, bigint)'::regprocedure) as rpc_security_invoker,
       (select proconfig from pg_proc
        where oid = 'public.guardar_proveedor(jsonb, bigint)'::regprocedure) = array['search_path=""'] as rpc_search_path_vacio,
       (select prosrc ~ 'insert into public\.proveedores_datos_sensibles'
        from pg_proc where oid = 'public.guardar_proveedor(jsonb, bigint)'::regprocedure) as rpc_escribe_tabla_sensible,
       (select prosrc !~* 'datos_pago\s*='
        from pg_proc where oid = 'public.guardar_proveedor(jsonb, bigint)'::regprocedure) as rpc_no_asigna_datos_pago;

-- Q2. Policies del catálogo: una sola de lectura, sin FOR ALL.
select policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'proveedores'
order by policyname;

-- Q3. Tabla sensible: RLS y policies intactas.
select (select relrowsecurity from pg_class
        where oid = 'public.proveedores_datos_sensibles'::regclass) as rls_activa;
select policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'proveedores_datos_sensibles'
order by policyname;

-- Q4. Privilegios.
select has_table_privilege('anon', 'public.proveedores', 'TRUNCATE') as proveedores_truncate_anon,
       has_table_privilege('authenticated', 'public.proveedores', 'TRUNCATE') as proveedores_truncate_authenticated,
       has_table_privilege('anon', 'public.proveedores_datos_sensibles', 'TRUNCATE') as sensible_truncate_anon,
       has_table_privilege('authenticated', 'public.proveedores_datos_sensibles', 'TRUNCATE') as sensible_truncate_authenticated,
       has_function_privilege('anon', 'public.guardar_proveedor(jsonb, bigint)', 'EXECUTE') as rpc_anon,
       has_function_privilege('authenticated', 'public.guardar_proveedor(jsonb, bigint)', 'EXECUTE') as rpc_authenticated;

-- Q5. Cada proveedor sigue con su fila sensible de Mayorista.
select count(*) filter (where s.proveedor_id is null) as sin_fila_sensible,
       count(*) as proveedores
from public.proveedores p
left join public.proveedores_datos_sensibles s
  on s.proveedor_id = p.id and s.tenant = 'mayorista';

-- Q6. Auditoría y redacción en su sitio.
select t.tgrelid::regclass as tabla, t.tgname as trigger, t.tgenabled as habilitado
from pg_trigger t
where (t.tgrelid = 'public.proveedores'::regclass and t.tgname = 'trg_auditoria')
   or (t.tgrelid = 'public.proveedores_datos_sensibles'::regclass and t.tgname = 'trg_auditoria')
   or (t.tgrelid = 'public.auditoria'::regclass and t.tgname = 'auditoria_proveedores_redactar')
order by 1, 2;

-- Q7. Ningún evento de auditoría de proveedores conserva valores sensibles.
select count(*) as eventos_con_valores_sensibles
from public.auditoria a
where a.tabla in ('proveedores', 'proveedores_datos_sensibles')
  and (
    coalesce(a.antes, '{}'::jsonb) ?| array['nit', 'razon_social', 'datos_pago', 'banco',
      'tipo_cuenta', 'numero_cuenta', 'politica_reservas', 'voucher_contacto']
    or coalesce(a.despues, '{}'::jsonb) ?| array['nit', 'razon_social', 'datos_pago', 'banco',
      'tipo_cuenta', 'numero_cuenta', 'politica_reservas', 'voucher_contacto']
    or exists (
      select 1 from jsonb_each(coalesce(a.cambios, '{}'::jsonb)) as c(k, v)
      where c.k in ('nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
                    'numero_cuenta', 'politica_reservas', 'voucher_contacto')
        and c.v <> '{"antes":"[REDACTADO]","despues":"[REDACTADO]"}'::jsonb)
  );

-- Q8. Huella de la tabla sensible (comparar con P10 del preflight).
select count(*) as filas_sensibles,
       md5(string_agg(row(s.*)::text, '|' order by s.proveedor_id, s.tenant)) as huella_tabla_sensible
from public.proveedores_datos_sensibles s;

-- Q9. Busqueda de nombres de roles externos en las lecturas. Complementaria:
-- no detecta una policy que conceda acceso sin nombrar roles (ver Q10).
select count(*) as lecturas_con_roles_externos
from pg_policies
where schemaname = 'public'
  and tablename in ('proveedores', 'proveedores_datos_sensibles')
  and cmd in ('SELECT', 'ALL')
  and coalesce(qual, '') ~ '(agencia|freelance|cliente_final)';

-- Q10. Forma de las policies sin mirar nombres de rol: cualquier fila es una
-- alarma. Solo deben existir las 8 esperadas, todas PERMISSIVE, solo para
-- authenticated, y ninguna con USING/WITH CHECK trivial (true) o ausente
-- donde el comando lo usa.
select p.tablename, p.policyname, p.cmd, p.permissive, p.roles,
       case
         when p.policyname not in (
           'proveedores: lectura catalogo', 'proveedores: insertar mayorista',
           'proveedores: actualizar mayorista', 'proveedores: borrar mayorista',
           'proveedores sensibles: lectura autorizada', 'proveedores sensibles: insertar mayorista',
           'proveedores sensibles: actualizar mayorista', 'proveedores sensibles: borrar mayorista')
           then 'policy no esperada'
         when p.permissive <> 'PERMISSIVE' then 'restrictiva no esperada'
         when p.roles <> array['authenticated']::name[] then 'roles distintos de authenticated'
         when p.cmd in ('SELECT', 'UPDATE', 'DELETE', 'ALL')
              and (p.qual is null or btrim(p.qual, ' ()') = 'true') then 'USING trivial o ausente'
         when p.cmd in ('INSERT', 'UPDATE', 'ALL')
              and (p.with_check is null or btrim(p.with_check, ' ()') = 'true') then 'WITH CHECK trivial o ausente'
       end as alarma
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('proveedores', 'proveedores_datos_sensibles')
  and (
    p.policyname not in (
      'proveedores: lectura catalogo', 'proveedores: insertar mayorista',
      'proveedores: actualizar mayorista', 'proveedores: borrar mayorista',
      'proveedores sensibles: lectura autorizada', 'proveedores sensibles: insertar mayorista',
      'proveedores sensibles: actualizar mayorista', 'proveedores sensibles: borrar mayorista')
    or p.permissive <> 'PERMISSIVE'
    or p.roles <> array['authenticated']::name[]
    or (p.cmd in ('SELECT', 'UPDATE', 'DELETE', 'ALL') and (p.qual is null or btrim(p.qual, ' ()') = 'true'))
    or (p.cmd in ('INSERT', 'UPDATE', 'ALL') and (p.with_check is null or btrim(p.with_check, ' ()') = 'true'))
  )
order by p.tablename, p.policyname;
