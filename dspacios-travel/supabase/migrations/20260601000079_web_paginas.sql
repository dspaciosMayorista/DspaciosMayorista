-- ─────────────────────────────────────────────────────────────────────────
-- Migración 079: CMS por PÁGINAS y SECCIONES (estilo "creador de sitios").
--
-- Reemplaza el enfoque plano (fichas) por un árbol de páginas/subpáginas
-- (navegación con menús desplegables) + secciones editables por página.
-- El sitio público renderiza cada página leyendo sus secciones en orden.
-- Edición y administración: solo superadmin (RLS). Lectura pública de lo activo.
-- ─────────────────────────────────────────────────────────────────────────

-- ===== PÁGINAS (árbol: parent_id para subpáginas / menús) =====
create table if not exists public.web_paginas (
  id            bigserial primary key,
  parent_id     bigint references public.web_paginas(id) on delete cascade,
  slug          text not null unique,          -- ruta: "/" usa slug 'inicio'
  titulo        text not null,                 -- H1 / título de la página
  etiqueta_menu text,                          -- texto en el menú (si difiere del título)
  tipo          text not null default 'generica',
  -- tipos: home | destinos_nacionales | destinos_internacionales | destino |
  --        experiencias | nosotros | contacto | blog | generica
  es_grupo_menu boolean not null default false, -- padre que solo agrupa en el menú (desplegable)
  en_menu       boolean not null default true,  -- aparece en la navegación
  orden         int not null default 0,
  seo_titulo    text,
  seo_descripcion text,
  imagen_portada text,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists web_paginas_parent_idx on public.web_paginas (parent_id, orden);
create index if not exists web_paginas_menu_idx   on public.web_paginas (en_menu, activo, orden);

-- ===== SECCIONES (cuerpo de cada página) =====
create table if not exists public.web_secciones (
  id         bigserial primary key,
  pagina_id  bigint not null references public.web_paginas(id) on delete cascade,
  tipo       text not null,
  -- tipos: hero | texto | galeria | destinos_grid | experiencias | testimonios |
  --        blog_grid | cta | contacto
  orden      int not null default 0,
  datos      jsonb not null default '{}',   -- contenido propio de la sección
  visible    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists web_secciones_pagina_idx on public.web_secciones (pagina_id, orden);

-- ─────────────────────────────────────────────────────────────────────────
-- RLS: lectura pública de lo activo/visible; escritura solo superadmin.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.web_paginas   enable row level security;
alter table public.web_secciones enable row level security;

drop policy if exists "web_paginas: público activo"   on public.web_paginas;
drop policy if exists "web_paginas: superadmin"        on public.web_paginas;
drop policy if exists "web_secciones: público visible" on public.web_secciones;
drop policy if exists "web_secciones: superadmin"      on public.web_secciones;

create policy "web_paginas: público activo"   on public.web_paginas   for select using (activo);
create policy "web_paginas: superadmin"        on public.web_paginas   for all
  using (public.mi_rol() = 'superadmin') with check (public.mi_rol() = 'superadmin');

create policy "web_secciones: público visible" on public.web_secciones for select using (visible);
create policy "web_secciones: superadmin"      on public.web_secciones for all
  using (public.mi_rol() = 'superadmin') with check (public.mi_rol() = 'superadmin');
