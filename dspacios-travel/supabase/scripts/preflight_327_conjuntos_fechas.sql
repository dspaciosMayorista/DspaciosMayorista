-- Preflight 327 (solo lectura, UNA consulta; columna estado por control). Esperado: todo OK antes de aplicar.
select n, control, actual, esperado, case when ok then 'OK' else 'FALLA' end as estado
from (
  select 1 as n, 'hotel_temporadas.rangos y .blackouts presentes (053)' as control,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_temporadas' and column_name in ('rangos', 'blackouts'))::text as actual, '2' as esperado,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_temporadas' and column_name in ('rangos', 'blackouts')) = 2 as ok
  union all select 2, 'puede_escribir_catalogo_global() presente (237)', (to_regprocedure('public.puede_escribir_catalogo_global()') is not null)::text, 'true', to_regprocedure('public.puede_escribir_catalogo_global()') is not null
  union all select 3, 'mi_rol() presente', (to_regprocedure('public.mi_rol()') is not null)::text, 'true', to_regprocedure('public.mi_rol()') is not null
  union all select 4, 'conjuntos_fechas aún no existe (0 = primera vez; 1 = reaplicación idempotente)', (to_regclass('public.conjuntos_fechas') is not null)::int::text, '0 o 1', true
) q order by n;
