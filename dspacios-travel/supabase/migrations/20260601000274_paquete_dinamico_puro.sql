-- 274 (#82) — Paquete 100 % dinámico como producto reutilizable.
--
-- DISTINTO de armado_paquetes.tipo='dinamico' (vuelo de sistema + hotel del catálogo, snapshot
-- en tarifario_resultado) y de la cotización manual. Esta migración es ADITIVA: no modifica
-- ninguna tabla, función ni trigger existente. Solo agrega:
--   1. paquete_din (+ vuelos, hoteles, servicios): configuración y precios del producto.
--   2. cotizaciones.paquete_din_id y cotizacion_servicios.componente/exige_costo.
--   3. cotizacion_versiones: qué versión y qué importes se mostraron al cliente (sin costos).
--   4. RPC (solo service_role): crear, editar, registrar costos reales, marcar versión mostrada
--      y convertir. La conversión envuelve convertir_cotizacion_manual_controlada: valida los
--      costos reales ANTES de numerar y, si faltan, no escribe nada.
--   5. Guardas: una cotización de paquete dinámico no se edita por el editor manual (recalcula
--      el valor desde el costo y dejaría líneas solo-PVP en 0), y ninguna venta puede nacer de
--      una cotización dinámica con costos pendientes (red de seguridad contra otra ruta).
-- Orden: preflight → esta migración → postcheck → recién después el código.
-- Rollback: supabase/scripts/rollback_274_paquete_dinamico_puro.sql.

-- ═══ 1. Configuración del producto ═══
create table if not exists public.paquete_din (
  id            bigserial primary key,
  tenant        text not null default 'mayorista' check (tenant in ('mayorista', 'minorista')),
  nombre        text not null check (length(btrim(nombre)) between 1 and 200),
  destino_id    bigint references public.destinos (id),
  destinos_extra bigint[] not null default '{}',          -- multidestino: vuelos/servicios de otros destinos
  moneda        text not null default 'COP' check (moneda in ('COP', 'USD')),
  esquema       text not null check (esquema in ('neta_markup', 'solo_pvp')),
  pvp_modo      text check (pvp_modo in ('general', 'por_componente')),
  pct_mk        numeric(6,4) not null default 0 check (pct_mk >= 0 and pct_mk < 1),
  usa_vuelo     boolean not null default false,
  usa_hotel     boolean not null default false,
  usa_servicios boolean not null default false,
  noches        integer not null default 3 check (noches between 1 and 60),
  compra_inicio date,
  compra_fin    date,
  viaje_inicio  date,
  viaje_fin     date,
  pvp_general   jsonb,                                     -- {sencilla,doble,...} solo_pvp + general
  total_declarado jsonb,                                   -- contraste opcional contra el desglose
  descripcion   text,
  incluye       text,
  no_incluye    text,
  activo        boolean not null default true,
  publicado     boolean not null default false,
  creado_por    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint paquete_din_componente_check check (usa_vuelo or usa_hotel or usa_servicios),
  constraint paquete_din_esquema_modo_check check ((esquema = 'solo_pvp') = (pvp_modo is not null)),
  constraint paquete_din_compra_check check (compra_inicio is null or compra_fin is null or compra_fin >= compra_inicio),
  constraint paquete_din_viaje_check check (viaje_inicio is null or viaje_fin is null or viaje_fin >= viaje_inicio)
);

create table if not exists public.paquete_din_vuelos (
  id             bigserial primary key,
  paquete_id     bigint not null references public.paquete_din (id) on delete cascade,
  empaquetado_id bigint references public.empaquetados (id),   -- vínculo a Empaquetados (opcional)
  destino_id     bigint references public.destinos (id),       -- vuelo de otro destino (multidestino)
  aerolinea      text,
  ruta           text,
  fecha_ida      date,
  fecha_regreso  date,
  proveedor      text,
  neto           jsonb not null default '{}'::jsonb,           -- {adulto,nino,infante}
  pvp            jsonb not null default '{}'::jsonb,
  notas          text,
  orden          integer not null default 0,
  constraint paquete_din_vuelos_fechas_check check (fecha_regreso is null or fecha_ida is null or fecha_regreso >= fecha_ida)
);

create table if not exists public.paquete_din_hoteles (
  id          bigserial primary key,
  paquete_id  bigint not null references public.paquete_din (id) on delete cascade,
  hotel_id    bigint references public.hoteles (id),           -- ficha existente (sin vigencias ni tarifas propias)
  nombre      text not null check (length(btrim(nombre)) > 0),
  categoria   text,
  regimen     text,
  descripcion text,
  foto_url    text,
  proveedor   text,
  neto        jsonb not null default '{}'::jsonb,              -- por acomodación
  pvp         jsonb not null default '{}'::jsonb,
  pvp_general jsonb,                                           -- precio general de ESTA opción (solo_pvp general)
  orden       integer not null default 0
);

create table if not exists public.paquete_din_servicios (
  id          bigserial primary key,
  paquete_id  bigint not null references public.paquete_din (id) on delete cascade,
  servicio_id bigint references public.servicios_adicionales (id),
  destino_id  bigint references public.destinos (id),
  nombre      text not null check (length(btrim(nombre)) > 0),
  proveedor   text,
  neto        numeric(15,2) check (neto is null or neto >= 0),
  pvp         numeric(15,2) check (pvp is null or pvp >= 0),
  orden       integer not null default 0
);

create index if not exists idx_paquete_din_vuelos_paquete on public.paquete_din_vuelos (paquete_id);
create index if not exists idx_paquete_din_hoteles_paquete on public.paquete_din_hoteles (paquete_id);
create index if not exists idx_paquete_din_servicios_paquete on public.paquete_din_servicios (paquete_id);

alter table public.paquete_din enable row level security;
alter table public.paquete_din_vuelos enable row level security;
alter table public.paquete_din_hoteles enable row level security;
alter table public.paquete_din_servicios enable row level security;
revoke all on public.paquete_din, public.paquete_din_vuelos, public.paquete_din_hoteles, public.paquete_din_servicios from public, anon;
grant select, insert, update, delete on public.paquete_din, public.paquete_din_vuelos, public.paquete_din_hoteles, public.paquete_din_servicios to authenticated, service_role;
grant usage, select on sequence public.paquete_din_id_seq, public.paquete_din_vuelos_id_seq, public.paquete_din_hoteles_id_seq, public.paquete_din_servicios_id_seq to authenticated, service_role;

-- Solo roles de producto, SIN filtro de fila ni de tenant: como el resto del catálogo de Producto (armado_paquetes, hoteles), y porque
-- estas tablas referencian destinos(id) y quien puede borrar destinos debe contar TODAS las filas (REFERENCIAS_DESTINO).
-- El catálogo público se sirve desde el servidor (sin netas).
drop policy if exists "paquete_din: producto" on public.paquete_din;
create policy "paquete_din: producto" on public.paquete_din for all to authenticated
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'))
  with check (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));
