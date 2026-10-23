-- ============================================================================
-- Postcheck 204 — Staging DIAN contable. SOLO LECTURA.
--
-- Ejecutar DESPUES de aplicar la migracion. No escribe nada.
-- Uso: psql $DATABASE_URL -v ON_ERROR_STOP=1 -f postcheck_204_staging_dian_lectura.sql
--
-- Salida esperada: todas las filas en OK. Un FALLA significa que la 204 quedo
-- a medias y hay que aplicar el rollback.
-- ============================================================================

\echo '=== POSTCHECK 204 (solo lectura) ==='

-- 1. Las 8 tablas existen.
\echo ''
\echo '--- 1. Las 8 tablas existen ---'
with esperadas(t) as (values
  ('lote_importacion_dian'), ('documento_dian_identidad'),
  ('documento_dian_staging'), ('documento_dian_linea_staging'),
  ('documento_dian_impuesto_staging'), ('documento_dian_retencion_staging'),
  ('documento_dian_forma_pago_staging'), ('documento_dian_resolucion'))
select e.t as tabla,
       case when exists (select 1 from information_schema.tables
                         where table_schema='public' and table_name=e.t)
            then 'OK' else 'FALLA  falta' end as existe
from esperadas e order by e.t;

-- 2. RLS activa y forzada en las 8.
\echo ''
\echo '--- 2. RLS activa ---'
select c.relname as tabla,
       case when c.relrowsecurity then 'OK    rls activa' else 'FALLA  rls OFF' end as rls,
       case when c.relforcerowsecurity then 'OK    forzada' else 'AVISO no forzada (el dueno la ignora)' end as forzada
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public'
  and c.relname in ('lote_importacion_dian','documento_dian_identidad',
                    'documento_dian_staging','documento_dian_linea_staging',
                    'documento_dian_impuesto_staging','documento_dian_retencion_staging',
                    'documento_dian_forma_pago_staging','documento_dian_resolucion')
order by c.relname;

-- 3. Privilegios: anon sin nada, authenticated sin delete ni truncate.
\echo ''
\echo '--- 3. Privilegios de la API ---'
select table_name as tabla,
       case when (select count(*) from information_schema.role_table_grants g
                  where g.table_schema='public' and g.table_name=t.table_name
                    and g.grantee='anon') = 0
            then 'OK    anon sin privilegios'
            else 'FALLA  anon tiene privilegios' end as anon,
       case when exists (select 1 from information_schema.role_table_grants g
                         where g.table_schema='public' and g.table_name=t.table_name
                           and g.grantee='authenticated'
                           and g.privilege_type in ('DELETE','TRUNCATE'))
            then 'FALLA  authenticated tiene DELETE/TRUNCATE'
            else 'OK    authenticated sin DELETE/TRUNCATE' end as authenticated,
       case when exists (select 1 from information_schema.role_table_grants g
                         where g.table_schema='public' and g.table_name=t.table_name
                           and g.grantee='service_role'
                           and g.privilege_type in ('DELETE','TRUNCATE'))
            then 'AVISO service_role tiene DELETE/TRUNCATE (el trigger es la ultima barrera)'
            else 'OK    service_role sin DELETE/TRUNCATE' end as service_role
from (values ('lote_importacion_dian'),('documento_dian_identidad'),
             ('documento_dian_staging'),('documento_dian_linea_staging'),
             ('documento_dian_impuesto_staging'),('documento_dian_retencion_staging'),
             ('documento_dian_forma_pago_staging'),('documento_dian_resolucion')
     ) as t(table_name) order by t.table_name;

-- 4. Las tablas hijas no admiten UPDATE desde la API.
\echo ''
\echo '--- 4. Detalle importado inmutable ---'
select c.relname as tabla,
       case when not exists (select 1 from pg_policy p
                             where p.polrelid = c.oid and p.polcmd = 'u')
            then 'OK    sin policy de UPDATE'
            else 'FALLA  tiene policy de UPDATE' end as update_policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public'
  and c.relname in ('documento_dian_linea_staging','documento_dian_impuesto_staging',
                    'documento_dian_retencion_staging','documento_dian_forma_pago_staging',
                    'documento_dian_identidad')
order by c.relname;

-- 5. indice de dedupe con el predicado correcto.
-- Se comprueba POR NOMBRE. Antes se iteraba sobre todos los indices unicos
-- de la tabla (incluida la PK) y cada uno salia como FALLA: eso reportaba
-- fallos donde no habia ninguno y escondia el indice que si importa.
\echo ''
\echo '--- 5. Indice de dedupe (§4.6) ---'
select 'uq_dian_staging_dedupe' as indice,
       case when exists (
         select 1 from pg_indexes
         where schemaname='public' and tablename='documento_dian_staging'
           and indexname='uq_dian_staging_dedupe'
           and indexdef ilike '%UNIQUE%'
           and indexdef ilike '%tenant, clave, total_declarado%'
           and indexdef ilike '%estado <>%duplicado%')
       then 'OK    unique (tenant, clave, total_declarado) WHERE estado <> duplicado'
       else 'FALLA  falta o no es el indice parcial de dedupe' end as estado;

