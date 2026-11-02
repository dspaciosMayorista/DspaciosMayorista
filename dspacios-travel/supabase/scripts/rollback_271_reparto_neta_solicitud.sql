-- Rollback de la 271 (#120). ABORTA si ya hay netas cargadas con su elección de reparto: perderla destruiría datos del negocio.
-- Restaura la RPC de 8 argumentos de la 270 y quita las columnas del reparto.
begin;
do $$
begin
  if exists (select 1 from public.cotizacion_tarifa_solicitud) then
    raise exception 'ROLLBACK 271 ABORTADO: hay netas cargadas en cotizacion_tarifa_solicitud (con su elección de reparto).';
  end if;
end $$;
drop function if exists public.cargar_neta_solicitud(bigint, text, numeric, text, numeric, numeric, jsonb, date, text, integer, integer, integer, numeric, numeric, numeric);
alter table public.cotizacion_tarifa_solicitud
  drop constraint if exists cts_modo_distribuir_check, drop constraint if exists cts_modo_adultos_check, drop constraint if exists cts_infante_cero_check,
  drop constraint if exists cts_conteos_check, drop constraint if exists cts_modo_check;
alter table public.cotizacion_tarifa_solicitud
  drop column if exists neta_infante, drop column if exists neta_nino, drop column if exists neta_adulto, drop column if exists infantes, drop column if exists ninos, drop column if exists adultos, drop column if exists modo;
create or replace function public.cargar_neta_solicitud(
  p_cotizacion bigint, p_item_ref text, p_neta numeric, p_moneda text, p_pct_mk numeric, p_precio_venta numeric, p_detalle jsonb, p_vigencia date
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.cotizaciones;
  t public.cotizacion_tarifa_solicitud;
  v_neta numeric(15,2) := round(coalesce(p_neta, 0), 2);
  v_paquete bigint;
  v_hotel bigint;
begin
  if auth.uid() is null or public.mi_rol() is null or public.mi_rol() not in ('superadmin', 'administracion', 'gerencia', 'operaciones') then
    raise exception 'NETA_SIN_PERMISO: solo producto/operaciones cargan la neta del hotel.' using errcode = '42501';
  end if;
  if v_neta <= 0 then raise exception 'NETA_INVALIDA: la neta debe ser mayor que cero.' using errcode = 'P0001'; end if;
  if p_moneda not in ('COP', 'USD') then raise exception 'NETA_INVALIDA: moneda no válida.' using errcode = 'P0001'; end if;
  if coalesce(p_precio_venta, 0) <= 0 then raise exception 'NETA_INVALIDA: el precio calculado debe ser mayor que cero.' using errcode = 'P0001'; end if;
  if coalesce(p_item_ref, '') !~ '^[a-z0-9_]{1,40}$' then raise exception 'NETA_INVALIDA: ítem no válido.' using errcode = 'P0001'; end if;

  select * into c from public.cotizaciones where id = p_cotizacion for update;
  if not found then raise exception 'NETA_COTIZACION_INEXISTENTE: no existe la cotización %.', p_cotizacion using errcode = 'P0001'; end if;
  if c.tenant is null or not public.puede_ver_tenant(c.tenant) then
    raise exception 'NETA_SIN_PERMISO: no tienes acceso a esta cotización.' using errcode = '42501';
  end if;

  select * into t from public.cotizacion_tarifa_solicitud where cotizacion_id = p_cotizacion and item_ref = p_item_ref;
  if found then
    if t.neta = v_neta and t.moneda = p_moneda then
      return jsonb_build_object('repetida', true, 'estado', c.estado, 'precio_venta', t.precio_venta);
    end if;
    raise exception 'NETA_DISTINTA: la cotización % ya tiene cargada otra neta (%); no se sobrescribe.', p_cotizacion, t.neta using errcode = 'P0001';
  end if;
  if c.estado <> 'pendiente_tarifa' then
    raise exception 'NETA_NO_PENDIENTE: la cotización % no está pendiente de tarifa (estado %).', p_cotizacion, c.estado using errcode = 'P0001';
  end if;

  v_paquete := c.paquete_armado_id;
  v_hotel := nullif(c.payload ->> 'hotelId', '')::bigint;
  if v_paquete is null or v_hotel is null then
    raise exception 'NETA_INVALIDA: la solicitud no identifica paquete y hotel.' using errcode = 'P0001';
  end if;
  if not coalesce((select h.tarifa_bajo_solicitud from public.hoteles h where h.id = v_hotel), false) then
    raise exception 'NETA_HOTEL_NO_SOLICITUD: el hotel de la solicitud ya no está marcado bajo solicitud.' using errcode = 'P0001';
  end if;

  insert into public.cotizacion_tarifa_solicitud (cotizacion_id, item_ref, tenant, paquete_id, hotel_id, neta, moneda, pct_mk, precio_venta, cargada_por)
  values (p_cotizacion, p_item_ref, c.tenant, v_paquete, v_hotel, v_neta, p_moneda, coalesce(p_pct_mk, 0), p_precio_venta, auth.uid());

  update public.cotizaciones set estado = 'abierta', precio_venta = p_precio_venta, moneda = p_moneda, detalle = p_detalle, vigencia_hasta = p_vigencia where id = p_cotizacion;
  return jsonb_build_object('repetida', false, 'estado', 'abierta', 'precio_venta', p_precio_venta);
end $$;

revoke all on function public.cargar_neta_solicitud(bigint, text, numeric, text, numeric, numeric, jsonb, date) from public, anon;
grant execute on function public.cargar_neta_solicitud(bigint, text, numeric, text, numeric, numeric, jsonb, date) to authenticated;
comment on function public.cargar_neta_solicitud(bigint, text, numeric, text, numeric, numeric, jsonb, date) is
  '#120: congela la neta del hotel y el precio total calculado por el servidor; la cotización pasa de pendiente_tarifa a abierta. Idempotente (misma neta) y rechaza una neta distinta.';
commit;
