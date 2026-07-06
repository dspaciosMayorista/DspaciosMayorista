-- ───────────────────────────────────────────────────────────────────────────
-- 121 · Hoteles pet friendly: tarifa y notas de mascota
--
--  Igual que el cargo de infante (migración 118): algunos hoteles aceptan
--  mascotas gratis, otros cobran un cargo neto por noche. `pet_friendly` es
--  el toggle que habilita/valida la reserva con mascotas en este hotel;
--  `pet_costo_neto` en 0 = gratis (sí se publica/permite igual).
-- ───────────────────────────────────────────────────────────────────────────

alter table public.hoteles add column if not exists pet_friendly boolean not null default false;
alter table public.hoteles add column if not exists pet_costo_neto numeric not null default 0;
alter table public.hoteles add column if not exists pet_costo_desc text;
alter table public.hoteles add column if not exists pet_nota text;
