-- ─────────────────────────────────────────────────────────────────────────
-- SaaS multi-tenant · Fase 0 — Fundación (edición white-label).
--
-- SOLO existe en la rama `saas-whitelabel` (producto SaaS independiente). NO va
-- a la base de D'spacios (main). Establece el concepto de ORGANIZACIÓN (tenant)
-- sin tocar todavía las tablas de negocio (eso es la Fase 1).
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- ===== ORGANIZACIONES (cada agencia cliente del SaaS) =====
create table if not exists public.organizaciones (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,         -- subdominio: <slug>.tudominio.com
  nombre        text not null,
  nit           text,
  ciudad        text,
  pais          text default 'Colombia',
  contacto      text,
  email         text,
  telefono      text,
  -- Marca (reemplaza el viejo empresa_config; configurable por agencia)
  logo_url        text,
  logo_white_url  text,
  color_primario  text default '#1D7C9A',
  color_acento    text default '#26BBD9',
  -- Contrato / legal configurable
  contrato_encabezado text,
  contrato_pie        text,
  contrato_terminos   text,
  -- Estado de la cuenta SaaS
  plan          text not null default 'trial',  -- trial|basico|pro|enterprise
  estado        text not null default 'activa', -- activa|suspendida|cancelada
  trial_hasta   date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ===== Cada usuario pertenece a una organización =====
alter table public.usuarios add column if not exists org_id uuid references public.organizaciones(id);
create index if not exists idx_usuarios_org on public.usuarios(org_id);

-- ===== Helper: organización del usuario autenticado (base del aislamiento) =====
create or replace function public.mi_org()
returns uuid language sql security definer stable as $$
  select org_id from public.usuarios where id = auth.uid();
$$;

-- ===== RLS de organizaciones =====
alter table public.organizaciones enable row level security;

drop policy if exists "organizaciones: miembros leen su org" on public.organizaciones;
create policy "organizaciones: miembros leen su org" on public.organizaciones
  for select using (id = public.mi_org());

drop policy if exists "organizaciones: superadmin de la org edita" on public.organizaciones;
create policy "organizaciones: superadmin de la org edita" on public.organizaciones
  for all
  using (id = public.mi_org() and public.mi_rol() = 'superadmin')
  with check (id = public.mi_org() and public.mi_rol() = 'superadmin');

-- NOTA: la Fase 1 agrega `org_id` + RLS por org a TODAS las tablas de negocio.
-- El rol de plataforma (administrar todas las orgs) y el onboarding self-service
-- llegan en fases posteriores (ver docs/saas/arquitectura-multitenant.md).
