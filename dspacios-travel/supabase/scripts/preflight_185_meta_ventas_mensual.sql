-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la migración 185 (`meta_ventas_mensual`).
-- SOLO LECTURA — no modifica nada. Correr ANTES de aplicar la 185.
-- Compatible con Supabase SQL Editor: una sola sentencia, sin metacomandos
-- de psql, resultado en una única fila JSON.
--
-- Comprueba las precondiciones de las que depende la migración:
--   · `public.meta_ventas_mensual` NO existe todavía (si ya existe, la
--     migración sería un no-op parcial — hay que revisar por qué antes de
--     aplicar de nuevo, en vez de asumir que es seguro repetir).
--   · Los helpers de RLS que las policies usan (`public.mi_rol()` y
--     `public.puede_ver_tenant(text)`) ya existen — la migración 185 los
--     referencia pero no los crea.
--   · No hay ningún objeto (tabla, índice, policy) que choque de nombre.
--   · Cuenta de usuarios por rol, informativo (no bloquea `ok`).
-- ───────────────────────────────────────────────────────────────────────────
select jsonb_build_object(
  'ok',
    (to_regclass('public.meta_ventas_mensual') is null)
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'mi_rol')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'puede_ver_tenant')
    and (to_regclass('public.idx_meta_ventas_tenant_periodo') is null)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'meta_ventas_mensual'),
  'tabla_no_existe_aun', to_regclass('public.meta_ventas_mensual') is null,
  'existe_mi_rol', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'mi_rol'),
  'existe_puede_ver_tenant', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'puede_ver_tenant'),
  'indice_libre', to_regclass('public.idx_meta_ventas_tenant_periodo') is null,
  'sin_policies_previas', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'meta_ventas_mensual'),
  'usuarios_por_rol', (
    select coalesce(jsonb_object_agg(rol, n), '{}'::jsonb)
    from (
      select rol, count(*) as n
      from public.usuarios
      where rol in ('superadmin', 'gerencia', 'administracion', 'operaciones')
      group by rol
    ) u
  ),
  'checked_at', now()
) as resultado;
