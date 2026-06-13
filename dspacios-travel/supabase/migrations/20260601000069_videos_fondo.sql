-- ───────────────────────────────────────────────────────────────────────────
-- 069 · VIDEOS de fondo (YouTube por URL)
--
-- Videos servidos por YouTube (no consumen Storage de Supabase: solo guardamos
-- el URL). Tres lugares:
--   · config_sitio.video_fondo_url → video de fondo del tarifario público (uno
--     global). Lectura PÚBLICA (el tarifario se ve sin login).
--   · hoteles.video_url            → video del hotel (se muestra en su ficha).
--   · programas.video_url          → video del programa (portada/hero del circuito).
-- ───────────────────────────────────────────────────────────────────────────

-- Configuración del sitio (una sola fila, lectura pública) ───────────────────
create table if not exists public.config_sitio (
  id              integer primary key default 1,
  video_fondo_url text,
  updated_at      timestamptz not null default now(),
  constraint config_sitio_una_fila check (id = 1)
);
insert into public.config_sitio (id) values (1) on conflict (id) do nothing;

alter table public.config_sitio enable row level security;
drop policy if exists "config_sitio: lectura pública" on public.config_sitio;
create policy "config_sitio: lectura pública" on public.config_sitio for select using (true);
drop policy if exists "config_sitio: escritura interna" on public.config_sitio;
create policy "config_sitio: escritura interna" on public.config_sitio
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

-- Video por hotel y por programa ─────────────────────────────────────────────
alter table public.hoteles   add column if not exists video_url text;
alter table public.programas add column if not exists video_url text;
