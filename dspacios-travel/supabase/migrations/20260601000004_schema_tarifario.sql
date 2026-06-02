-- Migración 004: Tarifario (scaffold Fase 1 — tablas vacías por ahora)

-- ──────────────────────────────────────────────────────────────────
-- TIPOS ENUM
-- ──────────────────────────────────────────────────────────────────
do $$ begin
  create type acomodacion_tipo as enum ('sencilla', 'doble', 'triple', 'multiple', 'nino');
exception when duplicate_object then null; end $$;

do $$ begin
  create type temporada_tipo as enum ('ALTA', 'MEDIA', 'BAJA');
exception when duplicate_object then null; end $$;

-- ──────────────────────────────────────────────────────────────────
-- DESTINOS
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.destinos (
  id            bigserial primary key,
  nombre        text not null unique,
  codigo_iata   text,
  activo        boolean default true
);

-- ──────────────────────────────────────────────────────────────────
-- HOTELES
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.hoteles (
  id            bigserial primary key,
  destino_id    bigint not null references public.destinos(id),
  nombre        text not null,
  zona          text,
  notas         text,
  activo        boolean default true
);

-- ──────────────────────────────────────────────────────────────────
-- HABITACIONES
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.habitaciones (
  id            bigserial primary key,
  hotel_id      bigint not null references public.hoteles(id),
  nombre        text not null          -- ej: "Estándar vista al mar"
);

-- ──────────────────────────────────────────────────────────────────
-- PLANES DE ALIMENTACIÓN
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.planes_alimentacion (
  id            bigserial primary key,
  codigo        text not null unique,
  nombre        text not null,
  descripcion   text,
  activo        boolean default true
);

-- ──────────────────────────────────────────────────────────────────
-- TEMPORADAS
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.temporadas (
  id            bigserial primary key,
  destino_id    bigint not null references public.destinos(id),
  nombre        temporada_tipo not null,
  anio          integer not null default extract(year from now())
);

create table if not exists public.temporada_fechas (
  id            bigserial primary key,
  temporada_id  bigint not null references public.temporadas(id) on delete cascade,
  fecha_inicio  date not null,
  fecha_fin     date not null,
  constraint no_fechas_invalidas check (fecha_fin >= fecha_inicio)
);

-- ──────────────────────────────────────────────────────────────────
-- TARIFAS
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.tarifas (
  id                          bigserial primary key,
  hotel_id                    bigint not null references public.hoteles(id),
  habitacion_id               bigint references public.habitaciones(id),
  plan_id                     bigint not null references public.planes_alimentacion(id),
  temporada_id                bigint not null references public.temporadas(id),
  noches                      integer not null default 3,
  comisionable                boolean default true,
  impuesto_no_comisionable    numeric(15,2) default 0,  -- ej: San Andrés $599.000/pax
  notas                       text,
  activo                      boolean default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- Precios por acomodación (filas, no columnas — NO APLICA = ausencia de fila)
create table if not exists public.tarifa_precios (
  id            bigserial primary key,
  tarifa_id     bigint not null references public.tarifas(id) on delete cascade,
  acomodacion   acomodacion_tipo not null,
  precio        numeric(15,2) not null check (precio > 0),
  unique (tarifa_id, acomodacion)
);

-- ──────────────────────────────────────────────────────────────────
-- ITINERARIOS (vincula destino con bloqueos de vuelo)
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.itinerarios (
  id              bigserial primary key,
  destino_id      bigint not null references public.destinos(id),
  bloqueo_id      bigint references public.bloqueos_vuelo(id),
  ruta            text,
  fecha_ida       date,
  fecha_regreso   date,
  cupos           integer default 0,
  activo          boolean default true
);

-- ──────────────────────────────────────────────────────────────────
-- INCLUSIONES / EXCLUSIONES DEL PAQUETE
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.inclusiones (
  id            bigserial primary key,
  destino_id    bigint not null references public.destinos(id),
  tipo          text not null check (tipo in ('incluye', 'no_incluye')),
  texto         text not null,
  orden         integer default 0
);
