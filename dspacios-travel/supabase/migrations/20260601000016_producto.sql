-- Migración 016: Módulo PRODUCTO — tarifas negociadas (solo costos netos)
--
-- Proveedores (hotelero/aéreo/servicios), hoteles con sus edades y temporadas
-- propias, tarifa de hotel neta por acomodación, servicios adicionales y enlace
-- de proveedor en los bloqueos aéreos. Todo es interno (no lo ve el asesor).

-- ── Proveedores: razón social + datos de pago ─────────────────────────────
alter table public.proveedores
  add column if not exists razon_social text,
  add column if not exists datos_pago   text;

-- ── Hoteles: proveedor + configuración de edades por hotel ────────────────
alter table public.hoteles
  add column if not exists proveedor_id     bigint references public.proveedores(id),
  add column if not exists edad_infante_min integer default 0,
  add column if not exists edad_infante_max integer default 2,
  add column if not exists edad_nino_min    integer default 2,
  add column if not exists edad_nino_max    integer default 10;

-- ── Temporadas propias de cada hotel (rangos) ─────────────────────────────
create table if not exists public.hotel_temporadas (
  id            bigserial primary key,
  hotel_id      bigint not null references public.hoteles(id) on delete cascade,
  nombre        text not null,
  fecha_inicio  date,
  fecha_fin     date,
  orden         integer default 0
);

-- ── Tarifa de hotel NETA por tipo de habitación + alimentación + temporada ─
create table if not exists public.tarifa_hotel (
  id              bigserial primary key,
  hotel_id        bigint not null references public.hoteles(id) on delete cascade,
  tipo_habitacion text,
  alimentacion    text,
  temporada       text,                 -- nombre de la temporada del hotel
  neto_sencilla   numeric(15,2),
  neto_doble      numeric(15,2),
  neto_triple     numeric(15,2),
  neto_multiple   numeric(15,2),
  neto_nino       numeric(15,2),         -- infante siempre $0 (no se cobra)
  notas           text,
  created_at      timestamptz not null default now()
);

-- ── Servicios adicionales NETOS ───────────────────────────────────────────
do $$ begin
  create type liquidacion_tipo as enum ('dia','noche','paquete');
exception when duplicate_object then null; end $$;

create table if not exists public.servicios_adicionales (
  id            bigserial primary key,
  nombre        text not null,
  proveedor_id  bigint references public.proveedores(id),
  destino_id    bigint references public.destinos(id),
  tarifa_neta   numeric(15,2) default 0,
  temporada     text,
  liquidacion   liquidacion_tipo not null default 'paquete',
  activo        boolean default true,
  created_at    timestamptz not null default now()
);

-- ── Aéreo: proveedor del bloqueo ──────────────────────────────────────────
alter table public.bloqueos_vuelo
  add column if not exists proveedor_id bigint references public.proveedores(id);

-- ── RLS: todo PRODUCTO es interno (el asesor 'venta' no ve costos) ────────
alter table public.hotel_temporadas      enable row level security;
alter table public.tarifa_hotel          enable row level security;
alter table public.servicios_adicionales enable row level security;

drop policy if exists "hotel_temporadas: interno"      on public.hotel_temporadas;
drop policy if exists "tarifa_hotel: interno"          on public.tarifa_hotel;
drop policy if exists "servicios_adicionales: interno" on public.servicios_adicionales;

create policy "hotel_temporadas: interno" on public.hotel_temporadas for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

create policy "tarifa_hotel: interno" on public.tarifa_hotel for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

create policy "servicios_adicionales: interno" on public.servicios_adicionales for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));
