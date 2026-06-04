-- Migración 029: categoría de servicio (para ubicarlo en el contrato)
--
-- Obs 3 del rediseño: un servicio adicional puede ser de tipo "tour/traslado"
-- o "asistencia médica". La categoría permite que en el contrato aparezca en la
-- casilla correcta (Tours y Traslados / Asistencia Médica), además de listarse
-- en la tabla de servicios adicionales.

alter table public.servicios_adicionales
  add column if not exists categoria text not null default 'otro';
  -- valores sugeridos: 'tour_traslado' | 'asistencia' | 'otro'

comment on column public.servicios_adicionales.categoria is
  'tour_traslado | asistencia | otro — ubica el servicio en el contrato.';
