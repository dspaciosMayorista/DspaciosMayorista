-- Migración 001: Tablas de catálogo y usuarios
-- Ejecutar en Supabase SQL Editor

-- ──────────────────────────────────────────────────────────────────
-- EXTENSIONES
-- ──────────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ──────────────────────────────────────────────────────────────────
-- TIPOS ENUM
-- ──────────────────────────────────────────────────────────────────
do $$ begin
  create type rol_usuario as enum (
    'superadmin', 'gerencia', 'administracion', 'operaciones',
    'venta', 'control_vuelo', 'agencia', 'freelance', 'cliente_final'
  );
exception when duplicate_object then null; end $$;

-- ──────────────────────────────────────────────────────────────────
-- USUARIOS (perfil extendido de auth.users)
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.usuarios (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null unique,
  nombre          text not null,
  rol             rol_usuario not null default 'venta',
  activo          boolean not null default true,
  fecha_registro  timestamptz not null default now()
);

-- Trigger: crear perfil automáticamente al registrarse en Supabase Auth
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuarios (id, email, nombre, rol)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'rol')::rol_usuario, 'venta')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ──────────────────────────────────────────────────────────────────
-- ASESORES
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.asesores (
  id                  bigserial primary key,
  nombre              text not null,
  email               text unique,
  rol                 text,
  pct_comision_base   numeric(5,4) default 0,
  pct_sobre_meta      numeric(5,4) default 0,
  meta_mensual        numeric(15,2) default 0,
  activo              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────
-- PROVEEDORES
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.proveedores (
  id                  bigserial primary key,
  nombre              text not null,
  nit                 text,
  tipo                text,
  ciudad              text,
  contacto            text,
  aplica_retencion    boolean default false,
  pct_retencion       numeric(5,4) default 0,
  created_at          timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────
-- ALIADOS (catálogo B2B)
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.aliados (
  id                  bigserial primary key,
  nombre              text not null,
  nit                 text,
  contacto            text,
  email               text,
  telefono            text,
  aplica_retencion    boolean default false,
  pct_retencion       numeric(5,4) default 0,
  created_at          timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────
-- PARÁMETROS TRIBUTARIOS
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.parametros_tributarios (
  id              bigserial primary key,
  parametro       text not null unique,
  valor           numeric(10,6) not null,
  base_calculo    text,
  descripcion     text,
  updated_at      timestamptz not null default now()
);
