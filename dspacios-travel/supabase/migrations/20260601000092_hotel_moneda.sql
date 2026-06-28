-- ───────────────────────────────────────────────────────────────────────────
-- 092 · HOTELES — moneda (COP / USD)
--
--  Los hoteles internacionales se negocian en USD. Se agrega `moneda` al hotel:
--  sus tarifas netas (tarifa_hotel) quedan en esa moneda. Un hotel = UNA moneda.
--    · default 'COP' → los hoteles existentes (nacionales) NO cambian.
--    · al crear un hotel cuyo destino es internacional (pais != Colombia), el
--      form propone 'USD' por defecto (editable).
--
--  Nota: la conversión USD→COP para el detalle tributario (IVA/provisiones a la
--  TRM del día) es trabajo de la FASE DE FINANZAS (posterior). Aquí solo se
--  habilita vender/liquidar en la moneda del hotel.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.hoteles
  add column if not exists moneda text not null default 'COP';

update public.hoteles set moneda = 'COP' where moneda is null;
