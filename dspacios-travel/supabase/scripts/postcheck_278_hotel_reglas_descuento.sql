-- POSTCHECK 278 (#90) · SOLO LECTURA · una consulta: n · control · observado · esperado · estado. Fila 99 = «278 CORRECTA».
with filas as (
  select 1 as n, 'tabla creada con RLS activa' as control,
         coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.hotel_reglas_descuento')), 'AUSENTE') as observado, 'true' as esperado,
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.hotel_reglas_descuento')), false) as ok
  union all select 2, 'CHECK de tipo, umbral y pct presentes',
         (select count(*) from pg_constraint where conrelid = to_regclass('public.hotel_reglas_descuento') and contype = 'c')::text, '3',
         (select count(*) from pg_constraint where conrelid = to_regclass('public.hotel_reglas_descuento') and contype = 'c') = 3
  union all select 3, 'anon sin ningún permiso; authenticated con CRUD',
         'anon=' || (select count(*) from information_schema.role_table_grants where table_name = 'hotel_reglas_descuento' and grantee = 'anon')::text
           || ' · auth=' || (select count(*) from information_schema.role_table_grants where table_name = 'hotel_reglas_descuento' and grantee = 'authenticated')::text,
         'anon=0 · auth=4',
         (select count(*) from information_schema.role_table_grants where table_name = 'hotel_reglas_descuento' and grantee = 'anon') = 0
           and (select count(*) from information_schema.role_table_grants where table_name = 'hotel_reglas_descuento' and grantee = 'authenticated') = 4
  union all select 4, '2 políticas propias + 3 restrictivas de catálogo global',
         (select count(*) from pg_policies where tablename = 'hotel_reglas_descuento')::text, '5',
         (select count(*) from pg_policies where tablename = 'hotel_reglas_descuento') = 5
)
select n, control, observado, esperado, case when ok then 'OK' else 'FALLA' end as estado from filas
union all select 99, 'VEREDICTO GLOBAL', case when bool_and(ok) then '278 CORRECTA' else '278 CON FALLAS' end, '278 CORRECTA', case when bool_and(ok) then 'OK' else 'FALLA' end from filas
order by n;