drop policy if exists "paquete_din_vuelos: producto" on public.paquete_din_vuelos;
create policy "paquete_din_vuelos: producto" on public.paquete_din_vuelos for all to authenticated
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'))
  with check (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));
drop trigger if exists trg_auditoria on public.paquete_din_vuelos;
create trigger trg_auditoria after insert or update or delete on public.paquete_din_vuelos for each row execute function public.fn_auditoria();
drop policy if exists "paquete_din_hoteles: producto" on public.paquete_din_hoteles;
create policy "paquete_din_hoteles: producto" on public.paquete_din_hoteles for all to authenticated
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'))
  with check (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));
drop trigger if exists trg_auditoria on public.paquete_din_hoteles;
create trigger trg_auditoria after insert or update or delete on public.paquete_din_hoteles for each row execute function public.fn_auditoria();
drop policy if exists "paquete_din_servicios: producto" on public.paquete_din_servicios;
create policy "paquete_din_servicios: producto" on public.paquete_din_servicios for all to authenticated
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'))
  with check (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));
drop trigger if exists trg_auditoria on public.paquete_din_servicios;
create trigger trg_auditoria after insert or update or delete on public.paquete_din_servicios for each row execute function public.fn_auditoria();
drop trigger if exists trg_auditoria on public.paquete_din;
create trigger trg_auditoria after insert or update or delete on public.paquete_din for each row execute function public.fn_auditoria();

