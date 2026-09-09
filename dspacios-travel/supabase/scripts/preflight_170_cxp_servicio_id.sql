-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la migración 170 (`cuentas_por_pagar.servicio_id`).
-- SOLO LECTURA — no modifica nada. Correr ANTES de aplicar la 170.
--
-- Comprueba las tres precondiciones de las que depende la migración:
--   1) `public.cuentas_por_pagar` existe y AÚN NO tiene `servicio_id`
--      (si ya la tiene, la 170 sería un no-op — hay que verificar por qué).
--   2) `public.servicios_adicionales` existe con PK `id` de tipo bigint:
--      es el destino de la FK; si el tipo no coincide, el `alter table` falla.
--   3) No hay un índice con el mismo nombre ocupado por otra cosa.
-- ───────────────────────────────────────────────────────────────────────────

\echo '=== 1) cuentas_por_pagar existe y estado de servicio_id ==='
select
  to_regclass('public.cuentas_por_pagar') is not null                      as tabla_cxp_existe,
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='cuentas_por_pagar' and column_name='servicio_id'
  )                                                                        as servicio_id_ya_existe,
  (select count(*) from public.cuentas_por_pagar)                          as filas_cxp_actuales;

\echo '=== 2) servicios_adicionales: PK y tipo (debe ser bigint) ==='
select
  to_regclass('public.servicios_adicionales') is not null as tabla_servicios_existe,
  c.data_type                                            as tipo_id
from information_schema.columns c
where c.table_schema='public' and c.table_name='servicios_adicionales' and c.column_name='id';

\echo '=== 3) el nombre del índice no está ocupado ==='
select to_regclass('public.cuentas_por_pagar_contrato_servicio_idx') is null as nombre_indice_libre;

\echo '=== Resultado esperado ==='
\echo 'tabla_cxp_existe = t | servicio_id_ya_existe = f | tabla_servicios_existe = t | tipo_id = bigint | nombre_indice_libre = t'
