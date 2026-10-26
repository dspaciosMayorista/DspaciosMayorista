-- ───────────────────────────────────────────────────────────────────────────
-- 238 · POSTCHECK INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre DESPUÉS de la 238. Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple · REVISAR = no cumple (no desplegar el código nuevo) · INFO = dato para comparar con el preflight.
-- Compara contra el preflight: mismo total de aliados y misma huella (id, tipo, pct_comision). No imprime filas de negocio.
-- ───────────────────────────────────────────────────────────────────────────
with
col as (
  select data_type, is_nullable, column_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'aliados' and column_name = 'activo'
),
al as (
  select a.id, a.tipo, a.pct_comision, to_jsonb(a) ->> 'activo' as activo from public.aliados a
),
vt as (
  select v.numero_contrato, v.precio_venta, v.comision_b2b, v.cotizacion_origen_id, v.grupo_conversion from public.ventas v
),
vcol as (
  select column_name, data_type, is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'ventas' and column_name in ('cotizacion_origen_id', 'grupo_conversion')
),
idx as (
  select pg_get_indexdef(i.indexrelid) as def, i.indisunique as unico
    from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'ux_ventas_conversion_cotizacion_grupo' and i.indrelid = 'public.ventas'::regclass
),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'columna_aliados_activo_existe', (exists (select 1 from col))::text, 'true',
         case when exists (select 1 from col) then 'OK' else 'REVISAR' end
  union all
  select 2, 'tipo_boolean', coalesce((select data_type from col), '-'), 'boolean',
         case when (select data_type from col) = 'boolean' then 'OK' else 'REVISAR' end
  union all
  select 3, 'not_null', coalesce((select is_nullable from col), '-'), 'NO',
         case when (select is_nullable from col) = 'NO' then 'OK' else 'REVISAR' end
  union all
  select 4, 'default_true', coalesce((select column_default from col), '-'), 'true',
         case when (select column_default from col) = 'true' then 'OK' else 'REVISAR' end
  union all
  select 5, 'filas_con_activo_nulo', (select count(*) from al where activo is null)::text, '0',
         case when (select count(*) from al where activo is null) = 0 then 'OK' else 'REVISAR' end
  union all
  -- Recién aplicada, todas las filas existentes deben quedar activas (después puede haber inactivos por decisión de administración).
  select 6, 'aliados_inactivos', (select count(*) from al where activo = 'false')::text, '0 recién aplicada',
         case when (select count(*) from al where activo = 'false') = 0 then 'OK' else 'INFO' end
  union all
  select 7, 'aliados_total', (select count(*) from al)::text, 'igual al preflight', 'INFO'
  union all
  select 8, 'huella_de_aliados_no_tocados',
         md5(coalesce((select string_agg(id::text || ':' || coalesce(tipo, '') || ':' || coalesce(pct_comision::text, ''), '|' order by id) from al), '')),
         'igual al preflight', 'INFO'
  union all
  select 9, 'rls_de_aliados_sigue_activa', coalesce((select c.relrowsecurity::text from pg_class c where c.oid = 'public.aliados'::regclass), 'false'), 'true',
         case when coalesce((select c.relrowsecurity from pg_class c where c.oid = 'public.aliados'::regclass), false) then 'OK' else 'REVISAR' end
  union all
  select 10, 'rpc_registrar_comision_b2b_reserva_intacta',
         (to_regprocedure('public.registrar_comision_b2b_reserva(text, bigint)') is not null)::text, 'true',
         case when to_regprocedure('public.registrar_comision_b2b_reserva(text, bigint)') is not null then 'OK' else 'REVISAR' end
  union all
  -- (2) Candado de unicidad de la conversión.
  select 11, 'ventas_columnas_de_conversion',
         coalesce((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name) from vcol), '-'),
         'cotizacion_origen_id:bigint:YES,grupo_conversion:text:YES',
         case when (select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name) from vcol) = 'cotizacion_origen_id:bigint:YES,grupo_conversion:text:YES' then 'OK' else 'REVISAR' end
  union all
  select 12, 'indice_unico_parcial_por_cotizacion_y_grupo',
         coalesce((select (unico and def like '%(cotizacion_origen_id, grupo_conversion)%' and def like '%WHERE (cotizacion_origen_id IS NOT NULL)%')::text from idx), 'false'),
         'true',
         case when coalesce((select unico and def like '%(cotizacion_origen_id, grupo_conversion)%' and def like '%WHERE (cotizacion_origen_id IS NOT NULL)%' from idx), false) then 'OK' else 'REVISAR' end
  union all
  select 13, 'check_ambas_columnas_juntas_o_ninguna',
         exists (select 1 from pg_constraint where conrelid = 'public.ventas'::regclass and conname = 'ventas_conversion_par_chk' and convalidated)::text, 'true',
         case when exists (select 1 from pg_constraint where conrelid = 'public.ventas'::regclass and conname = 'ventas_conversion_par_chk' and convalidated) then 'OK' else 'REVISAR' end
  union all
  select 14, 'contratos_con_marca_de_conversion', (select count(*) from vt where cotizacion_origen_id is not null or grupo_conversion is not null)::text,
         '0 recién aplicada (después, uno por contrato creado por la conversión B2B)',
         case when (select count(*) from vt where cotizacion_origen_id is not null or grupo_conversion is not null) = 0 then 'OK' else 'INFO' end
  union all
  select 15, 'ventas_total', (select count(*) from vt)::text, 'igual al preflight', 'INFO'
  union all
  select 16, 'huella_de_ventas_no_tocadas',
         md5(coalesce((select string_agg(numero_contrato || ':' || coalesce(precio_venta::text, '') || ':' || coalesce(comision_b2b::text, ''), '|' order by numero_contrato) from vt), '')),
         'igual al preflight', 'INFO'
  union all
  -- (3) Frontera del plan congelado: disparador BEFORE UPDATE FOR EACH ROW habilitado sobre cotizaciones.
  select 17, 'disparador_b2b_asistido_inmutable_activo',
         coalesce((select (t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16 and (t.tgtype & 4) = 0 and (t.tgtype & 8) = 0)::text
                     from pg_trigger t where t.tgrelid = 'public.cotizaciones'::regclass and t.tgname = 'trg_cot_b2b_asistido_inmutable' and not t.tgisinternal), 'false'),
         'true',
         case when coalesce((select t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16 and (t.tgtype & 4) = 0 and (t.tgtype & 8) = 0
                               from pg_trigger t where t.tgrelid = 'public.cotizaciones'::regclass and t.tgname = 'trg_cot_b2b_asistido_inmutable' and not t.tgisinternal), false) then 'OK' else 'REVISAR' end
  union all
  select 18, 'funcion_del_disparador_no_ejecutable_por_clientes',
         coalesce((select (not has_function_privilege('anon', f.oid, 'EXECUTE') and not has_function_privilege('authenticated', f.oid, 'EXECUTE'))::text
                     from pg_proc f where f.proname = 'tg_cot_b2b_asistido_inmutable' and f.pronamespace = 'public'::regnamespace), 'false'),
         'true',
         case when coalesce((select not has_function_privilege('anon', f.oid, 'EXECUTE') and not has_function_privilege('authenticated', f.oid, 'EXECUTE')
                               from pg_proc f where f.proname = 'tg_cot_b2b_asistido_inmutable' and f.pronamespace = 'public'::regnamespace), false) then 'OK' else 'REVISAR' end
  union all
  -- (3) El disparador también congela las unidades económicas (ítems, tours y servicios incluidos), no solo el bloque.
  select 19, 'disparador_congela_unidades_economicas',
         coalesce((select (pg_get_functiondef(f.oid) like '%''items''%' and pg_get_functiondef(f.oid) like '%''tours''%' and pg_get_functiondef(f.oid) like '%''serviciosIncluidos''%')::text
                     from pg_proc f where f.proname = 'tg_cot_b2b_asistido_inmutable' and f.pronamespace = 'public'::regnamespace), 'false'),
         'true',
         case when coalesce((select pg_get_functiondef(f.oid) like '%''items''%' and pg_get_functiondef(f.oid) like '%''tours''%' and pg_get_functiondef(f.oid) like '%''serviciosIncluidos''%'
                               from pg_proc f where f.proname = 'tg_cot_b2b_asistido_inmutable' and f.pronamespace = 'public'::regnamespace), false) then 'OK' else 'REVISAR' end
)
select control, valor, esperado, estado from controles order by orden;
