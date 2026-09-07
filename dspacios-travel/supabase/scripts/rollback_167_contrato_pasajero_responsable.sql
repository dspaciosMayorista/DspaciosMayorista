-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 167 · vínculo INF→adulto + reconciliación de sillas
-- Revierte exactamente lo que agregó la migración 167. No toca ninguna
-- migración anterior. Verificado únicamente contra una base local desechable.
--
-- HIGH (revisión de Opus, ronda 9): envuelto en begin/commit, igual que la
-- migración 167 y el resto de rollbacks del proyecto (153-164) — un fallo a
-- mitad de camino ahora revierte TODO en vez de dejar el esquema a medio
-- revertir.
--
-- Firmas actualizadas a la ronda 9 (fecha_salida NULL): `_reemplazar_
-- pasajeros_nucleo`, `_guardar_pasajeros_nucleo` y `crear_pasajeros_contrato_
-- multi` ganaron un 5º/6º parámetro `date` (`p_fecha_referencia_fallback`,
-- con default null) — `drop function` exige la firma EXACTA, así que estas
-- tres líneas cambian; `crear_pasajeros_contrato` (singular) no cambió de
-- firma en esa ronda y se deja igual.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- B6 (ronda 3): multi-bloqueo — dropear ANTES que sus dependencias
-- (_reemplazar_pasajeros_nucleo, _ajustar_sillas_bloqueo_nucleo, el tipo
-- compuesto), en orden inverso al de creación.
revoke execute on function public.crear_pasajeros_contrato_multi(text, jsonb, jsonb, uuid, date) from service_role;
drop function if exists public.crear_pasajeros_contrato_multi(text, jsonb, jsonb, uuid, date);

revoke execute on function public.crear_pasajeros_contrato(text, jsonb, integer, uuid) from service_role;
drop function if exists public.crear_pasajeros_contrato(text, jsonb, integer, uuid);

revoke execute on function public.guardar_pasajeros_contrato(text, jsonb) from authenticated;
drop function if exists public.guardar_pasajeros_contrato(text, jsonb);

drop function if exists public._guardar_pasajeros_nucleo(text, jsonb, integer, integer, uuid, date);
drop function if exists public._reemplazar_pasajeros_nucleo(text, jsonb, integer, uuid, date);
drop type if exists public._fila_pasajero_167;
drop function if exists public._autorizado_escribir_pasajeros(text, uuid);

revoke execute on function public.ajustar_sillas_por_pasajeros(text, integer) from authenticated;
drop function if exists public.ajustar_sillas_por_pasajeros(text, integer);

drop function if exists public._ajustar_sillas_nucleo(text, integer);
drop function if exists public._ajustar_sillas_bloqueo_nucleo(text, bigint, integer);

drop trigger if exists trg_validar_responsable_infante on public.contrato_pasajeros;
drop function if exists public.fn_validar_responsable_infante();

drop table if exists public._pasajeros_exentos_167;

drop function if exists public.es_infante_por_edad(date, date);
drop function if exists public.edad_anios(date, date);

drop index if exists public.idx_contrato_pasajeros_responsable;

alter table public.contrato_pasajeros drop column if exists responsable_id;

notify pgrst, 'reload schema';

commit;
