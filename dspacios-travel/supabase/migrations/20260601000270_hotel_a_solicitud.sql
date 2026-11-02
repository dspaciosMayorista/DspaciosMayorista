-- ─────────────────────────────────────────────────────────────────────────────
-- 270 · Hoteles a solicitud sin tarifa publicada (#120)   ⚠️ SIN CORRER
--
-- NUMERACIÓN: 270. La 269 está reservada por SalesBot #56 (aún fuera de esta rama); #120 no depende de ella. Confirmar con `ls supabase/migrations | sort | tail` antes de correr.
--
-- QUÉ HACE. Un hotel del catálogo puede MARCARSE «bajo solicitud» (sin tarifa negociada publicada): se ofrece en paquetes de bloqueo, empaquetado y porción terrestre
-- sin precio ficticio y sin impedir que los demás hoteles tarifados del paquete se vendan. La solicitud del cliente crea una cotización SEPARADA en estado
-- `pendiente_tarifa` (sin total ni importes); un operador autorizado carga SOLO la neta del hotel y el sistema calcula el total completo del paquete, lo congela y
-- pasa la cotización a `abierta` (flujo normal de cotización y conversión).
--   1. `hoteles.tarifa_bajo_solicitud` boolean NOT NULL DEFAULT false. ÚNICA fuente de verdad (el vínculo `armado_hoteles` no cambia: el hotel solo aparece en un
--      paquete si está seleccionado en él). SIN backfill ni heurística: ningún hotel existente cambia; la marca es una decisión humana editable.
--      Invariantes que impone la base: un hotel marcado no puede ser modelo 'unidad' (CHECK); no se puede MARCAR con tarifas cargadas; no se pueden cargar tarifas a
--      un hotel marcado (se desmarca primero); y NO se puede DESMARCAR mientras existan solicitudes pendientes de tarifa, o ya valoradas pero aún abiertas, de ese hotel.
--   2. `cotizacion_tarifa_solicitud`: la neta del hotel y el precio congelado, FUERA de `payload`/`detalle` (que leen `venta` y el enlace público). Una fila por
--      (cotización, ítem). Sin grants a anon; escritura solo por la RPC; lectura solo para roles de producto de su tenant.
--   3. Estado `pendiente_tarifa` en `cotizaciones` (la columna no tiene CHECK de estado). Un trigger BLOQUEA, venga de donde venga (API, RPC, service-role): convertir
--      o numerar contrato desde una cotización pendiente, dejarla en `abierta` sin que exista su neta con ese mismo precio, o volver a pendiente.
--   4. RPC `cargar_neta_solicitud`: atómica (FOR UPDATE), idempotente (misma neta = no-op), rechaza una neta distinta, valida rol con `mi_rol()`, tenant y que el hotel
--      siga marcado.
-- QUÉ NO HACE. No crea hoteles, precios, tarifas ni CxP; no clasifica hoteles; no edita migraciones existentes; no toca `tarifario_resultado` ni la publicación por lotes.
-- Orden: 270 antes del código de #120. Re-aplicar es idempotente.
-- Rollback: supabase/scripts/rollback_270_hotel_a_solicitud.sql (aborta si hay hoteles marcados o solicitudes; no borra datos ajenos).
-- ─────────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regclass('public.hoteles') is null or to_regclass('public.tarifa_hotel') is null or to_regclass('public.cotizaciones') is null then
    raise exception '270 ABORTADA: faltan hoteles, tarifa_hotel o cotizaciones.';
  end if;
  if to_regprocedure('public.mi_rol()') is null or to_regprocedure('public.puede_ver_tenant(text)') is null then
    raise exception '270 ABORTADA: faltan mi_rol() o puede_ver_tenant(text).';
  end if;
end $$;

-- 1. Marca del hotel (apagada por defecto; nunca se enciende sola).
alter table public.hoteles add column if not exists tarifa_bajo_solicitud boolean not null default false;
comment on column public.hoteles.tarifa_bajo_solicitud is
  '#120: true = el hotel se ofrece sin tarifa publicada (Tarifa y disponibilidad bajo solicitud); un operador carga la neta en cada solicitud. Marca editable, sin backfill.';
alter table public.hoteles drop constraint if exists hoteles_bajo_solicitud_no_unidad;
alter table public.hoteles add constraint hoteles_bajo_solicitud_no_unidad check (not (tarifa_bajo_solicitud and modelo_tarifario = 'unidad'));

-- 2. Neta del hotel + precio congelado de una solicitud (se crea antes de los triggers que la consultan).
create table if not exists public.cotizacion_tarifa_solicitud (
  id            bigserial primary key,
  cotizacion_id bigint not null references public.cotizaciones(id) on delete restrict,
  item_ref      text not null default 'hotel' check (item_ref ~ '^[a-z0-9_]{1,40}$'),
  tenant        text not null,
  paquete_id    bigint not null,
  hotel_id      bigint not null,
  neta          numeric(15,2) not null check (neta > 0),
  moneda        text not null check (moneda in ('COP', 'USD')),
  pct_mk        numeric(8,4) not null default 0,
  precio_venta  numeric(15,2) not null check (precio_venta > 0),
  cargada_por   uuid,
  cargada_en    timestamptz not null default now(),
  unique (cotizacion_id, item_ref)
);
comment on table public.cotizacion_tarifa_solicitud is
  '#120: neta del hotel (costo) y precio congelado de una solicitud a pedido. Nunca va en cotizaciones.payload/detalle. Solo la escribe cargar_neta_solicitud.';

alter table public.cotizacion_tarifa_solicitud enable row level security;
revoke all on table public.cotizacion_tarifa_solicitud from anon;
revoke insert, update, delete, truncate on table public.cotizacion_tarifa_solicitud from authenticated;
drop policy if exists "cotizacion_tarifa_solicitud: lectura producto" on public.cotizacion_tarifa_solicitud;
create policy "cotizacion_tarifa_solicitud: lectura producto" on public.cotizacion_tarifa_solicitud for select
  using (public.mi_rol() in ('superadmin', 'administracion', 'gerencia', 'operaciones') and public.puede_ver_tenant(tenant));

drop trigger if exists trg_auditoria on public.cotizacion_tarifa_solicitud;
create trigger trg_auditoria after insert or update or delete on public.cotizacion_tarifa_solicitud
  for each row execute function public.fn_auditoria();

-- 2b. Invariantes de la marca.
create or replace function public.tg_hotel_bajo_solicitud() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.tarifa_bajo_solicitud and not old.tarifa_bajo_solicitud
     and exists (select 1 from public.tarifa_hotel t where t.hotel_id = new.id) then
    raise exception 'HOTEL_BAJO_SOLICITUD: el hotel % ya tiene tarifas cargadas; no se puede marcar bajo solicitud (elimina esas tarifas si de verdad se vende así).', new.id using errcode = 'P0001';
  end if;
  if old.tarifa_bajo_solicitud and not new.tarifa_bajo_solicitud
     and (exists (select 1 from public.cotizaciones c where c.estado = 'pendiente_tarifa' and c.payload ->> 'hotelId' = old.id::text)
          or exists (select 1 from public.cotizacion_tarifa_solicitud t join public.cotizaciones c on c.id = t.cotizacion_id
                      where t.hotel_id = old.id and c.estado = 'abierta')) then
    raise exception 'HOTEL_BAJO_SOLICITUD: el hotel % tiene solicitudes pendientes de tarifa o cotizaciones valoradas aún abiertas; resuélvelas o descártalas antes de desmarcarlo.', old.id using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.tg_hotel_bajo_solicitud() from public, anon, authenticated;
drop trigger if exists trg_hotel_bajo_solicitud on public.hoteles;
create trigger trg_hotel_bajo_solicitud before update of tarifa_bajo_solicitud on public.hoteles
  for each row execute function public.tg_hotel_bajo_solicitud();

create or replace function public.tg_tarifa_hotel_no_bajo_solicitud() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.hoteles h where h.id = new.hotel_id and h.tarifa_bajo_solicitud) then
    raise exception 'HOTEL_BAJO_SOLICITUD: el hotel % está marcado bajo solicitud; desmarca la opción en su configuración antes de cargarle tarifas.', new.hotel_id using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.tg_tarifa_hotel_no_bajo_solicitud() from public, anon, authenticated;
