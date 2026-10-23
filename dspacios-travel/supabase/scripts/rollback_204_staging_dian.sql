-- ============================================================================
-- Rollback 204 — Staging DIAN contable.
--
-- Elimina las 8 tablas de staging y sus funciones, en orden inverso de
-- dependencia. NO toca `asientos_contables`, `asiento_lineas`,
-- `cuentas_por_pagar`, `proveedores` ni `puc_cuentas`.
--
-- Cuándo es aceptable: SOLO si el staging está vacío. El staging es
-- append-only y no tiene dependientes fuera de sí mismo, así que descartar
-- filas es perder evidencia de importación, no romper otra cosa.
--
-- Los tres valores del enum `rol_usuario` NO se quitan. Postgres no permite
-- quitar un valor de un enum; y aunque se pudiera, otros usuarios pueden ya
-- tenerlos asignados. Quedan como valores sin uso, que es inocuo.
--
-- Uso: psql $DATABASE_URL -v ON_ERROR_STOP=1 -f rollback_204_staging_dian.sql
-- ============================================================================

\echo '=== ROLLBACK 204: staging DIAN ==='

\echo ''
\echo '--- Aviso: cuantas filas se van a perder ---'
select 'lote_importacion_dian' as tabla, count(*) as filas from public.lote_importacion_dian
union all select 'documento_dian_identidad', count(*) from public.documento_dian_identidad
union all select 'documento_dian_staging', count(*) from public.documento_dian_staging
union all select 'documento_dian_linea_staging', count(*) from public.documento_dian_linea_staging
union all select 'documento_dian_impuesto_staging', count(*) from public.documento_dian_impuesto_staging
union all select 'documento_dian_retencion_staging', count(*) from public.documento_dian_retencion_staging
union all select 'documento_dian_forma_pago_staging', count(*) from public.documento_dian_forma_pago_staging
union all select 'documento_dian_resolucion', count(*) from public.documento_dian_resolucion
order by tabla;

\echo ''
\echo '--- 0. Quitar los triggers que bloquean el borrado ---'
-- Los triggers de inmutabilidad disparan BEFORE DELETE y harian fallar el
-- DROP por cascada. Se Bajan primero.
drop trigger if exists dian_resolucion_inmutable on public.documento_dian_resolucion;
drop trigger if exists dian_resolucion_sin_truncate on public.documento_dian_resolucion;
drop trigger if exists dian_staging_update_gate on public.documento_dian_staging;
drop trigger if exists dian_staging_transicion on public.documento_dian_staging;
drop trigger if exists dian_staging_sin_borrar on public.documento_dian_staging;
drop trigger if exists dian_staging_sin_truncate on public.documento_dian_staging;
drop trigger if exists dian_lote_sin_borrar on public.lote_importacion_dian;
drop trigger if exists dian_lote_sin_truncate on public.lote_importacion_dian;
drop trigger if exists dian_identidad_sin_borrar on public.documento_dian_identidad;
drop trigger if exists dian_identidad_sin_truncate on public.documento_dian_identidad;

do $$
declare t text;
begin
  foreach t in array array[
    'documento_dian_linea_staging', 'documento_dian_impuesto_staging',
    'documento_dian_retencion_staging', 'documento_dian_forma_pago_staging'
  ] loop
    execute format('drop trigger if exists dian_hija_sin_borrar on public.%I', t);
    execute format('drop trigger if exists dian_hija_sin_truncate on public.%I', t);
  end loop;
end;
$$;

