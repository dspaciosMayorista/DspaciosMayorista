-- ───────────────────────────────────────────────────────────────────────────
-- 073 · VENTAS — vínculo y datos del portal B2B
--
--  * b2b_usuario_id → usuario (agencia/freelance) del portal que hizo/posee la
--    venta. Permite mostrarle SOLO sus contratos en el portal B2B.
--  * modo_compra    → 'neta' | 'comisionable' (cómo compró el aliado).
--  * comision_b2b   → valor de la comisión del aliado para esa venta.
--  * comision_estado→ 'pendiente' | 'cuenta_cobro' | 'facturada' | 'pagada'.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.ventas
  add column if not exists b2b_usuario_id  uuid references public.usuarios(id),
  add column if not exists modo_compra      text,
  add column if not exists comision_b2b     numeric(15,2),
  add column if not exists comision_estado  text;

create index if not exists idx_ventas_b2b_usuario on public.ventas(b2b_usuario_id);
