-- ROLLBACK 213 · retira programas.destino_fijo_id y la lista programa_destinos_fijos.
-- Destruye la lista y todas las asignaciones. Hacerlo SOLO si el código que las usa YA NO está
-- desplegado (el código nuevo consulta la columna y fallaría sin ella). Revertir el código
-- vuelve a mostrar en el tarifario público todos los programas publicados.
-- Uso: psql -1 -v ON_ERROR_STOP=1 -f rollback_213_programa_destino_fijo.sql
alter table public.programas drop constraint if exists programas_destino_fijo_fk;
drop index if exists public.idx_programas_destino_fijo;
alter table public.programas drop column if exists destino_fijo_id;
drop table if exists public.programa_destinos_fijos;
notify pgrst, 'reload schema';
