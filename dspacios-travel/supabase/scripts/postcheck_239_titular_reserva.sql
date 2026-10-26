-- ───────────────────────────────────────────────────────────────────────────
-- 239 · POSTCHECK INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre DESPUÉS de la 239. Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple · REVISAR = no cumple (no desplegar el código nuevo) · INFO = dato para comparar con el preflight.
-- No imprime filas de negocio.
-- ───────────────────────────────────────────────────────────────────────────
with
vc as (
  select column_name, data_type, is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'ventas' and column_name in ('titular_nombre', 'titular_documento', 'titular_telefono', 'titular_email')
),
vb as (
  select column_name from information_schema.columns
   where table_schema = 'public' and table_name = 'ventas_basica' and column_name in ('titular_nombre', 'titular_documento', 'titular_telefono', 'titular_email')
),
vt as (
  select v.numero_contrato, v.cliente, v.precio_venta, to_jsonb(v) ->> 'titular_nombre' as titular_nombre from public.ventas v
),
def as (
  select pg_get_viewdef('public.ventas_basica'::regclass) as d
),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'ventas_columnas_titular_nullable_text', (select count(*) from vc where data_type = 'text' and is_nullable = 'YES')::text, '4',
         case when (select count(*) from vc where data_type = 'text' and is_nullable = 'YES') = 4 then 'OK' else 'REVISAR' end
  union all
  select 2, 'ventas_basica_expone_el_titular', (select count(*) from vb)::text, '4',
         case when (select count(*) from vb) = 4 then 'OK' else 'REVISAR' end
  union all
  -- La vista conserva su frontera de rol y agencia.
  select 3, 'ventas_basica_conserva_rol_y_agencia',
         ((select d from def) like '%mi_rol()%' and (select d from def) like '%puede_ver_tenant%')::text, 'true',
         case when (select d from def) like '%mi_rol()%' and (select d from def) like '%puede_ver_tenant%' then 'OK' else 'REVISAR' end
  union all
  -- El documento del titular se enmascara para un asesor ajeno, igual que el del cliente.
  select 4, 'documento_del_titular_enmascarado_para_venta_ajena',
         ((select d from def) ~ 'soy_asesor_del_contrato[^;]*titular_documento')::text, 'true',
         case when (select d from def) ~ 'soy_asesor_del_contrato[^;]*titular_documento' then 'OK' else 'REVISAR' end
  union all
  -- La vista sigue sin exponer columnas financieras (costos, comisión, impuesto).
  select 5, 'ventas_basica_sin_columnas_financieras',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas_basica'
             and column_name in ('costo_hotel', 'costo_aereo', 'costo_receptivo', 'costo_asistencia', 'otros_costos', 'comision_b2b', 'impuesto'))::text, '0',
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas_basica'
                      and column_name in ('costo_hotel', 'costo_aereo', 'costo_receptivo', 'costo_asistencia', 'otros_costos', 'comision_b2b', 'impuesto')) = 0 then 'OK' else 'REVISAR' end
  union all
  select 6, 'vista_legible_por_authenticated', has_table_privilege('authenticated', 'public.ventas_basica', 'SELECT')::text, 'true',
         case when has_table_privilege('authenticated', 'public.ventas_basica', 'SELECT') then 'OK' else 'REVISAR' end
  union all
  -- La 239 no cambia los permisos de la vista (CREATE OR REPLACE los conserva): la huella debe ser la del preflight. Lo que anon pueda leer no depende de la 239
  -- (la vista filtra por mi_rol(), que es NULL sin sesión).
  select 7, 'huella_de_permisos_de_la_vista (relacl)', md5(coalesce((select c.relacl::text from pg_class c where c.oid = 'public.ventas_basica'::regclass), '')),
         'igual al preflight', 'INFO'
  union all
  select 8, 'columnas_de_ventas_basica_ahora',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas_basica')::text, 'columnas del preflight + 4', 'INFO'
  union all
  select 9, 'ventas_total', (select count(*) from vt)::text, 'igual al preflight', 'INFO'
  union all
  select 10, 'huella_de_ventas', md5(coalesce((select string_agg(numero_contrato || ':' || coalesce(cliente, '') || ':' || coalesce(precio_venta::text, ''), '|' order by numero_contrato) from vt), '')),
         'igual al preflight', 'INFO'
  union all
  select 11, 'ventas_existentes_con_titular', (select count(*) from vt where titular_nombre is not null)::text,
         '0 justo después de aplicar (solo las conversiones NETO nuevas lo llenan)', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
