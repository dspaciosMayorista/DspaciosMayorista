-- Migración 013: Módulo de Producto — paquetes prearmados
--
-- Un paquete es un producto NEGOCIADO listo para vender (bloqueo o porción
-- terrestre): categoría + hoteles encadenados + precio por acomodación.
-- Los COSTOS van en tabla aparte (paquete_costos) con RLS restringido para que
-- el asesor comercial NO los vea — solo operación/administración/gerencia.

do $$ begin
  create type paquete_categoria as enum ('bloqueo','porcion_terrestre');
exception when duplicate_object then null; end $$;

create table if not exists public.paquetes (
  id                        bigserial primary key,
  categoria                 paquete_categoria not null,
  destino_id                bigint references public.destinos(id),
  nombre                    text not null,
  descripcion               text,
  plan_alimentacion         text,
  noches                    integer not null default 3,
  comisionable              boolean default true,
  impuesto_no_comisionable  numeric(15,2) default 0,
  bloqueo_id                bigint references public.bloqueos_vuelo(id),  -- record por defecto (bloqueo)
  activo                    boolean default true,
  notas                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table if not exists public.paquete_hoteles (
  id                  bigserial primary key,
  paquete_id          bigint not null references public.paquetes(id) on delete cascade,
  nombre              text not null,
  ciudad              text,
  alimentacion        text,
  acomodacion_detalle text,
  noches              integer default 0,
  orden               integer default 0
);

create table if not exists public.paquete_precios (
  id          bigserial primary key,
  paquete_id  bigint not null references public.paquetes(id) on delete cascade,
  acomodacion acomodacion_tipo not null,
  precio      numeric(15,2) not null check (precio > 0),
  unique (paquete_id, acomodacion)
);

-- Costos negociados — OCULTOS al asesor (RLS interno)
create table if not exists public.paquete_costos (
  paquete_id        bigint primary key references public.paquetes(id) on delete cascade,
  costo_hotel       numeric(15,2) default 0,
  costo_aereo       numeric(15,2) default 0,
  costo_receptivo   numeric(15,2) default 0,
  costo_asistencia  numeric(15,2) default 0,
  otros_costos      numeric(15,2) default 0
);

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.paquetes        enable row level security;
alter table public.paquete_hoteles enable row level security;
alter table public.paquete_precios enable row level security;
alter table public.paquete_costos  enable row level security;

drop policy if exists "paquetes: lectura"          on public.paquetes;
drop policy if exists "paquetes: escritura"        on public.paquetes;
drop policy if exists "paquete_hoteles: lectura"   on public.paquete_hoteles;
drop policy if exists "paquete_hoteles: escritura" on public.paquete_hoteles;
drop policy if exists "paquete_precios: lectura"   on public.paquete_precios;
drop policy if exists "paquete_precios: escritura" on public.paquete_precios;
drop policy if exists "paquete_costos: interno"    on public.paquete_costos;

-- Paquetes, hoteles y precios de venta: lectura amplia (tarifa neta para agencias),
-- escritura de operaciones/administración.
create policy "paquetes: lectura" on public.paquetes for select using (true);
create policy "paquetes: escritura" on public.paquetes for all
  using (public.mi_rol() in ('superadmin','operaciones','administracion'));

create policy "paquete_hoteles: lectura" on public.paquete_hoteles for select using (true);
create policy "paquete_hoteles: escritura" on public.paquete_hoteles for all
  using (public.mi_rol() in ('superadmin','operaciones','administracion'));

create policy "paquete_precios: lectura" on public.paquete_precios for select using (true);
create policy "paquete_precios: escritura" on public.paquete_precios for all
  using (public.mi_rol() in ('superadmin','operaciones','administracion'));

-- Costos: SOLO interno (el asesor 'venta' NO puede leerlos ni escribirlos).
create policy "paquete_costos: interno" on public.paquete_costos for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));
