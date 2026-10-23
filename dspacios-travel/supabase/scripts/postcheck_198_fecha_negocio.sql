-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 198 · Fecha de negocio (America/Bogota) — SOLO LECTURA.
--
-- Correr en producción DESPUÉS de la migración 198. UNA sola consulta SELECT:
-- no crea ni modifica nada y no devuelve datos de negocio. Una fila por
-- verificación (`ok` + detalle) y una fila RESUMEN; todo debe dar ok = true.
--
-- Comprueba:
--   · public.fecha_negocio(timestamptz) con su cuerpo, firma y volatilidad, y
--     que da el día de Bogotá en el límite de las 7 p. m. SIN importar el
--     TimeZone de la sesión (se evalúa con instantes fijos).
--   · Las 5 funciones de la 164 con el cuerpo exacto de la 198 (md5 sin
--     retornos de carro) y sin `current_date`.
--   · Los permisos de la 164 intactos (las RPC siguen solo para service_role).
--   · Los defaults de abonos.fecha_abono y cotizacion_pagos_previos.fecha_pago.
-- No verifica datos: la 198 no hace UPDATE de nada.
-- Si la 198 NO está aplicada, la consulta entera falla con "function
-- public.fecha_negocio(...) does not exist": ese error ya es el resultado.
-- Para el estado previo usar preflight_198_fecha_negocio_lectura.sql.
-- ───────────────────────────────────────────────────────────────────────────
with
esperado(fn, md5_198, es_rpc) as (values
  ('_huella_pago_previo',               '817eb22ea6063273d60f1044e66b3329', false),
  ('registrar_pago_previo',             '146d0275f5a97b9ecd6a52e11161b248', true),
  ('anular_pago_previo',                '49bb1f21f071141d30926ad426f87369', true),
  ('transferir_pagos_previos_a_abonos', '4814691695eb7587c18628ede17f266f', true),
  ('convertir_cotizacion_a_contrato',   'edc9975010746e53e4af6a75ad9763dc', true)
),
fn as (
  select p.oid, p.proname, p.provolatile, p.prosrc, md5(replace(p.prosrc, chr(13), '')) as md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (select fn from esperado)
),
fnn as (
  select p.oid, p.provolatile, pg_get_function_result(p.oid) as resultado,
         pg_get_function_identity_arguments(p.oid) as args, md5(replace(p.prosrc, chr(13), '')) as md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fecha_negocio'
),
checks(orden, verificacion, ok, detalle) as (
  select 10, 'fecha_negocio existe (una sola versión)', (select count(*) from fnn) = 1,
         (select count(*) from fnn) || ' versión/es'
  union all
  select 11, 'fecha_negocio: firma, resultado, volatilidad y cuerpo',
         coalesce((select args = 'p_instante timestamp with time zone' and resultado = 'date' and provolatile = 's'
                          and md5 = 'c3e4d7e4dda8eb6fc2d4dae61ee4327a' from fnn limit 1), false),
         coalesce((select args || ' → ' || resultado || ', volatilidad ' || provolatile::text from fnn limit 1), 'no existe')
  -- Límite de las 7 p. m. con instantes fijos (independiente del TimeZone de la sesión).
  union all
  select 12, 'fecha_negocio 18:30 Bogotá (23:30Z) = 2026-09-30',
         public.fecha_negocio('2026-09-30 23:30:00+00') = date '2026-09-30', public.fecha_negocio('2026-09-30 23:30:00+00')::text
  union all
  select 13, 'fecha_negocio 19:30 Bogotá (00:30Z) = 2026-09-30',
         public.fecha_negocio('2026-10-01 00:30:00+00') = date '2026-09-30', public.fecha_negocio('2026-10-01 00:30:00+00')::text
  union all
  select 14, 'fecha_negocio 00:00 Bogotá (05:00Z) = 2026-10-01',
         public.fecha_negocio('2026-10-01 05:00:00+00') = date '2026-10-01', public.fecha_negocio('2026-10-01 05:00:00+00')::text
  union all
  select 15, 'fecha_negocio() = día de Bogotá de now()',
         public.fecha_negocio() = (now() at time zone 'America/Bogota')::date,
         public.fecha_negocio()::text || ' (TimeZone sesión: ' || current_setting('TimeZone') || ', current_date: ' || current_date || ')'
  union all
  select 16, 'fecha_negocio ejecutable por authenticated y service_role',
         has_function_privilege('authenticated', 'public.fecha_negocio(timestamptz)', 'execute')
           and has_function_privilege('service_role', 'public.fecha_negocio(timestamptz)', 'execute'),
         'necesario para los defaults y para las RPC (SECURITY INVOKER)'
  union all
  select 20 + row_number() over (order by e.fn), 'cuerpo 198: ' || e.fn,
         f.md5 = e.md5_198 and f.prosrc not ilike '%current_date%',
         coalesce(case when f.md5 = e.md5_198 then 'ok' else 'md5 ' || f.md5 end, 'no existe')
  from esperado e left join fn f on f.proname = e.fn
  union all
  select 30, '_huella_pago_previo es STABLE',
         coalesce((select provolatile = 's' from fn where proname = '_huella_pago_previo'), false),
         coalesce((select provolatile::text from fn where proname = '_huella_pago_previo'), 'no existe')
  union all
  select 30 + row_number() over (order by e.fn), 'permisos 164 intactos: ' || e.fn,
         has_function_privilege('service_role', f.oid, 'execute')
           and not has_function_privilege('authenticated', f.oid, 'execute')
           and not has_function_privilege('anon', f.oid, 'execute'),
         'service_role sí; authenticated/anon no'
  from esperado e join fn f on f.proname = e.fn
  where e.es_rpc
  union all
  select 40 + row_number() over (order by table_name), 'default ' || table_name || '.' || column_name,
         column_default in ('fecha_negocio()', 'public.fecha_negocio()'), coalesce(column_default, '(sin default)')
  from information_schema.columns
  where table_schema = 'public'
    and (table_name, column_name) in (('abonos', 'fecha_abono'), ('cotizacion_pagos_previos', 'fecha_pago'))
)
select orden, verificacion, ok, detalle from checks
union all
select 99, 'RESUMEN', bool_and(ok),
       case when bool_and(ok) then 'OK: 198 aplicada como en el repositorio' else 'REVISAR: hay filas con ok = false' end
from checks
order by orden;