-- 6. indice unico de identidad: el que serializa importadores simultaneos.
\echo ''
\echo '--- 6. Indice unico de identidad (§4.3) ---'
select 'uq_dian_identidad_clave' as indice,
       case when exists (
         select 1 from pg_indexes
         where schemaname='public' and tablename='documento_dian_identidad'
           and indexname='uq_dian_identidad_clave'
           and indexdef ilike '%UNIQUE%'
           and indexdef ilike '%tenant, clave%')
       then 'OK    unique (tenant, clave)'
       else 'FALLA  falta unique (tenant, clave)' end as estado;

-- 7. Que NO exista un indice unico por identidad en staging: haria imposible
-- guardar el discrepante (§4.6). Se excluyen la PK y el indice de dedupe, que
-- son legitimos.
\echo ''
\echo '--- 7. Ausencia del indice que bloquearia el discrepante ---'
select coalesce(string_agg(indexname, ', '), 'ninguno') as_indices_sospechosos,
       case when count(*) = 0 then 'OK    solo PK + dedupe'
            else 'FALLA  hay un indice unico que haria imposible el discrepante' end as estado
from pg_indexes
where schemaname='public' and tablename='documento_dian_staging'
  and indexdef ilike '%UNIQUE%'
  and indexname not in ('documento_dian_staging_pkey','uq_dian_staging_dedupe');

-- 8. Los 7 helpers dedicados existen y no se toco puede_ver_tenant.
\echo ''
\echo '--- 8. Helpers dedicados, y puede_ver_tenant intacto (§6.1) ---'
select p.proname as funcion,
       case when p.prosecdef then 'security definer' else 'FALLA  no es definer' end as modo,
       case when p.proconfig @> array['search_path=public'] then 'OK    search_path fijo'
            else 'AVISO sin search_path fijo' end as search_path
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'dian_staging_puede%'
order by p.proname;

-- El punto §6.1 es que `puede_ver_tenant` NO debe seguir viendo los roles
-- contables: si los vieran, la 204 habria ampliado el helper global.
select 'puede_ver_tenant' as funcion,
       case when pg_get_functiondef(p.oid) ilike '%contador%'
             or pg_get_functiondef(p.oid) ilike '%revisor_fiscal%'
             or pg_get_functiondef(p.oid) ilike '%admin_contable%'
            then 'FALLA  el helper global ve los roles contables: fue ampliado'
            when pg_get_functiondef(p.oid) ilike '%superadmin%'
             and pg_get_functiondef(p.oid) ilike '%gerencia%'
            then 'OK    intacto: solo superadmin/gerencia, como en la 107'
            else 'AVISO definicion inesperada, revisarla a mano' end as estado
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='puede_ver_tenant';

-- 9. Triggers de inmutabilidad presentes.
\echo ''
\echo '--- 9. Triggers append-only ---'
select c.relname as tabla, t.tgname as trigger,
       case when t.tgname ilike '%sin_borrar%' then 'sin DELETE'
            when t.tgname ilike '%sin_truncate%' then 'sin TRUNCATE'
            else 'inmutable' end as tipo
from pg_trigger t
join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal
  and c.relname in ('lote_importacion_dian','documento_dian_identidad',
                    'documento_dian_staging','documento_dian_resolucion')
order by c.relname, t.tgname;

-- 10. trg_auditoria en las 8: verificar, no suponer (§11.1).
\echo ''
\echo '--- 10. trg_auditoria presente en las 8 ---'
with esperadas(t) as (values
  ('lote_importacion_dian'), ('documento_dian_identidad'),
  ('documento_dian_staging'), ('documento_dian_linea_staging'),
  ('documento_dian_impuesto_staging'), ('documento_dian_retencion_staging'),
  ('documento_dian_forma_pago_staging'), ('documento_dian_resolucion'))
select e.t as tabla,
       case when exists (select 1 from pg_trigger tg
                         join pg_class c on c.oid=tg.tgrelid
                         where c.relname=e.t and tg.tgname='trg_auditoria')
            then 'OK    trg_auditoria puesta'
            else 'FALLA  sin trg_auditoria' end as estado
from esperadas e order by e.t;

-- 11. Ninguna policy de DELETE en ninguna de las 8.
\echo ''
\echo '--- 11. RLS no abierta: ninguna policy de DELETE ---'
select c.relname as tabla,
       case when not exists (select 1 from pg_policy p
                             where p.polrelid=c.oid and p.polcmd='d')
            then 'OK    sin policy de DELETE'
            else 'FALLA  tiene policy de DELETE' end as estado
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in ('lote_importacion_dian','documento_dian_identidad',
                    'documento_dian_staging','documento_dian_linea_staging',
                    'documento_dian_impuesto_staging','documento_dian_retencion_staging',
                    'documento_dian_forma_pago_staging','documento_dian_resolucion')
