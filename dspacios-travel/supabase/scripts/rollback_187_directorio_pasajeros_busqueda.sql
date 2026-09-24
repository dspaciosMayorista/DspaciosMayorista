-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 187 · búsqueda de pasajero por documento + nombres/apellidos
-- estructurados. Revierte EXACTAMENTE lo que agregó la migración 187. No
-- toca ninguna migración anterior (en particular, no toca nada del núcleo
-- de la 167).
--
-- ⚠️ NO toca `contrato_pasajeros.nacionalidad`: esa columna NO pertenece a
-- la 187 — existe desde la migración 022
-- (20260601000022_reserva_tarifario.sql). La primera versión de este
-- rollback SÍ la dropeaba por error; corregido. Si `nacionalidad` necesita
-- revertirse alguna vez, es responsabilidad del rollback de la 022, nunca
-- de este archivo.
--
-- ⚠️ Si `contrato_pasajeros.nombres`/`apellidos` ya tienen datos reales
-- guardados por la app (best-effort, desde los flujos de creación desde
-- que se aplicó la 187), este DROP COLUMN los pierde de forma permanente —
-- confirmar antes de correr en producción.
-- ───────────────────────────────────────────────────────────────────────────

begin;

revoke execute on function public.buscar_pasajero_por_documento(text, text) from authenticated;
drop function if exists public.buscar_pasajero_por_documento(text, text);

drop index if exists public.idx_contrato_pasajeros_documento;

alter table public.contrato_pasajeros
  drop column if exists nombres,
  drop column if exists apellidos;

notify pgrst, 'reload schema';

commit;
