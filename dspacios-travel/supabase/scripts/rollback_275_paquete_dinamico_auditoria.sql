-- Rollback de la 275 (#82). Deja la base como estaba tras la 274: políticas por rol (sin agencia), sin canales externos,
-- sin reglas de publicación/fechas, sin guardado atómico. NO borra cotizaciones creadas por los canales externos
-- (siguen existiendo con su paquete_din_id; sin la 275 solo el personal interno puede crear nuevas).
drop trigger if exists trg_din_hotel_vinculable on public.paquete_din_hoteles;
drop function if exists public.tg_din_hotel_vinculable();
drop function if exists public.guardar_paquete_din(bigint, jsonb, jsonb, jsonb, jsonb);
drop function if exists public.crear_cotizacion_din_externa(text, uuid, bigint, jsonb, jsonb);
drop function if exists public.hoteles_vinculables_din();
drop function if exists public.hotel_vinculable_din(bigint);
drop function if exists public.uso_destino_din(bigint);

-- Políticas de la 274 (solo rol, sin agencia).
drop policy if exists "paquete_din: producto" on public.paquete_din;
create policy "paquete_din: producto" on public.paquete_din for all to authenticated
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'))
  with check (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));
drop policy if exists "paquete_din_vuelos: producto" on public.paquete_din_vuelos;
create policy "paquete_din_vuelos: producto" on public.paquete_din_vuelos for all to authenticated
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'))
  with check (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));
drop policy if exists "paquete_din_hoteles: producto" on public.paquete_din_hoteles;
create policy "paquete_din_hoteles: producto" on public.paquete_din_hoteles for all to authenticated
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'))
  with check (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));
drop policy if exists "paquete_din_servicios: producto" on public.paquete_din_servicios;
create policy "paquete_din_servicios: producto" on public.paquete_din_servicios for all to authenticated
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'))
  with check (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));
drop function if exists public.puede_producto_din(text);

-- crear_cotizacion_din tal como la dejó la 274.
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
  if not found or p.activo is not true then
    raise exception 'DIN_82_PAQUETE: el paquete no existe o está inactivo.' using errcode = 'P0001';
  end if;
  if upper(coalesce(p_cabecera->>'moneda', 'COP')) <> p.moneda then
    raise exception 'DIN_82_MONEDA: la cotización debe estar en la moneda del paquete (%).', p.moneda using errcode = 'P0001';
  end if;
  if p.compra_fin is not null and p.compra_fin < public.fecha_negocio() then
    raise exception 'DIN_82_PAQUETE: la vigencia de compra del paquete terminó.' using errcode = 'P0001';
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

drop function if exists p82_priv.validar_solicitud(public.paquete_din, jsonb);
drop schema if exists p82_priv;

-- destinos_extra: quita guardas y devuelve fn_fusionar_destino a la versión de la 237 (sin el reapuntado del arreglo).
drop trigger if exists trg_din_destinos_extra_validos on public.paquete_din;
drop function if exists public.tg_din_destinos_extra_validos();
drop trigger if exists trg_din_destino_extra_guard on public.destinos;
drop function if exists public.tg_din_destino_extra_guard();
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

  delete from public.destinos where id = p_origen;
end;
$function$;
