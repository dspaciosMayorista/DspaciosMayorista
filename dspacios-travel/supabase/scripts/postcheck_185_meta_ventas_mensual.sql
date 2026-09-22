-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK de la migración 185 (`meta_ventas_mensual`).
-- SOLO LECTURA. Correr DESPUÉS de aplicar la 185.
-- Compatible con Supabase SQL Editor: una sola sentencia, sin metacomandos
-- de psql, resultado en una única fila JSON.
--
-- Verifica lo que la migración promete, no solo que "no falló":
--   · columnas completas (8), check `valor > 0`, unicidad (tenant, periodo, moneda);
--   · RLS habilitada, 4 policies (una por acción, nunca "for all");
--   · las 4 policies filtran por tenant (puede_ver_tenant);
--   · lectura incluye el set interno completo (con 'operaciones');
--   · escritura (insert/update/delete) NO incluye 'operaciones';
--   · sin trigger de updated_at (decisión de diseño: se fija desde la
--     Server Action, mismo patrón que otras tablas del repo);
--   · GRANT de tabla: anon SIN acceso; authenticated con
--     select/insert/update/delete; service_role con todo;
--   · GRANT de secuencia (`meta_ventas_mensual_id_seq`): anon SIN acceso;
--     authenticated con usage/select; service_role con todo.
-- ───────────────────────────────────────────────────────────────────────────
with checks as (
  select
    (select count(*) = 8 from information_schema.columns
       where table_schema = 'public' and table_name = 'meta_ventas_mensual') as columnas_completas,
    exists (select 1 from pg_constraint
       where conrelid = 'public.meta_ventas_mensual'::regclass and contype = 'c'
         and pg_get_constraintdef(oid) ilike '%valor%0%') as check_valor_positivo,
    exists (select 1 from pg_constraint
       where conrelid = 'public.meta_ventas_mensual'::regclass and contype = 'u') as unicidad_existe,
    (select relrowsecurity from pg_class where oid = 'public.meta_ventas_mensual'::regclass) as rls_habilitada,
    (select count(*) = 4 from pg_policies
       where schemaname = 'public' and tablename = 'meta_ventas_mensual') as policies_4,
    (select count(*) = 0 from pg_policies
       where schemaname = 'public' and tablename = 'meta_ventas_mensual' and polcmd = '*') as sin_for_all,
    (select count(*) filter (where qual ilike '%puede_ver_tenant%' or with_check ilike '%puede_ver_tenant%') = 4
       from pg_policies where schemaname = 'public' and tablename = 'meta_ventas_mensual') as todas_filtran_tenant,
    coalesce((select bool_and(qual ilike '%operaciones%') from pg_policies
       where schemaname = 'public' and tablename = 'meta_ventas_mensual' and polcmd = 'r'), false) as lectura_incluye_operaciones,
    not coalesce((select bool_or(coalesce(qual, with_check) ilike '%operaciones%') from pg_policies
       where schemaname = 'public' and tablename = 'meta_ventas_mensual' and polcmd in ('a', 'w', 'd')), false) as escritura_sin_operaciones,
    not exists (select 1 from pg_trigger
       where tgrelid = 'public.meta_ventas_mensual'::regclass and not tgisinternal) as sin_trigger_updated_at,
    not (has_table_privilege('anon', 'public.meta_ventas_mensual', 'SELECT')
      or has_table_privilege('anon', 'public.meta_ventas_mensual', 'INSERT')
      or has_table_privilege('anon', 'public.meta_ventas_mensual', 'UPDATE')
      or has_table_privilege('anon', 'public.meta_ventas_mensual', 'DELETE')) as anon_tabla_sin_acceso,
    (has_table_privilege('authenticated', 'public.meta_ventas_mensual', 'SELECT')
      and has_table_privilege('authenticated', 'public.meta_ventas_mensual', 'INSERT')
      and has_table_privilege('authenticated', 'public.meta_ventas_mensual', 'UPDATE')
      and has_table_privilege('authenticated', 'public.meta_ventas_mensual', 'DELETE')) as authenticated_tabla_ok,
    (has_table_privilege('service_role', 'public.meta_ventas_mensual', 'SELECT')
      and has_table_privilege('service_role', 'public.meta_ventas_mensual', 'INSERT')
      and has_table_privilege('service_role', 'public.meta_ventas_mensual', 'UPDATE')
      and has_table_privilege('service_role', 'public.meta_ventas_mensual', 'DELETE')) as service_role_tabla_ok,
    not (has_sequence_privilege('anon', 'public.meta_ventas_mensual_id_seq', 'USAGE')
      or has_sequence_privilege('anon', 'public.meta_ventas_mensual_id_seq', 'SELECT')) as anon_secuencia_sin_acceso,
    (has_sequence_privilege('authenticated', 'public.meta_ventas_mensual_id_seq', 'USAGE')
      and has_sequence_privilege('authenticated', 'public.meta_ventas_mensual_id_seq', 'SELECT')) as authenticated_secuencia_ok,
    has_sequence_privilege('service_role', 'public.meta_ventas_mensual_id_seq', 'USAGE') as service_role_secuencia_ok
)
select jsonb_build_object(
  'ok',
    columnas_completas and check_valor_positivo and unicidad_existe and rls_habilitada
    and policies_4 and sin_for_all and todas_filtran_tenant and lectura_incluye_operaciones
    and escritura_sin_operaciones and sin_trigger_updated_at and anon_tabla_sin_acceso
    and authenticated_tabla_ok and service_role_tabla_ok and anon_secuencia_sin_acceso
    and authenticated_secuencia_ok and service_role_secuencia_ok,
  'columnas_completas', columnas_completas,
  'check_valor_positivo', check_valor_positivo,
  'unicidad_existe', unicidad_existe,
  'rls_habilitada', rls_habilitada,
  'policies_4', policies_4,
  'sin_for_all', sin_for_all,
  'todas_filtran_tenant', todas_filtran_tenant,
  'lectura_incluye_operaciones', lectura_incluye_operaciones,
  'escritura_sin_operaciones', escritura_sin_operaciones,
  'sin_trigger_updated_at', sin_trigger_updated_at,
  'anon_tabla_sin_acceso', anon_tabla_sin_acceso,
  'authenticated_tabla_ok', authenticated_tabla_ok,
  'service_role_tabla_ok', service_role_tabla_ok,
  'anon_secuencia_sin_acceso', anon_secuencia_sin_acceso,
  'authenticated_secuencia_ok', authenticated_secuencia_ok,
  'service_role_secuencia_ok', service_role_secuencia_ok,
  'checked_at', now()
) as resultado
from checks;
