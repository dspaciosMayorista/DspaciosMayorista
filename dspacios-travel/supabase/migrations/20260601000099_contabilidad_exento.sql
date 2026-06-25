-- ───────────────────────────────────────────────────────────────────────────
-- 099 · CONTABILIDAD — ingreso propio exento/excluido en la facturación
--
--  Refina el modelo de contrato_facturacion. El ingreso propio se parte en:
--    · base gravable (lleva IVA) = PVP − IRT − ingreso_exento
--    · ingreso_exento            = porción exenta o excluida (NO lleva IVA)
--  Ingreso propio = base gravable + ingreso_exento = PVP − IRT.
--  `tipo_exento` distingue exento vs excluido (para tratamiento tributario futuro).
--  Se deja de usar `lleva_iva` (la base gravable siempre liquida IVA).
-- ───────────────────────────────────────────────────────────────────────────

alter table public.contrato_facturacion
  add column if not exists ingreso_exento numeric(15,2) not null default 0,
  add column if not exists tipo_exento    text;  -- 'exento' | 'excluido' (null si ingreso_exento = 0)
