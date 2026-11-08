-- Rollback de la migración 283 (guardado atómico de «Mi perfil»). Solo elimina la función; no toca datos.
-- Antes de ejecutarlo hay que volver al código anterior de la acción, que ya no la llamaría.
drop function if exists public.guardar_perfil_portal(uuid, text, text, jsonb, jsonb);
