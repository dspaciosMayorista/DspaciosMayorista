-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 221 · Clientes de contratos en el CRM (#68). SOLO LECTURA (read only + ROLLBACK).
-- Correr DESPUÉS de aplicar la 221. Devuelve UNA sola fila consolidada (formato del postcheck de la 219):
--   veredicto   OK solo si las 15 verificaciones (C1-C15) dan true; si no, FALLA.
--   ok / fallos / chequeos   conteos (esperado: 15 / 0 / 15). Un resultado nulo cuenta como falla.
--   fallidos    códigos que fallaron, o 'ninguno'.
--   resumen     C1=t;C2=t;...;C15=t  (todas, en orden; t = pasa, f = falla).
--   detalle     jsonb con cada verificación: codigo, ok y su explicación.
-- C15 (ACL) es una lista blanca exhaustiva: acepta al dueño, a authenticated y a los roles ADMINISTRATIVOS postgres y
-- supabase_admin, porque Supabase les concede EXECUTE por privilegios por defecto (no son roles de la API); cualquier otro
-- beneficiario (PUBLIC, anon, service_role u otro rol) la hace fallar y el detalle lo nombra. Exige además EXECUTE de authenticated.
-- No lee datos personales: solo catálogo (firmas, atributos, ACL y texto de las funciones).
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
lista as (select p.* from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.crm_contratos_clientes_buscar(text,text,text,integer)')),
ficha as (select p.* from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.crm_contrato_cliente_ficha(text)')),
ambas as (select * from lista union all select * from ficha),
cuerpos as (
  -- Texto de cada función sin comentarios de línea (los comentarios pueden nombrar lo que el código NO usa).
  select a.oid, a.proname, regexp_replace(a.prosrc, '--[^\n]*', '', 'g') as src from ambas a
),
cols_ficha(texto) as (
  values ('numero_contrato text, fecha_venta date, cliente text, cliente_documento text, cliente_email text, cliente_telefono text, destino text, fecha_salida date, fecha_regreso date, estado text, tipo_asesor text, agencia_nombre text, freelance_nombre text, tenant text')
),
chequeos(codigo, ok, detalle) as (
  select 'C1', (select count(*) from ambas) = 2,
         'Existen las dos funciones con su firma exacta (esperado 2)'
  union all
  select 'C2', (select count(*) from ambas) = 2 and (select bool_and(prosecdef) from ambas),
         'Las dos son SECURITY DEFINER'
  union all
  select 'C3', (select count(*) from ambas) = 2 and (select bool_and(provolatile = 's') from ambas)
               and (select bool_and(l.lanname = 'plpgsql') from ambas a join pg_catalog.pg_language l on l.oid = a.prolang),
         'Las dos son STABLE (solo lectura) y plpgsql'
  union all
  select 'C4', (select count(*) from ambas where proconfig @> array['search_path=pg_catalog, pg_temp']) = 2,
         'search_path fijo = pg_catalog, pg_temp en las dos'
  union all
  select 'C5', (select count(*) from ambas) = 2
               and not exists (select 1 from ambas a where pg_get_userbyid(a.proowner) in ('anon', 'authenticated', 'service_role', 'authenticator'))
               and not exists (select 1 from ambas a where not has_table_privilege(a.proowner, to_regclass('public.ventas_basica'), 'select')),
         'Dueño que no es un rol de la API y puede leer ventas_basica'
  union all
  select 'C6', (select count(*) from ambas) = 2
               and (select bool_and(has_function_privilege('authenticated', a.oid, 'execute')) from ambas a)
               and not exists (select 1 from ambas a where has_function_privilege('anon', a.oid, 'execute'))
               and not exists (select 1 from ambas a where has_function_privilege('service_role', a.oid, 'execute')),
         'EXECUTE: authenticated sí; anon y service_role no (ni por PUBLIC)'
  union all
  select 'C7', (select pg_get_function_result(oid) from lista) = 'TABLE(' || (select texto from cols_ficha) || ', hay_mas boolean)',
         'La lista devuelve exactamente las 14 columnas del contrato más hay_mas (sin precio, dirección, firma ni share_token)'
  union all
  select 'C8', (select pg_get_function_result(oid) from ficha) = 'TABLE(' || (select texto from cols_ficha) || ')',
         'La ficha devuelve exactamente las 14 columnas del contrato'
  union all
  select 'C9', (select pg_get_function_arguments(oid) from lista) =
                 'p_tenant text DEFAULT NULL::text, p_busqueda text DEFAULT NULL::text, p_cursor text DEFAULT NULL::text, p_tam integer DEFAULT 50'
               and (select pg_get_function_arguments(oid) from ficha) = 'p_numero_contrato text'
               and (select pronargs from ficha) = 1,
         'Argumentos exactos; la ficha NO recibe tenant ni usuario'
  union all
  select 'C10', (select count(*) from cuerpos) = 2
                 and not exists (select 1 from cuerpos c where c.src !~ 'auth\.uid\(\)' or c.src !~ 'u\.activo is true' or c.src !~ 'public\.usuarios u')
                 and not exists (select 1 from cuerpos c where c.src ~ 'mi_tenant|puede_ver_tenant|mi_rol'),
         'El actor sale de auth.uid() y de la fila ACTIVA de usuarios; ni mi_tenant() ni puede_ver_tenant() ni mi_rol() como autoridad'
  union all
  select 'C11', (select count(*) from cuerpos) = 2
                 and not exists (select 1 from cuerpos c where c.src !~ 'public\.ventas_basica')
                 and not exists (select 1 from cuerpos c where c.src ~ 'public\.ventas[^_a-z]')
                 and not exists (select 1 from cuerpos c where c.src ~* 'crm_contactos')
                 and not exists (select 1 from cuerpos c where c.src ~* '\m(insert|update|delete|truncate)\M'),
         'Lee solo la vista ventas_basica: ni la tabla base, ni crm_contactos, ni escritura alguna'
  union all
  select 'C12', (select count(*) from cuerpos) = 2
                 and not exists (select 1 from cuerpos c
                                  where c.src !~ 'soy_asesor_del_contrato' or c.src !~ 'u2\.activo is true'
                                     or c.src !~ 'u2\.tenant' or c.src !~ '\) = 1'),
         'Guarda de venta: contrato propio Y asesor equivalente a UN solo usuario activo del tenant (homónimos ocultos)'
  union all
  select 'C13', (select count(*) from cuerpos where proname = 'crm_contratos_clientes_buscar' and src ~ 'p_tenant <> v_tenant_u') = 1
                 and (select count(*) from cuerpos where proname = 'crm_contratos_clientes_buscar' and src ~ 'v_rol = ''superadmin''') = 1,
         'p_tenant solo lo elige el superadmin; para el resto, un tenant distinto del propio da vacío'
  union all
  select 'C14', to_regclass('public.ventas_basica') is not null
                 and to_regprocedure('public.soy_asesor_del_contrato(text)') is not null
                 and (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure('public.soy_asesor_del_contrato(text)')),
         'La vista y los helpers que usa la 221 siguen presentes y sin cambios de tipo (soy_asesor_del_contrato sigue SECURITY DEFINER)'
  union all
  select 'C15', (select count(*) from ambas) = 2
                 and (select bool_and(has_function_privilege('authenticated', a.oid, 'execute')) from ambas a)
                 and not exists (select 1
                                   from ambas a
                                  cross join lateral aclexplode(coalesce(a.proacl, acldefault('f', a.proowner))) x
                                  where x.grantee <> a.proowner
                                    and x.grantee not in (select r.oid from pg_catalog.pg_roles r where r.rolname in ('authenticated', 'postgres', 'supabase_admin'))),
         'ACL exacta (lista blanca): authenticated con EXECUTE en las dos funciones y, como beneficiarios, solo el dueño, authenticated y los roles administrativos postgres y supabase_admin. Beneficiarios que sobran: '
         || coalesce((select string_agg(a.proname || ' -> ' || coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ', ' order by a.proname, r.rolname)
                        from ambas a
                       cross join lateral aclexplode(coalesce(a.proacl, acldefault('f', a.proowner))) x
                        left join pg_catalog.pg_roles r on r.oid = x.grantee
                       where x.grantee <> a.proowner
                         and x.grantee not in (select r3.oid from pg_catalog.pg_roles r3 where r3.rolname in ('authenticated', 'postgres', 'supabase_admin'))), 'ninguno')
         || '. Dueño: ' || coalesce((select string_agg(distinct pg_catalog.pg_get_userbyid(a.proowner), ',') from ambas a), '?')
),
orden as (
  select c.codigo, coalesce(c.ok, false) as ok, c.detalle, row_number() over (order by length(c.codigo), c.codigo) as n
    from chequeos c
)
select case when count(*) = 15 and count(*) filter (where not o.ok) = 0 then 'OK' else 'FALLA' end as veredicto,
       count(*) filter (where o.ok)::int as ok,
       count(*) filter (where not o.ok)::int as fallos,
       count(*)::int as chequeos,
       coalesce(string_agg(o.codigo, ',' order by o.n) filter (where not o.ok), 'ninguno') as fallidos,
       string_agg(o.codigo || '=' || case when o.ok then 't' else 'f' end, ';' order by o.n) as resumen,
       jsonb_agg(jsonb_build_object('codigo', o.codigo, 'ok', o.ok, 'detalle', o.detalle) order by o.n) as detalle
  from orden o;

rollback;
