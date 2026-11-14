-- 303 (#45) — Descripción y «qué incluye» de cada categoría DENTRO de un hotel. ⚠️ SIN CORRER.
--
-- Decisión del dueño (2026-11-12, Q-A): el texto es por categoría dentro de cada hotel; el NOMBRE sigue siendo el del catálogo
-- global `categorias_habitacion` (no se renombra nada, así que tarifas y calculadoras, que referencian la categoría por texto, no se tocan).
-- ADITIVA: dos columnas nullable en la tabla puente `hotel_categorias` (017). Sin backfill, sin funciones, sin RLS nueva: rigen las
-- policies de la 017 («interno» para todo) y las restrictivas de catálogo global de la 237 (escritura solo en contexto Mayorista).
-- La app deja de borrar y reinsertar todas las filas al guardar las categorías del hotel (si no, estos textos se perderían).
-- NUMERACIÓN: 298–302 provisionales de #43/#60; 303 reservada para #45 el 2026-11-12. Antes de correrla: `ls supabase/migrations | sort | tail`.
-- Orden: preflight_303 → esta migración → postcheck_303 → recién después el código. Rollback: supabase/scripts/rollback_303_hotel_categoria_descripcion.sql.

alter table public.hotel_categorias add column if not exists descripcion text;
alter table public.hotel_categorias add column if not exists incluye text;

alter table public.hotel_categorias drop constraint if exists hotel_categorias_textos_check;
alter table public.hotel_categorias add constraint hotel_categorias_textos_check check (
  (descripcion is null or char_length(descripcion) <= 2000)
  and (incluye is null or char_length(incluye) <= 2000));

comment on column public.hotel_categorias.descripcion is '#45: descripción de esta categoría en ESTE hotel (texto libre, visible al cliente en la ficha). NULL = sin descripción.';
comment on column public.hotel_categorias.incluye is '#45: «qué incluye» de esta categoría en ESTE hotel, una línea por ítem (visible al cliente). NULL = sin dato.';
