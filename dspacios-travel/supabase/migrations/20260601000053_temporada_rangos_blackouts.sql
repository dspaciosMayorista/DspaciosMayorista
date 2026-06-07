-- 053 · Múltiples rangos + black-outs por temporada
-- Una temporada puede cubrir VARIOS rangos de fechas (ej. "Media: puentes") y
-- EXCLUIR fechas (black-out), sin crear múltiples temporadas. Se guardan como
-- JSON: [{ "fecha_inicio": "2026-06-01", "fecha_fin": "2026-09-30" }, ...].
-- Compatibilidad: si 'rangos' está vacío, el motor usa fecha_inicio/fecha_fin
-- (las temporadas ya creadas siguen funcionando igual). Idempotente.

alter table public.hotel_temporadas
  add column if not exists rangos    jsonb not null default '[]'::jsonb,
  add column if not exists blackouts jsonb not null default '[]'::jsonb;