-- --- 1. Policies ANTES que funciones -------------------------------------
-- El orden importa: cada policy llama a un helper `dian_staging_puede_*`, asi
-- que intentar `drop function` antes de quitar las policies falla con
-- "cannot drop function ... because other objects depend on it". Verificado
-- ejecutando: ese era el primer fallo de este rollback.
do $$
declare t text;
begin
  foreach t in array array[
    'lote_importacion_dian', 'documento_dian_identidad',
    'documento_dian_staging', 'documento_dian_linea_staging',
    'documento_dian_impuesto_staging', 'documento_dian_retencion_staging',
    'documento_dian_forma_pago_staging', 'documento_dian_resolucion'
  ] loop
    execute format(
      'do $inner$ declare p record; begin
         for p in select policyname from pg_policies
                   where schemaname = ''public'' and tablename = %L
         loop
           execute format(''drop policy if exists %%I on public.%%I'', p.policyname, %L);
         end loop;
       end $inner$', t, t);
  end loop;
end;
$$;

-- Las tres policies de lectura de catalogos (§16 de la migracion). Se borran
-- por NOMBRE: en esas tablas viven las policies de 126/189, que no se tocan.
drop policy if exists "dian: lectura contable de proveedores" on public.proveedores;
drop policy if exists "dian: lectura contable de datos de proveedor" on public.proveedores_datos_sensibles;
drop policy if exists "dian: lectura contable del PUC" on public.puc_cuentas;

-- --- 2. Funciones de la migracion (en orden inverso) -----------------------
-- Firma completa (25 argumentos, con los 4 jsonb de hijos de §4.10). Con la firma
-- vieja de 21, `if exists` no encontraba la funcion y la dejaba viva sin avisar.
drop function if exists public.dian_registrar_documento(
  bigint, text, text, text, text, text, text, text, date, text, text, text,
  text, numeric, numeric, numeric, numeric, text, integer, text, boolean,
  jsonb, jsonb, jsonb, jsonb);

drop function if exists public._dian_staging_update_gate();
drop function if exists public._dian_staging_insertar_hijos(bigint, jsonb, jsonb, jsonb, jsonb);
drop function if exists public._dian_staging_validar_hijos(text, jsonb);
drop function if exists public.dian_staging_columnas_congeladas();
drop function if exists public._dian_staging_transicion();
drop function if exists public._dian_resolucion_inmutable();
drop function if exists public._dian_staging_sin_truncate();
drop function if exists public._dian_staging_sin_borrar();

drop function if exists public.dian_staging_puede_administrar();
drop function if exists public.dian_staging_puede_cerrar(text);
drop function if exists public.dian_staging_puede_devolver(text);
drop function if exists public.dian_staging_puede_aprobar(text);
drop function if exists public.dian_staging_puede_preparar(text);
drop function if exists public.dian_staging_puede_importar(text);
drop function if exists public.dian_staging_puede_ver(text);

-- --- 3. Tablas hijas primero, luego la central, luego la identidad y el lote -
begin;

-- Las hijas cuelgan del documento: se van primero.
drop table if exists public.documento_dian_linea_staging;
drop table if exists public.documento_dian_impuesto_staging;
drop table if exists public.documento_dian_retencion_staging;
drop table if exists public.documento_dian_forma_pago_staging;
drop table if exists public.documento_dian_resolucion;

-- `documento_dian_staging` referencia al lote y a la identidad por FK
-- compuesta; esas FKs se van con la tabla.
drop table if exists public.documento_dian_staging;

-- La identidad ya no la referencia nadie.
drop table if exists public.documento_dian_identidad;

-- El lote es el ultimo.
drop table if exists public.lote_importacion_dian;

commit;

\echo ''
\echo '--- 3. Verificacion: no queda ninguna ---'
select coalesce(string_agg(table_name, ', '), 'OK    ninguna tabla de staging queda') as resultado
from information_schema.tables
where table_schema='public'
  and (table_name like 'documento_dian%' or table_name = 'lote_importacion_dian');

select case when count(*) = 0 then 'OK    ningun helper dian_staging_puede_* queda'
            else 'FALLA  quedan helpers' end as helpers
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'dian_staging_puede%';

\echo ''
\echo '--- 4. Lo que el rollback NO toco ---'
select 'asientos_contables' as tabla, count(*) as filas from public.asientos_contables
union all select 'cuentas_por_pagar', count(*) from public.cuentas_por_pagar
union all select 'proveedores', count(*) from public.proveedores
order by tabla;
\echo 'Estos conteos deben ser identicos a los del preflight y el postcheck.'

\echo ''
\echo 'Los valores del enum (contador, revisor_fiscal, admin_contable) quedan'
\echo 'en rol_usuario: Postgres no permite quitar un valor de enum. Son inocuos.'

\echo ''
\echo '=== FIN ROLLBACK 204 ==='