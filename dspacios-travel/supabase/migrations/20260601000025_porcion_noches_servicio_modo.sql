-- Migración 025: porción terrestre por noches + servicio con precio persona/grupo
--
-- 1) El paquete tiene un número de NOCHES (lo usa porción terrestre: liquida ese
--    número de noches desde la fecha de inicio del viaje).
-- 2) El servicio guarda un precio POR PERSONA y/o POR GRUPO (un valor c/u).
--    Al adicionarlo a un paquete se elige el MODO (persona o grupo) para ese paquete.

alter table public.armado_paquetes
  add column if not exists noches integer not null default 3;

alter table public.servicios_adicionales
  add column if not exists precio_persona numeric(15,2),
  add column if not exists precio_grupo   numeric(15,2);

alter table public.armado_servicios
  add column if not exists modo text not null default 'persona';  -- 'persona' | 'grupo'
