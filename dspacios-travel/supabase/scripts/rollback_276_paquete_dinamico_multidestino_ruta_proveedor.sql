-- Rollback de la 276 (#82). Deja la base como tras la 275: sin multidestino explicito, sin ruta derivada, sin proveedor de ficha.
-- Restaura guardar_paquete_din de la 275. Las columnas nuevas se eliminan (solo contenian datos derivados o la marca multidestino).
-- Solo es seguro si no hay paquetes que dependan de ellas; los paquetes con destinos_extra conservan el arreglo.
begin;
drop trigger if exists trg_din_publicar on public.paquete_din;
drop trigger if exists trg_din_paquete_reglas on public.paquete_din;
drop trigger if exists trg_din_vuelo_reglas on public.paquete_din_vuelos;
drop trigger if exists trg_din_servicio_reglas on public.paquete_din_servicios;
drop trigger if exists trg_din_hotel_moneda on public.paquete_din_hoteles;
drop function if exists public.tg_din_publicar();
drop function if exists public.tg_din_paquete_reglas();
drop function if exists public.tg_din_vuelo_reglas();
drop function if exists public.tg_din_servicio_reglas();
drop function if exists public.tg_din_hotel_moneda();
drop function if exists public.hoteles_vinculables_din();
create function public.hoteles_vinculables_din() returns table (id bigint, nombre text, destino_id bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select h.id, h.nombre, h.destino_id from public.hoteles h
   where public.mi_rol()::text in ('superadmin', 'gerencia', 'administracion', 'operaciones')
     and public.hotel_vinculable_din(h.id)
   order by h.nombre
$$;
revoke all on function public.hoteles_vinculables_din() from public, anon;
grant execute on function public.hoteles_vinculables_din() to authenticated, service_role;
create or replace function public.guardar_paquete_din(
  p_id bigint, p_cabecera jsonb, p_vuelos jsonb, p_hoteles jsonb, p_servicios jsonb
) returns bigint
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_id bigint;
  v_tenant text;
begin
  if public.mi_rol()::text not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'DIN_82_NO_AUTORIZADO: no tienes permiso para administrar paquetes.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_cabecera) is distinct from 'object' or jsonb_typeof(coalesce(p_vuelos, '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_hoteles, '[]'::jsonb)) is distinct from 'array' or jsonb_typeof(coalesce(p_servicios, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'DIN_82_FORMA: datos del paquete inválidos.' using errcode = 'P0001';
  end if;

  if p_id is null then
    v_tenant := case when public.mi_rol()::text = 'superadmin' then coalesce(nullif(btrim(coalesce(p_cabecera->>'tenant', '')), ''), public.mi_tenant()) else public.mi_tenant() end;
    insert into public.paquete_din (tenant, nombre, destino_id, destinos_extra, moneda, esquema, pvp_modo, pct_mk, usa_vuelo, usa_hotel, usa_servicios, noches,
                                    compra_inicio, compra_fin, viaje_inicio, viaje_fin, pvp_general, total_declarado, descripcion, incluye, no_incluye, creado_por)
    select v_tenant, r.nombre, r.destino_id, coalesce(r.destinos_extra, '{}'), coalesce(r.moneda, 'COP'), r.esquema, r.pvp_modo, coalesce(r.pct_mk, 0),
           coalesce(r.usa_vuelo, false), coalesce(r.usa_hotel, false), coalesce(r.usa_servicios, false), coalesce(r.noches, 3),
           r.compra_inicio, r.compra_fin, r.viaje_inicio, r.viaje_fin, r.pvp_general, r.total_declarado, r.descripcion, r.incluye, r.no_incluye, auth.uid()
      from jsonb_populate_record(null::public.paquete_din, p_cabecera) r
    returning id into v_id;
  else
    update public.paquete_din t
       set nombre = r.nombre, destino_id = r.destino_id, destinos_extra = coalesce(r.destinos_extra, '{}'), moneda = coalesce(r.moneda, 'COP'),
           esquema = r.esquema, pvp_modo = r.pvp_modo, pct_mk = coalesce(r.pct_mk, 0), usa_vuelo = coalesce(r.usa_vuelo, false),
           usa_hotel = coalesce(r.usa_hotel, false), usa_servicios = coalesce(r.usa_servicios, false), noches = coalesce(r.noches, 3),
           compra_inicio = r.compra_inicio, compra_fin = r.compra_fin, viaje_inicio = r.viaje_inicio, viaje_fin = r.viaje_fin,
           pvp_general = r.pvp_general, total_declarado = r.total_declarado, descripcion = r.descripcion, incluye = r.incluye, no_incluye = r.no_incluye,
           publicado = false, updated_at = now()
      from jsonb_populate_record(null::public.paquete_din, p_cabecera) r
     where t.id = p_id
    returning t.id into v_id;
    if v_id is null then
      raise exception 'DIN_82_PAQUETE: el paquete no existe o no pertenece a tu agencia.' using errcode = 'P0001';
    end if;
    delete from public.paquete_din_vuelos where paquete_id = v_id;
    delete from public.paquete_din_hoteles where paquete_id = v_id;
    delete from public.paquete_din_servicios where paquete_id = v_id;
  end if;

  insert into public.paquete_din_vuelos (paquete_id, empaquetado_id, destino_id, aerolinea, ruta, fecha_ida, fecha_regreso, proveedor, neto, pvp, notas, orden)
  select v_id, r.empaquetado_id, r.destino_id, r.aerolinea, r.ruta, r.fecha_ida, r.fecha_regreso, r.proveedor,
         coalesce(r.neto, '{}'::jsonb), coalesce(r.pvp, '{}'::jsonb), r.notas, (row_number() over ())::integer - 1
    from jsonb_populate_recordset(null::public.paquete_din_vuelos, coalesce(p_vuelos, '[]'::jsonb)) r;
  insert into public.paquete_din_hoteles (paquete_id, hotel_id, nombre, categoria, regimen, descripcion, foto_url, proveedor, neto, pvp, pvp_general, orden)
  select v_id, r.hotel_id, r.nombre, r.categoria, r.regimen, r.descripcion, r.foto_url, r.proveedor,
         coalesce(r.neto, '{}'::jsonb), coalesce(r.pvp, '{}'::jsonb), r.pvp_general, (row_number() over ())::integer - 1
    from jsonb_populate_recordset(null::public.paquete_din_hoteles, coalesce(p_hoteles, '[]'::jsonb)) r;
  insert into public.paquete_din_servicios (paquete_id, servicio_id, destino_id, nombre, proveedor, neto, pvp, orden)
  select v_id, r.servicio_id, r.destino_id, r.nombre, r.proveedor, r.neto, r.pvp, (row_number() over ())::integer - 1
    from jsonb_populate_recordset(null::public.paquete_din_servicios, coalesce(p_servicios, '[]'::jsonb)) r;
  return v_id;
end $$;
revoke all on function public.guardar_paquete_din(bigint, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_paquete_din(bigint, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;
create or replace function p82_priv.validar_solicitud(p public.paquete_din, p_cab jsonb) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  hoy date := public.fecha_negocio();
  ida date; reg date;
  v_h bigint; v_v bigint;
  vu public.paquete_din_vuelos;
begin
  if p.activo is not true or p.publicado is not true then
    raise exception 'DIN_82_NO_PUBLICADO: el paquete no está disponible para cotizar.' using errcode = 'P0001';
  end if;
  if (p.compra_inicio is not null and hoy < p.compra_inicio) or (p.compra_fin is not null and hoy > p.compra_fin) then
    raise exception 'DIN_82_COMPRA: el paquete no está en su vigencia de compra.' using errcode = 'P0001';
  end if;
  begin
    ida := nullif(p_cab->>'fecha_salida', '')::date;
    reg := nullif(p_cab->>'fecha_regreso', '')::date;
  exception when others then
    raise exception 'DIN_82_FECHAS: las fechas del viaje no son válidas.' using errcode = 'P0001';
  end;
  if ida is null or reg is null or ida < hoy or (reg - ida) <> p.noches then
    raise exception 'DIN_82_FECHAS: el viaje debe ser futuro y durar exactamente % noches.', p.noches using errcode = 'P0001';
  end if;
  if (p.viaje_inicio is not null and ida < p.viaje_inicio) or (p.viaje_fin is not null and reg > p.viaje_fin) then
    raise exception 'DIN_82_FECHAS: las fechas están fuera de la ventana de viaje del paquete.' using errcode = 'P0001';
  end if;
  begin
    v_h := nullif(p_cab #>> '{payload,dinamico,hotelId}', '')::bigint;
    v_v := nullif(p_cab #>> '{payload,dinamico,vueloId}', '')::bigint;
  exception when others then
    raise exception 'DIN_82_FECHAS: la opción elegida no es válida.' using errcode = 'P0001';
  end;
  if p.usa_hotel then
    if v_h is null or not exists (select 1 from public.paquete_din_hoteles h where h.id = v_h and h.paquete_id = p.id) then
      raise exception 'DIN_82_HOTEL: el hotel elegido no pertenece al paquete.' using errcode = 'P0001';
    end if;
  elsif v_h is not null then
    raise exception 'DIN_82_HOTEL: el paquete no incluye hotel.' using errcode = 'P0001';
  end if;
  if p.usa_vuelo then
    select * into vu from public.paquete_din_vuelos v where v.id = v_v and v.paquete_id = p.id;
    if not found then
      raise exception 'DIN_82_VUELO: el vuelo elegido no pertenece al paquete.' using errcode = 'P0001';
    end if;
    if (vu.fecha_ida is not null and vu.fecha_ida <> ida) or (vu.fecha_regreso is not null and vu.fecha_regreso <> reg) then
      raise exception 'DIN_82_VUELO: las fechas pedidas no coinciden con las del vuelo elegido.' using errcode = 'P0001';
    end if;
  elsif v_v is not null then
    raise exception 'DIN_82_VUELO: el paquete no incluye vuelo.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function p82_priv.validar_solicitud(public.paquete_din, jsonb) from public, anon, authenticated;
grant execute on function p82_priv.validar_solicitud(public.paquete_din, jsonb) to service_role;
drop function if exists p82_priv.vinculos_desalineados(bigint, bigint, boolean);
alter table public.paquete_din_vuelos drop constraint if exists paquete_din_vuelos_iata_check;
alter table public.paquete_din_vuelos drop column if exists origen_iata;
alter table public.paquete_din_vuelos drop column if exists destino_iata;
alter table public.paquete_din_servicios drop column if exists proveedor_id;
alter table public.paquete_din drop column if exists multidestino;
commit;
