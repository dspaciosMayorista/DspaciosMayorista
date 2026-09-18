-- Rollback 183 — revierte la migración
-- 20260601000183_armado_hoteles_prioridad.sql
-- ⚠️ Si para cuando se corre este rollback ya existen hoteles marcados como
-- recomendados (prioridad 1-6) en algún paquete, este rollback los deja SIN
-- esa marca — vuelven a ser hoteles normales del paquete (no se borra la
-- asociación hotel↔paquete en sí, solo la columna de prioridad). Si el código
-- nuevo (editor de recomendados / VistaBooking) sigue desplegado cuando se
-- corre este rollback, cualquier lectura/escritura de `prioridad` empieza a
-- fallar con "column does not exist" hasta que se revierta también el código
-- — mismo criterio de orden que el resto de migraciones de esta serie.

begin;

drop index if exists public.armado_hoteles_paquete_prioridad_unica;

alter table public.armado_hoteles
  drop constraint if exists armado_hoteles_prioridad_rango_check;

alter table public.armado_hoteles
  drop column if exists prioridad;

commit;
