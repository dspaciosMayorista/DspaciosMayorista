-- ───────────────────────────────────────────────────────────────────────────
-- 128 · Retenciones — base gravable (para el informe mensual DIAN)
--
-- `retenciones_cxp` guardaba el VALOR retenido, pero no la base gravable
-- sobre la que se calculó — esa base solo quedaba enterrada como texto libre
-- dentro de `observaciones`. El informe mensual que se presenta a la DIAN
-- necesita sumar, por mes de declaración, tanto la base como el valor
-- retenido — sin una columna numérica no se puede sumar de verdad.
-- Retenciones ya registradas ANTES de esta migración quedan con
-- `base_gravable` en null (no se puede reconstruir de forma confiable desde
-- el texto libre); solo las nuevas la traen.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.retenciones_cxp add column if not exists base_gravable numeric(15,2);
