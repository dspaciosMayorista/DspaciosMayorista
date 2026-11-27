-- Postcheck 327 (solo lectura, UNA consulta; columna estado por control). Esperado: todo OK.
select n, control, actual, esperado, case when ok then 'OK' else 'FALLA' end as estado
from (
  select 1 as n, 'tabla conjuntos_fechas existe con RLS activa' as control,
         (select relrowsecurity from pg_class where oid = to_regclass('public.conjuntos_fechas'))::text as actual, 'true' as esperado,
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.conjuntos_fechas')), false) as ok
  union all select 2, 'sin datos sembrados (no se inventan festivos ni calendarios escolares): informativo', (select count(*) from public.conjuntos_fechas)::text, '0 la primera vez (luego los crea el dueño)', true
  union all select 3, 'anon sin ningún privilegio', (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'conjuntos_fechas' and grantee = 'anon')::text, '0',
         (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'conjuntos_fechas' and grantee = 'anon') = 0
  union all select 4, 'políticas: 2 permisivas + 3 restrictivas de frontera Mayorista', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'conjuntos_fechas')::text, '5',
         (select count(*) from pg_policies where schemaname = 'public' and tablename = 'conjuntos_fechas') = 5
  union all select 5, 'validador de rangos: acepta [] y un rango válido, rechaza fin<inicio y fecha imposible',
         (public.conjunto_fechas_rangos_validos('[]') and public.conjunto_fechas_rangos_validos('[{"fecha_inicio":"2027-03-25","fecha_fin":"2027-03-28"}]')
          and not public.conjunto_fechas_rangos_validos('[{"fecha_inicio":"2027-03-28","fecha_fin":"2027-03-25"}]') and not public.conjunto_fechas_rangos_validos('[{"fecha_inicio":"2027-02-31","fecha_fin":"2027-03-01"}]'))::text, 'true',
         (public.conjunto_fechas_rangos_validos('[]') and public.conjunto_fechas_rangos_validos('[{"fecha_inicio":"2027-03-25","fecha_fin":"2027-03-28"}]')
          and not public.conjunto_fechas_rangos_validos('[{"fecha_inicio":"2027-03-28","fecha_fin":"2027-03-25"}]') and not public.conjunto_fechas_rangos_validos('[{"fecha_inicio":"2027-02-31","fecha_fin":"2027-03-01"}]'))
  union all select 6, 'ninguna vigencia referencia un conjunto (no hay columna de vínculo: es copia)', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_temporadas' and column_name like '%conjunto%')::text, '0',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_temporadas' and column_name like '%conjunto%') = 0
) q order by n;
