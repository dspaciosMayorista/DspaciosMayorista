-- 138 · Foto de portada para servicios adicionales (tours/receptivos)
--
-- Pedido: en Vista Booking → Receptivos, poder darle clic a un tour y ver una
-- imagen + descripción, igual que ya pasa con los hoteles. La descripción ya
-- existía (migración 088); faltaba la foto. Un servicio = UNA imagen (no una
-- galería como hoteles): basta una columna directa, sin tabla aparte.

alter table public.servicios_adicionales add column if not exists foto_url text;

-- Bucket público (se muestra en el tarifario público), mismo patrón que
-- 'hotel-fotos' (055): lectura anónima, escritura interna.
insert into storage.buckets (id, name, public)
values ('servicio-fotos', 'servicio-fotos', true)
on conflict (id) do nothing;

drop policy if exists "servicio-fotos: lectura publica" on storage.objects;
create policy "servicio-fotos: lectura publica" on storage.objects
  for select using (bucket_id = 'servicio-fotos');

drop policy if exists "servicio-fotos: escritura interna" on storage.objects;
create policy "servicio-fotos: escritura interna" on storage.objects
  for all
  using (bucket_id = 'servicio-fotos' and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (bucket_id = 'servicio-fotos' and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));
