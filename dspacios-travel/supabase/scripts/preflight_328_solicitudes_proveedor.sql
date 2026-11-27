-- Preflight 328 (solo lectura, UNA consulta; columna estado por control). Esperado: todo OK antes de aplicar.
select n, control, actual, esperado, case when ok then 'OK' else 'FALLA' end as estado
from (
  select 1 as n, 'vouchers y ventas presentes' as control, (to_regclass('public.vouchers') is not null and to_regclass('public.ventas') is not null)::text as actual, 'true' as esperado,
         (to_regclass('public.vouchers') is not null and to_regclass('public.ventas') is not null) as ok
  union all select 2, 'mi_rol() y puede_ver_tenant(text) presentes', (to_regprocedure('public.mi_rol()') is not null and to_regprocedure('public.puede_ver_tenant(text)') is not null)::text, 'true',
         (to_regprocedure('public.mi_rol()') is not null and to_regprocedure('public.puede_ver_tenant(text)') is not null)
  union all select 3, 'tablas 328 aún no existen (0 = primera vez; 3 = reaplicación idempotente)',
         (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('solicitudes_proveedor', 'solicitud_proveedor_eventos', 'solicitud_proveedor_avisos'))::text, '0 o 3',
         (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('solicitudes_proveedor', 'solicitud_proveedor_eventos', 'solicitud_proveedor_avisos')) in (0, 3)
  union all select 4, 'identidad del contrato (284) instalada: ventas.contrato_uid, contrato_guardas_config, contrato_instalar_guardas, contrato_declarar_identidad',
         (to_regclass('public.contrato_guardas_config') is not null and to_regprocedure('public.contrato_instalar_guardas()') is not null and to_regprocedure('public.contrato_declarar_identidad(text,uuid)') is not null
          and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'contrato_uid'))::text, 'true',
         (to_regclass('public.contrato_guardas_config') is not null and to_regprocedure('public.contrato_instalar_guardas()') is not null and to_regprocedure('public.contrato_declarar_identidad(text,uuid)') is not null
          and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'contrato_uid'))
  -- El instalador de guardas aborta si ALGUNA tabla de contrato no está clasificada: lo que falte aquí (distinto de solicitudes_proveedor, que esta migración clasifica) hay que resolverlo antes.
  union all select 5, 'tablas de contrato sin clasificar en contrato_guardas_config (aparte de solicitudes_proveedor; 0 esperado)',
         coalesce((select string_agg(c.relname::text, ', ' order by c.relname) from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
                    where to_regclass('public.contrato_guardas_config') is not null and c.relkind in ('r', 'p') and c.relname <> 'solicitudes_proveedor'
                      and (exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attname in ('numero_contrato', 'contrato_numero'))
                           or exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.ventas'::regclass) or c.relname = 'ventas')
                      and not exists (select 1 from public.contrato_guardas_config g where g.tabla = c.relname::text)), '0'), '0',
         not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
                      where to_regclass('public.contrato_guardas_config') is not null and c.relkind in ('r', 'p') and c.relname <> 'solicitudes_proveedor'
                        and (exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attname in ('numero_contrato', 'contrato_numero'))
                             or exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.ventas'::regclass) or c.relname = 'ventas')
                        and not exists (select 1 from public.contrato_guardas_config g where g.tabla = c.relname::text))
) q order by n;
