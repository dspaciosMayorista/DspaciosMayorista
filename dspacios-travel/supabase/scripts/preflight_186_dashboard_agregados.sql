-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la migración 186 (6 funciones agregadas del Dashboard).
-- SOLO LECTURA — no modifica nada. Correr ANTES de aplicar la 186.
-- Compatible con Supabase SQL Editor: una sola sentencia, sin metacomandos
-- de psql, resultado en una única fila JSON.
--
-- Comprueba las precondiciones:
--   · ninguna de las 6 funciones existe todavía;
--   · las tablas/vista de origen existen (ventas, abonos, cupos_por_bloqueo,
--     retenciones_cxp, cuentas_por_pagar, cxp_pagos);
--   · RLS sigue habilitada en las 5 tablas base;
--   · PostgreSQL ≥ 15 (requerido por `security_invoker` en vistas);
--   · `cupos_por_bloqueo` está SIN `security_invoker` todavía (la 186 lo
--     activa por primera vez — si ya estuviera activo, revisar por qué).
-- ───────────────────────────────────────────────────────────────────────────
select jsonb_build_object(
  'ok',
    (to_regprocedure('public.fn_dashboard_contratos_por_estado(text)') is null)
    and (to_regprocedure('public.fn_dashboard_cupos_resumen()') is null)
    and (to_regprocedure('public.fn_dashboard_retenciones_mes(text,text)') is null)
    and (to_regprocedure('public.fn_dashboard_cxp_resumen(text,date,date)') is null)
    and (to_regprocedure('public.fn_dashboard_cartera_por_moneda(text,date)') is null)
    and (to_regprocedure('public.fn_dashboard_ventas_mes(text,text)') is null)
    and to_regclass('public.ventas') is not null
    and to_regclass('public.abonos') is not null
    and to_regclass('public.cupos_por_bloqueo') is not null
    and to_regclass('public.retenciones_cxp') is not null
    and to_regclass('public.cuentas_por_pagar') is not null
    and to_regclass('public.cxp_pagos') is not null
    and (select bool_and(relrowsecurity) from pg_class
         where relname in ('ventas','abonos','retenciones_cxp','cuentas_por_pagar','cxp_pagos')
           and relnamespace = 'public'::regnamespace)
    and current_setting('server_version_num')::int >= 150000
    and not coalesce((
      select (option_value::boolean) from pg_class c, pg_options_to_table(c.reloptions) o
      where c.relname = 'cupos_por_bloqueo' and c.relnamespace = 'public'::regnamespace
        and o.option_name = 'security_invoker'
    ), false),
  'funciones_libres', jsonb_build_object(
    'fn_dashboard_contratos_por_estado', to_regprocedure('public.fn_dashboard_contratos_por_estado(text)') is null,
    'fn_dashboard_cupos_resumen', to_regprocedure('public.fn_dashboard_cupos_resumen()') is null,
    'fn_dashboard_retenciones_mes', to_regprocedure('public.fn_dashboard_retenciones_mes(text,text)') is null,
    'fn_dashboard_cxp_resumen', to_regprocedure('public.fn_dashboard_cxp_resumen(text,date,date)') is null,
    'fn_dashboard_cartera_por_moneda', to_regprocedure('public.fn_dashboard_cartera_por_moneda(text,date)') is null,
    'fn_dashboard_ventas_mes', to_regprocedure('public.fn_dashboard_ventas_mes(text,text)') is null
  ),
  'tablas_origen_existen', jsonb_build_object(
    'ventas', to_regclass('public.ventas') is not null,
    'abonos', to_regclass('public.abonos') is not null,
    'cupos_por_bloqueo', to_regclass('public.cupos_por_bloqueo') is not null,
    'retenciones_cxp', to_regclass('public.retenciones_cxp') is not null,
    'cuentas_por_pagar', to_regclass('public.cuentas_por_pagar') is not null,
    'cxp_pagos', to_regclass('public.cxp_pagos') is not null
  ),
  'rls_habilitada_en_todas', (select bool_and(relrowsecurity) from pg_class
    where relname in ('ventas','abonos','retenciones_cxp','cuentas_por_pagar','cxp_pagos')
      and relnamespace = 'public'::regnamespace),
  'pg_15_o_superior', current_setting('server_version_num')::int >= 150000,
  'pg_version', version(),
  'cupos_por_bloqueo_security_invoker_ya_activo', coalesce((
    select (option_value::boolean) from pg_class c, pg_options_to_table(c.reloptions) o
    where c.relname = 'cupos_por_bloqueo' and c.relnamespace = 'public'::regnamespace
      and o.option_name = 'security_invoker'
  ), false),
  'checked_at', now()
) as resultado;
