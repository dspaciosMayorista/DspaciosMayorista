-- Migración 041: escala de comisión + retención en USUARIOS (asesor interno)
--
-- Rectificación: el "asesor interno" es un USUARIO con rol 'venta' (no el catálogo
-- `asesores`). La escala de comisión y el check de retención van aquí.

alter table public.usuarios
  add column if not exists escala_id        bigint references public.escalas_comision(id),
  add column if not exists aplica_retencion boolean not null default true;
