-- ─────────────────────────────────────────────────────────────────────────────
-- 271 · Reparto de la neta de un hotel a solicitud entre adultos, niños e infantes (#120)   ⚠️ SIN CORRER
--
-- NUMERACIÓN: 271 = siguiente número libre en esta rama tras la 270 (la 269 es de SalesBot #56). NO edita la 270 (aditiva sobre ella). Orden: 270 → 271.
--
-- REGLA CONFIRMADA POR EL DUEÑO. La neta cargada es el TOTAL del hotel para toda la estadía y todas las habitaciones. Sin niños, el hotel se carga a los adultos. Con niños, el operador
-- elige «adultos» (los niños con neta hotelera $0) o «distribuir» (neta por adulto y por niño para toda la estadía, que debe sumar la neta total salvo centavos). Los infantes SIEMPRE
-- llevan neta hotelera $0. La elección (modo + conteos + importes por tipo) se congela de forma PRIVADA junto a la neta, en `cotizacion_tarifa_solicitud` (RLS de producto; jamás en
-- `cotizaciones.payload`/`detalle`, que leen `venta` y el enlace público), y se reacredita al convertir.
--   1. Columnas nuevas en `cotizacion_tarifa_solicitud`: modo, adultos, ninos, infantes, neta_adulto, neta_nino, neta_infante, con CHECK que repiten la regla:
--        infante = 0 siempre; modo «adultos» ⇒ neta_nino = 0; modo «distribuir» ⇒ hay niños, ambos importes > 0 y adultos×neta_adulto + niños×neta_nino = neta (± 1 centavo por persona).
--      Las filas que existieran (solo en bases de prueba que ya aplicaron la 270) quedan con modo «adultos», 1 adulto y 0 niños/infantes: no representan una elección real.
--   2. `cargar_neta_solicitud` pasa a 15 argumentos (la de 8 de la 270 se elimina: dos firmas permitirían saltarse el reparto). Misma garantía: atómica (FOR UPDATE), rol de producto,
--      tenant, hotel aún marcado; MISMA elección = no-op; otra neta u otra distribución = rechazo (NETA_DISTINTA / DISTRIBUCION_DISTINTA).
-- QUÉ NO HACE. No calcula precios (los calcula el servidor con el motor de paquetes y aquí solo se congelan), no toca la tabla `cotizaciones` ni sus triggers.
-- Rollback: supabase/scripts/rollback_271_reparto_neta_solicitud.sql (aborta si hay netas cargadas). Preflight/postcheck: supabase/scripts/{preflight,postcheck}_271_*.sql
-- ─────────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regclass('public.cotizacion_tarifa_solicitud') is null then
    raise exception '271 ABORTADA: falta cotizacion_tarifa_solicitud (migración 270).';
  end if;
  if to_regprocedure('public.cargar_neta_solicitud(bigint,text,numeric,text,numeric,numeric,jsonb,date)') is null
     and to_regprocedure('public.cargar_neta_solicitud(bigint,text,numeric,text,numeric,numeric,jsonb,date,text,integer,integer,integer,numeric,numeric,numeric)') is null then
    raise exception '271 ABORTADA: falta cargar_neta_solicitud (migración 270).';
  end if;
end $$;

-- 1. Elección de reparto congelada (privada).
alter table public.cotizacion_tarifa_solicitud
  add column if not exists modo         text          not null default 'adultos',
  add column if not exists adultos      integer       not null default 1,
  add column if not exists ninos        integer       not null default 0,
  add column if not exists infantes     integer       not null default 0,
  add column if not exists neta_adulto  numeric(18,6) not null default 0,
  add column if not exists neta_nino    numeric(18,6) not null default 0,
  add column if not exists neta_infante numeric(15,2) not null default 0;

alter table public.cotizacion_tarifa_solicitud drop constraint if exists cts_modo_check;
alter table public.cotizacion_tarifa_solicitud add constraint cts_modo_check check (modo in ('adultos', 'distribuir'));
alter table public.cotizacion_tarifa_solicitud drop constraint if exists cts_conteos_check;
alter table public.cotizacion_tarifa_solicitud add constraint cts_conteos_check check (adultos >= 1 and ninos >= 0 and infantes >= 0);
alter table public.cotizacion_tarifa_solicitud drop constraint if exists cts_infante_cero_check;
alter table public.cotizacion_tarifa_solicitud add constraint cts_infante_cero_check check (neta_infante = 0);
alter table public.cotizacion_tarifa_solicitud drop constraint if exists cts_modo_adultos_check;
alter table public.cotizacion_tarifa_solicitud add constraint cts_modo_adultos_check check (modo <> 'adultos' or neta_nino = 0);
alter table public.cotizacion_tarifa_solicitud drop constraint if exists cts_modo_distribuir_check;
alter table public.cotizacion_tarifa_solicitud add constraint cts_modo_distribuir_check check (
  modo <> 'distribuir' or (ninos > 0 and neta_adulto > 0 and neta_nino > 0 and abs(adultos * neta_adulto + ninos * neta_nino - neta) <= 0.01 * (adultos + ninos) + 0.000001)
);
comment on column public.cotizacion_tarifa_solicitud.modo is
  '#120/271: adultos = el hotel se carga a los adultos (niños e infantes $0); distribuir = neta por adulto y por niño (infantes $0). Privado: nunca en payload/detalle.';

-- 2. RPC de 15 argumentos (reemplaza a la de 8 de la 270).
drop function if exists public.cargar_neta_solicitud(bigint, text, numeric, text, numeric, numeric, jsonb, date);

create or replace function public.cargar_neta_solicitud(
  p_cotizacion bigint, p_item_ref text, p_neta numeric, p_moneda text, p_pct_mk numeric, p_precio_venta numeric, p_detalle jsonb, p_vigencia date,
  p_modo text, p_adultos integer, p_ninos integer, p_infantes integer, p_neta_adulto numeric, p_neta_nino numeric, p_neta_infante numeric
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.cotizaciones;
  t public.cotizacion_tarifa_solicitud;
  v_neta numeric(15,2) := round(coalesce(p_neta, 0), 2);
  v_na numeric(18,6) := round(coalesce(p_neta_adulto, 0), 6);
  v_nn numeric(18,6) := round(coalesce(p_neta_nino, 0), 6);
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
  -- Reparto: las mismas reglas que los CHECK, con mensajes claros.
  if p_modo is null or p_modo not in ('adultos', 'distribuir') then raise exception 'REPARTO_INVALIDO: el modo debe ser adultos o distribuir.' using errcode = 'P0001'; end if;
  if coalesce(p_adultos, 0) < 1 or coalesce(p_ninos, -1) < 0 or coalesce(p_infantes, -1) < 0 then raise exception 'REPARTO_INVALIDO: conteos de viajeros no válidos.' using errcode = 'P0001'; end if;
  if coalesce(p_neta_infante, 0) <> 0 then raise exception 'REPARTO_INVALIDO: los infantes siempre van con neta hotelera $0.' using errcode = 'P0001'; end if;
  if p_modo = 'adultos' and v_nn <> 0 then raise exception 'REPARTO_INVALIDO: cargar el hotel a los adultos no lleva neta por niño.' using errcode = 'P0001'; end if;
  if p_modo = 'distribuir' then
    if p_ninos <= 0 then raise exception 'REPARTO_INVALIDO: no hay niños en la solicitud: no hay nada que distribuir.' using errcode = 'P0001'; end if;
    if v_na <= 0 or v_nn <= 0 then raise exception 'REPARTO_INVALIDO: indica la neta por adulto y por niño.' using errcode = 'P0001'; end if;
    if abs(p_adultos * v_na + p_ninos * v_nn - v_neta) > 0.01 * (p_adultos + p_ninos) + 0.000001 then
      raise exception 'REPARTO_INVALIDO: la distribución no cuadra con la neta total.' using errcode = 'P0001';
    end if;
  end if;

  select * into c from public.cotizaciones where id = p_cotizacion for update;
  if not found then raise exception 'NETA_COTIZACION_INEXISTENTE: no existe la cotización %.', p_cotizacion using errcode = 'P0001'; end if;
  if c.tenant is null or not public.puede_ver_tenant(c.tenant) then
    raise exception 'NETA_SIN_PERMISO: no tienes acceso a esta cotización.' using errcode = '42501';
  end if;

  select * into t from public.cotizacion_tarifa_solicitud where cotizacion_id = p_cotizacion and item_ref = p_item_ref;
  if found then
    if t.neta = v_neta and t.moneda = p_moneda and t.modo = p_modo and t.adultos = p_adultos and t.ninos = p_ninos and t.infantes = p_infantes
       and abs(t.neta_adulto - v_na) < 0.000001 and abs(t.neta_nino - v_nn) < 0.000001 then
      return jsonb_build_object('repetida', true, 'estado', c.estado, 'precio_venta', t.precio_venta);
    end if;
    if t.neta <> v_neta then
      raise exception 'NETA_DISTINTA: la cotización % ya tiene cargada otra neta (%); no se sobrescribe.', p_cotizacion, t.neta using errcode = 'P0001';
    end if;
    raise exception 'DISTRIBUCION_DISTINTA: la cotización % ya tiene cargada otra distribución del hotel; no se sobrescribe.', p_cotizacion using errcode = 'P0001';
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

  insert into public.cotizacion_tarifa_solicitud (cotizacion_id, item_ref, tenant, paquete_id, hotel_id, neta, moneda, pct_mk, precio_venta, cargada_por,
                                                  modo, adultos, ninos, infantes, neta_adulto, neta_nino, neta_infante)
  values (p_cotizacion, p_item_ref, c.tenant, v_paquete, v_hotel, v_neta, p_moneda, coalesce(p_pct_mk, 0), p_precio_venta, auth.uid(),
          p_modo, p_adultos, p_ninos, p_infantes, v_na, v_nn, 0);

  update public.cotizaciones set estado = 'abierta', precio_venta = p_precio_venta, moneda = p_moneda, detalle = p_detalle, vigencia_hasta = p_vigencia where id = p_cotizacion;
  return jsonb_build_object('repetida', false, 'estado', 'abierta', 'precio_venta', p_precio_venta);
end $$;

revoke all on function public.cargar_neta_solicitud(bigint, text, numeric, text, numeric, numeric, jsonb, date, text, integer, integer, integer, numeric, numeric, numeric) from public, anon;
grant execute on function public.cargar_neta_solicitud(bigint, text, numeric, text, numeric, numeric, jsonb, date, text, integer, integer, integer, numeric, numeric, numeric) to authenticated;
comment on function public.cargar_neta_solicitud(bigint, text, numeric, text, numeric, numeric, jsonb, date, text, integer, integer, integer, numeric, numeric, numeric) is
  '#120/271: congela la neta total, el reparto (adultos/distribuir; infantes $0) y el precio total calculado por el servidor; la cotización pasa de pendiente_tarifa a abierta. Misma elección = no-op; otra neta u otra distribución = rechazo.';

commit;
