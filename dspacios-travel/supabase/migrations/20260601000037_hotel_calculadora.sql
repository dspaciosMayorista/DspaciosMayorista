-- Migración 037: CALCULADORA de tarifas por hotel (estructura especial)
--
-- Algunos hoteles mandan la tarifa con su propia fórmula (ej. HOTEL DUBAI:
-- una base por persona/noche + modificadores por acomodación + suplementos de
-- régimen). En vez de "montar el resultado" a mano, se guarda aquí el TIPO de
-- calculadora y sus PARÁMETROS, y un botón "Generar tarifas" produce las filas
-- normales en `tarifa_hotel` (el resto del sistema funciona igual).
--
-- Es extensible: cada tipo de calculadora es una función en lib/calc/calculadoras.
-- Una fila por hotel.

create table if not exists public.hotel_calculadora (
  id          bigserial primary key,
  hotel_id    bigint not null unique references public.hoteles(id) on delete cascade,
  tipo        text not null default 'dubai',
  params      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.hotel_calculadora enable row level security;

drop policy if exists "hotel_calculadora: interno" on public.hotel_calculadora;
create policy "hotel_calculadora: interno" on public.hotel_calculadora for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));
