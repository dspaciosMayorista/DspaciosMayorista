-- Migración 023: tipo explícito del paquete armado
--
-- Un paquete es de tipo BLOQUEO (vuelo + hotel), PORCIÓN TERRESTRE (solo hotel,
-- sin vuelo) o SERVICIOS (solo servicios adicionales). El tipo define qué se le
-- adiciona y en qué módulo del tarifario/contrato aparece (sirve de filtro).

alter table public.armado_paquetes
  add column if not exists tipo tarifario_modulo not null default 'bloqueo';