drop trigger if exists trg_tarifa_hotel_no_bajo_solicitud on public.tarifa_hotel;
create trigger trg_tarifa_hotel_no_bajo_solicitud before insert on public.tarifa_hotel
  for each row execute function public.tg_tarifa_hotel_no_bajo_solicitud();

-- 3. Candado del estado `pendiente_tarifa` (cualquier camino de escritura).
create or replace function public.tg_cotizacion_pendiente_tarifa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.estado = 'pendiente_tarifa' and (coalesce(new.precio_venta, 0) <> 0 or new.numero_contrato is not null) then
      raise exception 'COTIZACION_PENDIENTE_TARIFA: una cotización pendiente de tarifa nace sin precio ni contrato.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.estado = 'pendiente_tarifa' then
    if new.estado = 'convertida' or new.numero_contrato is not null then
      raise exception 'COTIZACION_PENDIENTE_TARIFA: la cotización % espera la tarifa del hotel; no se convierte ni se numera contrato.', old.id using errcode = 'P0001';
    end if;
    if new.estado = 'abierta'
       and not exists (select 1 from public.cotizacion_tarifa_solicitud t where t.cotizacion_id = new.id and t.precio_venta = new.precio_venta) then
      raise exception 'COTIZACION_PENDIENTE_TARIFA: la cotización % solo se abre con la neta del hotel cargada y su precio congelado.', old.id using errcode = 'P0001';
    end if;
  elsif new.estado = 'pendiente_tarifa' then
    raise exception 'COTIZACION_PENDIENTE_TARIFA: una cotización ya valorada no vuelve a pendiente de tarifa.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.tg_cotizacion_pendiente_tarifa() from public, anon, authenticated;

drop trigger if exists trg_cotizacion_pendiente_tarifa on public.cotizaciones;
create trigger trg_cotizacion_pendiente_tarifa before insert or update of estado, numero_contrato, precio_venta on public.cotizaciones
  for each row execute function public.tg_cotizacion_pendiente_tarifa();

-- 4. Carga atómica e idempotente de la neta. El precio y el detalle los calcula el servidor con el motor del paquete; aquí solo se congelan.
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
