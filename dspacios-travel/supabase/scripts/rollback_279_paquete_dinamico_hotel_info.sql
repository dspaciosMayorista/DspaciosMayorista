-- Rollback de la 279 (#82). Deja la base como tras la 277: sin estrellas ni ubicación del hotel del paquete. Restaura guardar_paquete_din de la 277.
-- Se pierden los valores guardados en esas dos columnas (la ficha del hotel no se toca).
begin;
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
    insert into public.paquete_din (tenant, nombre, destino_id, multidestino, destinos_extra, moneda, esquema, pvp_modo, pct_mk, usa_vuelo, usa_hotel, usa_servicios, noches,
                                    compra_inicio, compra_fin, viaje_inicio, viaje_fin, pvp_general, total_declarado, descripcion, incluye, no_incluye, creado_por)
    select v_tenant, r.nombre, r.destino_id, coalesce(r.multidestino, false), coalesce(r.destinos_extra, '{}'), coalesce(r.moneda, 'COP'), r.esquema, r.pvp_modo, coalesce(r.pct_mk, 0),
           coalesce(r.usa_vuelo, false), coalesce(r.usa_hotel, false), coalesce(r.usa_servicios, false), coalesce(r.noches, 3),
           r.compra_inicio, r.compra_fin, r.viaje_inicio, r.viaje_fin, r.pvp_general, r.total_declarado, r.descripcion, r.incluye, r.no_incluye, auth.uid()
      from jsonb_populate_record(null::public.paquete_din, p_cabecera) r
    returning id into v_id;
  else
    select id into v_id from public.paquete_din where id = p_id for update;
    if v_id is null then
      raise exception 'DIN_82_PAQUETE: el paquete no existe o no pertenece a tu agencia.' using errcode = 'P0001';
    end if;
    delete from public.paquete_din_vuelos where paquete_id = v_id;
    delete from public.paquete_din_hoteles where paquete_id = v_id;
    delete from public.paquete_din_servicios where paquete_id = v_id;
    update public.paquete_din t
       set nombre = r.nombre, destino_id = r.destino_id, multidestino = coalesce(r.multidestino, false), destinos_extra = coalesce(r.destinos_extra, '{}'),
           moneda = coalesce(r.moneda, 'COP'),
           esquema = r.esquema, pvp_modo = r.pvp_modo, pct_mk = coalesce(r.pct_mk, 0), usa_vuelo = coalesce(r.usa_vuelo, false),
           usa_hotel = coalesce(r.usa_hotel, false), usa_servicios = coalesce(r.usa_servicios, false), noches = coalesce(r.noches, 3),
           compra_inicio = r.compra_inicio, compra_fin = r.compra_fin, viaje_inicio = r.viaje_inicio, viaje_fin = r.viaje_fin,
           pvp_general = r.pvp_general, total_declarado = r.total_declarado, descripcion = r.descripcion, incluye = r.incluye, no_incluye = r.no_incluye,
           publicado = false, updated_at = now()
      from jsonb_populate_record(null::public.paquete_din, p_cabecera) r
     where t.id = v_id;
  end if;

  insert into public.paquete_din_vuelos (paquete_id, empaquetado_id, destino_id, aerolinea, origen_iata, destino_iata, ruta, fecha_ida, fecha_regreso, proveedor, neto, pvp, notas, orden)
  select v_id, r.empaquetado_id, r.destino_id, r.aerolinea, r.origen_iata, r.destino_iata, r.ruta, r.fecha_ida, r.fecha_regreso, r.proveedor,
         coalesce(r.neto, '{}'::jsonb), coalesce(r.pvp, '{}'::jsonb), r.notas, (row_number() over ())::integer - 1
    from jsonb_populate_recordset(null::public.paquete_din_vuelos, coalesce(p_vuelos, '[]'::jsonb)) r;
  insert into public.paquete_din_hoteles (paquete_id, hotel_id, nombre, categoria, regimen, descripcion, foto_url, proveedor, neto, pvp, pvp_general, capacidad_ninos, edad_infante_max, edad_nino_max, orden)
  select v_id, r.hotel_id, r.nombre, r.categoria, r.regimen, r.descripcion, r.foto_url, r.proveedor,
         coalesce(r.neto, '{}'::jsonb), coalesce(r.pvp, '{}'::jsonb), r.pvp_general, r.capacidad_ninos, r.edad_infante_max, r.edad_nino_max, (row_number() over ())::integer - 1
    from jsonb_populate_recordset(null::public.paquete_din_hoteles, coalesce(p_hoteles, '[]'::jsonb)) r;
  insert into public.paquete_din_servicios (paquete_id, servicio_id, destino_id, nombre, proveedor, neto, pvp, pvp_infante, orden)
  select v_id, r.servicio_id, r.destino_id, r.nombre, r.proveedor, r.neto, r.pvp, r.pvp_infante, (row_number() over ())::integer - 1
    from jsonb_populate_recordset(null::public.paquete_din_servicios, coalesce(p_servicios, '[]'::jsonb)) r;
  return v_id;
end $$;
revoke all on function public.guardar_paquete_din(bigint, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_paquete_din(bigint, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;
alter table public.paquete_din_hoteles drop constraint if exists paquete_din_hoteles_info_check;
alter table public.paquete_din_hoteles drop column if exists estrellas;
alter table public.paquete_din_hoteles drop column if exists ubicacion;
commit;
