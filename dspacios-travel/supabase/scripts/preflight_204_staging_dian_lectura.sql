-- ============================================================================
-- Preflight 204 — Staging DIAN contable. SOLO LECTURA.
--
-- Ejecutar ANTES de aplicar la migracion. No escribe nada.
-- Uso: psql $DATABASE_URL -v ON_ERROR_STOP=1 -f preflight_204_staging_dian_lectura.sql
--
-- Salida esperada: todo en OK. Si algo sale en FALLA, la migracion no debe
-- aplicarse todavia.
-- ============================================================================

\echo '=== PREFLIGHT 204 (solo lectura) ==='

-- 1. Que el numero 204 este libre en el filesystem. Si ya existe, hay otra
--    migracion con el mismo numero y hay que renumerar primero.
\echo ''
\echo '--- 1. Numeracion: 204 libre en disco ---'
select case
         when exists (select 1 from pg_proc p
                      join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public'
                        and p.proname like 'dian_staging_puede%')
           then 'FALLA  los helpers dian_staging_puede_* ya existen'
         when exists (select 1 from information_schema.tables
                      where table_schema = 'public'
                        and table_name like 'documento_dian%')
           then 'FALLA  ya existen tablas documento_dian*'
         when exists (select 1 from information_schema.tables
                      where table_schema = 'public'
                        and table_name = 'lote_importacion_dian')
           then 'FALLA  ya existe lote_importacion_dian'
         else 'OK    204 libre: ni tablas ni helpers de staging'
       end as numeracion;

-- 2. Las tablas que NO deben existir todavia.
\echo ''
\echo '--- 2. Objetivo limpio ---'
with esperadas(t) as (values
  ('lote_importacion_dian'), ('documento_dian_identidad'),
  ('documento_dian_staging'), ('documento_dian_linea_staging'),
  ('documento_dian_impuesto_staging'), ('documento_dian_retencion_staging'),
  ('documento_dian_forma_pago_staging'), ('documento_dian_resolucion'))
select e.t as tabla,
       case when exists (select 1 from information_schema.tables
                         where table_schema='public' and table_name=e.t)
            then 'FALLA  ya existe'
            else 'OK    no existe todavia' end as estado
from esperadas e order by e.t;

-- 3. Los tres roles contables en el enum (D1). Si faltan, la migracion los
--    agrega; este chequeo es para saberlo antes.
\echo ''
\echo '--- 3. Roles contables en rol_usuario ---'
select r.valor,
       case when exists (
              select 1 from pg_enum e
              join pg_type t on t.oid = e.enumtypid
              where t.typname = 'rol_usuario' and e.enumlabel = r.valor)
         then 'OK    ya existe en el enum'
         else 'NUEVO la migracion lo agrega con alter type'
       end as estado
from (values ('contador'), ('revisor_fiscal'), ('admin_contable')) r(valor);

-- 4. Superficie de datos que alimentara la primera carga. Alimenta D4 y D5.
\echo ''
\echo '--- 4. Catalogo de proveedores: alimenta D4 y D5 ---'
-- main >= 189/191: NIT y tenant de proveedores viven en proveedores_datos_sensibles
-- (PK proveedor_id+tenant); `proveedores.nit` ya no existe.
select
  s.tenant,
  (select count(*) from public.proveedores) as proveedores_total,
  count(*) filter (where s.nit is null or btrim(s.nit) = '') as sin_nit,
  (select count(*) from (
      select d.nit from public.proveedores_datos_sensibles d
      where d.tenant = s.tenant and d.nit is not null and btrim(d.nit) <> ''
      group by d.nit having count(*) > 1) x) as nits_duplicados,
  case when exists (select 1 from pg_indexes
                   where schemaname='public' and tablename='proveedores_datos_sensibles'
                     and indexdef ilike '%unique%nit%')
       then 'OK    proveedores_datos_sensibles.nit tiene indice unico'
       else 'AVISO proveedores_datos_sensibles.nit NO tiene indice unico: D5 se resuelve en la app, no en la base'
       end as nota_nit
from public.proveedores_datos_sensibles s
group by s.tenant;

-- 5. Estado real de trg_auditoria (seccion 11.1 del diseno). La 202 del CRM
--    lo recrea en TODAS las tablas de public, asi que el estado hay que
--    verificarlo, no suponerlo.
\echo ''
\echo '--- 5. trg_auditoria: verificar, no suponer ---'
select 'fn_auditoria() existe' as objeto,
       case when exists (select 1 from pg_proc p
                         join pg_namespace n on n.oid=p.pronamespace
                         where n.nspname='public' and p.proname='fn_auditoria')
            then 'OK' else 'FALLA  falta la funcion de auditoria' end as estado;

-- 6. Que no haya una version desplegada escribiendo en algo llamado staging.
\echo ''
\echo '--- 6. Barrera previa ---'
\echo 'La 204 SOLO crea tablas nuevas y no cambia permisos sobre tablas'
\echo 'existentes: no hay barrera que cruzar. Confirmar que ninguna version'
\echo 'desplegada (Produccion ni Preview) escribe en public.documento_dian_staging,'
\echo 'porque la tabla todavia no existe y eso es lo esperado.'

-- 7. Cuentos que el staging NO debe tocar.
\echo ''
\echo '--- 7. Superficie contable que la 204 no toca ---'
select 'asientos_contables' as tabla, count(*) as filas from public.asientos_contables
union all select 'asiento_lineas', count(*) from public.asiento_lineas
union all select 'cuentas_por_pagar', count(*) from public.cuentas_por_pagar
order by tabla;

\echo ''
\echo '=== FIN PREFLIGHT 204 ==='