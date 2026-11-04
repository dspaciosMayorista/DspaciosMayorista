-- 277 (#82) — Experiencia del hotel manual del paquete 100 % dinámico: capacidad de niños y edades. ADITIVA sobre la 274/275/276 (no las modifica).
--   · paquete_din_hoteles.capacidad_ninos: capacidad máxima de niños por habitación (0 a 2: el sistema cobra hasta Niño 1 y Niño 2 por habitación), aplicada de forma
--     GENERAL a todas las acomodaciones del hotel manual (simplificación de este producto).
--   · edad_infante_max / edad_nino_max: umbrales de edad del hotel manual (infante hasta X años, niño hasta Y años; desde Y+1 se cuenta como adulto).
--   · Un hotel manual NUEVO exige las tres. Un hotel con FICHA no las guarda: sus reglas (edades, acomodaciones, pax, solo adultos) se leen de la ficha al cotizar.
--   · Los hoteles manuales ya guardados quedan con las tres en NULL (paquete anterior: sin validación de capacidad) hasta que se vuelvan a guardar.
--   · paquete_din_servicios.pvp_infante: PVP del menor de 2 años de un servicio VINCULADO por persona en solo PVP (la ficha cobra al infante: el equipo lo define,
--     0 = gratis explícito; NULL = no definido). Por grupo no aplica. El resto de servicios no lo usa.
--   + guardar_paquete_din se redefine para guardar esas columnas.
-- Orden: preflight → 274 → 275 → 276 → esta migración → postcheck → recién después el código.
-- Rollback: supabase/scripts/rollback_277_paquete_dinamico_hotel_menores.sql.

alter table public.paquete_din_hoteles add column if not exists capacidad_ninos smallint;
alter table public.paquete_din_hoteles add column if not exists edad_infante_max smallint;
alter table public.paquete_din_hoteles add column if not exists edad_nino_max smallint;
alter table public.paquete_din_hoteles drop constraint if exists paquete_din_hoteles_menores_check;
alter table public.paquete_din_hoteles add constraint paquete_din_hoteles_menores_check check (
  (capacidad_ninos is null or capacidad_ninos between 0 and 2)
  and (edad_infante_max is null or edad_infante_max between 0 and 17)
  and (edad_nino_max is null or edad_nino_max between 0 and 17)
  and (edad_infante_max is null or edad_nino_max is null or edad_nino_max > edad_infante_max));

alter table public.paquete_din_servicios add column if not exists pvp_infante numeric(15,2);
alter table public.paquete_din_servicios drop constraint if exists paquete_din_servicios_pvp_infante_check;
alter table public.paquete_din_servicios add constraint paquete_din_servicios_pvp_infante_check check (pvp_infante is null or pvp_infante >= 0);

create or replace function public.tg_din_hotel_menores() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_revisar boolean := false;
begin
  if new.hotel_id is not null then
    -- Con ficha: las reglas salen de la ficha; no se guarda otra copia que pueda contradecirla.
    new.capacidad_ninos := null; new.edad_infante_max := null; new.edad_nino_max := null;
    return new;
  end if;
  if tg_op = 'INSERT' then
    v_revisar := true;
  else
    v_revisar := old.hotel_id is not null or new.capacidad_ninos is distinct from old.capacidad_ninos
      or new.edad_infante_max is distinct from old.edad_infante_max or new.edad_nino_max is distinct from old.edad_nino_max;
  end if;
  if v_revisar and (new.capacidad_ninos is null or new.edad_infante_max is null or new.edad_nino_max is null) then
    raise exception 'DIN_82_MENORES: el hotel manual «%» necesita la capacidad máxima de niños por habitación y las edades de infante y niño.', new.nombre using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.tg_din_hotel_menores() from public, anon, authenticated;
drop trigger if exists trg_din_hotel_menores on public.paquete_din_hoteles;
create trigger trg_din_hotel_menores before insert or update on public.paquete_din_hoteles
  for each row execute function public.tg_din_hotel_menores();

-- ═══ Guardado atómico (redefine el de la 276: + capacidad y edades del hotel manual) ═══
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
