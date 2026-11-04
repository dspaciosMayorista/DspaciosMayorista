-- 275 (#82) — Corrige los cuatro bloqueos de la auditoría del paquete 100 % dinámico. ADITIVA sobre la 274 (no la modifica).
--   1. Aislamiento por agencia: las tablas paquete_din* (netas y proveedores) pasan a RLS por AGENCIA. Un rol de producto solo lee/escribe
--      las de su agencia; solo superadmin cruza. Esto incluye gerencia (a diferencia de puede_ver_tenant()): estas tablas guardan costos.
--   2. Canales de cotización: `crear_cotizacion_din_externa` crea la cotización del VISITANTE sin sesión ('publico') y del aliado B2B
--      ('b2b', agencia/freelance activo con su aliado), sin identidad interna ficticia. El autor/propietario/aliado los fija la base.
--   3. Publicación y fechas: `p82_priv.validar_solicitud` exige paquete activo y publicado, vigencia de compra, noches, ventana de viaje y
--      coherencia con el vuelo/hotel elegidos. Lo usan los DOS caminos (interno y externo): ninguna petición vieja se salta las reglas.
--   4. Hoteles vinculables: solo fichas activas SIN vigencias ni tarifas (temporadas, tarifa_hotel, tarifas por unidad, calculadora),
--      con selector (`hoteles_vinculables_din`) y guarda en la base (trigger) al guardar.
--   + Guardado ATÓMICO del paquete: `guardar_paquete_din` (una sola transacción; un error no deja hijos reemplazados a medias).
-- Orden: preflight → 274 → esta migración → postcheck → recién después el código.
-- Rollback: supabase/scripts/rollback_275_paquete_dinamico_auditoria.sql.

create schema if not exists p82_priv;
revoke all on schema p82_priv from public, anon, authenticated;
grant usage on schema p82_priv to service_role;

-- ═══ 1. RLS por agencia ═══
-- Roles de producto de SU agencia; superadmin cruza. SECURITY DEFINER solo para poder leer mi_rol()/mi_tenant() sin recursión.
create or replace function public.puede_producto_din(t text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.mi_rol()::text = 'superadmin'
      or (public.mi_rol()::text in ('gerencia', 'administracion', 'operaciones') and public.mi_tenant() = t)
$$;
revoke all on function public.puede_producto_din(text) from public, anon;
grant execute on function public.puede_producto_din(text) to authenticated, service_role;

drop policy if exists "paquete_din: producto" on public.paquete_din;
create policy "paquete_din: producto" on public.paquete_din for all to authenticated
  using (public.puede_producto_din(tenant))
  with check (public.puede_producto_din(tenant));

-- Los hijos heredan la visibilidad del padre (el EXISTS se evalúa con la RLS del padre: misma agencia y rol).
drop policy if exists "paquete_din_vuelos: producto" on public.paquete_din_vuelos;
create policy "paquete_din_vuelos: producto" on public.paquete_din_vuelos for all to authenticated
  using (exists (select 1 from public.paquete_din p where p.id = paquete_din_vuelos.paquete_id))
  with check (exists (select 1 from public.paquete_din p where p.id = paquete_din_vuelos.paquete_id));
drop policy if exists "paquete_din_hoteles: producto" on public.paquete_din_hoteles;
create policy "paquete_din_hoteles: producto" on public.paquete_din_hoteles for all to authenticated
  using (exists (select 1 from public.paquete_din p where p.id = paquete_din_hoteles.paquete_id))
  with check (exists (select 1 from public.paquete_din p where p.id = paquete_din_hoteles.paquete_id));
drop policy if exists "paquete_din_servicios: producto" on public.paquete_din_servicios;
create policy "paquete_din_servicios: producto" on public.paquete_din_servicios for all to authenticated
  using (exists (select 1 from public.paquete_din p where p.id = paquete_din_servicios.paquete_id))
  with check (exists (select 1 from public.paquete_din p where p.id = paquete_din_servicios.paquete_id));

-- Como la RLS ya no deja ver TODAS las filas, el modal de borrado de destinos cuenta estas tres tablas con esta función
-- (solo conteos, sin datos; solo roles que pueden borrar destinos).
create or replace function public.uso_destino_din(p_destino bigint) returns table (tabla text, n bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select 'paquete_din'::text, count(*) from public.paquete_din where (destino_id = p_destino or p_destino = any (destinos_extra)) and public.mi_rol()::text in ('superadmin', 'gerencia', 'administracion', 'operaciones')
  union all
  select 'paquete_din_vuelos', count(*) from public.paquete_din_vuelos where destino_id = p_destino and public.mi_rol()::text in ('superadmin', 'gerencia', 'administracion', 'operaciones')
  union all
  select 'paquete_din_servicios', count(*) from public.paquete_din_servicios where destino_id = p_destino and public.mi_rol()::text in ('superadmin', 'gerencia', 'administracion', 'operaciones')
$$;
revoke all on function public.uso_destino_din(bigint) from public, anon;
grant execute on function public.uso_destino_din(bigint) to authenticated, service_role;

-- ═══ 4. Hoteles vinculables ═══
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

create or replace function public.hoteles_vinculables_din() returns table (id bigint, nombre text, destino_id bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select h.id, h.nombre, h.destino_id from public.hoteles h
   where public.mi_rol()::text in ('superadmin', 'gerencia', 'administracion', 'operaciones')
     and public.hotel_vinculable_din(h.id)
   order by h.nombre
$$;
revoke all on function public.hoteles_vinculables_din() from public, anon;
grant execute on function public.hoteles_vinculables_din() to authenticated, service_role;

create or replace function public.tg_din_hotel_vinculable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_revisar boolean := false;
begin
  -- Se revisa al vincular una ficha (alta) o al cambiarla; nunca se toca OLD en un INSERT.
  if new.hotel_id is not null then
    if tg_op = 'INSERT' then
      v_revisar := true;
    else
      v_revisar := old.hotel_id is distinct from new.hotel_id;
    end if;
  end if;
  if v_revisar and not public.hotel_vinculable_din(new.hotel_id) then
    raise exception 'DIN_82_HOTEL: la ficha % no se puede vincular: debe estar activa y no tener vigencias ni tarifas (usa un hotel manual).', new.hotel_id using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_din_hotel_vinculable on public.paquete_din_hoteles;
create trigger trg_din_hotel_vinculable before insert or update on public.paquete_din_hoteles
  for each row execute function public.tg_din_hotel_vinculable();

-- ═══ 3. Reglas de la solicitud (publicación, compra, viaje, noches, vuelo/hotel) ═══
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

-- Camino INTERNO (personal con rol): misma firma que la 274, ahora con las reglas de arriba ANTES de escribir nada.
create or replace function public.crear_cotizacion_din(
  p_usuario_id uuid, p_tenant text, p_paquete_id bigint, p_cabecera jsonb, p_servicios jsonb
) returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  p public.paquete_din;
  c public.cotizaciones;
  v_id bigint;
begin
  select * into p from public.paquete_din where id = p_paquete_id;
  if not found then
    raise exception 'DIN_82_PAQUETE: el paquete no existe.' using errcode = 'P0001';
  end if;
  perform p82_priv.validar_solicitud(p, p_cabecera);
  if upper(coalesce(p_cabecera->>'moneda', 'COP')) <> p.moneda then
    raise exception 'DIN_82_MONEDA: la cotización debe estar en la moneda del paquete (%).', p.moneda using errcode = 'P0001';
  end if;
  v_id := public.crear_cotizacion_manual(p_usuario_id, p_tenant, p_cabecera, p_servicios);
  select * into c from public.cotizaciones where id = v_id;
  if c.tenant is distinct from p.tenant then
    raise exception 'DIN_82_PAQUETE: el paquete pertenece a otra agencia.' using errcode = '42501';
  end if;
  perform set_config('p82.din', '1', true);
  update public.cotizaciones set paquete_din_id = p.id where id = v_id;
  perform public.din_marcar_lineas(v_id, p_servicios);
  insert into public.cotizacion_versiones (cotizacion_id, tenant, version, motivo, precio_venta, moneda, documento, lineas, creado_por)
  values (v_id, c.tenant, 1, 'Versión inicial', c.precio_venta, c.moneda, coalesce(c.detalle, '{}'::jsonb), public.din_lineas_sin_costo(v_id), p_usuario_id);
  perform set_config('p82.din', '', true);
  return v_id;
end $$;
revoke all on function public.crear_cotizacion_din(uuid, text, bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.crear_cotizacion_din(uuid, text, bigint, jsonb, jsonb) to service_role;

-- ═══ 2. Canales externos: visitante ('publico') y aliado B2B ('b2b') ═══
-- p_actor: NULL para el visitante; el id del usuario agencia/freelance para B2B. NUNCA se acepta un usuario interno aquí.
create or replace function public.crear_cotizacion_din_externa(
  p_canal text, p_actor uuid, p_paquete_id bigint, p_cabecera jsonb, p_servicios jsonb
) returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  p public.paquete_din;
  u public.usuarios;
  v_pay jsonb := p_cabecera->'payload';
  v_det jsonb := p_cabecera->'detalle';
  v_tenant text; v_aliado bigint; v_prop uuid; v_autor uuid; v_email_autor text;
  v_email text; v_tel text; v_contacto text;
  v_vig date; v_precio numeric; v_suma numeric; v_esperado numeric; v_id bigint;
begin
  select * into p from public.paquete_din where id = p_paquete_id;
  if not found then
    raise exception 'DIN_82_PAQUETE: el paquete no existe.' using errcode = 'P0001';
  end if;

  if p_canal = 'publico' then
    if p_actor is not null then
      raise exception 'DIN_82_CANAL: el canal público no admite usuario.' using errcode = 'P0001';
    end if;
    if p.tenant <> 'mayorista' then
      raise exception 'DIN_82_PAQUETE: el paquete no está disponible públicamente.' using errcode = 'P0001';
    end if;
    v_tenant := 'mayorista';
    v_email := lower(btrim(coalesce(v_pay #>> '{cliente,email}', '')));
    v_tel := regexp_replace(coalesce(v_pay #>> '{cliente,telefono}', ''), '\D', '', 'g');
    if length(btrim(coalesce(v_pay #>> '{cliente,nombres}', ''))) = 0
       or length(coalesce(v_pay #>> '{cliente,nombres}', '')) > 120 or length(coalesce(v_pay #>> '{cliente,apellidos}', '')) > 120
       or not (v_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_tel) >= 7) or length(v_email) > 200 then
      raise exception 'DIN_82_CONTACTO: indica tu nombre y un correo o teléfono de contacto válidos.' using errcode = 'P0001';
    end if;
    v_contacto := case when v_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_email else v_tel end;
    -- Tope por contacto (anti-abuso del enlace público): 5 cotizaciones por hora.
    if (select count(*) from public.cotizaciones c
         where c.paquete_din_id is not null and c.creado_por_id is null and c.propietario_id is null
           and c.created_at > now() - interval '1 hour'
           and (lower(c.payload #>> '{cliente,email}') = v_contacto
                or regexp_replace(coalesce(c.payload #>> '{cliente,telefono}', ''), '\D', '', 'g') = v_contacto)) >= 5 then
      raise exception 'DIN_82_LIMITE: ya generaste varias cotizaciones; intenta más tarde o contáctanos.' using errcode = 'P0001';
    end if;
  elsif p_canal = 'b2b' then
    select * into u from public.usuarios where id = p_actor;
    if not found or u.activo is not true or u.rol::text not in ('agencia', 'freelance') then
      raise exception 'DIN_82_CANAL: tu usuario no puede cotizar por este canal.' using errcode = '42501';
    end if;
    if u.tenant is distinct from p.tenant then
      raise exception 'DIN_82_PAQUETE: el paquete pertenece a otra agencia.' using errcode = '42501';
    end if;
    v_tenant := u.tenant; v_aliado := u.aliado_id; v_prop := u.id; v_autor := u.id; v_email_autor := u.email;
  else
    raise exception 'DIN_82_CANAL: canal no válido.' using errcode = 'P0001';
  end if;

  perform p82_priv.validar_solicitud(p, p_cabecera);
  if upper(coalesce(p_cabecera->>'moneda', 'COP')) <> p.moneda then
    raise exception 'DIN_82_MONEDA: la cotización debe estar en la moneda del paquete (%).', p.moneda using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_pay) is distinct from 'object' or jsonb_typeof(v_det) is distinct from 'object' then
    raise exception 'EDICION_39_INCOHERENTE: faltan los datos de la cotización.' using errcode = 'P0001';
  end if;
  perform p39_priv.validar_servicios(p_servicios);
  v_vig := nullif(p_cabecera->>'vigencia_hasta', '')::date;
  if v_vig is null or v_vig < public.fecha_negocio() then
    raise exception 'EDICION_39_INCOHERENTE: la vigencia de la cotización no es válida.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_cabecera->'precio_venta') is distinct from 'number' or (p_cabecera->>'precio_venta')::numeric <= 0 then
    raise exception 'EDICION_39_INCOHERENTE: el precio de la cotización no es válido.' using errcode = 'P0001';
  end if;
  v_precio := (p_cabecera->>'precio_venta')::numeric;
  select coalesce(sum((e->>'valor')::numeric), 0) into v_suma from jsonb_array_elements(p_servicios) e;
  v_esperado := v_suma + greatest(coalesce((v_pay->>'recobro')::numeric, 0), 0)
                + greatest(floor(coalesce((v_pay->>'ninos')::numeric, 0)), 0) * greatest(coalesce((v_pay->>'tarifaNino')::numeric, 0), 0);
  if abs(v_esperado - v_precio) > 0.5 then
    raise exception 'EDICION_39_INCOHERENTE: el total no coincide con los servicios (% vs %).', v_precio, v_esperado using errcode = 'P0001';
  end if;

  perform set_config('p82.din', '1', true);
  insert into public.cotizaciones (
    tenant, tipo, estado, payload, detalle, cliente, cliente_documento, destino, hotel, modulo, plan_nombre,
    pax, precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, asesor, creado_por, creado_por_id,
    propietario_id, aliado_id, paquete_din_id
  ) values (
    v_tenant, 'manual', 'abierta', v_pay, v_det,
    nullif(p_cabecera->>'cliente', ''), nullif(p_cabecera->>'cliente_documento', ''),
    nullif(p_cabecera->>'destino', ''), nullif(p_cabecera->>'hotel', ''), 'manual', coalesce(nullif(p_cabecera->>'plan_nombre', ''), p.nombre),
    coalesce(nullif(p_cabecera->>'pax', '')::integer, 0), v_precio, p.moneda,
    nullif(p_cabecera->>'fecha_salida', '')::date, nullif(p_cabecera->>'fecha_regreso', '')::date,
    v_vig, nullif(p_cabecera->>'asesor', ''), v_email_autor, v_autor, v_prop, v_aliado, p.id
  ) returning id into v_id;

  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor,
                                           costo_neto, modo, pct_markup, ta, valor)
  select v_id, (o.n - 1)::integer, o.e->>'tipo_servicio', nullif(o.e->>'plataforma', ''), nullif(o.e->>'nombre_servicio', ''),
         nullif(o.e->>'proveedor', ''), (o.e->>'costo_neto')::numeric, coalesce(o.e->>'modo', 'mk'),
         coalesce((o.e->>'pct_markup')::numeric, 0), coalesce((o.e->>'ta')::numeric, 0), (o.e->>'valor')::numeric
    from jsonb_array_elements(p_servicios) with ordinality as o(e, n);
  perform public.din_marcar_lineas(v_id, p_servicios);
  insert into public.cotizacion_versiones (cotizacion_id, tenant, version, motivo, precio_venta, moneda, documento, lineas, creado_por)
  values (v_id, v_tenant, 1, 'Versión inicial', v_precio, p.moneda, coalesce(v_det, '{}'::jsonb), public.din_lineas_sin_costo(v_id), v_autor);
  perform set_config('p82.din', '', true);
  return v_id;
end $$;
revoke all on function public.crear_cotizacion_din_externa(text, uuid, bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.crear_cotizacion_din_externa(text, uuid, bigint, jsonb, jsonb) to service_role;

-- ═══ Guardado atómico del paquete ═══
-- SECURITY INVOKER: la RLS por agencia, los CHECK y el trigger de hoteles vinculables rigen. Una sola sentencia = una transacción:
-- si un hijo falla, el paquete y los hijos anteriores quedan intactos. Editar deja el paquete SIN publicar.
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

-- ═══ destinos_extra (arreglo SIN FK) ═══
-- 1) Conteo: `uso_destino_din` (arriba) ya cuenta el paquete si el destino es el principal O aparece en `destinos_extra`, así que el
--    modal de borrado ofrece fusionar en vez de borrar.
-- 2) Guarda: borrar un destino que aparece en `destinos_extra` fallaría en silencio (no hay FK) y dejaría un id huérfano; se rechaza.
create or replace function public.tg_din_destino_extra_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.paquete_din p where old.id = any (p.destinos_extra)) then
    raise exception 'DIN_82_DESTINO_EN_USO: el destino % está como destino adicional de un paquete dinámico; fusiónalo en otro destino en lugar de borrarlo.', old.id using errcode = '23503';
  end if;
  return old;
end $$;
drop trigger if exists trg_din_destino_extra_guard on public.destinos;
create trigger trg_din_destino_extra_guard before delete on public.destinos
  for each row execute function public.tg_din_destino_extra_guard();

-- 3) Fusión: copia EXACTA de `fn_fusionar_destino` (112, con la guarda de agencia de la 237) + un único añadido: antes de borrar el
--    origen, `destinos_extra` pasa del origen al destino (sin duplicados, conservando el orden y sin repetir el destino principal).
CREATE OR REPLACE FUNCTION public.fn_fusionar_destino(p_origen bigint, p_destino bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  fk record;
begin
  if public.mi_rol() not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'No autorizado para fusionar destinos.';
  end if;
  if not public.puede_escribir_catalogo_global() then
    raise exception 'Los catalogos globales solo se editan desde la agencia Mayorista.' using errcode = '42501';
  end if;
  if p_origen = p_destino then
    raise exception 'El origen y el destino no pueden ser el mismo.';
  end if;
  if not exists (select 1 from public.destinos where id = p_destino) then
    raise exception 'El destino de llegada no existe.';
  end if;
  if not exists (select 1 from public.destinos where id = p_origen) then
    return; -- ya no existe, nada que fusionar
  end if;

  -- Re-apunta cada columna con FK a destinos(id), del origen al destino.
  for fk in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.destinos'::regclass
  loop
    execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col)
      using p_destino, p_origen;
  end loop;

  -- 275 (#82): `paquete_din.destinos_extra` es un arreglo sin FK; se reapunta aparte.
  update public.paquete_din p
     set destinos_extra = coalesce((
           select array_agg(x order by n)
             from (select x, min(n) as n from unnest(array_replace(p.destinos_extra, p_origen, p_destino)) with ordinality as t(x, n)
                    where x is distinct from p.destino_id group by x) s), '{}'::bigint[])
   where p_origen = any (p.destinos_extra);

  delete from public.destinos where id = p_origen;
end;
$function$;

-- 4) Integridad del arreglo: cada id de `destinos_extra` debe EXISTIR en destinos (no hay FK). Se valida en la tabla, así que cubre
--    `guardar_paquete_din` (crear y editar) y cualquier escritura directa por PostgREST. FOR SHARE bloquea el borrado concurrente de esos
--    destinos hasta terminar la transacción (la guarda de borrado de arriba cubre el resto).
create or replace function public.tg_din_destinos_extra_validos() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ids bigint[];
  v_ok bigint[];
  v_faltan bigint[];
begin
  if new.destinos_extra is null then
    new.destinos_extra := '{}';
  end if;
  if array_position(new.destinos_extra, null) is not null then
    raise exception 'DIN_82_DESTINO: destinos_extra no admite valores vacíos.' using errcode = 'P0001';
  end if;
  v_ids := new.destinos_extra;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return new;
  end if;
  select coalesce(array_agg(d.id), '{}') into v_ok from (select id from public.destinos where id = any (v_ids) for share) d;
  select coalesce(array_agg(x), '{}') into v_faltan from (select distinct x from unnest(v_ids) x where x <> all (v_ok)) f;
  if coalesce(array_length(v_faltan, 1), 0) > 0 then
    raise exception 'DIN_82_DESTINO: los destinos adicionales % no existen.', v_faltan using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_din_destinos_extra_validos on public.paquete_din;
create trigger trg_din_destinos_extra_validos before insert or update of destinos_extra on public.paquete_din
  for each row execute function public.tg_din_destinos_extra_validos();
