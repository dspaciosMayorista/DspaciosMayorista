-- 057 · Estrellas / clasificación y descripción del hotel
--
-- Para la vista dinámica (tipo Booking): cada hotel puede tener estrellas (1–5)
-- o, si no maneja estrellas, una clasificación libre (Boutique, Luxury, Villa…).
-- Y una descripción comercial que se muestra en el detalle.

alter table public.hoteles
  add column if not exists estrellas    smallint,
  add column if not exists clasificacion text,
  add column if not exists descripcion   text;
