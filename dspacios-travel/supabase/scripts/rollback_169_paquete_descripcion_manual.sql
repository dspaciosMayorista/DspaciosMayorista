-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 169 · Descripción manual del paquete (armado_paquetes)
-- Revierte EXACTAMENTE lo que agregó la migración 169 (4 columnas de texto
-- libre, sin tablas/policies/triggers propios). No toca ninguna otra
-- migración. Verificado únicamente contra una base local desechable.
--
-- ⚠️ Destructivo: si ya se cargó contenido en producción, este rollback lo
-- borra sin posibilidad de recuperación (son columnas de texto libre, no hay
-- tabla de respaldo). Confirmar con el dueño antes de ejecutar sobre una base
-- con datos reales.
-- ───────────────────────────────────────────────────────────────────────────

begin;

alter table public.armado_paquetes
  drop column if exists programa_incluye,
  drop column if exists programa_no_incluye,
  drop column if exists programa_tarifas_especiales,
  drop column if exists programa_condiciones_comerciales;

commit;
