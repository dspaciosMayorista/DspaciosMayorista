-- Migración 027: configuración de ACOMODACIONES por hotel (reservar por habitaciones)
--
-- Rediseño de Reservar (puntos 2 y 3 del handoff):
--   2) Se reserva por CANTIDAD DE HABITACIONES, no por personas. 1 hab Doble ⇒
--      tarifa_doble × 2 pax; 1 Triple ⇒ × 3; Sencilla ⇒ × 1. El multiplicador
--      (pax que cubre la tarifa por persona de una habitación) es `pax_tarifa`.
--   3) Config de acomodaciones por hotel:
--      A) pax mínimo/máximo del hotel  (hoteles.pax_min / pax_max).
--      B) por acomodación: pax máx + (mín/máx adultos, niños, infantes).
--         Ej. Sencilla: máx 2 | adt 1–1 | chd 0–1 | inf 0–1.
--              Doble:    máx 4 | adt 2–2 | chd 0–2 | inf 0–2.
-- Las reglas adt/chd/inf alimentan la validación pasajeros↔acomodación (punto 4).

-- A) Pax mínimo y máximo del hotel (acomodación global).
alter table public.hoteles
  add column if not exists pax_min integer,
  add column if not exists pax_max integer;

-- B) Reglas por acomodación (solo tipos de habitación: sencilla/doble/triple/multiple).
create table if not exists public.hotel_acomodaciones (
  id          bigserial primary key,
  hotel_id    bigint not null references public.hoteles(id) on delete cascade,
  acomodacion acomodacion_tipo not null,          -- sencilla|doble|triple|multiple
  pax_tarifa  integer not null default 1,          -- pax que cubre 1 habitación (× tarifa/persona)
  pax_max     integer not null default 1,          -- máximo de pax por habitación
  adt_min     integer not null default 0,
  adt_max     integer not null default 0,
  chd_min     integer not null default 0,
  chd_max     integer not null default 0,
  inf_min     integer not null default 0,
  inf_max     integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (hotel_id, acomodacion)
);

create index if not exists idx_hotel_acomodaciones_hotel on public.hotel_acomodaciones(hotel_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Lectura para cualquier usuario autenticado (la reserva la hace el asesor
-- 'venta'); escritura solo interna (gestión del producto).
alter table public.hotel_acomodaciones enable row level security;

drop policy if exists "hotel_acomodaciones: lectura"   on public.hotel_acomodaciones;
drop policy if exists "hotel_acomodaciones: escritura" on public.hotel_acomodaciones;

create policy "hotel_acomodaciones: lectura" on public.hotel_acomodaciones
  for select using (auth.uid() is not null);

create policy "hotel_acomodaciones: escritura" on public.hotel_acomodaciones
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));
