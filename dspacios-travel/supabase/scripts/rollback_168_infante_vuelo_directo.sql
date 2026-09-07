-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 168 · guardar_infante_vuelo
-- Revierte EXACTAMENTE lo que agregó la migración 168 (una sola función
-- nueva, sin tablas/columnas/triggers propios). No toca la migración 167 ni
-- ninguna otra. Verificado únicamente contra una base local desechable.
-- ───────────────────────────────────────────────────────────────────────────

begin;

revoke all on function public.guardar_infante_vuelo(bigint, bigint, bigint, text, text, text, text, date) from authenticated;
revoke all on function public.guardar_infante_vuelo(bigint, bigint, bigint, text, text, text, text, date) from anon;
revoke all on function public.guardar_infante_vuelo(bigint, bigint, bigint, text, text, text, text, date) from public;

drop function if exists public.guardar_infante_vuelo(bigint, bigint, bigint, text, text, text, text, date);

commit;
