-- Preflight 330 (solo lectura, UNA consulta). Esperado: todo OK antes de aplicar.
select n, control, actual, esperado, case when ok then 'OK' else 'FALLA' end as estado from (
  select 1 as n, 'service_role existe' as control, (exists (select 1 from pg_roles where rolname = 'service_role'))::text as actual, 'true' as esperado, exists (select 1 from pg_roles where rolname = 'service_role') as ok
  union all select 2, 'tablas 330 aún no existen (0 = primera vez; 2 = reaplicación)', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('hostinger_estado_buzon', 'hostinger_respuestas_pendientes'))::text, '0 o 2',
         (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('hostinger_estado_buzon', 'hostinger_respuestas_pendientes')) in (0, 2)
) q order by n;
