-- POSTCHECK 310 (#125) — UNA sola consulta de SOLO LECTURA. Pegarla completa en el editor SQL DESPUÉS de correr la 310 y ANTES de desplegar el código.
-- Columnas: orden · control · observado · esperado · estado. La fila 99 es el veredicto: debe decir 310 CORRECTA.
select orden, control, observado, esperado, estado
from (
  with c as (
    select 1 as orden, 'Cuatro columnas nuevas en hotel_temporadas' as control,
           (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_temporadas'
              and column_name in ('promo_sigue_base', 'nino_gratis', 'nino_gratis_edad_min', 'nino_gratis_edad_max'))::text as observado, '4' as esperado
    union all select 2, 'promo_sigue_base y nino_gratis son boolean NOT NULL default false',
           (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_temporadas'
              and column_name in ('promo_sigue_base', 'nino_gratis') and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false')::text, '2'
    union all select 3, 'Edades del niño gratis son smallint NULL',
           (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_temporadas'
              and column_name in ('nino_gratis_edad_min', 'nino_gratis_edad_max') and data_type = 'smallint' and is_nullable = 'YES')::text, '2'
    union all select 4, 'Restricción hotel_temporadas_promo_125 presente y validada',
           (select count(*) from pg_constraint where conname = 'hotel_temporadas_promo_125' and conrelid = 'public.hotel_temporadas'::regclass and convalidated)::text, '1'
    union all select 5, 'NINGUNA promoción existente quedó en modo nuevo (seguir-base / niño gratis)',
           (select count(*) from public.hotel_temporadas where promo_sigue_base or nino_gratis or nino_gratis_edad_min is not null or nino_gratis_edad_max is not null)::text, '0'
    union all select 6, 'RPC de 8 parámetros presente',
           (to_regprocedure('public.promocion_guardar_reglas(bigint,bigint,jsonb,jsonb,boolean,boolean,smallint,smallint)') is not null)::text, 'true'
    union all select 7, 'RPC de 4 parámetros ya NO existe (sin sobrecarga ambigua para PostgREST)',
           (to_regprocedure('public.promocion_guardar_reglas(bigint,bigint,jsonb,jsonb)') is null)::text, 'true'
    union all select 8, 'Solo UNA función promocion_guardar_reglas en public',
           (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'promocion_guardar_reglas')::text, '1'
    union all select 9, 'authenticated y service_role pueden ejecutar la RPC y anon NO',
           (has_function_privilege('authenticated', 'public.promocion_guardar_reglas(bigint,bigint,jsonb,jsonb,boolean,boolean,smallint,smallint)', 'execute')
            and has_function_privilege('service_role', 'public.promocion_guardar_reglas(bigint,bigint,jsonb,jsonb,boolean,boolean,smallint,smallint)', 'execute')
            and not has_function_privilege('anon', 'public.promocion_guardar_reglas(bigint,bigint,jsonb,jsonb,boolean,boolean,smallint,smallint)', 'execute'))::text, 'true'
    union all select 10, 'La validación por noche existe; authenticated/service_role la ejecutan y anon NO',
           (to_regprocedure('public._promo_125_validar_sigue_base(bigint)') is not null
            and has_function_privilege('authenticated', 'public._promo_125_validar_sigue_base(bigint)', 'execute')
            and has_function_privilege('service_role', 'public._promo_125_validar_sigue_base(bigint)', 'execute')
            and not has_function_privilege('anon', 'public._promo_125_validar_sigue_base(bigint)', 'execute'))::text, 'true'
    union all select 11, 'El trigger de reglas ya conoce el modo seguir-base',
           (select (position('promo_sigue_base' in pg_get_functiondef(p.oid)) > 0)::text from pg_proc p where p.proname = 'tg_hotel_promocion_reglas_300' limit 1), 'true'
    union all select 12, 'Reglas por grupo existentes (debe ser igual al preflight)', (select count(*) from public.hotel_promocion_reglas)::text, 'INFO'
    union all select 13, 'Promociones vinculadas a una base (debe ser igual al preflight)', (select count(*) from public.hotel_temporadas where promo_base_id is not null)::text, 'INFO'
  ), r as (
    select orden, control, observado, esperado, case when esperado = 'INFO' then 'INFO' when observado = esperado then 'OK' else 'REVISAR' end as estado from c
  )
  select * from r
  union all
  select 99, 'VEREDICTO', (select count(*) filter (where estado = 'REVISAR') from r)::text || ' controles por revisar', '0 controles por revisar',
         case when (select count(*) filter (where estado = 'REVISAR') from r) = 0 then '310 CORRECTA' else '310 CON PROBLEMAS: REVISAR' end
) x
order by orden;
