-- POSTCHECK de la migración 306. SOLO LECTURA. UNA consulta integral: todo debe decir OK (el control 4 es informativo).
select * from (
  select 1 as o, 'Las tres columnas existen (uuid, text, text; todas nullable)' as control,
         (select string_agg(column_name || ':' || data_type || '/' || is_nullable, ', ' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones' and column_name in ('clave_envio', 'huella_envio', 'actor_envio')) as valor,
         'actor_envio:text/YES, clave_envio:uuid/YES, huella_envio:text/YES' as esperado,
         case when (select string_agg(column_name || ':' || data_type || '/' || is_nullable, ', ' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones' and column_name in ('clave_envio', 'huella_envio', 'actor_envio')) = 'actor_envio:text/YES, clave_envio:uuid/YES, huella_envio:text/YES' then 'OK' else 'REVISAR' end as estado
  union all select 2, 'Índice único parcial uq_cotizaciones_clave_envio',
         coalesce((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'uq_cotizaciones_clave_envio'), 'NO EXISTE'), 'UNIQUE … WHERE clave_envio IS NOT NULL',
         case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_cotizaciones_clave_envio' and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%WHERE (clave_envio IS NOT NULL)%') then 'OK' else 'REVISAR' end
  union all select 3, 'Restricción: con clave, la huella (64 hex) y el actor son obligatorios',
         coalesce((select pg_get_constraintdef(oid) from pg_constraint where conname = 'cotizaciones_clave_envio_completa_chk'), 'NO EXISTE'), 'CHECK presente',
         case when exists (select 1 from pg_constraint where conname = 'cotizaciones_clave_envio_completa_chk' and conrelid = 'public.cotizaciones'::regclass) then 'OK' else 'REVISAR' end
  union all select 4, 'Las cotizaciones existentes quedan sin clave (histórico intacto)',
         (select count(*)::text from public.cotizaciones where clave_envio is not null), '0', case when (select count(*) from public.cotizaciones where clave_envio is not null) = 0 then 'OK' else 'INFO' end
) q order by o;
