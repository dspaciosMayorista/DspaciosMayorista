-- 052 · DOCUMENTOS por hotel (PDF de tarifas que envía el hotel — respaldo/origen)
--
-- Archivos de respaldo del hotel (ej. el tarifario en PDF que manda el hotel, como
-- prueba del origen de las tarifas). Bucket PRIVADO 'hoteles' (descarga con URL
-- firmada). Una fila por archivo enlazada al hotel.

insert into storage.buckets (id, name, public)
values ('hoteles', 'hoteles', false)
on conflict (id) do nothing;

drop policy if exists "hoteles files: acceso" on storage.objects;
create policy "hoteles files: acceso" on storage.objects
  for all
  using (bucket_id = 'hoteles' and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (bucket_id = 'hoteles' and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

create table if not exists public.hotel_documentos (
  id          bigserial primary key,
  hotel_id    bigint not null references public.hoteles(id) on delete cascade,
  tipo        text not null default 'tarifario',   -- tarifario | acuerdo | otro
  nombre      text,
  path        text not null,                        -- ruta dentro del bucket
  size_bytes  bigint,
  subido_por  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_hotel_documentos_hotel on public.hotel_documentos(hotel_id);

alter table public.hotel_documentos enable row level security;
drop policy if exists "hotel_documentos: interno" on public.hotel_documentos;
create policy "hotel_documentos: interno" on public.hotel_documentos
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));
