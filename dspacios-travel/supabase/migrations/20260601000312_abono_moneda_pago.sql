-- 312 · #126-A (Codex ronda 1, pregunta de alcance 3) · Moneda en la que el dinero LLEGÓ en cada abono.
-- Un pago nativo en dólares y un pago en pesos con su TRM se guardaban IGUAL (`valor_abono` en la moneda de cobro, `monto_cop`, `trm`): los documentos no podían distinguir «USD 300 recibidos
-- (equivalente contable COP 1.230.000 a TRM 4.100)» de «COP 1.230.000 recibidos a TRM 4.100 = USD 300» y llamaban «pesos recibidos» a un equivalente contable.
-- `moneda_pago` dice qué se recibió de verdad: 'USD' = dólares recibidos (`valor_abono` = lo recibido; `monto_cop` = equivalente CONTABLE a `trm`), 'COP' = pesos recibidos.
-- NULL = abono anterior a esta migración o registrado sin esa información: se interpreta EXACTAMENTE como hasta hoy (pesos recibidos). NO se rellena ni se corrige ningún abono existente
-- (sin recalcular histórico, sin inferir): contratos y pagos de hoy, incluido DTM-0005, conservan su interpretación.
-- Aditiva e idempotente. Código antiguo la ignora; el código nuevo la LEE, así que va DESPUÉS de esta migración (orden: preflight → 312 → postcheck → despliegue).
alter table public.abonos add column if not exists moneda_pago text;
alter table public.abonos drop constraint if exists abonos_moneda_pago_check;
alter table public.abonos add constraint abonos_moneda_pago_check check (moneda_pago is null or moneda_pago in ('COP', 'USD'));
comment on column public.abonos.moneda_pago is
  '#126: moneda en que llegó el dinero: USD = dólares recibidos (valor_abono = lo recibido, monto_cop = equivalente contable a trm); COP = pesos recibidos; NULL = abono previo, se interpreta como pesos recibidos.';
