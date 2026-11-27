-- NEGATIVE CONTROL for the 338 driver (RB1_SEMILLA): the round-5 locking — the generation serialized only against OTHER GENERATIONS (advisory lock), with no ventas key share and no lock in the leg writers.
-- The race reported as V5-1 comes back: scenarios V1, V2, V3, V4 and V6 must FAIL (a stale generation overwrites a later invalidation with «vigente»). DISPOSABLE database only.
drop trigger t_00_tramo_candado on public.contrato_vuelos;
create or replace function public.bloquear_voucher_vuelo(p_numero text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_numero is null or btrim(p_numero) = '' or not public.puede_ver_contrato(p_numero) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('voucher_vuelo|' || p_numero, 0));   -- generation vs generation only
end $$;
