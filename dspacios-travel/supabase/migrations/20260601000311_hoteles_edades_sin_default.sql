-- 311 · O3 (2026-11-17) · Sin edades inventadas por defecto en `hoteles`.
-- Desde la migración 016 las cuatro columnas de edades de un hotel nacían con un DEFAULT (infante 0–2, niño 2–10): un hotel nuevo parecía «configurado» sin que nadie
-- hubiera escrito sus edades. La aplicación ahora exige «Infante hasta» y «Niño hasta» (obligatorias para todo hotel que acepta menores; Adults Only exento) y no usa
-- ningún valor por defecto al cotizar, reservar ni publicar. Esta migración solo QUITA el default de la columna: los hoteles NUEVOS que no declaren edades quedan en NULL
-- (= «sin configurar») y la aplicación lo advierte y bloquea los menores.
-- NO modifica ninguna fila existente (ni rellena ni corrige por inferencia): un hotel ya guardado conserva exactamente lo que tiene. Idempotente. No toca contratos ni cotizaciones.
alter table public.hoteles alter column edad_infante_min drop default;
alter table public.hoteles alter column edad_infante_max drop default;
alter table public.hoteles alter column edad_nino_min drop default;
alter table public.hoteles alter column edad_nino_max drop default;