-- ═══ 2. Enlaces desde la cotización ═══
alter table public.cotizaciones add column if not exists paquete_din_id bigint references public.paquete_din (id);
alter table public.cotizacion_servicios add column if not exists componente text;       -- vuelo | hotel | servicio:<id> | paquete
alter table public.cotizacion_servicios add column if not exists exige_costo boolean not null default false;
create index if not exists idx_cotizaciones_paquete_din on public.cotizaciones (paquete_din_id) where paquete_din_id is not null;

-- ═══ 3. Versiones mostradas al cliente (sin costos) ═══
create table if not exists public.cotizacion_versiones (
  id             bigserial primary key,
  cotizacion_id  bigint not null references public.cotizaciones (id) on delete restrict,
  tenant         text not null,
  version        integer not null check (version >= 1),
  motivo         text not null check (length(btrim(motivo)) between 1 and 500),
  precio_venta   numeric(15,2) not null,
  moneda         text not null,
  documento      jsonb not null,            -- detalle (líneas) que ve el cliente
  lineas         jsonb not null,            -- valor por componente, SIN costos
  creado_por     uuid,
  creado_en      timestamptz not null default now(),
  mostrada_en    timestamptz,               -- null = nunca se marcó como mostrada/enviada
  mostrada_por   uuid,
  unique (cotizacion_id, version)
);
alter table public.cotizacion_versiones enable row level security;
revoke all on public.cotizacion_versiones from public, anon, authenticated, service_role;
revoke all on sequence public.cotizacion_versiones_id_seq from public, anon, authenticated, service_role;
grant select on public.cotizacion_versiones to authenticated, service_role;
grant insert, update on public.cotizacion_versiones to service_role;
grant usage, select on sequence public.cotizacion_versiones_id_seq to service_role;
drop policy if exists "cotizacion_versiones: lectura" on public.cotizacion_versiones;
create policy "cotizacion_versiones: lectura" on public.cotizacion_versiones for select to authenticated
  using (
    public.puede_ver_tenant_cotizacion(tenant)
    and (
      public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
      or (public.mi_rol() = 'venta'
          and exists (select 1 from public.cotizaciones c where c.id = cotizacion_versiones.cotizacion_id and c.creado_por_id = auth.uid()))
    )
  );
drop trigger if exists trg_auditoria on public.cotizacion_versiones;
create trigger trg_auditoria after insert or update or delete on public.cotizacion_versiones for each row execute function public.fn_auditoria();

-- Una versión es inmutable salvo marcarla como mostrada (una sola vez).
create or replace function public.tg_cotizacion_versiones_inmutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'DIN_82_VERSION_INMUTABLE: las versiones no se borran.' using errcode = 'P0001';
  end if;
  if (new.cotizacion_id, new.tenant, new.version, new.motivo, new.precio_venta, new.moneda, new.documento, new.lineas, new.creado_por, new.creado_en)
     is distinct from
     (old.cotizacion_id, old.tenant, old.version, old.motivo, old.precio_venta, old.moneda, old.documento, old.lineas, old.creado_por, old.creado_en)
     or (old.mostrada_en is not null and (new.mostrada_en, new.mostrada_por) is distinct from (old.mostrada_en, old.mostrada_por)) then
    raise exception 'DIN_82_VERSION_INMUTABLE: una versión no se modifica.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_cotizacion_versiones_inmutable on public.cotizacion_versiones;
create trigger trg_cotizacion_versiones_inmutable before update or delete on public.cotizacion_versiones
  for each row execute function public.tg_cotizacion_versiones_inmutable();

-- ═══ 4. Funciones ═══
-- Costos reales faltantes de una cotización dinámica (nombres de componente). Vacío = completa.
create or replace function public.din_costos_pendientes(p_cotizacion_id bigint) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(coalesce(nullif(btrim(s.nombre_servicio), ''), s.componente, 'componente') order by s.orden), '{}'::text[])
    from public.cotizacion_servicios s
   where s.cotizacion_id = p_cotizacion_id
     and s.exige_costo
     and (s.costo_neto <= 0 or length(btrim(coalesce(s.proveedor, ''))) = 0)
