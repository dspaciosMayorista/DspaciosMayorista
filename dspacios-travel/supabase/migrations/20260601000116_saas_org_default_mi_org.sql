-- ─────────────────────────────────────────────────────────────────────────
-- SaaS multi-tenant · Fase 1 — Paso 2 (parcial): el org_id de inserts CON SESIÓN
-- sale de `mi_org()` automáticamente.  (SOLO rama `saas-whitelabel`; migración 102.)
--
-- Cambia el DEFAULT de `org_id` en todas las tablas de negocio:
--   antes (migr. 101):  org #1 fijo
--   ahora:              coalesce(public.mi_org(), org #1)
--
-- Efecto:
--   • Inserts con SESIÓN de usuario (anon key + JWT) → `org_id` = el org del usuario
--     (vía mi_org()). Multi-tenant correcto, SIN cambios de código.
--   • Inserts con SERVICE-ROLE o públicos (sin auth.uid → mi_org() null) → caen a la
--     org #1 (puente seguro mientras haya UNA sola org).
--
-- ⚠️ FALTA (resto del Paso 2, ver CLAUDE-SAAS.md): pasar `org_id` EXPLÍCITO en los
--    inserts con service-role (reservar: sillas/costos/CxP; cotización manual: CxP;
--    contratos; checkout; registro B2B; usuarios). HASTA hacerlo, NO abrir una 2ª org
--    (sus escrituras service-role caerían en la org #1). Luego: quitar este default y
--    poner `org_id NOT NULL`, y reescribir la RLS por org (Paso 3).
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  v_org uuid;
  t text;
  excluidas text[] := array['organizaciones', 'usuarios', 'auditoria'];
begin
  select id into v_org from public.organizaciones where slug = 'dspacios';

  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> all (excluidas)
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'org_id'
    ) then
      execute format(
        'alter table public.%I alter column org_id set default coalesce(public.mi_org(), %L::uuid)',
        t, v_org
      );
    end if;
  end loop;
end $$;
