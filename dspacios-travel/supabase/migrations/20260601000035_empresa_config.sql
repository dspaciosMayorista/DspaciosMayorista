-- Migración 035: INFORMACIÓN DE LA EMPRESA (marca blanca / white-label)
--
-- Hace la app vendible a otras agencias: el nombre, logo, datos tributarios
-- (cabecera del contrato), cuenta bancaria y las políticas/condiciones dejan de
-- estar "quemados" en el código y pasan a esta config editable.
--
-- Patrón de fila única: id siempre = 1 (una sola empresa por instalación).
-- El SEED es GENÉRICO (producto en blanco). Para conservar la identidad de
-- D'spacios en su propia instalación, correr aparte:
--   supabase/scripts/empresa_dspacios.sql

create table if not exists public.empresa_config (
  id                integer primary key default 1 check (id = 1),

  -- ── Identidad ──────────────────────────────────────────────
  nombre_comercial  text not null default 'Tu Agencia de Viajes',
  tagline           text default 'Agencia de Viajes y Turismo',

  -- ── Logos (URL pública; se pueden subir al bucket 'empresa') ─
  logo_url          text,   -- color, fondos claros
  logo_white_url    text,   -- blanco, fondos de color
  logo_icon_url     text,   -- ícono cuadrado (PWA/favicon)
  color_primary     text default '#1D7C9A',
  color_accent      text default '#26BBD9',

  -- ── Tributario / cabecera del contrato (datos del RUT) ──────
  razon_social      text default '',
  nit               text default '',
  dv                text default '',     -- dígito de verificación
  regimen           text default '',
  rnt               text default '',     -- Registro Nacional de Turismo
  direccion         text default '',
  ciudad            text default '',
  telefono          text default '',
  email             text default '',
  sitio_web         text default '',

  -- ── Bancario (datos de pago del contrato) ──────────────────
  banco             text default '',
  cuenta_tipo       text default '',     -- 'cuenta corriente' / 'cuenta de ahorros'
  cuenta_numero     text default '',
  cuenta_titular    text default '',

  -- ── Legal (editable; espacios en blanco que llena cada agencia)
  ciudad_emision    text default '',
  jurisdiccion      text default '',
  politica_pago     text default '',
  politica_cancelacion text default '',
  terminos_condiciones text default '',
  nota_contrato     text default '',

  updated_at        timestamptz not null default now()
);

-- Fila única genérica.
insert into public.empresa_config (id, nombre_comercial)
values (1, 'Tu Agencia de Viajes')
on conflict (id) do nothing;

-- ── RLS: lectura PÚBLICA (el nombre/logo/políticas salen en el contrato
--    compartible y el tarifario público); escritura solo interna. ───────────
alter table public.empresa_config enable row level security;

drop policy if exists "empresa_config: lectura"   on public.empresa_config;
drop policy if exists "empresa_config: escritura" on public.empresa_config;

create policy "empresa_config: lectura" on public.empresa_config
  for select using (true);

create policy "empresa_config: escritura" on public.empresa_config
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion'));

-- ── Storage: bucket público para los logos de la empresa ───────────────────
insert into storage.buckets (id, name, public)
values ('empresa', 'empresa', true)
on conflict (id) do nothing;

drop policy if exists "empresa logos: lectura"  on storage.objects;
drop policy if exists "empresa logos: escritura" on storage.objects;

create policy "empresa logos: lectura" on storage.objects
  for select using (bucket_id = 'empresa');

create policy "empresa logos: escritura" on storage.objects
  for all
  using (bucket_id = 'empresa' and public.mi_rol() in ('superadmin','gerencia','administracion'))
  with check (bucket_id = 'empresa' and public.mi_rol() in ('superadmin','gerencia','administracion'));
