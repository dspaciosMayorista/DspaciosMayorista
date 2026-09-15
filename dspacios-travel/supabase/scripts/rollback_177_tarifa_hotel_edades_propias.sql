-- Rollback 177 — revierte la migración 20260601000177_tarifa_hotel_edades_propias.sql
-- Seguro: nada en el código de producción lee estas columnas todavía (esta
-- migración se entrega SIN aplicar); si en el futuro ya se aplicó y se
-- configuraron overrides reales, este rollback los PIERDE (son solo 4
-- columnas de una fila de tarifa_hotel, no hay backfill posible sin volver a
-- cargarlos a mano) — confirmar con el dueño antes de correr si ya hay datos.

begin;

alter table public.tarifa_hotel
  drop constraint if exists tarifa_hotel_edades_rangos_check,
  drop constraint if exists tarifa_hotel_edades_todas_o_ninguna_check;

alter table public.tarifa_hotel
  drop column if exists edad_infante_min,
  drop column if exists edad_infante_max,
  drop column if exists edad_nino_min,
  drop column if exists edad_nino_max;

commit;
