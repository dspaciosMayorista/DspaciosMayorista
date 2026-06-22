-- Migración 083: mínimo de noches por TEMPORADA (vigencia) del hotel.
-- Cada vigencia (estándar o promoción) puede exigir un mínimo de noches. Si el
-- cliente busca menos noches que el mínimo de la temporada de entrada, ese hotel
-- no aparece en la búsqueda.
--
-- `default 1` deja en 1 a TODAS las temporadas ya existentes (no quedan en blanco).

alter table public.hotel_temporadas
  add column if not exists min_noches integer not null default 1;
