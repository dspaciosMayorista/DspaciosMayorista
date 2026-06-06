-- 050 · País del destino
-- Campo de texto para agrupar los destinos por país (Colombia, México, etc.).
-- Idempotente.

alter table public.destinos
  add column if not exists pais text;
