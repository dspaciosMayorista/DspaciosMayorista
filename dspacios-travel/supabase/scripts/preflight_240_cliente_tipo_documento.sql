-- ───────────────────────────────────────────────────────────────────────────
-- 240 · PREFLIGHT INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre ANTES de la 240. Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple lo esperado · REVISAR = hay que mirar antes de aplicar · INFO = dato (se compara con el postcheck).
-- No usa la columna nueva (catálogo / to_jsonb): corre igual con o sin la 240 aplicada. No imprime filas de negocio: solo conteos y una huella.
-- ───────────────────────────────────────────────────────────────────────────
with
vt as (select numero_contrato, cliente, cliente_documento, precio_venta from public.ventas),
col as (select count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'cliente_tipo_documento'),
chk as (select count(*) as n from pg_constraint where conrelid = to_regclass('public.ventas') and conname = 'ventas_cliente_tipo_documento_catalogo'),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'tabla_ventas_presente', (to_regclass('public.ventas') is not null)::text, 'true',
         case when to_regclass('public.ventas') is not null then 'OK' else 'REVISAR' end
  union all
  select 2, 'migracion_239_aplicada (ventas.titular_nombre)',
         (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'titular_nombre'))::text, 'true',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'titular_nombre') then 'OK' else 'REVISAR' end
  union all
  select 3, 'migracion_240_no_aplicada', ((select n from col) = 0 and (select n from chk) = 0)::text, 'true',
         case when (select n from col) = 0 and (select n from chk) = 0 then 'OK' else 'REVISAR' end
  union all
  select 4, 'columnas_de_ventas_hoy', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas')::text, 'igual al postcheck menos 1', 'INFO'
  union all
  select 5, 'columnas_de_ventas_basica_hoy', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas_basica')::text, 'igual en el postcheck (la vista no cambia)', 'INFO'
  union all
  select 6, 'ventas_total', (select count(*) from vt)::text, 'igual en el postcheck', 'INFO'
  union all
  select 7, 'huella_de_ventas_que_la_240_no_debe_tocar',
         md5(coalesce((select string_agg(numero_contrato || ':' || coalesce(cliente, '') || ':' || coalesce(cliente_documento, '') || ':' || coalesce(precio_venta::text, ''), '|' order by numero_contrato) from vt), '')),
         'igual en el postcheck', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
