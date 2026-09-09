-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK de la migración 170 (`cuentas_por_pagar.servicio_id`).
-- SOLO LECTURA. Correr DESPUÉS de aplicar la 170.
--
-- Verifica lo que la migración promete, no solo que "no falló":
--   A) la columna existe, es bigint y es NULLABLE;
--   B) la FK apunta a servicios_adicionales(id) con ON DELETE SET NULL
--      (una CxP es dinero real: borrar un servicio NUNCA debe borrarla);
--   C) el índice parcial existe y es parcial (solo servicio_id not null);
--   D) NO hubo backfill: ninguna CxP anterior quedó con servicio_id inventado;
--   E) integridad: ningún servicio_id apunta a un servicio inexistente.
-- ───────────────────────────────────────────────────────────────────────────

\echo '=== A) columna: existe, bigint, nullable ==='
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='cuentas_por_pagar' and column_name='servicio_id';
\echo 'esperado: servicio_id | bigint | YES | (null)'

\echo '=== B) FK -> servicios_adicionales(id) ON DELETE SET NULL ==='
select
  con.conname,
  pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname='public' and rel.relname='cuentas_por_pagar' and con.contype='f'
  and pg_get_constraintdef(con.oid) ilike '%servicio_id%';
\echo 'esperado: FOREIGN KEY (servicio_id) REFERENCES servicios_adicionales(id) ON DELETE SET NULL'

\echo '=== C) índice parcial presente ==='
select indexname, indexdef
from pg_indexes
where schemaname='public' and indexname='cuentas_por_pagar_contrato_servicio_idx';
\echo 'esperado: ... (numero_contrato, servicio_id) WHERE (servicio_id IS NOT NULL)'

\echo '=== D) sin backfill: las CxP previas siguen en NULL ==='
select
  count(*)                                             as cxp_total,
  count(*) filter (where servicio_id is not null)      as con_servicio_id,
  count(*) filter (where servicio_id is null)          as sin_servicio_id
from public.cuentas_por_pagar;
\echo 'esperado justo después de aplicar la 170: con_servicio_id = 0'

\echo '=== E) integridad referencial (debe dar 0) ==='
select count(*) as huerfanas
from public.cuentas_por_pagar c
where c.servicio_id is not null
  and not exists (select 1 from public.servicios_adicionales s where s.id = c.servicio_id);
\echo 'esperado: huerfanas = 0'
