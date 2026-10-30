-- ───────────────────────────────────────────────────────────────────────────
-- 241 · PREFLIGHT INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre ANTES de la 241. Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple lo esperado · REVISAR = hay que mirar antes de aplicar · INFO = dato (se compara con el postcheck).
-- No usa las columnas nuevas (catálogo / pg_proc): corre igual con o sin la 241 aplicada. No imprime filas de negocio: solo conteos y huellas.
-- ───────────────────────────────────────────────────────────────────────────
with
vt as (select numero_contrato, cliente, cliente_documento, precio_venta from public.ventas),
col240 as (select count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'cliente_tipo_documento'),
col241 as (select count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'titular_tipo_documento'),
chk241 as (select count(*) as n from pg_constraint where conrelid = to_regclass('public.ventas') and conname = 'ventas_titular_tipo_documento_catalogo'),
fn as (select p.prosrc, p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)')),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'migracion_240_aplicada (ventas.cliente_tipo_documento)', ((select n from col240) = 1)::text, 'true',
         case when (select n from col240) = 1 then 'OK' else 'REVISAR' end
  union all
  select 2, 'funciones_de_conversion_presentes (198/222)',
         (to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)') is not null and to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)') is not null)::text, 'true',
         case when to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)') is not null and to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)') is not null then 'OK' else 'REVISAR' end
  union all
  select 3, 'wrapper_es_el_de_la_222 (aún no copia el tipo)', coalesce(((select prosrc from fn) !~ 'cliente_tipo_documento')::text, 'no existe'), 'true',
         case when (select prosrc from fn) !~ 'cliente_tipo_documento' then 'OK' else 'REVISAR' end
  union all
  select 4, 'wrapper_security_invoker', coalesce((not (select prosecdef from fn))::text, 'no existe'), 'true',
         case when (select prosecdef from fn) is false then 'OK' else 'REVISAR' end
  union all
  select 5, 'migracion_241_no_aplicada', ((select n from col241) = 0 and (select n from chk241) = 0)::text, 'true',
         case when (select n from col241) = 0 and (select n from chk241) = 0 then 'OK' else 'REVISAR' end
  union all
  select 6, 'columnas_de_ventas_hoy', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas')::text, 'postcheck menos 1', 'INFO'
  union all
  select 7, 'columnas_de_ventas_basica_hoy', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas_basica')::text, 'igual en el postcheck (la vista no cambia)', 'INFO'
  union all
  select 8, 'ventas_total', (select count(*) from vt)::text, 'igual en el postcheck', 'INFO'
  union all
  select 9, 'huella_de_ventas_que_la_241_no_debe_tocar',
         md5(coalesce((select string_agg(numero_contrato || ':' || coalesce(cliente, '') || ':' || coalesce(cliente_documento, '') || ':' || coalesce(precio_venta::text, ''), '|' order by numero_contrato) from vt), '')),
         'igual en el postcheck', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
