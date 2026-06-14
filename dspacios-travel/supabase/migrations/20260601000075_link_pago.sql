-- ───────────────────────────────────────────────────────────────────────────
-- 075 · LINK DE PAGO (config del sitio)
--
-- URL del link de pago (Wompi / Bold / Nequi / PayU / etc.) que pega el dueño.
-- La gente entra a /pagar (o desde su contrato / portal B2B) y paga ahí.
-- Una pasarela "real" (con webhooks que marquen el abono solo) se conecta
-- encima más adelante; por ahora es un enlace directo.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.config_sitio
  add column if not exists link_pago text;
