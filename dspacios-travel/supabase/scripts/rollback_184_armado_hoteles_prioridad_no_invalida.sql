-- Rollback 184 — revierte la migración
-- 20260601000184_armado_hoteles_prioridad_no_invalida.sql
--
-- Restaura el trigger de `armado_hoteles` EXACTAMENTE como lo dejó la
-- migración 181: mismo nombre, mismas columnas de evento (insert/update/delete)
-- y misma función (`tarifario_trg_bump_armado_directo`, la genérica), que
-- NUNCA se modificó — no hay que recrearla. Después elimina la función propia
-- que introdujo la 184.
--
-- ⚠️ Consecuencia: al revertir vuelve el comportamiento viejo — guardar una
-- prioridad vuelve a marcar el paquete como `pendiente` y a poner
-- `tarifario_snapshot_publicable = false`, con lo que el paquete desaparece de
-- Vista Booking hasta republicar. Revertir a la vez el código que escribe
-- `prioridad` (o no usarlo) evita el problema.
--
-- NO toca datos: ningún `armado_hoteles.prioridad` ni ningún
-- `armado_paquetes.tarifario_*` se modifican acá.

begin;

-- 1) El trigger vuelve a apuntar a la función genérica de la 181.
drop trigger if exists tarifario_trg_armado_hoteles on public.armado_hoteles;
create trigger tarifario_trg_armado_hoteles
  after insert or update or delete on public.armado_hoteles
  for each row execute function public.tarifario_trg_bump_armado_directo();

-- 2) Se elimina la función propia de la 184 (ya no la usa nadie).
drop function if exists public.tarifario_trg_bump_armado_hoteles();

commit;
