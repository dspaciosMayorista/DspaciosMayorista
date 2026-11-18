-- PREFLIGHT 310 (#125) — UNA sola consulta de SOLO LECTURA. Pegarla completa en el editor SQL de Supabase ANTES de correr la 310.
-- Columnas: orden · control · observado · esperado · estado (OK / REVISAR / INFO). La fila 99 es el veredicto: debe decir LISTA PARA 310.
select orden, control, observado, esperado, estado
from (
  with c as (
    select 1 as orden, 'Migración 300 aplicada (tabla de reglas por grupo)' as control,
           (to_regclass('public.hotel_promocion_reglas') is not null)::text as observado, 'true' as esperado
    union all select 2, 'RPC promocion_guardar_reglas de 4 parámetros presente (la 310 la reemplaza)',
           (to_regprocedure('public.promocion_guardar_reglas(bigint,bigint,jsonb,jsonb)') is not null)::text, 'true'
    union all select 3, 'RPC de 8 parámetros AÚN ausente',
           (to_regprocedure('public.promocion_guardar_reglas(bigint,bigint,jsonb,jsonb,boolean,boolean,smallint,smallint)') is null)::text, 'true'
    union all select 4, 'Columnas nuevas AÚN ausentes en hotel_temporadas (promo_sigue_base, nino_gratis, nino_gratis_edad_min/max)',
           (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_temporadas'
              and column_name in ('promo_sigue_base', 'nino_gratis', 'nino_gratis_edad_min', 'nino_gratis_edad_max'))::text, '0'
    union all select 5, 'Helper de candado de la 300 presente (_promo_300_candado_base)',
           (to_regprocedure('public._promo_300_candado_base(bigint[])') is not null)::text, 'true'
    union all select 6, 'Funciones de cobertura de la 300 presentes (_promo_300_cubre, _promo_300_extremo)',
           (to_regprocedure('public._promo_300_cubre(jsonb,date,date,jsonb,date)') is not null
            and to_regprocedure('public._promo_300_extremo(jsonb,date,date,boolean)') is not null)::text, 'true'
    union all select 7, 'Función del trigger de reglas presente', (to_regprocedure('public.tg_hotel_promocion_reglas_300()') is not null)::text, 'true'
    union all select 8, 'Restricción hotel_temporadas_promo_125 AÚN ausente',
           (not exists (select 1 from pg_constraint where conname = 'hotel_temporadas_promo_125'))::text, 'true'
    union all select 9, 'Promociones vinculadas a una base hoy (informativo; no cambian)',
           (select count(*) from public.hotel_temporadas where promo_base_id is not null)::text, 'INFO'
    union all select 10, 'Reglas por grupo existentes hoy (informativo; no cambian)',
           (select count(*) from public.hotel_promocion_reglas)::text, 'INFO'
    union all select 11, 'Vigencias de hotel hoy (informativo)', (select count(*) from public.hotel_temporadas)::text, 'INFO'
  ), r as (
    select orden, control, observado, esperado, case when esperado = 'INFO' then 'INFO' when observado = esperado then 'OK' else 'REVISAR' end as estado from c
  )
  select * from r
  union all
  select 99, 'VEREDICTO', (select count(*) filter (where estado = 'REVISAR') from r)::text || ' controles por revisar', '0 controles por revisar',
         case when (select count(*) filter (where estado = 'REVISAR') from r) = 0 then 'LISTA PARA 310' else 'NO CORRER 310: REVISAR' end
) x
order by orden;
