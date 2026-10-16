-- ROLLBACK 212 · retira la RPC de reemplazo atómico, su ayudante y la columna informativa
-- programa_ciudades.alojamiento_previsto. Destruye los textos capturados; hacerlo solo si el
-- código que llama a la RPC / lee la columna YA NO está desplegado (el código nuevo falla sin ellas).
-- Uso: psql -1 -v ON_ERROR_STOP=1 -f rollback_212_programa_ruta_alojamiento.sql
drop function if exists public.reemplazar_ruta_programa(bigint, jsonb);
drop function if exists public.clave_ciudad_ruta(text);
alter table public.programa_ciudades
  drop constraint if exists programa_ciudades_alojamiento_previsto_len;
alter table public.programa_ciudades
  drop column if exists alojamiento_previsto;
