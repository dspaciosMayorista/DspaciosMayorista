-- ───────────────────────────────────────────────────────────────────────────
-- 067 · PROGRAMAS — asistencia médica por día (componente del precio de venta)
--
-- El montaje del programa define el PVP a partir del neto del proveedor:
--   PVP_persona = neto / (1 - markup)            (markup del proveedor, ej. 25%)
--               + asistencia_medica_dia × días   (seguro por pax y por día)
--   PVP_final   = PVP_persona / (1 - fee_bancario)   (fee TDC/link, ej. 3%)
--
-- `pct_fee_tarjeta` ya existía (fee bancario). Faltaba la asistencia médica
-- por día, que se cobra por pasajero y por día de programa.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.programas
  add column if not exists asistencia_medica_dia numeric(15,2) not null default 0;
