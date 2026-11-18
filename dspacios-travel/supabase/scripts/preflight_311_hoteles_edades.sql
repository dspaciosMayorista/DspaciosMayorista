-- PREFLIGHT 311 (O3: hoteles sin edades por defecto) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 311. Los INFO se anotan: el postcheck debe dar las mismas cifras
-- (la 311 no cambia ninguna fila). El control 6 lista hoteles que aceptan menores y HOY no tienen edades válidas: no se corrigen por inferencia; Producto debe completarlos.
with pre as (
  select
    (to_regclass('public.hoteles') is not null) as tabla,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hoteles'
        and column_name in ('edad_infante_min', 'edad_infante_max', 'edad_nino_min', 'edad_nino_max'))::int as columnas,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hoteles'
        and column_name in ('edad_infante_min', 'edad_infante_max', 'edad_nino_min', 'edad_nino_max') and column_default is not null)::int as con_default,
    (select count(*) from public.hoteles)::bigint as hoteles,
    (select count(*) from public.hoteles where adults_only is true)::bigint as adults_only,
    (select count(*) from public.hoteles where adults_only is not true and (edad_infante_max is null or edad_nino_max is null
        or edad_infante_max < 0 or edad_nino_max > 17 or edad_infante_max >= edad_nino_max))::bigint as sin_edades_validas,
    (select string_agg(id::text || ':' || nombre, ' | ' order by nombre) from (
        select id, nombre from public.hoteles where adults_only is not true and (edad_infante_max is null or edad_nino_max is null
          or edad_infante_max < 0 or edad_nino_max > 17 or edad_infante_max >= edad_nino_max) order by nombre limit 20) x) as lista_sin_edades,
    (select count(*) from public.hoteles where adults_only is not true and edad_infante_min = 0 and edad_infante_max = 2 and edad_nino_min = 2 and edad_nino_max = 10)::bigint as valores_del_default_viejo
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Tabla hoteles presente' as control, tabla::text as observado, 'true' as esperado, case when tabla then 'OK' else 'REVISAR' end as estado from pre
  union all select 2, 'Las 4 columnas de edades existen', columnas::text, '4', case when columnas = 4 then 'OK' else 'REVISAR' end from pre
  union all select 3, 'Columnas que aún tienen DEFAULT (la 311 las deja en 0)', con_default::text, '4 antes de la 311 (0 si ya se corrió)', case when con_default in (0, 4) then 'OK' else 'REVISAR' end from pre
  union all select 4, 'Total de hoteles y de Adults Only (anotar; igual en el postcheck)', hoteles::text || ' / ' || adults_only::text, 'anotar', 'INFO' from pre
  union all select 5, 'Hoteles que aceptan menores SIN edades válidas hoy (anotar; la 311 no los toca)', sin_edades_validas::text, 'anotar', 'INFO' from pre
  union all select 6, 'Cuáles (hasta 20: id:nombre)', coalesce(lista_sin_edades, 'ninguno'), 'completarlos en Producto', 'INFO' from pre
  union all select 7, 'Hoteles cuyas edades son exactamente las del default viejo 0-2/2-10 (no se pueden distinguir de una configuración real: revisar con Producto si se quiere)', valores_del_default_viejo::text, 'anotar', 'INFO' from pre
) r order by orden;
