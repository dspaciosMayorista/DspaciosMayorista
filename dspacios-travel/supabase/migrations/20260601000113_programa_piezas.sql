-- ───────────────────────────────────────────────────────────────────────────
-- 113 · PROGRAMAS — piezas gráficas SUBIDAS (flyer / historia) + bucket
--
--  En vez de generar el flyer/historia, el dueño SUBE las piezas ya diseñadas y
--  el cliente las descarga. Bucket público 'programas' (lectura por URL, escritura
--  interna), igual que 'hotel-fotos'. La portada (portada_url) ya existe y ahora
--  también se puede SUBIR (no solo pegar URL).
-- ───────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('programas', 'programas', true)
on conflict (id) do nothing;

drop policy if exists "programas: lectura publica" on storage.objects;
create policy "programas: lectura publica" on storage.objects
  for select using (bucket_id = 'programas');

drop policy if exists "programas: escritura interna" on storage.objects;
create policy "programas: escritura interna" on storage.objects
  for all
  using (bucket_id = 'programas' and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (bucket_id = 'programas' and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

alter table public.programas
  add column if not exists flyer_url    text,
  add column if not exists historia_url text;
