-- ───────────────────────────────────────────────────────────────────────────
-- 240 · POSTCHECK INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre DESPUÉS de la 240. Columnas: control · valor · esperado · estado.
--   Los INFO se comparan a mano con el preflight (columnas: +1 en ventas, igual en la vista; mismo total y misma huella de ventas).
-- ───────────────────────────────────────────────────────────────────────────
with
vt as (select numero_contrato, cliente, cliente_documento, precio_venta from public.ventas),
cd as (
  select data_type, is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'ventas' and column_name = 'cliente_tipo_documento'
),
chk as (
  select pg_get_constraintdef(c.oid) as def from pg_constraint c
   where c.conrelid = to_regclass('public.ventas') and c.conname = 'ventas_cliente_tipo_documento_catalogo'
),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'columna_ventas.cliente_tipo_documento_text_nullable',
         coalesce((select data_type || '/' || is_nullable from cd), 'no existe'), 'text/YES',
         case when (select data_type || '/' || is_nullable from cd) = 'text/YES' then 'OK' else 'REVISAR' end
  union all
  select 2, 'check_catalogo_de_tipos (CC, CE, TI, RC, PAS, PPT, NIT)',
         coalesce((select def from chk), 'no existe'), 'incluye los 7 tipos',
         case when (select def from chk) ~ 'CC' and (select def from chk) ~ 'CE' and (select def from chk) ~ 'TI' and (select def from chk) ~ 'RC'
               and (select def from chk) ~ 'PAS' and (select def from chk) ~ 'PPT' and (select def from chk) ~ 'NIT' then 'OK' else 'REVISAR' end
  union all
  select 3, 'ventas_con_tipo_ya_guardado (antes de usar el código nuevo debe ser 0)',
         (select count(*) from public.ventas where cliente_tipo_documento is not null)::text, '0 si el código nuevo aún no corrió',
         case when (select count(*) from public.ventas where cliente_tipo_documento is not null) = 0 then 'OK' else 'INFO' end
  union all
  select 4, 'vista_ventas_basica_no_expone_la_columna',
         (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas_basica' and column_name = 'cliente_tipo_documento'))::text, 'true',
         case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas_basica' and column_name = 'cliente_tipo_documento') then 'OK' else 'REVISAR' end
  union all
  select 5, 'columnas_de_ventas', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas')::text, 'preflight + 1', 'INFO'
  union all
  select 6, 'columnas_de_ventas_basica', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas_basica')::text, 'igual al preflight', 'INFO'
  union all
  select 7, 'ventas_total', (select count(*) from vt)::text, 'igual al preflight', 'INFO'
  union all
  select 8, 'huella_de_ventas_que_la_240_no_debe_tocar',
         md5(coalesce((select string_agg(numero_contrato || ':' || coalesce(cliente, '') || ':' || coalesce(cliente_documento, '') || ':' || coalesce(precio_venta::text, ''), '|' order by numero_contrato) from vt), '')),
         'igual al preflight', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
