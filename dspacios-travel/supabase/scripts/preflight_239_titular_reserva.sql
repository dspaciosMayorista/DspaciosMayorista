-- ───────────────────────────────────────────────────────────────────────────
-- 239 · PREFLIGHT INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre ANTES de la 239. Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple lo esperado · REVISAR = hay que mirar antes de aplicar · INFO = dato (se compara con el postcheck).
-- No usa las columnas nuevas (catálogo / to_jsonb): corre igual con o sin la 239 aplicada (si ya está aplicada, 'migracion_239_no_aplicada' sale REVISAR).
-- No imprime filas de negocio: solo conteos y una huella.
-- ───────────────────────────────────────────────────────────────────────────
with
vt as (
  select v.numero_contrato, v.cliente, v.precio_venta from public.ventas v
),
vcols as (
  select count(*) as n from information_schema.columns
   where table_schema = 'public' and table_name = 'ventas' and column_name in ('titular_nombre', 'titular_documento', 'titular_telefono', 'titular_email')
),
vista as (
  select count(*) as n from information_schema.columns
   where table_schema = 'public' and table_name = 'ventas_basica' and column_name in ('titular_nombre', 'titular_documento', 'titular_telefono', 'titular_email')
),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'migracion_238_aplicada',
         (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'cotizacion_origen_id'))::text, 'true',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'cotizacion_origen_id') then 'OK' else 'REVISAR' end
  union all
  select 2, 'migracion_235_aplicada (ventas.total_cobro)',
         (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'total_cobro'))::text, 'true',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'total_cobro') then 'OK' else 'REVISAR' end
  union all
  select 3, 'migracion_239_no_aplicada', ((select n from vcols) = 0 and (select n from vista) = 0)::text, 'true',
         case when (select n from vcols) = 0 and (select n from vista) = 0 then 'OK' else 'REVISAR' end
  union all
  select 4, 'vista_ventas_basica_presente', (to_regclass('public.ventas_basica') is not null)::text, 'true',
         case when to_regclass('public.ventas_basica') is not null then 'OK' else 'REVISAR' end
  union all
  -- La vista se redefine con CREATE OR REPLACE: debe conservar las columnas que ya tiene (la 239 solo AGREGA al final).
  select 5, 'columnas_de_ventas_basica_hoy',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas_basica')::text, 'igual al postcheck menos 4', 'INFO'
  union all
  select 6, 'funciones_de_la_vista_presentes (mi_rol, puede_ver_tenant, soy_asesor_del_contrato)',
         (select count(distinct proname) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('mi_rol', 'puede_ver_tenant', 'soy_asesor_del_contrato'))::text, '3',
         case when (select count(distinct proname) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('mi_rol', 'puede_ver_tenant', 'soy_asesor_del_contrato')) = 3 then 'OK' else 'REVISAR' end
  union all
  select 7, 'huella_de_permisos_de_la_vista (relacl)', md5(coalesce((select c.relacl::text from pg_class c where c.oid = to_regclass('public.ventas_basica')), '')),
         'igual en el postcheck', 'INFO'
  union all
  select 8, 'ventas_total', (select count(*) from vt)::text, 'igual en el postcheck', 'INFO'
  union all
  select 9, 'huella_de_ventas_que_la_239_no_debe_tocar',
         md5(coalesce((select string_agg(numero_contrato || ':' || coalesce(cliente, '') || ':' || coalesce(precio_venta::text, ''), '|' order by numero_contrato) from vt), '')),
         'igual en el postcheck', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
