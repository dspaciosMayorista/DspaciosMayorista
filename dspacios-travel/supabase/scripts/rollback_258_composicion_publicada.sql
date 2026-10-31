-- ROLLBACK 258 — quita la función y la tabla de evidencia. Con el código nuevo desplegado, TODA reserva de bloqueo/dinámico con servicios incluidos queda rechazada
-- («no se puede verificar la composición»): revierte el código ANTES o junto con este script. No toca la 255/256/257.
begin;
drop function if exists public.registrar_composicion_publicada(bigint, bigint, smallint, jsonb);
drop table if exists public.tarifario_composicion_publicada;
commit;
