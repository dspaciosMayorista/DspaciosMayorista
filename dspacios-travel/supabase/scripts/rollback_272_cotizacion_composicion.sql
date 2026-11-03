-- Rollback de la 272. Solo borra la composición guardada (no afecta precios ni cotizaciones).
drop table if exists public.cotizacion_composicion;
