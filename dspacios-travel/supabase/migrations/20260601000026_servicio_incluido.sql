-- Migración 026: servicio incluido en el paquete vs opcional (add-on)
--
-- Al adicionar un servicio a un paquete, se elige si va INCLUIDO (se hornea en
-- la tarifa del hotel, "todo junto") o como OPCIONAL (add-on que se elige al
-- reservar). Por defecto, opcional.

alter table public.armado_servicios
  add column if not exists incluido boolean not null default false;
