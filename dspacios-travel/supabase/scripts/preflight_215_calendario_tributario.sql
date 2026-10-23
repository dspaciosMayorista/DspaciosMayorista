-- ============================================================================
-- Preflight 215 — Calendario tributario (#43-1a). SOLO LECTURA.
-- Ejecutar ANTES de aplicar la migracion. No escribe nada.
-- Uso: psql $DATABASE_URL -v ON_ERROR_STOP=1 -f preflight_215_calendario_tributario.sql
-- Esperado: todo en OK (los AVISO no bloquean, pero hay que leerlos).
-- ============================================================================

\echo '--- 1. Las tablas de la 215 aun no existen ---'
select t as tabla,
       case when to_regclass('public.' || t) is null then 'OK    no existe todavia'
            else 'AVISO ya existe: la 215 es idempotente, revisar si ya se aplico' end as estado
from unnest(array['obligacion_tributaria', 'obligacion_vencimiento', 'obligacion_cumplimiento']) t;

\echo ''
\echo '--- 2. Dependencias que usa la migracion ---'
select f as funcion,
       case when to_regprocedure(f) is not null then 'OK' else 'FALLA  no existe' end as estado
from unnest(array['public.mi_rol()', 'public.mi_tenant()', 'public.fn_auditoria()', 'auth.uid()']) f;

\echo ''
\echo '--- 3. NIT de cada agencia (el calendario elige la fecha por sus digitos) ---'
select a.tenant,
       case when nullif(regexp_replace(coalesce(a.nit, ''), '\D', '', 'g'), '') is null
            then 'AVISO sin NIT: las obligaciones por digito no se podran resolver hasta cargarlo en Datos de la agencia'
            else 'OK    NIT cargado' end as estado
from public.agencias a
order by a.tenant;

\echo ''
\echo '=== FIN PREFLIGHT 215 ==='