order by c.relname;

-- 12. Que la migracion no haya tocado el motor contable.
\echo ''
\echo '--- 12. El motor contable no fue tocado ---'
select 'asientos_contables' as tabla, count(*) as filas from public.asientos_contables
union all select 'asiento_lineas', count(*) from public.asiento_lineas
union all select 'cuentas_por_pagar', count(*) from public.cuentas_por_pagar
order by tabla;
\echo 'Estos conteos deben ser identicos a los del preflight. La 204 no escribe'
\echo 'en ninguna de las tres: no hay function ni trigger que lo haga.'

-- 13. D11: como se deduplicarian las notas del archivo real (§8.2).
\echo ''
\echo '--- 13. CUFE vs REF (D11): conteo sobre datos reales ---'
\echo 'Ejecutar DESPUES de la primera carga de prueba. Requiere que haya'
\echo 'documentos; con la tabla vacia el conteo es 0 y no dice nada.'
select tipo_documento,
       clave_base,
       count(*) as documentos
from public.documento_dian_staging
where tipo_documento in ('nota_credito','nota_debito')
group by tipo_documento, clave_base
order by tipo_documento, clave_base;
\echo 'Lectura: si las notas salen por REF: y no por cufecude, el CUDE no esta'
\echo 'llegando y el dedupe de notas no es confiable todavia (§8.2, D11).'

-- 14. Los tres roles contables quedaron en el enum.
\echo ''
\echo '--- 14. Roles contables en rol_usuario (D1) ---'
select r.valor,
       case when exists (select 1 from pg_enum e
                          join pg_type t on t.oid = e.enumtypid
                          where t.typname = 'rol_usuario' and e.enumlabel = r.valor)
            then 'OK' else 'FALLA  falta el valor' end as estado
from (values ('contador'), ('revisor_fiscal'), ('admin_contable')) r(valor);

-- 15. El gate de UPDATE tiene que existir: sin el, RLS no separa los actos y
-- las columnas del parser quedan editables.
\echo ''
\echo '--- 15. Gate de UPDATE: columnas congeladas + transicion + rol ---'
select case when exists (
  select 1 from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'documento_dian_staging'
    and t.tgname = 'dian_staging_update_gate' and not t.tgisinternal)
  then 'OK    dian_staging_update_gate puesto'
  else 'FALLA  sin gate de UPDATE: el contador podria aprobar y el parser seria editable' end as estado;

select case when exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'dian_staging_columnas_congeladas')
  then 'OK    la lista de columnas congeladas existe'
  else 'FALLA  no existe dian_staging_columnas_congeladas()' end as estado;

\echo ''
\echo '--- 15b. Las columnas criticas estan en la lista de congeladas ---'
with criticas(columna) as (values
  ('tenant'), ('clave'), ('clave_base'), ('total_declarado'), ('total_calculado'),
  ('lote_id'), ('documento_dian_identidad_id'), ('cufe'), ('cude'),
  ('tipo_documento'), ('tipo_documento_original'), ('fecha'), ('moneda'),
  ('subtotal'), ('impuestos_total'), ('retenciones_total'), ('xml_hash'),
  ('proveedor_nit'), ('proveedor_nombre'), ('duplicado_de'))
select c.columna,
       case when c.columna = any (public.dian_staging_columnas_congeladas())
            then 'OK' else 'FALLA  NO esta congelada' end as estado
from criticas c order by c.columna;

-- Las que SI deben poder cambiar: son la entrada de larevision.
\echo ''
\echo '--- 15c. Las columnas de revision NO estan congeladas ---'
with revisables(columna) as (values
  ('estado'), ('proveedor_id'), ('proveedor_cruce_estado'), ('cuenta_puc'),
  ('cuenta_puc_origen'), ('tipo_gasto'), ('periodo_asignado'),
  ('documento_relacionado_id'), ('motivo_pendiente'),
  ('preparado_por'), ('preparado_rol'), ('preparado_en'),
  ('aprobado_por'), ('aprobado_rol'), ('aprobado_en'),
  ('devuelto_por'), ('devuelto_rol'), ('devuelto_en'),
  ('cerrado_por'), ('cerrado_rol'), ('cerrado_en'))
select r.columna,
       case when r.columna = any (public.dian_staging_columnas_congeladas())
            then 'FALLA  esta congelada pero deberia ser editable'
            else 'OK' end as estado
from revisables r order by r.columna;

\echo ''
\echo '--- 16. La RPC no es ejecutable por anon ---'
select p.proname,
       case when has_function_privilege('anon', p.oid, 'EXECUTE')
            then 'FALLA  anon puede ejecutar la RPC'
            when has_function_privilege('authenticated', p.oid, 'EXECUTE')
            then 'OK    solo authenticated'
            else 'AVISO  nadie de la API puede ejecutarla' end as estado
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'dian_registrar_documento';

\echo ''
\echo '=== FIN POSTCHECK 204 ==='