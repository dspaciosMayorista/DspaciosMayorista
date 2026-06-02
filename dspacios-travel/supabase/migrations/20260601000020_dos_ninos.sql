-- Migración 020: dos tarifas de niño (Niño 1 y Niño 2)
--
-- Hay hoteles que dan gratis el 1er niño y cobran el 2º, o cobran distinto cada
-- uno. Por eso separamos: `neto_nino` pasa a ser "Niño 1" y agregamos
-- `neto_nino2` ("Niño 2"). En el resultado del tarifario aparecen como las
-- acomodaciones `nino` (Chd1) y `nino2` (Chd2).

-- Nuevo valor del enum de acomodación (idempotente).
alter type acomodacion_tipo add value if not exists 'nino2';

-- Tarifa neta del segundo niño en el hotel.
alter table public.tarifa_hotel
  add column if not exists neto_nino2 numeric(15,2);

-- Flag denormalizado para que la vitrina pública (anónima) muestre solo los
-- paquetes activos sin tener que leer `armado_paquetes` (que es interno).
alter table public.tarifario_resultado
  add column if not exists paquete_activo boolean not null default true;
