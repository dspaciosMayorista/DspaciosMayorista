-- ───────────────────────────────────────────────────────────────────────────
-- 097 · FINANZAS USD — TRM por pago en cuentas por pagar (paso 5e)
--
--  Las CxP de un contrato USD quedan en USD (valor_total, abono1/2/3). Pero al
--  proveedor se le paga en PESOS a la TRM del día de pago. Cada pago guarda la
--  TRM con que se realizó: el abonoN sigue en USD (reduce la obligación) y el
--  costo en pesos realizado = abonoN × trmN. En COP, trm = 1.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.cuentas_por_pagar
  add column if not exists trm1 numeric(15,4),
  add column if not exists trm2 numeric(15,4),
  add column if not exists trm3 numeric(15,4);
