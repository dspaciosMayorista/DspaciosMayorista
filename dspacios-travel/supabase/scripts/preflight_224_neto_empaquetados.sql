-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 224 · vista `empaquetados_basica` (fase 1, aditiva). SOLO LECTURA (termina en ROLLBACK).
-- Correr ANTES de aplicar la 224. Una fila por dato: codigo | nivel | cantidad | detalle.
-- CUENTA lo existente y NO bloquea: ningún nivel es BLOQUEANTE (la migración valida sus propios
-- prerrequisitos y aborta sola). Niveles: INFO · REVISAR (conviene conocer el caso antes de aplicar).
--
-- Qué hace la 224: SOLO agrega la vista `empaquetados_basica` y sus grants. No quita acceso a nadie ni toca
-- datos ni policies: `venta` conserva la lectura de la tabla base hasta la 225. P4/P7 cuentan lo que la 225
-- cerrará después.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with chequeos as (
  select 'P1' as codigo, 'INFO' as nivel,
         (to_regclass('public.empaquetados') is not null and to_regprocedure('public.mi_rol()') is not null)::int as cantidad,
         'Prerrequisitos: public.empaquetados (156) y public.mi_rol() presentes (1 = sí)' as detalle
  union all
  select 'P2', 'INFO', (to_regclass('public.empaquetados_basica') is not null)::int,
         '224 aún no aplicada: la vista empaquetados_basica no existe (0 = no existe; 1 = ya existe, la migración es idempotente)'
  union all
  select 'P3', 'INFO', count(*)::int,
         'Policies actuales sobre public.empaquetados (la 224 NO las modifica): '
         || coalesce(string_agg(policyname || ' [' || cmd || '] ' || regexp_replace(coalesce(qual, ''), '\s+', ' ', 'g'), ' || ' order by policyname), 'ninguna')
    from pg_policies where schemaname = 'public' and tablename = 'empaquetados'
  union all
  select 'P4', 'INFO', count(*) filter (where (cmd in ('SELECT', 'ALL')) and qual like '%''venta''%')::int,
         'Policies de lectura de empaquetados que nombran a venta HOY (la 224 las deja igual; las cierra la 225)'
    from pg_policies where schemaname = 'public' and tablename = 'empaquetados'
  union all
  select 'P5', 'INFO', count(*)::int,
         'Filas en empaquetados (' || count(*) filter (where tarifa_proveedor > 0) || ' con tarifa_proveedor > 0, '
         || count(*) filter (where fee_infante > 0) || ' con fee_infante > 0): los datos que venta puede leer por la API hasta la 225'
    from public.empaquetados
  union all
  select 'P6', 'INFO', count(*)::int,
         'Usuarios activos por rol afectado: ' || coalesce(string_agg(rol::text || '=' || n, ', ' order by rol::text), 'ninguno')
    from (select rol, count(*) as n from public.usuarios where activo and rol::text in ('venta', 'control_vuelo') group by rol) u
  union all
  select 'P7', case when count(*) > 0 then 'REVISAR' else 'INFO' end, count(*)::int,
         'Contratos que nacieron de un Empaquetado (ventas.empaquetado_ref_id): tras desplegar el código, su reserva futura lee empaquetados_basica; la 225 se aplica DESPUÉS de ese despliegue'
    from public.ventas where empaquetado_ref_id is not null
  union all
  select 'P8', 'INFO', count(*)::int,
         'Funciones SECURITY DEFINER de public que mencionan tarifa_proveedor (otro camino al neto): '
         || coalesce(string_agg(p.proname, ', ' order by p.proname), 'ninguna')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.prosrc ilike '%tarifa_proveedor%'
  union all
  select 'P9', 'INFO', count(*)::int,
         'Vistas de public que mencionan tarifa_proveedor: ' || coalesce(string_agg(viewname, ', ' order by viewname), 'ninguna')
    from pg_views where schemaname = 'public' and definition ilike '%tarifa_proveedor%'
  union all
  select 'P10', 'INFO', count(*)::int,
         'Policies de empaquetado_cambios (ni la 224 ni la 225 las tocan; su detalle solo trae record/emisión/pago): '
         || coalesce(string_agg(policyname || ' [' || cmd || ']', ' || ' order by policyname), 'ninguna')
    from pg_policies where schemaname = 'public' and tablename = 'empaquetado_cambios'
)
select codigo, nivel, cantidad, detalle from chequeos order by length(codigo), codigo;

rollback;
