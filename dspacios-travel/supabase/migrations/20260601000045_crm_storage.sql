-- Migración 045: bucket de Storage para imágenes/flyers de las campañas del CRM.

insert into storage.buckets (id, name, public)
values ('crm', 'crm', true)
on conflict (id) do nothing;

drop policy if exists "crm img: lectura"   on storage.objects;
drop policy if exists "crm img: escritura" on storage.objects;

create policy "crm img: lectura" on storage.objects
  for select using (bucket_id = 'crm');

create policy "crm img: escritura" on storage.objects
  for all
  using (bucket_id = 'crm' and public.mi_rol() in ('superadmin','gerencia','administracion'))
  with check (bucket_id = 'crm' and public.mi_rol() in ('superadmin','gerencia','administracion'));
