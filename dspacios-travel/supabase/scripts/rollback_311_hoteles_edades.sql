-- ROLLBACK de la migración 311 (O3). Restaura SOLO los defaults de columna que la 311 quitó (infante 0–2, niño 2–10). No modifica ninguna fila ni ningún hotel.
-- Ojo: volver a poner el default hace que un hotel NUEVO sin edades nazca con 2/10 y parezca configurado (justo lo que la 311 evita); úsalo solo si hay una razón operativa.
begin;
alter table public.hoteles alter column edad_infante_min set default 0;
alter table public.hoteles alter column edad_infante_max set default 2;
alter table public.hoteles alter column edad_nino_min set default 2;
alter table public.hoteles alter column edad_nino_max set default 10;
commit;
