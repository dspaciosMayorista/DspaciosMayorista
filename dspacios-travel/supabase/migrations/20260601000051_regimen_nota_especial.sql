-- 051 · Nota especial del régimen de alimentación
-- Nota opcional con instrucciones/condiciones de planes muy personalizados de
-- algunos hoteles. Se muestra (al hacer click) en Configuración y aparece en el
-- contrato cuando se usa ese régimen. Idempotente.

alter table public.planes_alimentacion
  add column if not exists nota_especial text;
