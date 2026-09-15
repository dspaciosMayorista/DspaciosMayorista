-- Rollback 178 — revierte la migración
-- 20260601000178_contrato_hoteles_condiciones_tarifa.sql
-- ⚠️ Si para cuando se corre este rollback ya existen contratos convertidos
-- CON condiciones de tarifa guardadas, este rollback las PIERDE (es solo una
-- columna de `contrato_hoteles`, no hay backfill posible sin volver a
-- convertir desde el snapshot de la cotización original — y esa cotización
-- pudo haber sido purgada/editada desde entonces) — confirmar con el dueño
-- antes de correr si ya hay datos.

begin;

alter table public.contrato_hoteles
  drop constraint if exists contrato_hoteles_condiciones_tarifa_array_check;

alter table public.contrato_hoteles
  drop column if exists condiciones_tarifa;

commit;
