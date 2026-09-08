-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la migración 172. SOLO LECTURA. Correr ANTES de aplicarla.
-- ───────────────────────────────────────────────────────────────────────────

\echo '=== 1) la migración 171 está aplicada (registrar_financiero_contrato existe) ==='
select to_regprocedure('public.registrar_financiero_contrato(text, text, jsonb, jsonb)') is not null as m171_existe;
\echo 'esperado: t (si es f, aplicar primero la 171)'

\echo '=== 2) estado actual de las columnas/tabla nuevas ==='
select
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='financiero_estado') as financiero_estado_ya_existe,
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='financiero_actualizado_en') as financiero_actualizado_en_ya_existe,
  to_regclass('public.contrato_financiero_pendiente') is not null as tabla_pendiente_ya_existe;
\echo 'esperado en instalación limpia: f | f | f (t = ya aplicada; toda la migración usa if not exists/create or replace, reaplicar es seguro)'

\echo '=== 3) tablas que toca la revertir_contrato_incompleto corregida ==='
select
  to_regclass('public.facturacion')            is not null as facturacion,
  to_regclass('public.rentabilidad')           is not null as rentabilidad,
  to_regclass('public.liquidacion_comisiones') is not null as liquidacion_comisiones,
  to_regclass('public.aliados_b2b')            is not null as aliados_b2b,
  to_regclass('public.contrato_condiciones')   is not null as contrato_condiciones;
\echo 'esperado: todas en t'

\echo '=== 4) el trigger de inmutabilidad de contrato_condiciones sigue siendo el de la 166 (bypass reutilizado, no reescrito) ==='
select prosrc ilike '%app.eliminando_contrato%' as trigger_tiene_el_bypass
from pg_proc where proname = 'contrato_condiciones_inmutable';
\echo 'esperado: t (si es f, la migración 166 no está aplicada tal cual — revisar antes de continuar)'

\echo '=== 5) conteo actual de ventas (para comparar contra el postcheck: la 172 no debe tocar datos existentes) ==='
select count(*) as ventas from public.ventas;
