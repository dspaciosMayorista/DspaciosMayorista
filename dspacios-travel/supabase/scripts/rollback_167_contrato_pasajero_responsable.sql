-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 167 · vínculo INF→adulto + reconciliación de sillas
-- Revierte exactamente lo que agregó la migración 167. No toca ninguna
-- migración anterior. Verificado únicamente contra una base local desechable.
-- ───────────────────────────────────────────────────────────────────────────

revoke execute on function public.ajustar_sillas_por_pasajeros(text, integer) from authenticated;
drop function if exists public.ajustar_sillas_por_pasajeros(text, integer);

drop trigger if exists trg_validar_responsable_infante on public.contrato_pasajeros;
drop function if exists public.fn_validar_responsable_infante();

drop index if exists public.idx_contrato_pasajeros_responsable;

alter table public.contrato_pasajeros drop column if exists responsable_id;

notify pgrst, 'reload schema';