$$;
revoke all on function public.din_costos_pendientes(bigint) from public, anon, authenticated;
grant execute on function public.din_costos_pendientes(bigint) to service_role;

-- Aplica {componente, exige_costo} de p_servicios (por posición) a las filas recién escritas.
create or replace function public.din_marcar_lineas(p_cotizacion_id bigint, p_servicios jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('p82.din', '1', true);
  update public.cotizacion_servicios s
     set componente = nullif(o.e->>'componente', ''),
         exige_costo = coalesce((o.e->>'exige_costo')::boolean, false)
    from jsonb_array_elements(p_servicios) with ordinality as o(e, n)
   where s.cotizacion_id = p_cotizacion_id and s.orden = (o.n - 1)::integer;
end $$;
revoke all on function public.din_marcar_lineas(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.din_marcar_lineas(bigint, jsonb) to service_role;

create or replace function public.din_lineas_sin_costo(p_cotizacion_id bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('orden', s.orden, 'componente', s.componente, 'nombre', s.nombre_servicio, 'valor', s.valor) order by s.orden), '[]'::jsonb)
    from public.cotizacion_servicios s where s.cotizacion_id = p_cotizacion_id
$$;
revoke all on function public.din_lineas_sin_costo(bigint) from public, anon, authenticated;
grant execute on function public.din_lineas_sin_costo(bigint) to service_role;

-- Crear: cabecera + servicios (por crear_cotizacion_manual, transaccional) + enlace + versión 1.
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

-- Editar valores (y costos) de una cotización dinámica abierta. Crea versión nueva con motivo.
create or replace function public.editar_cotizacion_din(
  p_usuario_id uuid, p_cotizacion_id bigint, p_rev_esperada integer, p_motivo text, p_servicios jsonb, p_cambios jsonb
) returns integer
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  c public.cotizaciones;
  v_items jsonb := p_cambios->'items';
  v_precio numeric;
  v_det jsonb;
  v_ver integer;
begin
  c := p39_priv.bloquear_para_editar(p_cotizacion_id, p_usuario_id, p_rev_esperada, p_motivo);
  if c.paquete_din_id is null then
    raise exception 'DIN_82_NO_DINAMICA: esta cotización no pertenece a un paquete dinámico.' using errcode = 'P0001';
  end if;
  perform p39_priv.validar_servicios(p_servicios);
  if jsonb_typeof(p_cambios->'precio_venta') is distinct from 'number'
     or jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'EDICION_39_INCOHERENTE: faltan el precio o las líneas del documento.' using errcode = 'P0001';
  end if;
  v_precio := (p_cambios->>'precio_venta')::numeric;
  if v_precio <= 0 or abs(coalesce((select sum((e->>'valor')::numeric) from jsonb_array_elements(p_servicios) e), 0) - v_precio) > 0.5 then
    raise exception 'EDICION_39_INCOHERENTE: el total no coincide con los componentes.' using errcode = 'P0001';
  end if;
  if abs(coalesce((select sum((i->>'valor')::numeric) from jsonb_array_elements(v_items) i), 0) - v_precio) > 0.5 then
    raise exception 'EDICION_39_INCOHERENTE: las líneas del documento no suman el total.' using errcode = 'P0001';
  end if;

  perform set_config('p82.din', '1', true);
  delete from public.cotizacion_servicios where cotizacion_id = c.id;
  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor,
                                           costo_neto, modo, pct_markup, ta, valor)
  select c.id, (o.n - 1)::integer, o.e->>'tipo_servicio', nullif(o.e->>'plataforma', ''), nullif(o.e->>'nombre_servicio', ''),
         nullif(o.e->>'proveedor', ''), (o.e->>'costo_neto')::numeric, coalesce(o.e->>'modo', 'mk'),
         coalesce((o.e->>'pct_markup')::numeric, 0), coalesce((o.e->>'ta')::numeric, 0), (o.e->>'valor')::numeric
    from jsonb_array_elements(p_servicios) with ordinality as o(e, n);
  perform public.din_marcar_lineas(c.id, p_servicios);

  v_det := jsonb_set(coalesce(c.detalle, '{}'::jsonb), '{items}', v_items, true);
  v_det := jsonb_set(v_det, '{venta}', coalesce(v_det->'venta', '{}'::jsonb) || jsonb_build_object('precio_venta', v_precio), true);
  update public.cotizaciones set precio_venta = v_precio, detalle = v_det where id = c.id;

  select coalesce(max(version), 0) + 1 into v_ver from public.cotizacion_versiones where cotizacion_id = c.id;
  insert into public.cotizacion_versiones (cotizacion_id, tenant, version, motivo, precio_venta, moneda, documento, lineas, creado_por)
  values (c.id, c.tenant, v_ver, btrim(p_motivo), v_precio, c.moneda, v_det, public.din_lineas_sin_costo(c.id), p_usuario_id);
  perform set_config('p82.din', '', true);
  return v_ver;
