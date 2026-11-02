-- Rollback de la 270 (#120). ABORTA si ya hay hoteles marcados, netas cargadas o cotizaciones pendientes: borrarlos destruiría datos del negocio.
begin;
do $$
begin
  if exists (select 1 from public.hoteles where tarifa_bajo_solicitud) then
    raise exception 'ROLLBACK 270 ABORTADO: hay hoteles marcados bajo solicitud (desmárcalos antes).';
  end if;
  if exists (select 1 from public.cotizacion_tarifa_solicitud) then
    raise exception 'ROLLBACK 270 ABORTADO: hay netas cargadas en cotizacion_tarifa_solicitud.';
  end if;
  if exists (select 1 from public.cotizaciones where estado = 'pendiente_tarifa') then
    raise exception 'ROLLBACK 270 ABORTADO: hay cotizaciones pendiente_tarifa.';
  end if;
end $$;
drop trigger if exists trg_cotizacion_pendiente_tarifa on public.cotizaciones;
drop function if exists public.tg_cotizacion_pendiente_tarifa();
drop function if exists public.cargar_neta_solicitud(bigint, text, numeric, text, numeric, numeric, jsonb, date);
drop trigger if exists trg_tarifa_hotel_no_bajo_solicitud on public.tarifa_hotel;
drop function if exists public.tg_tarifa_hotel_no_bajo_solicitud();
drop trigger if exists trg_hotel_bajo_solicitud on public.hoteles;
drop function if exists public.tg_hotel_bajo_solicitud();
drop table if exists public.cotizacion_tarifa_solicitud;
alter table public.hoteles drop constraint if exists hoteles_bajo_solicitud_no_unidad;
alter table public.hoteles drop column if exists tarifa_bajo_solicitud;
commit;
