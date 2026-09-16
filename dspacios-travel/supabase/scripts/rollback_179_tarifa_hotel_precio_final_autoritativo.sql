-- Rollback 179 — revierte la migración
-- 20260601000179_tarifa_hotel_precio_final_autoritativo.sql
-- ⚠️ Si para cuando se corre este rollback ya existen filas de `tarifa_hotel`
-- marcadas `precio_final_autoritativo = true` (promociones Dubai regeneradas
-- con el código nuevo), este rollback las deja SIN esa marca — el motor
-- volvería al comportamiento legacy (recalcula el descuento desde la base)
-- para esas filas hasta que se vuelvan a generar. No pierde precio/neto (esas
-- columnas no se tocan), solo pierde la identidad de "precio final" y
-- "temporada_base" — confirmar con el dueño antes de correr si ya hay datos.
-- También elimina el RPC `reemplazar_tarifas_hotel_calculadora` — si el
-- código nuevo (`generarTarifasCalculadora`) sigue desplegado cuando se corre
-- este rollback, "Generar tarifas" empieza a fallar con "function does not
-- exist" hasta que se revierta también el código (mismo criterio de orden
-- que el resto de migraciones de esta serie: SQL y código se revierten
-- juntos, nunca uno sin el otro).

begin;

drop function if exists public.reemplazar_tarifas_hotel_calculadora(bigint, text[], jsonb);

alter table public.tarifa_hotel
  drop constraint if exists tarifa_hotel_temporada_base_solo_si_final_check;

alter table public.tarifa_hotel
  drop column if exists temporada_base;

alter table public.tarifa_hotel
  drop column if exists precio_final_autoritativo;

commit;
