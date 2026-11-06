-- Rollback de la 280 (#82). Deja la base como tras la 279: la ficha vinculable vuelve a exigir estar activa y SIN tarifas/vigencias/calculadora,
-- vuelve el trigger de moneda de la ficha y se quita la restricción de longitud. Ojo: los paquetes ya guardados con fichas que tienen tarifario
-- quedan guardados (los triggers solo revisan al insertar o al cambiar la ficha), pero no se podrán volver a guardar con esa ficha.
begin;
alter table public.paquete_din_hoteles drop constraint if exists paquete_din_hoteles_texto_check;

create or replace function public.hotel_vinculable_din(p_hotel bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.hoteles h where h.id = p_hotel and h.activo is true)
     and not exists (select 1 from public.hotel_temporadas t where t.hotel_id = p_hotel)
     and not exists (select 1 from public.tarifa_hotel t where t.hotel_id = p_hotel)
     and not exists (select 1 from public.hotel_tarifas_unidad t where t.hotel_id = p_hotel)
     and not exists (select 1 from public.hotel_calculadora t where t.hotel_id = p_hotel)
$$;
revoke all on function public.hotel_vinculable_din(bigint) from public, anon;
grant execute on function public.hotel_vinculable_din(bigint) to authenticated, service_role;

create or replace function public.tg_din_hotel_vinculable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_revisar boolean := false;
begin
  if new.hotel_id is not null then
    if tg_op = 'INSERT' then v_revisar := true; else v_revisar := old.hotel_id is distinct from new.hotel_id; end if;
  end if;
  if v_revisar and not public.hotel_vinculable_din(new.hotel_id) then
    raise exception 'DIN_82_HOTEL: la ficha % no se puede vincular: debe estar activa y no tener vigencias ni tarifas (usa un hotel manual).', new.hotel_id using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.tg_din_hotel_moneda() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_h text; v_p text;
begin
  if new.hotel_id is not null then
    select moneda into v_h from public.hoteles where id = new.hotel_id;
    select moneda into v_p from public.paquete_din where id = new.paquete_id;
    if v_h is distinct from v_p then
      raise exception 'DIN_82_MONEDA: el hotel «%» está en % y el paquete en %.', new.nombre, v_h, v_p using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.tg_din_hotel_moneda() from public, anon, authenticated;
drop trigger if exists trg_din_hotel_moneda on public.paquete_din_hoteles;
create trigger trg_din_hotel_moneda before insert or update on public.paquete_din_hoteles
  for each row execute function public.tg_din_hotel_moneda();
commit;
