-- 055 · FOTOS por hotel (galería para el tarifario público)
--
-- A diferencia de los documentos (bucket privado 'hoteles'), las fotos se MUESTRAN
-- en el tarifario público, así que van en un bucket PÚBLICO 'hotel-fotos' (lectura
-- anónima por URL pública). La escritura sigue siendo interna. Una fila por foto;
-- `es_portada` marca la imagen principal que usa la vista tipo Booking.

insert into storage.buckets (id, name, public)
values ('hotel-fotos', 'hotel-fotos', true)
on conflict (id) do nothing;

-- Lectura pública del bucket; escritura solo interna.
drop policy if exists "hotel-fotos: lectura publica" on storage.objects;
create policy "hotel-fotos: lectura publica" on storage.objects
  for select using (bucket_id = 'hotel-fotos');

drop policy if exists "hotel-fotos: escritura interna" on storage.objects;
create policy "hotel-fotos: escritura interna" on storage.objects
  for all
  using (bucket_id = 'hotel-fotos' and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (bucket_id = 'hotel-fotos' and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

create table if not exists public.hotel_fotos (
  id          bigserial primary key,
  hotel_id    bigint not null references public.hoteles(id) on delete cascade,
  path        text not null,                 -- ruta dentro del bucket público
  url         text not null,                 -- URL pública (getPublicUrl)
  orden       integer not null default 0,
  es_portada  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_hotel_fotos_hotel on public.hotel_fotos(hotel_id);

alter table public.hotel_fotos enable row level security;

-- Lectura PÚBLICA (el tarifario es público) + escritura interna.
drop policy if exists "hotel_fotos: lectura publica" on public.hotel_fotos;
create policy "hotel_fotos: lectura publica" on public.hotel_fotos
  for select using (true);

drop policy if exists "hotel_fotos: escritura interna" on public.hotel_fotos;
create policy "hotel_fotos: escritura interna" on public.hotel_fotos
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));
