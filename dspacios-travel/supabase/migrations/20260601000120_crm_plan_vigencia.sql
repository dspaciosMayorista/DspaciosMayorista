-- ───────────────────────────────────────────────────────────────────────────
-- 120 · CRM Difusión: vigencia de la promoción programada
--
--  Cada envío del calendario puede tener fecha de vencimiento (ej. tarifa/
--  promoción válida hasta cierta fecha) para saber cuándo hay que renovarla.
--  Nullable: no todo el material tiene una vigencia fija (contenido evergreen).
-- ───────────────────────────────────────────────────────────────────────────

alter table public.crm_difusion_plan add column if not exists vigencia_hasta date;
