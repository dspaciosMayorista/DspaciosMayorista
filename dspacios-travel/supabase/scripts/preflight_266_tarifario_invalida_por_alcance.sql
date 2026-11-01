-- Preflight 266 (solo lectura, UNA consulta; columna estado por control). Esperado: ningún REVISAR/FALLA antes de aplicar.
select n, control, actual, esperado,
       case when estado_sql then 'OK' else coalesce(fallo, 'FALLA') end as estado
from (
  select 1 as n, '255 aplicada (servicio_suplementos_franja)' as control, (to_regclass('public.servicio_suplementos_franja') is not null)::text as actual, 'true' as esperado, to_regclass('public.servicio_suplementos_franja') is not null as estado_sql, null::text as fallo
  union all select 2, '262 aplicada (servicio_precio_alcance)', (to_regclass('public.servicio_precio_alcance') is not null)::text, 'true', to_regclass('public.servicio_precio_alcance') is not null, null
  union all select 3, '262 aplicada (servicios_adicionales.tipo_receptivo / combo_*)',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'servicios_adicionales' and column_name in ('tipo_receptivo','combo_incluye_traslado','combo_traslado_alcance'))::text, '3',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'servicios_adicionales' and column_name in ('tipo_receptivo','combo_incluye_traslado','combo_traslado_alcance')) = 3, null
  union all select 4, 'tarifario_invalidar(bigint[], boolean) presente (181)', (to_regprocedure('public.tarifario_invalidar(bigint[],boolean)') is not null)::text, 'true', to_regprocedure('public.tarifario_invalidar(bigint[],boolean)') is not null, null
  union all select 5, 'armado_servicios existe (paquetes que usan cada servicio)', (to_regclass('public.armado_servicios') is not null)::text, 'true', to_regclass('public.armado_servicios') is not null, null
  union all select 6, 'disparadores de la 266 ya presentes (0 = primera vez · 3 = reaplicación idempotente)',
    (select count(*) from pg_trigger where not tgisinternal and tgname in ('tarifario_trg_servicio_precio_alcance','tarifario_trg_servicio_suplementos_franja','tarifario_trg_servicios_alcance_catalogo'))::text, '0 o 3',
    (select count(*) from pg_trigger where not tgisinternal and tgname in ('tarifario_trg_servicio_precio_alcance','tarifario_trg_servicio_suplementos_franja','tarifario_trg_servicios_alcance_catalogo')) in (0, 3), null
  union all select 7, 'paquetes con una publicación EN CURSO (tarifario_estado = recalculando): la 266 no los toca, pero su activación se descarta si cambia un precio por alcance durante ella',
    (select count(*) from public.armado_paquetes where tarifario_estado = 'recalculando')::text, 'cualquiera', true, null
  union all select 8, 'paquetes ACTIVOS que usan algún servicio (los que se ocultarán al editar un precio por alcance hasta regenerar)',
    (select count(distinct a.paquete_id) from public.armado_servicios a join public.armado_paquetes p on p.id = a.paquete_id where p.activo)::text, 'cualquiera', true, null
  union all select 9, 'transacciones abiertas sin actividad > 1 min (retendrían el candado del CREATE TRIGGER)',
    (select count(*) from pg_stat_activity where state = 'idle in transaction' and now() - state_change > interval '1 minute')::text, '0',
    (select count(*) from pg_stat_activity where state = 'idle in transaction' and now() - state_change > interval '1 minute') = 0, 'REVISAR'
) q order by n;
