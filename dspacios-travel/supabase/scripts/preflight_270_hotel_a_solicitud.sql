-- PREFLIGHT 270 (#120) · SOLO LECTURA · UNA consulta integral: n · control · observado · esperado · estado. Pegar COMPLETA en el editor SQL (sin begin/rollback).
-- Última fila (n = 99) = VEREDICTO GLOBAL: «LISTA PARA APLICAR» solo si ninguna fila es FALLA. REVISAR = decisión humana (no bloquea por sí sola, pero léela).
select n, control, observado, esperado,
       case when ok then 'OK' else coalesce(nivel, 'FALLA') end as estado
from (
  select 1 as n, 'tablas base presentes (hoteles, tarifa_hotel, cotizaciones, armado_hoteles)' as control,
         ((to_regclass('public.hoteles') is not null)::int + (to_regclass('public.tarifa_hotel') is not null)::int + (to_regclass('public.cotizaciones') is not null)::int + (to_regclass('public.armado_hoteles') is not null)::int)::text as observado,
         '4' as esperado,
         ((to_regclass('public.hoteles') is not null)::int + (to_regclass('public.tarifa_hotel') is not null)::int + (to_regclass('public.cotizaciones') is not null)::int + (to_regclass('public.armado_hoteles') is not null)::int) = 4 as ok, null::text as nivel
  union all select 2, 'funciones de apoyo presentes (mi_rol, puede_ver_tenant, fn_auditoria)',
         ((to_regprocedure('public.mi_rol()') is not null)::int + (to_regprocedure('public.puede_ver_tenant(text)') is not null)::int + (to_regprocedure('public.fn_auditoria()') is not null)::int)::text, '3',
         ((to_regprocedure('public.mi_rol()') is not null)::int + (to_regprocedure('public.puede_ver_tenant(text)') is not null)::int + (to_regprocedure('public.fn_auditoria()') is not null)::int) = 3, null
  union all select 3, 'columna hoteles.modelo_tarifario presente (la 270 la usa en su CHECK)',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hoteles' and column_name = 'modelo_tarifario')::text, '1',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hoteles' and column_name = 'modelo_tarifario') = 1, null
  union all select 4, 'objetos de la 270 ya presentes (0 = primera vez · 6 = reaplicación idempotente: columna + tabla + 4 funciones)',
         ((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hoteles' and column_name = 'tarifa_bajo_solicitud')
          + (case when to_regclass('public.cotizacion_tarifa_solicitud') is not null then 1 else 0 end)
          + (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('tg_hotel_bajo_solicitud', 'tg_tarifa_hotel_no_bajo_solicitud', 'tg_cotizacion_pendiente_tarifa', 'cargar_neta_solicitud')))::text,
         '0 o 6',
         ((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hoteles' and column_name = 'tarifa_bajo_solicitud')
          + (case when to_regclass('public.cotizacion_tarifa_solicitud') is not null then 1 else 0 end)
          + (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('tg_hotel_bajo_solicitud', 'tg_tarifa_hotel_no_bajo_solicitud', 'tg_cotizacion_pendiente_tarifa', 'cargar_neta_solicitud'))) in (0, 6), null
  union all select 5, 'cotizaciones en estado pendiente_tarifa antes de aplicar (nadie las crea sin la 270)',
         (select count(*) from public.cotizaciones where estado = 'pendiente_tarifa')::text, '0 (o las de una reaplicación)',
         true, null
  union all select 6, 'hoteles por unidad (Bernalo): la 270 no los toca; solo no podrán marcarse',
         (select count(*) from public.hoteles where modelo_tarifario = 'unidad')::text, 'cualquiera', true, null
  union all select 7, 'estados de cotización distintos de abierta/convertida/descartada/pendiente_tarifa (la 270 no agrega CHECK de estado; solo un trigger)',
         (select count(*) from public.cotizaciones where estado not in ('abierta', 'convertida', 'descartada', 'pendiente_tarifa'))::text, '0',
         (select count(*) from public.cotizaciones where estado not in ('abierta', 'convertida', 'descartada', 'pendiente_tarifa')) = 0, 'REVISAR'
  union all select 8, 'transacciones abiertas sin actividad > 1 min (retendrían el candado de los CREATE TRIGGER sobre hoteles/tarifa_hotel/cotizaciones)',
         (select count(*) from pg_stat_activity where state = 'idle in transaction' and now() - state_change > interval '1 minute')::text, '0',
         (select count(*) from pg_stat_activity where state = 'idle in transaction' and now() - state_change > interval '1 minute') = 0, 'REVISAR'
  union all select 99, 'VEREDICTO GLOBAL',
         case when ((to_regclass('public.hoteles') is not null)::int + (to_regclass('public.tarifa_hotel') is not null)::int + (to_regclass('public.cotizaciones') is not null)::int + (to_regclass('public.armado_hoteles') is not null)::int) = 4
               and ((to_regprocedure('public.mi_rol()') is not null)::int + (to_regprocedure('public.puede_ver_tenant(text)') is not null)::int + (to_regprocedure('public.fn_auditoria()') is not null)::int) = 3
               and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hoteles' and column_name = 'modelo_tarifario') = 1
              then 'LISTA PARA APLICAR' else 'NO APLICAR' end,
         'LISTA PARA APLICAR',
         ((to_regclass('public.hoteles') is not null)::int + (to_regclass('public.tarifa_hotel') is not null)::int + (to_regclass('public.cotizaciones') is not null)::int + (to_regclass('public.armado_hoteles') is not null)::int) = 4
           and ((to_regprocedure('public.mi_rol()') is not null)::int + (to_regprocedure('public.puede_ver_tenant(text)') is not null)::int + (to_regprocedure('public.fn_auditoria()') is not null)::int) = 3
           and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hoteles' and column_name = 'modelo_tarifario') = 1, null
) q order by n;
