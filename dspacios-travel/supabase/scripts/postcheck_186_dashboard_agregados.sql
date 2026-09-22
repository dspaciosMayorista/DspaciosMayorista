-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK de la migración 186 (6 funciones agregadas del Dashboard).
-- SOLO LECTURA (las funciones son SELECT puro, ejecutarlas no muta nada).
-- Correr DESPUÉS de aplicar la 186.
-- Compatible con Supabase SQL Editor: una sola sentencia, sin metacomandos
-- de psql, resultado en una única fila JSON.
--
-- Verifica lo que la migración promete:
--   · las 6 funciones existen, ninguna es SECURITY DEFINER;
--   · anon SIN EXECUTE; authenticated Y service_role CON EXECUTE, en las 6;
--   · `cupos_por_bloqueo` quedó con `security_invoker = true`;
--   · `fn_dashboard_cartera_por_moneda` filtra `estado in ('confirmado',
--     'activo')` — 'pendiente' y 'cancelado' NO generan cartera;
--   · comparación cruzada con un cálculo manual (misma regla) para cartera
--     Y para ventas del mes, por moneda;
--   · informativo: cuántas ventas 'pendiente' existen en total (para leer
--     junto al resultado de cartera — deben quedar fuera del agregado).
-- ───────────────────────────────────────────────────────────────────────────
with funcs as (
  select
    p.proname, p.oid, p.prosecdef,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'fn_dashboard_contratos_por_estado', 'fn_dashboard_cupos_resumen',
      'fn_dashboard_retenciones_mes', 'fn_dashboard_cxp_resumen',
      'fn_dashboard_cartera_por_moneda', 'fn_dashboard_ventas_mes'
    )
),
cupos_check as (
  select coalesce((
    select (option_value::boolean) from pg_class c, pg_options_to_table(c.reloptions) o
    where c.relname = 'cupos_por_bloqueo' and c.relnamespace = 'public'::regnamespace
      and o.option_name = 'security_invoker'
  ), false) as security_invoker_activo
),
cartera_formula as (
  select pg_get_functiondef(p.oid) ilike '%estado in (''confirmado'', ''activo'')%' as filtra_confirmado_activo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fn_dashboard_cartera_por_moneda'
),
cartera_manual as (
  select
    coalesce(v.moneda, 'COP') as moneda,
    sum(greatest(coalesce(v.precio_venta, 0) - coalesce(a.suma, 0), 0)) as total_manual
  from public.ventas v
  left join (
    select numero_contrato, sum(valor_abono) as suma
    from public.abonos where tenant = 'mayorista' group by numero_contrato
  ) a on a.numero_contrato = v.numero_contrato
  where v.tenant = 'mayorista' and v.estado in ('confirmado', 'activo')
  group by coalesce(v.moneda, 'COP')
),
cartera_agregado as (
  select moneda, (al_dia + vencida + sin_fecha) as total_funcion
  from public.fn_dashboard_cartera_por_moneda('mayorista', current_date)
),
cartera_cmp as (
  select
    coalesce(m.moneda, a.moneda) as moneda,
    coalesce(m.total_manual, 0) as total_manual,
    coalesce(a.total_funcion, 0) as total_funcion,
    (coalesce(m.total_manual, 0) = coalesce(a.total_funcion, 0)) as coincide
  from cartera_manual m
  full outer join cartera_agregado a on a.moneda = m.moneda
),
ventas_manual as (
  select moneda, coalesce(sum(precio_venta), 0) as total_manual
  from public.ventas
  where tenant = 'mayorista'
    and estado in ('confirmado', 'activo')
    and to_char(fecha_venta, 'YYYY-MM') = to_char(current_date, 'YYYY-MM')
  group by moneda
),
ventas_agregado as (
  select moneda, total as total_funcion
  from public.fn_dashboard_ventas_mes('mayorista', to_char(current_date, 'YYYY-MM'))
),
ventas_cmp as (
  select
    coalesce(m.moneda, a.moneda) as moneda,
    coalesce(m.total_manual, 0) as total_manual,
    coalesce(a.total_funcion, 0) as total_funcion,
    (coalesce(m.total_manual, 0) = coalesce(a.total_funcion, 0)) as coincide
  from ventas_manual m
  full outer join ventas_agregado a on a.moneda = m.moneda
),
pendientes_check as (
  select count(*) as ventas_pendientes_total
  from public.ventas
  where tenant = 'mayorista' and estado = 'pendiente'
)
select jsonb_build_object(
  'ok',
    (select count(*) = 6 from funcs)
    and (select bool_and(not prosecdef) from funcs)
    and (select bool_and(not anon_execute) from funcs)
    and (select bool_and(authenticated_execute) from funcs)
    and (select bool_and(service_role_execute) from funcs)
    and (select security_invoker_activo from cupos_check)
    and (select filtra_confirmado_activo from cartera_formula)
    and coalesce((select bool_and(coincide) from cartera_cmp), true)
    and coalesce((select bool_and(coincide) from ventas_cmp), true),
  'funciones', (select jsonb_agg(jsonb_build_object(
      'proname', proname, 'security_definer', prosecdef,
      'anon_execute', anon_execute, 'authenticated_execute', authenticated_execute,
      'service_role_execute', service_role_execute
    )) from funcs),
  'cupos_por_bloqueo_security_invoker', (select security_invoker_activo from cupos_check),
  'cartera_formula_confirmado_activo', (select filtra_confirmado_activo from cartera_formula),
  'cartera_comparacion_manual', (select coalesce(jsonb_agg(jsonb_build_object(
      'moneda', moneda, 'total_manual', total_manual, 'total_funcion', total_funcion, 'coincide', coincide
    )), '[]'::jsonb) from cartera_cmp),
  'ventas_comparacion_manual', (select coalesce(jsonb_agg(jsonb_build_object(
      'moneda', moneda, 'total_manual', total_manual, 'total_funcion', total_funcion, 'coincide', coincide
    )), '[]'::jsonb) from ventas_cmp),
  'ventas_pendientes_total', (select ventas_pendientes_total from pendientes_check),
  'checked_at', now()
) as resultado;
