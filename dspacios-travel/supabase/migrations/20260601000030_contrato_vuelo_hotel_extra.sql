-- Migración 030: completar datos de vuelo y hotel en el contrato
--
-- Obs 1: el vuelo del contrato necesita RECORD (PNR), números de vuelo y horas.
-- Obs 2: el hotel del contrato necesita categoría de habitación y proveedor.
-- En reservar/paquete negociado se arrastran automáticamente; en el contrato
-- manual (dinámico) se llenan a mano.

alter table public.contrato_vuelos
  add column if not exists record           text,
  add column if not exists vuelo_ida         text,
  add column if not exists vuelo_regreso     text,
  add column if not exists hora_salida_ida   text,
  add column if not exists hora_llegada_ida  text,
  add column if not exists hora_salida_reg   text,
  add column if not exists hora_llegada_reg  text,
  add column if not exists fecha_regreso     date;

alter table public.contrato_hoteles
  add column if not exists categoria text,
  add column if not exists proveedor text;
