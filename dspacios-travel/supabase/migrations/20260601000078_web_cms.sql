-- ─────────────────────────────────────────────────────────────────────────
-- Migración 078: CMS del SITIO WEB público (marketing).
--
-- Tablas que alimentan la web pública (route group app/(sitio)). El contenido
-- lo administra SOLO el superadmin desde /dashboard/cms. Lectura pública
-- (anónima) de las filas activas; escritura solo superadmin.
--
-- Reemplaza el contenido estático de lib/sitio/data.js por datos editables.
-- ─────────────────────────────────────────────────────────────────────────

-- ===== PAQUETES (tarjetas de marketing) =====
create table if not exists public.web_paquetes (
  id               bigserial primary key,
  titulo           text not null,
  region           text,
  destino          text,
  duracion         text,                       -- "4 días / 3 noches"
  personas         text,                       -- "2 personas"
  precio_desde     text,                       -- "desde $X" (texto para preservar formato)
  descripcion      text,
  descripcion_larga text,
  incluye          text[] not null default '{}',
  no_incluye       text[] not null default '{}',
  imagen_url       text,
  galeria          text[] not null default '{}',
  destacado        boolean not null default false,
  cta_url          text,                        -- a dónde lleva "Cotizar" (default /tarifario)
  orden            int not null default 0,
  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ===== DESTINOS =====
create table if not exists public.web_destinos (
  id          bigserial primary key,
  nombre      text not null,
  region      text,
  imagen_url  text,
  tips        text[] not null default '{}',
  orden       int not null default 0,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ===== TESTIMONIOS =====
create table if not exists public.web_testimonios (
  id          bigserial primary key,
  nombre      text not null,
  ubicacion   text,
  rating      int not null default 5 check (rating between 1 and 5),
  comentario  text not null,
  imagen_url  text,
  orden       int not null default 0,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ===== BLOG =====
create table if not exists public.web_blog (
  id          bigserial primary key,
  titulo      text not null,
  slug        text unique,
  categoria   text,
  fecha       text,                            -- "15 Oct 2023" (texto, como el origen)
  resumen     text,
  contenido   text,
  imagen_url  text,
  orden       int not null default 0,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ===== CONFIG GLOBAL (fila única) =====
-- Hero, Nosotros, contacto, WhatsApp y redes. Un solo registro (id = 1).
create table if not exists public.web_config (
  id                 int primary key default 1 check (id = 1),
  -- Hero
  hero_titulo        text,
  hero_subtitulo     text,
  hero_imagen_url    text,
  hero_cta_texto     text,
  hero_cta_url       text,
  -- Nosotros
  nosotros_titulo    text,
  nosotros_texto     text,
  nosotros_imagen_url text,
  -- Contacto / canales
  contacto_email     text,
  contacto_telefono  text,
  whatsapp_numero    text,                      -- "573212150582"
  whatsapp_mensaje   text,
  direccion          text,
  -- Redes
  instagram_url      text,
  facebook_url       text,
  tiktok_url         text,
  -- Flexible (bloques que no merecen columna propia)
  extra              jsonb not null default '{}',
  updated_at         timestamptz not null default now()
);

insert into public.web_config (id) values (1) on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- RLS: lectura pública de lo ACTIVO; escritura solo superadmin.
-- (El superadmin además ve TODO — incl. inactivo — vía la policy "for all".)
-- ─────────────────────────────────────────────────────────────────────────
alter table public.web_paquetes    enable row level security;
alter table public.web_destinos    enable row level security;
alter table public.web_testimonios enable row level security;
alter table public.web_blog        enable row level security;
alter table public.web_config      enable row level security;

-- Lectura pública (anon + autenticados) de filas activas.
drop policy if exists "web_paquetes: público activo"    on public.web_paquetes;
drop policy if exists "web_destinos: público activo"    on public.web_destinos;
drop policy if exists "web_testimonios: público activo" on public.web_testimonios;
drop policy if exists "web_blog: público activo"        on public.web_blog;
drop policy if exists "web_config: público"             on public.web_config;

create policy "web_paquetes: público activo"    on public.web_paquetes    for select using (activo);
create policy "web_destinos: público activo"    on public.web_destinos    for select using (activo);
create policy "web_testimonios: público activo" on public.web_testimonios for select using (activo);
create policy "web_blog: público activo"        on public.web_blog        for select using (activo);
create policy "web_config: público"             on public.web_config      for select using (true);

-- Escritura (y lectura total) solo superadmin.
drop policy if exists "web_paquetes: superadmin"    on public.web_paquetes;
drop policy if exists "web_destinos: superadmin"    on public.web_destinos;
drop policy if exists "web_testimonios: superadmin" on public.web_testimonios;
drop policy if exists "web_blog: superadmin"        on public.web_blog;
drop policy if exists "web_config: superadmin"      on public.web_config;

create policy "web_paquetes: superadmin"    on public.web_paquetes    for all
  using (public.mi_rol() = 'superadmin') with check (public.mi_rol() = 'superadmin');
create policy "web_destinos: superadmin"    on public.web_destinos    for all
  using (public.mi_rol() = 'superadmin') with check (public.mi_rol() = 'superadmin');
create policy "web_testimonios: superadmin" on public.web_testimonios for all
  using (public.mi_rol() = 'superadmin') with check (public.mi_rol() = 'superadmin');
create policy "web_blog: superadmin"        on public.web_blog        for all
  using (public.mi_rol() = 'superadmin') with check (public.mi_rol() = 'superadmin');
create policy "web_config: superadmin"      on public.web_config      for all
  using (public.mi_rol() = 'superadmin') with check (public.mi_rol() = 'superadmin');

-- Índices de orden/activo para el render del sitio.
create index if not exists web_paquetes_orden_idx    on public.web_paquetes (activo, orden);
create index if not exists web_destinos_orden_idx    on public.web_destinos (activo, orden);
create index if not exists web_testimonios_orden_idx on public.web_testimonios (activo, orden);
create index if not exists web_blog_orden_idx        on public.web_blog (activo, orden);
