-- ───────────────────────────────────────────────────────────────────────────
-- 089 · SERVICIOS por TEMPORADA + vigencia de compra (igual que hoteles)
--
--  Algunos servicios cambian de tarifa según la fecha del viaje. Se replica el
--  modelo de hoteles (temporadas con rango de fechas + vigencia de compra +
--  prioridad), pero acotado a lo que un servicio necesita (sin descuentos /
--  blackouts / min_noches).
--
--   · servicio_temporadas: rangos de fecha del VIAJE (fecha_inicio/fecha_fin) con
--     su VIGENCIA DE COMPRA (compra_inicio/compra_fin), prioridad y su propio
--     precio_persona. Análogo a hotel_temporadas + el neto de tarifa_hotel.
--   · servicio_tarifa_pax gana `temporada`: los rangos por GRUPO también pueden
--     variar por temporada (como tarifa_hotel por temporada).
--
--  La tarifa que el servicio ya tiene hoy es la temporada **'GENERAL'** (sin
--  fechas = aplica siempre): el precio por persona sigue en
--  `servicios_adicionales.precio_persona` y los rangos por grupo existentes
--  quedan con temporada='GENERAL'. Las temporadas con fechas son OVERRIDES que
--  ganan cuando la fecha del viaje cae en su rango y están en vigencia de compra.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.servicio_temporadas (
  id             bigserial primary key,
  servicio_id    bigint not null references public.servicios_adicionales(id) on delete cascade,
  nombre         text not null,
  fecha_inicio   date,
  fecha_fin      date,
  prioridad      integer not null default 1,   -- gana la de mayor prioridad que cubra la fecha
  compra_inicio  date,                          -- vigencia de compra (desde)
  compra_fin     date,                          -- vigencia de compra (hasta)
  precio_persona numeric(15,2),                 -- tarifa por persona en ESA temporada
  orden          integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_servicio_temporadas_servicio on public.servicio_temporadas(servicio_id);

-- Rangos por GRUPO también por temporada (la actual = 'GENERAL').
alter table public.servicio_tarifa_pax
  add column if not exists temporada text not null default 'GENERAL';
update public.servicio_tarifa_pax set temporada = 'GENERAL' where temporada is null;

-- ── RLS: interno (mismo criterio que servicio_tarifa_pax) ──────────────────
alter table public.servicio_temporadas enable row level security;
drop policy if exists "servicio_temporadas: interno" on public.servicio_temporadas;
create policy "servicio_temporadas: interno" on public.servicio_temporadas for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));
