-- Migración 003: Inventario de vuelos / sillas

-- ──────────────────────────────────────────────────────────────────
-- TIPOS ENUM
-- ──────────────────────────────────────────────────────────────────
do $$ begin
  create type estado_silla as enum (
    'disponible', 'en_plazo', 'confirmada', 'devuelta',
    'no_vendida', 'cambio', 'cambio_entrante'
  );
exception when duplicate_object then null; end $$;

-- ──────────────────────────────────────────────────────────────────
-- BLOQUEOS DE VUELO
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.bloqueos_vuelo (
  id                    bigserial primary key,
  record                text not null unique,          -- PNR, ej: L93FYZ
  aerolinea             text,
  ruta                  text,
  vuelo_ida             text,
  fecha_ida             date,
  hora_salida_ida       time,
  hora_llegada_ida      time,
  vuelo_regreso         text,
  fecha_regreso         date,
  hora_salida_reg       time,
  hora_llegada_reg      time,
  cupos_total           integer default 0,
  tarifa_para_empaquetar numeric(15,2) default 0,
  fecha_devolucion      date,
  fecha_emision         date,
  notas                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────
-- SILLAS
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.sillas (
  id                    bigserial primary key,
  bloqueo_id            bigint not null references public.bloqueos_vuelo(id),
  numero_silla          integer,
  estado                estado_silla not null default 'disponible',
  numero_contrato       text references public.ventas(numero_contrato),
  -- Pasajero adulto
  pasajero_nombres      text,
  pasajero_apellidos    text,
  tipo_doc              text,
  numero_doc            text,
  nacimiento            date,
  -- Metadatos operativos
  asesor                text,
  agencia               text,
  hotel                 text,
  acomodacion           text,
  plazo                 date,
  -- Infante (opcional)
  inf_nombres           text,
  inf_apellidos         text,
  inf_tipo_doc          text,
  inf_numero            text,
  inf_nacimiento        date,
  responsable_menor     text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────
-- MOVIMIENTOS DE SILLA (transferencias entre records)
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.movimientos_silla (
  id                    bigserial primary key,
  silla_id              bigint not null references public.sillas(id),
  bloqueo_origen_id     bigint references public.bloqueos_vuelo(id),
  bloqueo_destino_id    bigint references public.bloqueos_vuelo(id),
  motivo                text,
  fecha_movimiento      timestamptz not null default now(),
  registrado_por        text
);

-- Vista: cupos disponibles por bloqueo
create or replace view public.cupos_por_bloqueo as
select
  b.id,
  b.record,
  b.ruta,
  b.fecha_ida,
  b.cupos_total,
  count(s.id) filter (where s.estado = 'disponible') as cupos_disponibles,
  count(s.id) filter (where s.estado in ('confirmada', 'en_plazo')) as cupos_ocupados,
  count(s.id) filter (where s.estado = 'devuelta') as cupos_devueltos
from public.bloqueos_vuelo b
left join public.sillas s on s.bloqueo_id = b.id
group by b.id, b.record, b.ruta, b.fecha_ida, b.cupos_total;
