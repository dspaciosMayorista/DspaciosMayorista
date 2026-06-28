-- ─────────────────────────────────────────────────────────────────────────
-- SaaS multi-tenant · Fase 1 — Paso 3a: AISLAMIENTO por organización (RLS).
-- (SOLO rama `saas-whitelabel`; migración 117.)
--
-- Agrega una policy RESTRICTIVE uniforme `org_isolation` a cada tabla de negocio
-- que YA tenga RLS habilitada y columna `org_id`:
--
--   using/with check:  org_id = public.mi_org()  OR  auth.uid() is null
--
-- Semántica (las RESTRICTIVE se combinan con AND sobre las permissive existentes):
--   • Usuario logueado  → solo ve/escribe filas de SU organización (mi_org()).
--   • Anónimo (público) → sin restricción de org (auth.uid() null). Las lecturas
--     públicas —tarifario/sitio— se acotarán por el org del path en el Paso 4.
--   • service-role      → BYPASEA RLS (por eso sus inserts setean org_id explícito).
--
-- Por qué NO rompe nada en mono-tenant: con una sola org, TODOS los usuarios y datos
-- son de la org #1, así que `org_id = mi_org()` es siempre verdadero; y el anónimo
-- queda exento. Para multi-tenant, ya aísla a los usuarios logueados.
--
-- Excluidas: `organizaciones` (policy propia, migr. 114), `usuarios` (RLS sensible de
-- login/perfil — se le dará scope por org en un paso aparte) y `auditoria`.
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  t record;
  excluidas text[] := array['organizaciones', 'usuarios', 'auditoria'];
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity            -- solo tablas con RLS ya habilitada
      and c.relname <> all (excluidas)
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t.relname and column_name = 'org_id'
    ) then
      execute format('drop policy if exists org_isolation on public.%I', t.relname);
      execute format(
        'create policy org_isolation on public.%I as restrictive for all '
        'using (org_id = public.mi_org() or auth.uid() is null) '
        'with check (org_id = public.mi_org() or auth.uid() is null)',
        t.relname
      );
    end if;
  end loop;
end $$;
