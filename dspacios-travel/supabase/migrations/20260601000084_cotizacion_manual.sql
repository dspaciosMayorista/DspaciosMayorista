-- Migración 084: Cotización DINÁMICA / MANUAL
--
-- Además de la cotización que sale del tarifario (desde un paquete), ahora se
-- puede crear una cotización 100% MANUAL: el asesor arma a mano los servicios
-- (aéreo, hotel, traslado, asistencia médica, otro) indicando por cada uno la
-- PLATAFORMA por donde lo cotizó, el NOMBRE del servicio, el PROVEEDOR, su costo
-- neto y un markup (margen). El valor de cada servicio = costo / (1 - markup) y
-- el total es la suma. Se guarda en la misma tabla `cotizaciones` con tipo
-- 'manual'; los servicios viven en `cotizacion_servicios`.

-- Distinguir el origen de la cotización: 'tarifario' (desde paquete) o 'manual'.
alter table public.cotizaciones
  add column if not exists tipo text not null default 'tarifario';

-- En las manuales el payload del tarifario no aplica → permitir null.
alter table public.cotizaciones
  alter column payload drop not null;

create table if not exists public.cotizacion_servicios (
  id             bigserial primary key,
  cotizacion_id  bigint not null references public.cotizaciones(id) on delete cascade,
  orden          integer not null default 0,
  tipo_servicio  text not null,        -- aereo / hotel / traslado / asistencia / otro
  plataforma     text,                 -- por dónde se cotizó (Despegar, JetSMART, Booking…)
  nombre_servicio text,                -- nombre del servicio
  proveedor      text,                 -- proveedor del servicio (texto libre)
  costo_neto     numeric(15,2) not null default 0,
  pct_markup     numeric(6,4) not null default 0,   -- margen en fracción (0.25 = 25%)
  valor          numeric(15,2) not null default 0,  -- costo / (1 - markup)
  created_at     timestamptz not null default now()
);

create index if not exists idx_cot_servicios_cotizacion on public.cotizacion_servicios(cotizacion_id);

-- ── RLS: mismo alcance interno que cotizaciones ───────────────────────────
alter table public.cotizacion_servicios enable row level security;

drop policy if exists "cotizacion_servicios: interno" on public.cotizacion_servicios;
create policy "cotizacion_servicios: interno" on public.cotizacion_servicios for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));
