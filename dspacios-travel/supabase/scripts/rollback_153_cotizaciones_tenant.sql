-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 153 (COTIZACIONES: aislamiento por tenant — aditivo)
--
-- ⚠️ Primero hay que deshacer la 154 (`rollback_154_cotizaciones_tenant.sql`)
-- si ya se corrió — este script asume que `tenant` es una columna simple sin
-- policies ni trigger que dependan de ella (el estado que deja la 153 sola).
--
-- Quita por completo la columna `tenant` de `cotizaciones` (con su índice y
-- su CHECK) — vuelve el esquema exactamente a como estaba antes de la 153.
-- El código de la aplicación desplegado DESPUÉS de la 153 asume que esta
-- columna existe (estampa `tenant` en cada insert): si el código nuevo sigue
-- corriendo mientras se aplica este rollback, esos inserts empezarán a
-- fallar. Úsalo solo junto con revertir el despliegue del código, no solo.
--
-- Se pega en el editor SQL de Supabase. Es idempotente.
-- ───────────────────────────────────────────────────────────────────────────

drop index if exists public.idx_cotizaciones_tenant;
alter table public.cotizaciones drop constraint if exists cotizaciones_tenant_check;
alter table public.cotizaciones drop column if exists tenant;
