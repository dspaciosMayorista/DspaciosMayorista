-- ─────────────────────────────────────────────────────────────────────────
-- SaaS multi-tenant · Fase 1 — Paso 1: ORG #1 + `org_id` en todas las tablas
-- de negocio + backfill.  (SOLO rama `saas-whitelabel`; migración 115.)
--
-- Qué hace y por qué NO rompe nada (sigue operando como una sola agencia):
--   1) Crea la organización #1 = "D'spacios Travel" (los datos actuales son suyos).
--   2) Asigna todos los usuarios actuales a esa org.
--   3) Agrega `org_id` (uuid, FK) a TODAS las tablas base de `public` (menos las
--      que ya lo tienen o no aplica) con DEFAULT = org #1 → los registros
--      existentes quedan backfilleados y los inserts nuevos siguen funcionando
--      aunque el código aún no setee `org_id`.
--   4) Índice por `org_id` en cada tabla.
--
-- ⚠️ El `default = org #1` es un PUENTE temporal (mono-tenant). En el paso donde
--    el código setee `org_id` en cada insert y exista onboarding, se quita el
--    default y se pone NOT NULL.  La RLS por org se reescribe POR MÓDULO en pasos
--    siguientes: las tablas con lectura pública (tarifario_resultado, web_*,
--    hoteles, destinos, programas…) necesitan policies que resuelvan el org desde
--    el path/host, no desde `mi_org()`, así que NO se tocan aquí.
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

do $$
declare
  v_org uuid;
  t text;
  -- No llevan org_id: la tabla de tenants, usuarios (ya lo tiene, migr. 114) y el
  -- log de auditoría (se le dará scope por org en un paso posterior, junto con su
  -- trigger).
  excluidas text[] := array['organizaciones', 'usuarios', 'auditoria'];
begin
  -- 1) Org #1 = D'spacios (marca actual).
  insert into public.organizaciones (slug, nombre, pais, color_primario, color_acento, plan, estado)
  values ('dspacios', 'D''spacios Travel', 'Colombia', '#1D7C9A', '#26BBD9', 'enterprise', 'activa')
  on conflict (slug) do nothing;
  select id into v_org from public.organizaciones where slug = 'dspacios';

  -- 2) Todos los usuarios actuales pertenecen a la org #1.
  update public.usuarios set org_id = v_org where org_id is null;

  -- 3) + 4) org_id (default temporal = org #1) + backfill + índice por tabla.
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> all (excluidas)
  loop
    execute format(
      'alter table public.%I add column if not exists org_id uuid references public.organizaciones(id) default %L',
      t, v_org
    );
    execute format('update public.%I set org_id = %L where org_id is null', t, v_org);
    execute format('create index if not exists idx_%s_org on public.%I (org_id)', t, t);
  end loop;
end $$;
