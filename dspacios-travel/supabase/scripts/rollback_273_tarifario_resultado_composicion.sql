-- Rollback de la 273. Solo borra la composición guardada del tarifario (no afecta precios, tarifarios ni cotizaciones).
drop table if exists public.tarifario_resultado_composicion;
