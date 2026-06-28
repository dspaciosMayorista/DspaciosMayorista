-- ───────────────────────────────────────────────────────────────────────────
-- 105 · CONTABILIDAD — control de facturación a la DIAN
--
--  Marca por contrato si la factura ya fue emitida a la DIAN, para llevar el
--  control en la pestaña DIAN del módulo de Facturación.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.contrato_facturacion
  add column if not exists dian_emitida boolean not null default false,
  add column if not exists dian_fecha   date;
