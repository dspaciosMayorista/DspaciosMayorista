-- Migración 019: filtros de categoría / régimen por hotel dentro de un paquete
--
-- Al adicionar un hotel al paquete, puedes elegir cuáles categorías de
-- habitación y cuáles regímenes de alimentación se publican. NULL (o vacío)
-- significa "todas" (comportamiento por defecto).

alter table public.armado_hoteles
  add column if not exists categorias text[],
  add column if not exists regimenes  text[];
