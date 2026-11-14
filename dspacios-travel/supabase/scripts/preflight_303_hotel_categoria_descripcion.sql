-- Preflight 303 (#45) · SOLO LECTURA · una sola consulta con columna de estado.
select control, observado, esperado,
       case when observado = esperado then 'OK' else 'REVISAR' end as estado
from (
  select 'tabla hotel_categorias existe' as control,
         (to_regclass('public.hotel_categorias') is not null)::text as observado, 'true' as esperado
  union all
  select 'columna descripcion aún no existe',
         (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hotel_categorias' and column_name = 'descripcion'))::text, 'true'
  union all
  select 'columna incluye aún no existe',
         (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hotel_categorias' and column_name = 'incluye'))::text, 'true'
  union all
  select 'restricción de longitud aún no existe',
         (not exists (select 1 from pg_constraint where conname = 'hotel_categorias_textos_check'))::text, 'true'
) c;
