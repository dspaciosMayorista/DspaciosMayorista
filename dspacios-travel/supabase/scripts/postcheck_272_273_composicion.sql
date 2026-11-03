-- POSTCHECK 272 + 273 · solo lectura · UNA consulta con columna `estado` (pegar tal cual en el editor SQL DESPUÉS de correr la 272 y la 273).
-- Todas las filas `control` deben dar OK; las `informativo` no bloquean. Confirma que las dos tablas existen, son privadas (RLS activa, cero políticas, solo service_role)
-- y que no se tocó ninguna columna ni vista pública.
select 'control' as tipo, c.nombre,
       case when c.ok then 'OK' else 'REVISAR' end as estado, c.detalle
  from (values
    ('existen las dos tablas',
       to_regclass('public.cotizacion_composicion') is not null and to_regclass('public.tarifario_resultado_composicion') is not null, 'cotizacion_composicion (272) y tarifario_resultado_composicion (273)'),
    ('RLS activa en ambas',
       coalesce((select bool_and(relrowsecurity) from pg_class where oid in (to_regclass('public.cotizacion_composicion'), to_regclass('public.tarifario_resultado_composicion'))), false), 'row level security enabled'),
    ('cero políticas (nadie las alcanza por la API)',
       not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('cotizacion_composicion', 'tarifario_resultado_composicion')), 'sin políticas'),
    ('anon y authenticated SIN ningún privilegio',
       to_regclass('public.cotizacion_composicion') is not null and to_regclass('public.tarifario_resultado_composicion') is not null
       and not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('cotizacion_composicion', 'tarifario_resultado_composicion')
                          and grantee in ('anon', 'authenticated', 'PUBLIC')), 'revoke all from public, anon, authenticated'),
    ('service_role escribe cotizacion_composicion',
       to_regclass('public.cotizacion_composicion') is not null and has_table_privilege('service_role', 'public.cotizacion_composicion', 'select, insert'), 'select + insert'),
    ('service_role escribe tarifario_resultado_composicion',
       to_regclass('public.tarifario_resultado_composicion') is not null and has_table_privilege('service_role', 'public.tarifario_resultado_composicion', 'select, insert, update, delete'), 'select + insert + update + delete'),
    ('cotizacion_composicion cae en cascada con la cotización',
       exists (select 1 from pg_constraint where conrelid = to_regclass('public.cotizacion_composicion') and contype = 'f' and confdeltype = 'c'), 'FK on delete cascade'),
    ('tarifario_resultado_composicion cae en cascada con el paquete y tiene PK (paquete, generación, clave)',
       exists (select 1 from pg_constraint where conrelid = to_regclass('public.tarifario_resultado_composicion') and contype = 'f' and confdeltype = 'c')
       and exists (select 1 from pg_constraint where conrelid = to_regclass('public.tarifario_resultado_composicion') and contype = 'p' and array_length(conkey, 1) = 3), 'FK cascade + PK de 3 columnas'),
    ('la composición debe ser un objeto JSON (ambas)',
       (select count(*) from pg_constraint where contype = 'c' and conrelid in (to_regclass('public.cotizacion_composicion'), to_regclass('public.tarifario_resultado_composicion'))
           and pg_get_constraintdef(oid) ilike '%jsonb_typeof%object%') = 2, 'check jsonb_typeof = object'),
    ('tarifario_resultado NO ganó ninguna columna de composición',
       not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name ilike '%composicion%'), 'la tabla pública no cambió'),
    ('la vista pública del tarifario no menciona la composición',
       to_regclass('public.tarifario_resultado_publicable') is not null and pg_get_viewdef(to_regclass('public.tarifario_resultado_publicable')) not ilike '%composicion%', 'sin netos ni composición en la vista'),
    ('cotizaciones no ganó columna de composición (el detalle público no la lleva)',
       not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones' and column_name ilike '%composicion%'), 'la composición vive solo en la tabla privada')
  ) as c(nombre, ok, detalle)
union all
select 'informativo', 'filas en cotizacion_composicion (0 justo después de aplicar; crece con cada cotización NUEVA)', 'INFO', case when to_regclass('public.cotizacion_composicion') is null then 'no existe' else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.cotizacion_composicion', false, true, '')))[1]::text end
union all
select 'informativo', 'filas en tarifario_resultado_composicion (0 hasta regenerar un paquete DESPUÉS de la 273)', 'INFO', case when to_regclass('public.tarifario_resultado_composicion') is null then 'no existe' else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.tarifario_resultado_composicion', false, true, '')))[1]::text end
order by 1, 2;
