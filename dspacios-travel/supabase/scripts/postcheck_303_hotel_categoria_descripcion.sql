-- Postcheck 303 (#45) · SOLO LECTURA · una sola consulta con columna de estado.
select control, observado, esperado,
       case when observado = esperado then 'OK' else 'FALLA' end as estado
from (
  select 'columna descripcion (text, nullable)' as control,
         coalesce((select data_type || '/' || is_nullable from information_schema.columns
                   where table_schema = 'public' and table_name = 'hotel_categorias' and column_name = 'descripcion'), 'ausente') as observado,
         'text/YES' as esperado
  union all
  select 'columna incluye (text, nullable)',
         coalesce((select data_type || '/' || is_nullable from information_schema.columns
                   where table_schema = 'public' and table_name = 'hotel_categorias' and column_name = 'incluye'), 'ausente'),
         'text/YES'
  union all
  select 'restricción de longitud',
         (exists (select 1 from pg_constraint where conname = 'hotel_categorias_textos_check'
                  and conrelid = 'public.hotel_categorias'::regclass))::text,
         'true'
  union all
  select 'RLS sigue activa en hotel_categorias',
         (select relrowsecurity::text from pg_class where oid = 'public.hotel_categorias'::regclass),
         'true'
) c;
