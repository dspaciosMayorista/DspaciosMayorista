-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK 188 (crm_pasajeros_contrato_lectura) — revierte EXACTAMENTE lo
-- que agregó esa migración. No toca ninguna otra migración, ni el núcleo
-- de la 167, ni nada de la rama de "búsqueda de pasajero por documento".
-- ─────────────────────────────────────────────────────────────────────────

begin;

revoke execute on function public.crm_pasajeros_contrato_buscar(text, integer, integer) from authenticated;
drop function if exists public.crm_pasajeros_contrato_buscar(text, integer, integer);

notify pgrst, 'reload schema';

commit;
