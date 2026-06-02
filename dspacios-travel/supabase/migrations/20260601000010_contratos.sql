-- Migración 010: Generador de contratos
--
-- Añade la numeración automática de contratos, los campos del contrato en
-- `ventas` y las tablas hijas (pasajeros, hoteles, vuelos e ítems de valores)
-- que alimentan el PDF/documento del contrato. Todo cuelga de numero_contrato.

-- ──────────────────────────────────────────────────────────────────
-- NUMERACIÓN DE CONTRATOS (formato 00-NNNN). Continúa tras 00-00481.
-- ──────────────────────────────────────────────────────────────────
create sequence if not exists public.contrato_seq start 482;

create or replace function public.siguiente_numero_contrato()
returns text language sql security definer set search_path = public as $$
  select '00-' || lpad(nextval('public.contrato_seq')::text, 4, '0');
$$;

-- ──────────────────────────────────────────────────────────────────
-- CAMPOS DEL CONTRATO EN VENTAS
-- ──────────────────────────────────────────────────────────────────
alter table public.ventas
  add column if not exists fecha_emision        date default current_date,
  add column if not exists cliente_documento    text,
  add column if not exists cliente_telefono      text,
  add column if not exists cliente_direccion     text,
  add column if not exists asistencia_medica     boolean default false,
  add column if not exists plan_nombre           text,
  add column if not exists tours_traslados       text,
  add column if not exists asesor_firma_nombre   text,
  add column if not exists asesor_firma_cargo    text default 'Asesor/a',
  add column if not exists asesor_firma_cc       text,
  add column if not exists asesor_firma_tel      text;

-- ──────────────────────────────────────────────────────────────────
-- PASAJEROS DEL CONTRATO
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.contrato_pasajeros (
  id              bigserial primary key,
  numero_contrato text not null references public.ventas(numero_contrato) on delete cascade,
  nombre          text not null,
  tipo_id         text default 'CC',
  identificacion  text,
  fecha_nacimiento date,
  es_infante      boolean default false,
  orden           integer default 0
);

-- ──────────────────────────────────────────────────────────────────
-- HOTELES DEL CONTRATO
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.contrato_hoteles (
  id                  bigserial primary key,
  numero_contrato     text not null references public.ventas(numero_contrato) on delete cascade,
  nombre              text not null,
  ciudad              text,
  alimentacion        text,
  acomodacion         text,
  detalle_acomodacion text,
  fecha_ingreso       date,
  fecha_salida        date,
  orden               integer default 0
);

-- ──────────────────────────────────────────────────────────────────
-- TRAYECTOS DE VUELO DEL CONTRATO
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.contrato_vuelos (
  id              bigserial primary key,
  numero_contrato text not null references public.ventas(numero_contrato) on delete cascade,
  aerolinea       text,
  origen_codigo   text,
  origen_ciudad   text,
  destino_codigo  text,
  destino_ciudad  text,
  servicios       text,
  fecha_salida    date,
  orden           integer default 0
);

-- ──────────────────────────────────────────────────────────────────
-- ÍTEMS DE VALORES DEL CONTRATO
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.contrato_items (
  id              bigserial primary key,
  numero_contrato text not null references public.ventas(numero_contrato) on delete cascade,
  descripcion     text not null,
  adultos         integer default 0,
  ninos           integer default 0,
  tarifa_adulto   numeric(15,2) default 0,
  tarifa_nino     numeric(15,2) default 0,
  orden           integer default 0
);

-- ──────────────────────────────────────────────────────────────────
-- RLS (acceso interno; la creación la hace operaciones/venta/admin)
-- ──────────────────────────────────────────────────────────────────
alter table public.contrato_pasajeros enable row level security;
alter table public.contrato_hoteles   enable row level security;
alter table public.contrato_vuelos    enable row level security;
alter table public.contrato_items     enable row level security;

drop policy if exists "contrato_pasajeros: interno" on public.contrato_pasajeros;
drop policy if exists "contrato_hoteles: interno"   on public.contrato_hoteles;
drop policy if exists "contrato_vuelos: interno"    on public.contrato_vuelos;
drop policy if exists "contrato_items: interno"     on public.contrato_items;

create policy "contrato_pasajeros: interno" on public.contrato_pasajeros for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','administracion','operaciones','venta'));

create policy "contrato_hoteles: interno" on public.contrato_hoteles for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','administracion','operaciones','venta'));

create policy "contrato_vuelos: interno" on public.contrato_vuelos for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','administracion','operaciones','venta'));

create policy "contrato_items: interno" on public.contrato_items for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','administracion','operaciones','venta'));
