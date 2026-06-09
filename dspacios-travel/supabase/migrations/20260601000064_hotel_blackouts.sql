-- 064 · Black out GENERAL del hotel (cierre de ventas por noches)
--
-- Cierra la venta del hotel en un rango de noches, por encima de CUALQUIER
-- vigencia. Puede ser cierre TOTAL (todas las habitaciones) o por acomodaciones
-- específicas. El motor de liquidación por fechas excluye esas noches.

create table if not exists public.hotel_blackouts (
  id            bigserial primary key,
  hotel_id      bigint not null references public.hoteles(id) on delete cascade,
  fecha_inicio  date not null,
  fecha_fin     date not null,                 -- noche final cerrada (inclusive)
  total         boolean not null default true, -- true = cierre total (todas las hab)
  acomodaciones text[],                        -- si total=false, qué acomodaciones cierra
  motivo        text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_hotel_blackouts_hotel on public.hotel_blackouts(hotel_id);

alter table public.hotel_blackouts enable row level security;
drop policy if exists "hotel_blackouts: lectura" on public.hotel_blackouts;
create policy "hotel_blackouts: lectura" on public.hotel_blackouts
  for select using (auth.uid() is not null);
drop policy if exists "hotel_blackouts: escritura" on public.hotel_blackouts;
create policy "hotel_blackouts: escritura" on public.hotel_blackouts
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));
