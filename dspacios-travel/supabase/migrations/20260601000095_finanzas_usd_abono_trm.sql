-- ───────────────────────────────────────────────────────────────────────────
-- 095 · FINANZAS USD — abonos con TRM + TRM del contrato (paso 5a)
--
--  Contratos en USD: el cliente paga en COP y se registra la TRM del día; el
--  abono "vale" en la moneda del contrato (USD) = monto_cop / trm. Así la lógica
--  de saldo y de confirmación (compara abonos vs precio_venta en la MISMA moneda)
--  sigue igual para COP y USD.
--    · abonos.valor_abono  = monto en la MONEDA DEL CONTRATO (USD o COP).
--    · abonos.monto_cop    = lo que el cliente pagó en PESOS.
--    · abonos.trm          = TRM del día del abono (COP por 1 USD). 1 en COP.
--  El contrato guarda la TRM efectiva (promedio ponderado de los abonos, o la
--  manual al confirmar sin abono). PVP en pesos vigente = precio_venta × trm.
--
--  Compatibilidad: en contratos COP, trm = 1 y monto_cop = valor_abono (sin
--  cambios). El backfill deja los abonos viejos consistentes.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.abonos
  add column if not exists trm       numeric(15,4),
  add column if not exists monto_cop numeric(15,2);

-- Backfill: los abonos existentes son COP → trm 1 y monto_cop = valor_abono.
update public.abonos set trm = 1 where trm is null;
update public.abonos set monto_cop = valor_abono where monto_cop is null;

-- TRM efectiva del contrato (promedio ponderado de abonos, o manual al confirmar).
-- null/1 en contratos COP.
alter table public.ventas
  add column if not exists trm_contrato numeric(15,4);
