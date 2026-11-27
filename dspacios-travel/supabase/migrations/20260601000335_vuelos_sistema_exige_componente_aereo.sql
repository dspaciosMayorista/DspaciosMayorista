-- Migration 335 (#37): a land-only operation must not appear among packaged ("Sistema") flights.
--
-- Why: `ventas_vuelo_sistema` (156/157, +contrato_uid in 285) admitted every contract with `tipo_paquete = 'dinamico'`, with no check
-- that the contract has any air component. Manual contracts default to `dinamico` (NuevoContratoForm) and every manual-quote conversion
-- hardcodes `dinamico` (288), so hotel/transfer-only operations showed up in the packaged-flights list with an all-NULL airline,
-- record and route.
--
-- Rule (additive, nothing is reclassified or deleted; `ventas.tipo_paquete` and `ventas.empaquetado_ref_id` are untouched):
--   a `dinamico` contract belongs to the list only if it has SOME saved evidence of air:
--     · at least one `contrato_vuelos` row, OR
--     · a non-empty `ventas.aerolinea`, OR
--     · `ventas.costo_aereo > 0`, OR
--     · at least one air payable (`cuentas_por_pagar.tipo_proveedor = 'aereo'`, the same `cxp_aer` the view already joins).
--   A contract linked to a Promoción (`empaquetado_ref_id is not null`) always stays: the source offer IS its air component.
--   Known limit: an air operation with no leg rows, no airline, no air cost and no air payable is indistinguishable from a land-only one.
--
-- Like 285, the live view definition is read and ONE predicate is rewritten (no copy of the text, so a sibling change is not lost).
-- It aborts if the expected predicate is not found exactly once. Idempotent.
-- Rollback: supabase/scripts/rollback_334_335_vuelos_destinos.sql

begin;

do $$
declare
  d text;
  n int;
  viejo constant text := 'v\.tipo_paquete = ''dinamico''::text';
  nuevo constant text := '(v.tipo_paquete = ''dinamico''::text AND (NULLIF(btrim(COALESCE(v.aerolinea, ''''::text)), ''''::text) IS NOT NULL OR COALESCE(v.costo_aereo, 0::numeric) > 0::numeric OR COALESCE(cxp_aer.total, 0::bigint) > 0 OR EXISTS (SELECT 1 FROM public.contrato_vuelos cvx WHERE cvx.numero_contrato = v.numero_contrato)))';
begin
  d := pg_get_viewdef('public.ventas_vuelo_sistema'::regclass, false);
  if d like '%cvx.numero_contrato%' then
    return; -- ya aplicada
  end if;
  select count(*) into n from regexp_matches(d, viejo, 'g');
  if n <> 1 then
    raise exception 'ventas_vuelo_sistema tiene una forma inesperada (el predicado dinamico aparece % veces, se esperaba 1); no se modifica.', n;
  end if;
  execute 'create or replace view public.ventas_vuelo_sistema as ' || regexp_replace(d, viejo, replace(nuevo, '\', '\\'));
end $$;

notify pgrst, 'reload schema';
commit;
