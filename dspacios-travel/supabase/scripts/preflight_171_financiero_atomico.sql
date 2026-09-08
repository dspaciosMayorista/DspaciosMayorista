-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la migración 171 (escritura financiera atómica del contrato).
-- SOLO LECTURA — no modifica nada. Correr ANTES de aplicar la 171.
--
-- Precondiciones reales de las que depende la migración:
--   1) la 170 ya está aplicada (`cuentas_por_pagar.servicio_id` existe): la
--      171 inserta esa columna, así que sin ella falla;
--   2) existen las tablas que la función lee/escribe: ventas,
--      cuentas_por_pagar, cxp_pagos, retenciones_cxp, abonos, sillas y las
--      hijas del contrato que borra la reversión;
--   3) `ventas` tiene las cinco columnas de costo que actualiza;
--   4) los nombres de función están libres (o ya son de esta migración —
--      es `create or replace`, así que reaplicarla es seguro);
--   5) existe el rol `service_role` (el único con permiso de ejecución).
-- ───────────────────────────────────────────────────────────────────────────

\echo '=== 1) la migración 170 está aplicada (cuentas_por_pagar.servicio_id) ==='
select exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='cuentas_por_pagar' and column_name='servicio_id'
) as servicio_id_existe;
\echo 'esperado: t  (si es f, aplicar primero la 170)'

\echo '=== 2) tablas que tocan las dos funciones ==='
select
  to_regclass('public.ventas')             is not null as ventas,
  to_regclass('public.cuentas_por_pagar')  is not null as cuentas_por_pagar,
  to_regclass('public.cxp_pagos')          is not null as cxp_pagos,
  to_regclass('public.retenciones_cxp')    is not null as retenciones_cxp,
  to_regclass('public.abonos')             is not null as abonos,
  to_regclass('public.sillas')             is not null as sillas,
  to_regclass('public.contrato_items')     is not null as contrato_items,
  to_regclass('public.contrato_hoteles')   is not null as contrato_hoteles,
  to_regclass('public.contrato_vuelos')    is not null as contrato_vuelos,
  to_regclass('public.contrato_servicios') is not null as contrato_servicios,
  to_regclass('public.contrato_pasajeros') is not null as contrato_pasajeros;
\echo 'esperado: todas en t'

\echo '=== 3) ventas tiene las cinco columnas de costo ==='
select count(*) = 5 as cinco_columnas_costo
from information_schema.columns
where table_schema='public' and table_name='ventas'
  and column_name in ('costo_hotel','costo_aereo','costo_receptivo','costo_asistencia','otros_costos');

\echo '=== 4) estado actual de los nombres de función ==='
select
  to_regprocedure('public.registrar_financiero_contrato(text, text, jsonb, jsonb)') is not null as registrar_ya_existe,
  to_regprocedure('public.revertir_contrato_incompleto(text, text)')                is not null as revertir_ya_existe,
  to_regprocedure('public.marca_cxp_automatica()')                                  is not null as marca_ya_existe;
\echo 'esperado en una instalación limpia: f | f | f  (t = ya aplicada; es create or replace, reaplicar es seguro)'

\echo '=== 5) rol service_role presente (único con execute) ==='
select exists (select 1 from pg_roles where rolname='service_role') as service_role_existe;

\echo '=== 6) CxP automáticas ya existentes (las que un reintento podría reemplazar) ==='
-- Solo informativo: la 171 no toca datos al aplicarse. Este conteo muestra
-- cuántas filas quedarían dentro del alcance de reemplazo de un futuro
-- reintento sobre el MISMO contrato (nunca las manuales, nunca las que ya
-- tienen pagos o retenciones).
select
  count(*) filter (where observaciones like 'Generado automáticamente desde el tarifario%') as automaticas,
  count(*) filter (where observaciones is null or observaciones not like 'Generado automáticamente desde el tarifario%') as manuales,
  count(*) as total
from public.cuentas_por_pagar;
