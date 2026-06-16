-- ─────────────────────────────────────────────────────────────────────────
-- Migración 080: Storage para el CMS del sitio (imágenes y flyers).
--
-- Bucket público 'web-cms': lectura pública (las imágenes/flyers del sitio son
-- públicas); escritura/borrado solo superadmin. La subida real se hace desde
-- un server action con service-role (que igual exige superadmin antes).
-- ─────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('web-cms', 'web-cms', true)
on conflict (id) do nothing;

-- Lectura pública de los objetos del bucket.
drop policy if exists "web-cms: lectura pública" on storage.objects;
create policy "web-cms: lectura pública" on storage.objects
  for select using (bucket_id = 'web-cms');

-- Escritura/actualización/borrado solo superadmin.
drop policy if exists "web-cms: insert superadmin" on storage.objects;
create policy "web-cms: insert superadmin" on storage.objects
  for insert with check (bucket_id = 'web-cms' and public.mi_rol() = 'superadmin');

drop policy if exists "web-cms: update superadmin" on storage.objects;
create policy "web-cms: update superadmin" on storage.objects
  for update using (bucket_id = 'web-cms' and public.mi_rol() = 'superadmin');

drop policy if exists "web-cms: delete superadmin" on storage.objects;
create policy "web-cms: delete superadmin" on storage.objects
  for delete using (bucket_id = 'web-cms' and public.mi_rol() = 'superadmin');