end $$;
revoke all on function public.editar_cotizacion_din(uuid, bigint, integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.editar_cotizacion_din(uuid, bigint, integer, text, jsonb, jsonb) to service_role;

-- Registrar costos reales por componente (no cambia el precio al cliente ni crea versión).
create or replace function public.registrar_costos_cotizacion_din(
  p_usuario_id uuid, p_cotizacion_id bigint, p_costos jsonb
) returns text[]
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  u public.usuarios;
  c public.cotizaciones;
  e jsonb;
begin
  select * into u from public.usuarios where id = p_usuario_id;
  if not found or u.activo is not true or u.rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'DIN_82_NO_AUTORIZADO: no tienes permiso para registrar costos.' using errcode = '42501';
  end if;
  select * into c from public.cotizaciones where id = p_cotizacion_id for update;
  if not found or (u.rol <> 'superadmin' and u.tenant is distinct from c.tenant) then
    raise exception 'DIN_82_NO_AUTORIZADO: no tienes permiso para registrar costos.' using errcode = '42501';
  end if;
  if c.paquete_din_id is null or c.estado is distinct from 'abierta'
     or exists (select 1 from public.ventas v where v.cotizacion_id = c.id) then
    raise exception 'DIN_82_NO_ELEGIBLE: la cotización no es dinámica o ya no está abierta.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_costos) is distinct from 'array' or jsonb_array_length(p_costos) = 0 then
    raise exception 'DIN_82_COSTOS: indica al menos un costo.' using errcode = 'P0001';
  end if;
  perform set_config('p82.din', '1', true);
  for e in select x from jsonb_array_elements(p_costos) x loop
    if jsonb_typeof(e->'orden') is distinct from 'number' or jsonb_typeof(e->'costo_neto') is distinct from 'number'
       or (e->>'costo_neto')::numeric <= 0 or length(btrim(coalesce(e->>'proveedor', ''))) = 0 then
      raise exception 'DIN_82_COSTOS: cada costo necesita valor mayor que 0 y proveedor.' using errcode = 'P0001';
    end if;
    update public.cotizacion_servicios
       set costo_neto = (e->>'costo_neto')::numeric, proveedor = btrim(e->>'proveedor')
     where cotizacion_id = c.id and orden = (e->>'orden')::integer;
    if not found then
      raise exception 'DIN_82_COSTOS: el componente % no existe.', e->>'orden' using errcode = 'P0001';
    end if;
  end loop;
  perform set_config('p82.din', '', true);
  return public.din_costos_pendientes(c.id);
end $$;
revoke all on function public.registrar_costos_cotizacion_din(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_costos_cotizacion_din(uuid, bigint, jsonb) to service_role;

-- Marcar una versión como mostrada/enviada al cliente.
create or replace function public.marcar_version_mostrada(p_usuario_id uuid, p_cotizacion_id bigint, p_version integer)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; c public.cotizaciones;
begin
  select * into u from public.usuarios where id = p_usuario_id;
  if not found or u.activo is not true or u.rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta') then
    raise exception 'DIN_82_NO_AUTORIZADO: sin permiso.' using errcode = '42501';
  end if;
  select * into c from public.cotizaciones where id = p_cotizacion_id;
  if not found or (u.rol <> 'superadmin' and u.tenant is distinct from c.tenant)
     or (u.rol = 'venta' and c.creado_por_id is distinct from u.id) then
    raise exception 'DIN_82_NO_AUTORIZADO: sin permiso.' using errcode = '42501';
  end if;
  update public.cotizacion_versiones set mostrada_en = now(), mostrada_por = p_usuario_id
   where cotizacion_id = p_cotizacion_id and version = p_version and mostrada_en is null;
  if not found and not exists (select 1 from public.cotizacion_versiones where cotizacion_id = p_cotizacion_id and version = p_version) then
    raise exception 'DIN_82_VERSION: la versión no existe.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.marcar_version_mostrada(uuid, bigint, integer) from public, anon, authenticated;
grant execute on function public.marcar_version_mostrada(uuid, bigint, integer) to service_role;

-- Convertir: valida costos reales ANTES de numerar; luego usa la conversión controlada vigente.
create or replace function public.convertir_cotizacion_din(p_cotizacion_id bigint, p_usuario_id uuid)
returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_pend text[];
  v_paq bigint;
begin
  select c.paquete_din_id into v_paq from public.cotizaciones c where c.id = p_cotizacion_id for update;
  if not found then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  if v_paq is null then
    raise exception 'DIN_82_NO_DINAMICA: esta cotización no pertenece a un paquete dinámico.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.ventas v where v.cotizacion_id = p_cotizacion_id) then
    v_pend := public.din_costos_pendientes(p_cotizacion_id);
    if coalesce(array_length(v_pend, 1), 0) > 0 then
      raise exception 'DIN_82_COSTOS_PENDIENTES: registra el costo real y el proveedor de: % antes de convertir.', array_to_string(v_pend, ', ') using errcode = 'P0001';
    end if;
  end if;
  return public.convertir_cotizacion_manual_controlada(p_cotizacion_id, p_usuario_id);
end $$;
revoke all on function public.convertir_cotizacion_din(bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.convertir_cotizacion_din(bigint, uuid) to service_role;

-- ═══ 5. Guardas ═══
-- 5.1 Los servicios de una cotización dinámica solo cambian por las RPC de arriba.
create or replace function public.tg_din_servicios_guarda() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cot bigint := case when tg_op = 'DELETE' then old.cotizacion_id else new.cotizacion_id end;
begin
  if coalesce(current_setting('p82.din', true), '') <> '1'
     and exists (select 1 from public.cotizaciones c where c.id = v_cot and c.paquete_din_id is not null) then
    raise exception 'DIN_82_USAR_EDITOR: los componentes de un paquete dinámico se editan con su propio editor.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_din_servicios_guarda on public.cotizacion_servicios;
create trigger trg_din_servicios_guarda before insert or update or delete on public.cotizacion_servicios
  for each row execute function public.tg_din_servicios_guarda();

-- 5.2 El precio/documento de una cotización dinámica no cambia por el editor manual de recobro/niños.
create or replace function public.tg_din_cotizacion_guarda() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.paquete_din_id is not null and coalesce(current_setting('p82.din', true), '') <> '1'
     and ((new.precio_venta, new.moneda, new.detalle->'items') is distinct from (old.precio_venta, old.moneda, old.detalle->'items')) then
    raise exception 'DIN_82_USAR_EDITOR: el precio de un paquete dinámico se edita con su propio editor.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_din_cotizacion_guarda on public.cotizaciones;
create trigger trg_din_cotizacion_guarda before update on public.cotizaciones
  for each row execute function public.tg_din_cotizacion_guarda();

-- 5.3 Red de seguridad: ninguna venta nace de una cotización dinámica con costos pendientes.
create or replace function public.tg_din_venta_guarda() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pend text[];
begin
  if new.cotizacion_id is not null
     and exists (select 1 from public.cotizaciones c where c.id = new.cotizacion_id and c.paquete_din_id is not null) then
    v_pend := public.din_costos_pendientes(new.cotizacion_id);
    if coalesce(array_length(v_pend, 1), 0) > 0 then
      raise exception 'DIN_82_COSTOS_PENDIENTES: faltan costos reales de: %.', array_to_string(v_pend, ', ') using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_din_venta_guarda on public.ventas;
create trigger trg_din_venta_guarda before insert on public.ventas
  for each row execute function public.tg_din_venta_guarda();
