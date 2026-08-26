-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 160 (ventas_formato_numero_por_tenant)
--
-- Puramente aditiva (un CHECK) → revertirla es solo quitar el candado. No
-- hay datos que restaurar: esta migración nunca tocó ni reenumeró filas.
-- ───────────────────────────────────────────────────────────────────────────

begin;

alter table public.ventas
  drop constraint if exists ventas_numero_contrato_formato_por_tenant;

commit;
