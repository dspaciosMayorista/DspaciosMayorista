-- 280 (#82) — Hotel con ficha del paquete 100 % dinámico: la ficha aporta SOLO información general; las tarifas son del paquete.
--   · hotel_vinculable_din(): antes exigía ficha activa SIN temporadas, tarifas (por persona o por unidad) ni calculadora. Ahora basta que la ficha esté ACTIVA
--     (visible en el catálogo). Tener tarifario ya no la descarta: el paquete nunca lee ni copia esas tarifas ni vigencias (sus precios salen de
--     paquete_din_hoteles.neto/pvp/pvp_general y validarPaquete los exige para publicar y cotizar).
--   · hoteles_vinculables_din() (selector) y tg_din_hotel_vinculable() (guarda al escribir) usan esa función: el selector no se redefine.
--   · tg_din_hotel_moneda(): se elimina. La moneda de la ficha ya no condiciona al paquete: los importes manuales se ingresan en la moneda del paquete.
--   · categoria y regimen del hotel del paquete son texto propio del paquete (pueden ser valores nuevos que no existen en el catálogo): solo se acota su longitud (≤ 80).
--     No se escribe en categorias_habitacion, planes_alimentacion ni en la ficha.
-- ADITIVA sobre 274–279 (no edita ninguna). Orden: preflight → esta migración → postcheck → recién después el código.
-- Rollback: supabase/scripts/rollback_280_paquete_dinamico_ficha_sin_tarifario.sql.
begin;

create or replace function public.hotel_vinculable_din(p_hotel bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.hoteles h where h.id = p_hotel and h.activo is true)
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
    raise exception 'DIN_82_HOTEL: la ficha % no se puede vincular: debe existir y estar activa (usa un hotel manual).', new.hotel_id using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_din_hotel_moneda on public.paquete_din_hoteles;
drop function if exists public.tg_din_hotel_moneda();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'paquete_din_hoteles_texto_check' and conrelid = 'public.paquete_din_hoteles'::regclass) then
    alter table public.paquete_din_hoteles add constraint paquete_din_hoteles_texto_check
      check (char_length(coalesce(categoria, '')) <= 80 and char_length(coalesce(regimen, '')) <= 80);
  end if;
end $$;

commit;
