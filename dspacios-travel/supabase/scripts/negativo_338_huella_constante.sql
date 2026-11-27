-- NEGATIVE CONTROL for the 338 driver (RB1_SEMILLA): the leg FINGERPRINT is neutralized (constant), so guardar_vouchers_vuelo can no longer notice that the saved legs changed
-- between the application's read and the write (ids unchanged, a field edited). Scenario E3 must FAIL (the stale itinerary would be stored as «vigente»). DISPOSABLE database only.
create or replace function public.servicios_aereos_contrato(p_numero text)
returns table (servicio uuid, tramos bigint[], huella text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_numero is null or btrim(p_numero) = '' or not public.puede_ver_contrato(p_numero) then return; end if;
  return query select c.servicio_aereo, array_agg(c.id order by c.id), md5('constante') from public.contrato_vuelos c where c.numero_contrato = p_numero group by c.servicio_aereo;
end $$;
