-- ───────────────────────────────────────────────────────────────────────────
-- 066 · PROGRAMAS — campos de vitrina
--
-- Tres campos sobre la cabecera del programa para la presentación pública,
-- que no encajaban en el modelo de precios por categoría:
--   · desde_precio    → precio "Desde" manual (titular). Si está, manda sobre
--                       el mínimo calculado de la matriz (útil cuando el
--                       proveedor solo da un "Desde $X" sin matriz completa).
--   · incluye_aereo   → false = Solo terrestre · true = Con aéreo. Cambia el
--                       badge de la vitrina y el texto del titular.
--   · portada_url     → imagen de portada (URL) para la tarjeta y la cabecera.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.programas
  add column if not exists desde_precio  numeric(15,2),
  add column if not exists incluye_aereo boolean not null default false,
  add column if not exists portada_url   text;
