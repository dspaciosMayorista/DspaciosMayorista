-- 276 (#82) — Feedback de Preview del paquete 100 % dinámico. ADITIVA sobre la 274/275 (no las modifica).
--   1. Multidestino explícito: `paquete_din.multidestino`. Sin activarlo no puede haber destinos adicionales; activado, solo del MISMO país que el
--      principal (destinos.pais, comparado con pais_comparable_67 de la 220). Vuelos y servicios solo pueden ser de un destino del paquete.
--   2. Ruta del vuelo derivada, nunca libre: vinculado a Empaquetados → la ruta del empaquetado; manual → origen_iata + destino_iata (3 letras).
--   3. Servicios vinculados: el proveedor sale de servicios_adicionales.proveedor_id (y su ficha en proveedores); no se escribe a mano. Publicar
--      exige que la ficha tenga proveedor. La moneda del servicio y del hotel vinculado debe ser la del paquete.
--   + Guarda de ficha fuente: un vuelo/servicio VINCULADO debe declarar (destino_id, o el principal si va vacío) el destino de su ficha fuente
--      (empaquetados.destino_id / servicios_adicionales.destino_id). Un destino_id válido pero falso se rechaza; los manuales y los servicios nacionales (sin destino) no se comparan.
--   + Ficha que cambia de destino DESPUÉS de vincularse: publicar y cotizar revisan los vínculos (`p82_priv.vinculos_desalineados`); `p82_priv.validar_solicitud` se redefine.
--   + `guardar_paquete_din` se redefine (multidestino) y borra los hijos ANTES de actualizar la cabecera, para que las reglas de destino/moneda
--      de la cabecera no choquen con hijos que el mismo guardado va a reemplazar.
-- Orden: preflight → 274 → 275 → esta migración → postcheck → recién después el código.
-- Rollback: supabase/scripts/rollback_276_paquete_dinamico_multidestino_ruta_proveedor.sql.

-- ═══ Columnas ═══
alter table public.paquete_din add column if not exists multidestino boolean not null default false;
update public.paquete_din set multidestino = true where multidestino is false and coalesce(cardinality(destinos_extra), 0) > 0;

alter table public.paquete_din_vuelos add column if not exists origen_iata text;
alter table public.paquete_din_vuelos add column if not exists destino_iata text;
alter table public.paquete_din_vuelos drop constraint if exists paquete_din_vuelos_iata_check;
alter table public.paquete_din_vuelos add constraint paquete_din_vuelos_iata_check
  check ((origen_iata is null or origen_iata ~ '^[A-Z]{3}$') and (destino_iata is null or destino_iata ~ '^[A-Z]{3}$'));

alter table public.paquete_din_servicios add column if not exists proveedor_id bigint references public.proveedores (id);
-- Backfill ANTES de crear los triggers: lo ya vinculado toma el proveedor de la ficha (solo si la ficha lo tiene).
update public.paquete_din_servicios ps
   set proveedor_id = s.proveedor_id, proveedor = coalesce(pr.nombre, ps.proveedor)
  from public.servicios_adicionales s left join public.proveedores pr on pr.id = s.proveedor_id
 where ps.servicio_id = s.id and s.proveedor_id is not null;

-- ═══ 1. Cabecera: multidestino, país y coherencia con los hijos ═══
create or replace function public.tg_din_paquete_reglas() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pais text;
  v_mal bigint[];
  v_perm bigint[];
begin
  if not new.multidestino then
    if coalesce(cardinality(new.destinos_extra), 0) > 0 then
      raise exception 'DIN_82_MULTIDESTINO: activa «multidestino» para poder usar destinos adicionales.' using errcode = 'P0001';
    end if;
  elsif coalesce(cardinality(new.destinos_extra), 0) > 0 then
    if new.destino_id is null then
      raise exception 'DIN_82_MULTIDESTINO: elige el destino principal antes de agregar destinos adicionales.' using errcode = 'P0001';
    end if;
    if new.destino_id = any (new.destinos_extra) then
      raise exception 'DIN_82_MULTIDESTINO: el destino principal no puede repetirse como adicional.' using errcode = 'P0001';
    end if;
    select public.pais_comparable_67(d.pais) into v_pais from public.destinos d where d.id = new.destino_id;
    if v_pais is null then
      raise exception 'DIN_82_PAIS: el destino principal no tiene país cargado; completa su ficha de destino.' using errcode = 'P0001';
    end if;
    select coalesce(array_agg(d.id), '{}') into v_mal from public.destinos d
     where d.id = any (new.destinos_extra) and public.pais_comparable_67(d.pais) is distinct from v_pais;
    if coalesce(cardinality(v_mal), 0) > 0 then
      raise exception 'DIN_82_PAIS: los destinos adicionales deben ser del mismo país que el principal (no lo cumplen: %).', v_mal using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    v_perm := array_remove(array[new.destino_id] || coalesce(new.destinos_extra, '{}'), null);
    if exists (select 1 from public.paquete_din_vuelos v where v.paquete_id = new.id and v.destino_id is not null and v.destino_id <> all (v_perm))
       or exists (select 1 from public.paquete_din_servicios s where s.paquete_id = new.id and s.destino_id is not null and s.destino_id <> all (v_perm)) then
      raise exception 'DIN_82_DESTINO: un vuelo o servicio del paquete es de un destino que ya no está en el paquete.' using errcode = 'P0001';
    end if;
    if new.destino_id is distinct from old.destino_id
       and (exists (select 1 from public.paquete_din_vuelos v join public.empaquetados e on e.id = v.empaquetado_id where v.paquete_id = new.id and v.destino_id is null and e.destino_id is not null and e.destino_id is distinct from new.destino_id)
         or exists (select 1 from public.paquete_din_servicios s join public.servicios_adicionales x on x.id = s.servicio_id where s.paquete_id = new.id and s.destino_id is null and x.destino_id is not null and x.destino_id is distinct from new.destino_id)) then
      raise exception 'DIN_82_DESTINO: hay vuelos o servicios vinculados cuya ficha es de otro destino que el nuevo principal.' using errcode = 'P0001';
    end if;
    if new.moneda is distinct from old.moneda then
      if exists (select 1 from public.paquete_din_hoteles h join public.hoteles x on x.id = h.hotel_id where h.paquete_id = new.id and x.moneda is distinct from new.moneda)
         or exists (select 1 from public.paquete_din_servicios s join public.servicios_adicionales x on x.id = s.servicio_id where s.paquete_id = new.id and x.moneda is distinct from new.moneda) then
        raise exception 'DIN_82_MONEDA: hay hoteles o servicios vinculados en otra moneda que la nueva del paquete.' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.tg_din_paquete_reglas() from public, anon, authenticated;
drop trigger if exists trg_din_paquete_reglas on public.paquete_din;
create trigger trg_din_paquete_reglas before insert or update of destino_id, destinos_extra, multidestino, moneda on public.paquete_din
  for each row execute function public.tg_din_paquete_reglas();

-- ═══ 2. Vuelos: destino del paquete y ruta DERIVADA ═══
create or replace function public.tg_din_vuelo_reglas() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  e record;
begin
  select destino_id, destinos_extra into p from public.paquete_din where id = new.paquete_id;
  if new.destino_id is not null
     and not (coalesce(new.destino_id = p.destino_id, false) or coalesce(new.destino_id = any (coalesce(p.destinos_extra, '{}')), false)) then
    raise exception 'DIN_82_DESTINO: el vuelo es de un destino que no está en el paquete.' using errcode = 'P0001';
  end if;
  if new.empaquetado_id is not null then
    select em.ruta as ruta, em.origen as origen, d.codigo_iata as destino_iata, em.destino_id as destino_src into e
      from public.empaquetados em left join public.destinos d on d.id = em.destino_id where em.id = new.empaquetado_id;
    if e.destino_src is not null and e.destino_src is distinct from coalesce(new.destino_id, p.destino_id) then
      raise exception 'DIN_82_DESTINO: el empaquetado % es de otro destino que el declarado para el vuelo.', new.empaquetado_id using errcode = 'P0001';
    end if;
    if e.ruta is null or btrim(e.ruta) = '' then
      raise exception 'DIN_82_RUTA: el empaquetado % no tiene ruta cargada; complétala en Empaquetados.', new.empaquetado_id using errcode = 'P0001';
    end if;
    new.ruta := btrim(e.ruta);
    new.origen_iata := nullif(upper(btrim(coalesce(e.origen, ''))), '');
    new.destino_iata := nullif(upper(btrim(coalesce(e.destino_iata, ''))), '');
    if new.origen_iata !~ '^[A-Z]{3}$' then new.origen_iata := null; end if;
    if new.destino_iata !~ '^[A-Z]{3}$' then new.destino_iata := null; end if;
  else
    new.origen_iata := upper(btrim(coalesce(new.origen_iata, '')));
    new.destino_iata := upper(btrim(coalesce(new.destino_iata, '')));
    if new.origen_iata !~ '^[A-Z]{3}$' or new.destino_iata !~ '^[A-Z]{3}$' then
      raise exception 'DIN_82_RUTA: un vuelo manual necesita origen y destino con código IATA de 3 letras.' using errcode = 'P0001';
    end if;
    if new.origen_iata = new.destino_iata then
      raise exception 'DIN_82_RUTA: el origen y el destino del vuelo no pueden ser el mismo.' using errcode = 'P0001';
    end if;
    new.ruta := new.origen_iata || ' - ' || new.destino_iata || case when new.fecha_regreso is not null then ' - ' || new.origen_iata else '' end;
  end if;
  return new;
end $$;
revoke all on function public.tg_din_vuelo_reglas() from public, anon, authenticated;
drop trigger if exists trg_din_vuelo_reglas on public.paquete_din_vuelos;
create trigger trg_din_vuelo_reglas before insert or update on public.paquete_din_vuelos
  for each row execute function public.tg_din_vuelo_reglas();

-- ═══ 3. Servicios: destino, moneda y proveedor DE LA FICHA ═══
create or replace function public.tg_din_servicio_reglas() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  sv record;
begin
  select destino_id, destinos_extra, moneda into p from public.paquete_din where id = new.paquete_id;
  if new.destino_id is not null
     and not (coalesce(new.destino_id = p.destino_id, false) or coalesce(new.destino_id = any (coalesce(p.destinos_extra, '{}')), false)) then
    raise exception 'DIN_82_DESTINO: el servicio es de un destino que no está en el paquete.' using errcode = 'P0001';
  end if;
  if new.servicio_id is not null then
    select s.moneda as moneda, s.proveedor_id as pid, pr.nombre as pnombre, s.destino_id as destino_src into sv
      from public.servicios_adicionales s left join public.proveedores pr on pr.id = s.proveedor_id where s.id = new.servicio_id;
    if sv.destino_src is not null and sv.destino_src is distinct from coalesce(new.destino_id, p.destino_id) then
      raise exception 'DIN_82_DESTINO: el servicio «%» es de otro destino que el declarado en el paquete.', new.nombre using errcode = 'P0001';
    end if;
    if sv.moneda is distinct from p.moneda then
      raise exception 'DIN_82_MONEDA: el servicio «%» está en % y el paquete en %.', new.nombre, sv.moneda, p.moneda using errcode = 'P0001';
    end if;
    new.proveedor_id := sv.pid;
    new.proveedor := sv.pnombre;
  else
    new.proveedor_id := null;
  end if;
  return new;
end $$;
revoke all on function public.tg_din_servicio_reglas() from public, anon, authenticated;
drop trigger if exists trg_din_servicio_reglas on public.paquete_din_servicios;
create trigger trg_din_servicio_reglas before insert or update on public.paquete_din_servicios
  for each row execute function public.tg_din_servicio_reglas();

-- Hotel ficha: misma moneda que el paquete.
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

-- Publicar: re-lee la ficha de cada servicio vinculado y exige que tenga proveedor (sin él no habría a quién registrar el costo al convertir).
create or replace function public.tg_din_publicar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_falta text; v_mal text;
begin
  if new.publicado is true and old.publicado is distinct from true then
    v_mal := p82_priv.vinculos_desalineados(new.id, null, true);
    if v_mal is not null then
      raise exception 'DIN_82_DESTINO: no se puede publicar: la ficha de % cambió de destino y ya no coincide con el del paquete.', v_mal using errcode = 'P0001';
    end if;
    update public.paquete_din_servicios set servicio_id = servicio_id where paquete_id = new.id and servicio_id is not null;
    select string_agg(nombre, ', ' order by orden) into v_falta from public.paquete_din_servicios
     where paquete_id = new.id and servicio_id is not null and proveedor_id is null;
    if v_falta is not null then
      raise exception 'DIN_82_PROVEEDOR: no se puede publicar: la ficha de % no tiene proveedor (Producto > Servicios).', v_falta using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.tg_din_publicar() from public, anon, authenticated;
drop trigger if exists trg_din_publicar on public.paquete_din;
create trigger trg_din_publicar before update of publicado on public.paquete_din
  for each row execute function public.tg_din_publicar();

-- Selector de fichas vinculables: ahora trae la moneda (solo se ofrecen las de la moneda del paquete).
drop function if exists public.hoteles_vinculables_din();
create function public.hoteles_vinculables_din() returns table (id bigint, nombre text, destino_id bigint, moneda text)
language sql stable security definer set search_path = public, pg_temp as $$
  select h.id, h.nombre, h.destino_id, h.moneda from public.hoteles h
   where public.mi_rol()::text in ('superadmin', 'gerencia', 'administracion', 'operaciones')
     and public.hotel_vinculable_din(h.id)
   order by h.nombre
$$;
revoke all on function public.hoteles_vinculables_din() from public, anon;
grant execute on function public.hoteles_vinculables_din() to authenticated, service_role;

-- ═══ Vínculos desalineados: la ficha fuente cambió de destino después de vincularse ═══
-- Devuelve los nombres (o NULL) de los vuelos y servicios vinculados cuyo destino en la ficha fuente ya no es el declarado en el paquete.
-- p_todos = true revisa todos los vuelos (publicar); false, solo p_vuelo (cotizar). Los servicios se revisan siempre. No modifica nada.
create or replace function p82_priv.vinculos_desalineados(p_paquete bigint, p_vuelo bigint, p_todos boolean) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select string_agg(t, ', ' order by t) from (
    select 'vuelo ' || coalesce(nullif(v.ruta, ''), v.id::text) as t
      from public.paquete_din_vuelos v join public.paquete_din p on p.id = v.paquete_id join public.empaquetados e on e.id = v.empaquetado_id
     where v.paquete_id = p_paquete and (p_todos or v.id = p_vuelo)
       and e.destino_id is not null and e.destino_id is distinct from coalesce(v.destino_id, p.destino_id)
    union all
    select 'servicio ' || s.nombre
      from public.paquete_din_servicios s join public.paquete_din p on p.id = s.paquete_id join public.servicios_adicionales x on x.id = s.servicio_id
     where s.paquete_id = p_paquete
       and x.destino_id is not null and x.destino_id is distinct from coalesce(s.destino_id, p.destino_id)
  ) q
$$;
revoke all on function p82_priv.vinculos_desalineados(bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function p82_priv.vinculos_desalineados(bigint, bigint, boolean) to service_role;

-- Misma regla de la 275, más la guarda de vínculos desalineados (cotizar).
create or replace function p82_priv.validar_solicitud(p public.paquete_din, p_cab jsonb) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  hoy date := public.fecha_negocio();
  ida date; reg date;
  v_h bigint; v_v bigint;
  vu public.paquete_din_vuelos;
  v_mal text;
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
  -- 276: la ficha fuente pudo cambiar de destino DESPUÉS de vincularse; un paquete publicado no se cotiza con un vínculo desalineado.
  v_mal := p82_priv.vinculos_desalineados(p.id, case when p.usa_vuelo then v_v else null end, false);
  if v_mal is not null then
    raise exception 'DIN_82_DESTINO: este paquete tiene vínculos cuya ficha cambió de destino (%); no se puede cotizar hasta corregirlo.', v_mal using errcode = 'P0001';
  end if;
end $$;
revoke all on function p82_priv.validar_solicitud(public.paquete_din, jsonb) from public, anon, authenticated;
grant execute on function p82_priv.validar_solicitud(public.paquete_din, jsonb) to service_role;
-- ═══ Guardado atómico (redefine el de la 275: + multidestino, hijos antes que cabecera) ═══
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
