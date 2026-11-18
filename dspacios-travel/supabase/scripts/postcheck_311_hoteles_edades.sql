-- POSTCHECK 311 (O3: hoteles sin edades por defecto) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 311. Todo debe decir OK; los INFO se comparan con el preflight (iguales).
with pos as (
  select
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hoteles'
        and column_name in ('edad_infante_min', 'edad_infante_max', 'edad_nino_min', 'edad_nino_max') and column_default is null)::int as sin_default,
    (select count(*) from public.hoteles)::bigint as hoteles,
    (select count(*) from public.hoteles where adults_only is true)::bigint as adults_only,
    (select count(*) from public.hoteles where adults_only is not true and (edad_infante_max is null or edad_nino_max is null
        or edad_infante_max < 0 or edad_nino_max > 17 or edad_infante_max >= edad_nino_max))::bigint as sin_edades_validas,
    (select count(*) from public.hoteles where adults_only is not true and edad_infante_min = 0 and edad_infante_max = 2 and edad_nino_min = 2 and edad_nino_max = 10)::bigint as valores_del_default_viejo
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Las 4 columnas de edades ya NO tienen default' as control, sin_default::text as observado, '4' as esperado, case when sin_default = 4 then 'OK' else 'REVISAR' end as estado from pos
  union all select 2, 'Total de hoteles y de Adults Only (igual al preflight)', hoteles::text || ' / ' || adults_only::text, 'igual al preflight', 'INFO' from pos
  union all select 3, 'Hoteles que aceptan menores sin edades válidas (igual al preflight: la 311 no cambia filas)', sin_edades_validas::text, 'igual al preflight', 'INFO' from pos
  union all select 4, 'Hoteles con exactamente las edades del default viejo (igual al preflight)', valores_del_default_viejo::text, 'igual al preflight', 'INFO' from pos
) r order by orden;
