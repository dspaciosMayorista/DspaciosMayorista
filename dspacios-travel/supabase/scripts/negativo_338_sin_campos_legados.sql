-- NEGATIVE CONTROL for the 338 driver (RB1_SEMILLA): the round-5 invalidation rule — a hand-written list of modern fields only (no legacy ida+regreso fields, no display order).
-- Scenario V5-2 must FAIL: a change of vuelo_ida / horas / fecha_regreso leaves the issued voucher «vigente». DISPOSABLE database only.
create or replace function public.fn_tramo_marca_vouchers() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform public.fn_marcar_voucher_servicio(new.numero_contrato, new.servicio_aereo);
  elsif tg_op = 'DELETE' then
    perform public.fn_marcar_voucher_servicio(old.numero_contrato, old.servicio_aereo);
  else
    if new.servicio_aereo is distinct from old.servicio_aereo then
      perform public.fn_marcar_voucher_servicio(old.numero_contrato, old.servicio_aereo);
      perform public.fn_marcar_voucher_servicio(new.numero_contrato, new.servicio_aereo);
    elsif (old.aerolinea, old.record, old.direccion, old.origen_codigo, old.origen_ciudad, old.destino_codigo, old.destino_ciudad, old.numero_vuelo, old.fecha_salida, old.hora_salida, old.hora_llegada, old.servicios)
          is distinct from
          (new.aerolinea, new.record, new.direccion, new.origen_codigo, new.origen_ciudad, new.destino_codigo, new.destino_ciudad, new.numero_vuelo, new.fecha_salida, new.hora_salida, new.hora_llegada, new.servicios) then
      perform public.fn_marcar_voucher_servicio(new.numero_contrato, new.servicio_aereo);
    end if;
  end if;
  return null;
end $$;
