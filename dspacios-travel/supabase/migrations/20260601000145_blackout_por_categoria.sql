-- Migración 145: black out de hotel por CATEGORÍA de habitación
--
-- El cierre de ventas de un hotel (`hotel_blackouts`, migración 064) permitía
-- cerrar TODO el hotel o unas ACOMODACIONES puntuales (sencilla, doble…), pero
-- no una CATEGORÍA. En la realidad un hotel cierra "Suite vista al mar" y sigue
-- vendiendo "Estándar": no se puede expresar hoy, y cerrar por acomodación se
-- lleva por delante todas las categorías.
--
-- Se agrega `categorias text[]`, con la misma forma que `acomodaciones`.
--
-- CÓMO SE COMBINAN (con `total = false`)
--   · solo acomodaciones → esas acomodaciones en TODAS las categorías
--     (comportamiento de siempre: las filas viejas tienen categorias = null y
--     siguen funcionando igual, sin backfill).
--   · solo categorías     → esas categorías completas, en todas sus acomodaciones.
--   · las dos             → la INTERSECCIÓN: solo esas acomodaciones dentro de
--     esas categorías. Ej. cerrar la doble de "Suite" sin tocar la sencilla de
--     "Suite" ni ninguna "Estándar".
--
-- `total = true` sigue cerrando el hotel entero y no mira ninguna de las dos.

alter table public.hotel_blackouts
  add column if not exists categorias text[];

comment on column public.hotel_blackouts.categorias is
  'Categorías de habitación cerradas (null/vacío = todas). Se cruza con `acomodaciones`: si ambas vienen, cierra solo esas acomodaciones dentro de esas categorías.';

notify pgrst, 'reload schema';
