-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la migración 243 (fn_dashboard_cupos_activos, #118).
-- SOLO LECTURA. Correr ANTES de aplicar la 243. Una sola consulta: devuelve
-- todos los controles como filas (control · valor · esperado · estado).
-- Estados: OK = cumple · REVISAR = no aplicar la 243 hasta entenderlo · INFO = dato.
-- Compatible con el SQL Editor de Supabase (una sentencia, sin metacomandos).
-- ───────────────────────────────────────────────────────────────────────────
with
vista as (
  select c.oid, c.reloptions
    from pg_class c
   where c.relname = 'cupos_por_bloqueo' and c.relnamespace = 'public'::regnamespace
),
cols as (
  select count(*) as n
    from vista v
    join pg_attribute a on a.attrelid = v.oid and a.attnum > 0 and not a.attisdropped
   where a.attname in ('fecha_ida', 'cupos_total', 'cupos_ocupados', 'cupos_disponibles')
),
si as (
  select coalesce((select o.option_value from vista v, pg_options_to_table(v.reloptions) o
                    where o.option_name = 'security_invoker'), 'no definido') as v
),
controles as (
  select 1 as orden, 'PostgreSQL >= 15 (security_invoker en vistas)'::text as control,
         current_setting('server_version_num') as valor, '>= 150000'::text as esperado,
         case when current_setting('server_version_num')::int >= 150000 then 'OK' else 'REVISAR' end as estado
  union all
  select 2, 'vista public.cupos_por_bloqueo existe',
         case when exists (select 1 from vista) then 'si' else 'no' end, 'si',
         case when exists (select 1 from vista) then 'OK' else 'REVISAR' end
  union all
  select 3, 'la vista expone fecha_ida, cupos_total, cupos_ocupados y cupos_disponibles',
         (select n from cols)::text || ' de 4', '4 de 4',
         case when (select n from cols) = 4 then 'OK' else 'REVISAR' end
  union all
  select 4, 'la vista tiene security_invoker = true (la RLS de bloqueos/sillas aplica a quien consulta)',
         (select v from si), 'true',
         case when (select v from si) = 'true' then 'OK' else 'REVISAR' end
  union all
  select 5, 'RLS activa en bloqueos_vuelo y sillas',
         coalesce((select string_agg(relname || '=' || relrowsecurity::text, ', ' order by relname) from pg_class
                    where relnamespace = 'public'::regnamespace and relname in ('bloqueos_vuelo', 'sillas')), 'ausentes'),
         'bloqueos_vuelo=true, sillas=true',
         case when (select count(*) from pg_class
                     where relnamespace = 'public'::regnamespace and relname in ('bloqueos_vuelo', 'sillas') and relrowsecurity) = 2
              then 'OK' else 'REVISAR' end
  union all
  select 6, '_silla_libre(sillas) existe (la 201 ya fue aplicada: la vista cuenta lo mismo que toma el núcleo)',
         coalesce(to_regprocedure('public._silla_libre(public.sillas)')::text, 'no'), 'existe',
         case when to_regprocedure('public._silla_libre(public.sillas)') is not null then 'OK' else 'REVISAR' end
  union all
  select 7, 'fn_dashboard_cupos_activos(date) aun NO existe',
         coalesce(to_regprocedure('public.fn_dashboard_cupos_activos(date)')::text, 'no existe'), 'no existe',
         case when to_regprocedure('public.fn_dashboard_cupos_activos(date)') is null then 'OK' else 'REVISAR' end
  union all
  select 8, 'fn_dashboard_cupos_resumen() (la 186) sigue presente; la 243 no la toca',
         coalesce(to_regprocedure('public.fn_dashboard_cupos_resumen()')::text, 'no existe'), 'existe',
         case when to_regprocedure('public.fn_dashboard_cupos_resumen()') is not null then 'OK' else 'INFO' end
  union all
  select 9, 'INFO records en bloqueos_vuelo',
         (select count(*)::text from public.bloqueos_vuelo), 'dato', 'INFO'
  union all
  select 10, 'INFO records sin fecha_ida (cuentan como activos en la tarjeta, nunca en la alerta)',
         (select count(*)::text from public.bloqueos_vuelo where fecha_ida is null), 'dato', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
