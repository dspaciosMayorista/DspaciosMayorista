-- Rollback 327: borra el catálogo de conjuntos de fechas. Las vigencias NO se tocan (cada una conserva su propia copia de las fechas en hotel_temporadas.blackouts).
drop table if exists public.conjuntos_fechas;
drop function if exists public.conjuntos_fechas_tocar();
drop function if exists public.conjunto_fechas_rangos_validos(jsonb);
