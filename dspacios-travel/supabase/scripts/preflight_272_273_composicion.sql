-- PREFLIGHT 272 + 273 · solo lectura · UNA consulta con columna `estado` (pegar tal cual en el editor SQL ANTES de correr la 272 y la 273).
-- Todas las filas `requisito` deben dar OK; las `informativo` no bloquean. Orden de aplicación: 272 → 273 (independientes entre sí, pero la 273 es la que usa el generador del tarifario).
select 'requisito' as tipo, c.nombre,
       case when c.ok then 'OK' else 'BLOQUEA' end as estado, c.detalle
  from (values
    ('cotizaciones existe con id bigint (la 272 la referencia)',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones' and column_name = 'id' and data_type = 'bigint'), 'FK cotizacion_composicion.cotizacion_id → cotizaciones.id'),
    ('armado_paquetes existe con id bigint (la 273 la referencia)',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'id' and data_type = 'bigint'), 'FK tarifario_resultado_composicion.paquete_id → armado_paquetes.id'),
    ('el rol service_role existe (único con acceso a las tablas nuevas)',
       exists (select 1 from pg_roles where rolname = 'service_role'), 'grant select/insert(/update/delete) to service_role'),
    ('la 272 todavía NO está aplicada',
       to_regclass('public.cotizacion_composicion') is null, 'si ya existe, la 272 se NIEGA (no pisa nada): no la corras otra vez'),
    ('la 273 todavía NO está aplicada',
       to_regclass('public.tarifario_resultado_composicion') is null, 'si ya existe, la 273 se NIEGA (no pisa nada): no la corras otra vez'),
    ('precedente privado cotizacion_neto sin políticas (mismo patrón)',
       to_regclass('public.cotizacion_neto') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cotizacion_neto'), 'las tablas nuevas siguen su patrón: RLS activa, cero políticas'),
    ('precedente privado tarifario_resultado_neto sin políticas (mismo patrón)',
       to_regclass('public.tarifario_resultado_neto') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tarifario_resultado_neto'), 'idem')
  ) as c(nombre, ok, detalle)
union all
select 'informativo', 'cotizaciones existentes (quedarán SIN composición: la ficha dirá «no fue conservado»)', 'INFO', count(*)::text from public.cotizaciones
union all
select 'informativo', 'paquetes activos con tarifario publicado (regenerar DESPUÉS de la 273 para que bloqueo/empaquetado tengan composición)', 'INFO',
       count(*)::text from public.armado_paquetes where activo and tarifario_generacion_publicada is not null
union all
select 'informativo', 'paquetes activos por tipo (bloqueo / porción / servicios)', 'INFO',
       coalesce(string_agg(t.tipo::text || '=' || t.n, ' · ' order by t.tipo::text), 'ninguno')
  from (select tipo, count(*) n from public.armado_paquetes where activo group by tipo) t
order by 1, 2;
