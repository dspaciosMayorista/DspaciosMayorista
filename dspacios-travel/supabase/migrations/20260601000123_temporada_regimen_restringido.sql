-- ───────────────────────────────────────────────────────────────────────────
-- 123 · Temporadas/promos restringidas a un solo régimen
--
--  Algunas promociones (ej. Dubai) solo aplican a UN régimen de alimentación
--  aunque el hotel tenga varios (ej. la promo es solo para PC, no para PAM).
--  NULL = aplica a todos los régimen (comportamiento actual, sin cambios para
--  las temporadas ya cargadas). Aplica a cualquier tipo de vigencia (tarifa,
--  descuento_pct, descuento_monto, promo_noche_gratis).
-- ───────────────────────────────────────────────────────────────────────────

alter table public.hotel_temporadas add column if not exists regimen_restringido text;
