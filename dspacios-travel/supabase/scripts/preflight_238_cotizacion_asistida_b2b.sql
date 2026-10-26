-- ───────────────────────────────────────────────────────────────────────────
-- 238 · PREFLIGHT INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre ANTES de la 238. Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple lo esperado · REVISAR = hay que mirar antes de aplicar · INFO = dato (se compara con el postcheck).
-- No usa la columna nueva (se lee con to_jsonb / catálogo): corre igual con o sin la 238 aplicada (si ya está aplicada, 'migracion_238_no_aplicada' sale REVISAR).
-- No imprime filas de negocio: solo conteos y una huella.
-- ───────────────────────────────────────────────────────────────────────────
with
al as (
  select a.id, a.nombre, a.tipo, a.pct_comision from public.aliados a
),
vt as (
  select v.numero_contrato, v.precio_venta, v.comision_b2b from public.ventas v
),
columnas as (
  select count(*) as n from information_schema.columns
   where table_schema = 'public' and table_name = 'aliados' and column_name = 'activo'
),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'tabla_aliados_presente', (to_regclass('public.aliados') is not null)::text, 'true',
         case when to_regclass('public.aliados') is not null then 'OK' else 'REVISAR' end
  union all
  select 2, 'migracion_238_no_aplicada',
         ((select n from columnas) = 0
          and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name in ('cotizacion_origen_id', 'grupo_conversion'))
          and to_regclass('public.ux_ventas_conversion_cotizacion_grupo') is null)::text,
         'true',
         case when (select n from columnas) = 0
                   and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name in ('cotizacion_origen_id', 'grupo_conversion'))
                   and to_regclass('public.ux_ventas_conversion_cotizacion_grupo') is null then 'OK' else 'REVISAR' end
  union all
  -- La venta B2B asistida reutiliza la comisión de reserva (205): su RPC y las columnas B2B de ventas deben existir.
  select 3, 'rpc_registrar_comision_b2b_reserva_ejecutable_por_authenticated',
         coalesce((select has_function_privilege('authenticated', f.oid, 'EXECUTE')::text
                     from pg_proc f where f.proname = 'registrar_comision_b2b_reserva' and f.pronamespace = 'public'::regnamespace limit 1), 'false'),
         'true',
         case when coalesce((select has_function_privilege('authenticated', f.oid, 'EXECUTE')
                               from pg_proc f where f.proname = 'registrar_comision_b2b_reserva' and f.pronamespace = 'public'::regnamespace limit 1), false) then 'OK' else 'REVISAR' end
  union all
  select 4, 'ventas_columnas_b2b_presentes',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas'
             and column_name in ('impuesto', 'modo_compra', 'comision_b2b', 'comision_estado', 'aliado_id', 'tipo_asesor', 'canal'))::text,
         '7',
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas'
                       and column_name in ('impuesto', 'modo_compra', 'comision_b2b', 'comision_estado', 'aliado_id', 'tipo_asesor', 'canal')) = 7 then 'OK' else 'REVISAR' end
  union all
  select 5, 'aliados_total', (select count(*) from al)::text, 'igual en el postcheck', 'INFO'
  union all
  -- Solo agencias y freelance se pueden cotizar como beneficiarios; otro tipo (o vacío) quedaría fuera del selector.
  select 6, 'aliados_con_tipo_distinto_de_agencia_o_freelance', (select count(*) from al where tipo is null or tipo not in ('agencia', 'freelance'))::text, '0',
         case when (select count(*) from al where tipo is null or tipo not in ('agencia', 'freelance')) = 0 then 'OK' else 'REVISAR' end
  union all
  select 7, 'aliados_sin_nombre', (select count(*) from al where nombre is null or btrim(nombre) = '')::text, '0',
         case when (select count(*) from al where nombre is null or btrim(nombre) = '') = 0 then 'OK' else 'REVISAR' end
  union all
  -- Un % propio fuera de 0..1 hace que la cotización B2B asistida se niegue a calcular (se corrige en /dashboard/aliados).
  select 8, 'aliados_con_pct_comision_fuera_de_0_a_1', (select count(*) from al where pct_comision is not null and (pct_comision < 0 or pct_comision > 1))::text, '0',
         case when (select count(*) from al where pct_comision is not null and (pct_comision < 0 or pct_comision > 1)) = 0 then 'OK' else 'REVISAR' end
  union all
  select 9, 'parametros_comision_general_presentes',
         (select count(*) from public.parametros_tributarios where parametro in ('COMISION_AGENCIA', 'COMISION_FREELANCE'))::text,
         '2 (si falta uno se usa 12 % agencia / 11 % freelance)',
         case when (select count(*) from public.parametros_tributarios where parametro in ('COMISION_AGENCIA', 'COMISION_FREELANCE')) = 2 then 'OK' else 'INFO' end
  union all
  select 10, 'huella_de_aliados_que_la_238_no_debe_tocar',
         md5(coalesce((select string_agg(id::text || ':' || coalesce(tipo, '') || ':' || coalesce(pct_comision::text, ''), '|' order by id) from al), '')),
         'igual en el postcheck', 'INFO'
  union all
  select 11, 'ventas_total', (select count(*) from vt)::text, 'igual en el postcheck', 'INFO'
  union all
  -- La 238 solo AGREGA columnas nullable a ventas: ningún contrato existente se toca (la huella se compara con la del postcheck).
  select 12, 'huella_de_ventas_que_la_238_no_debe_tocar',
         md5(coalesce((select string_agg(numero_contrato || ':' || coalesce(precio_venta::text, '') || ':' || coalesce(comision_b2b::text, ''), '|' order by numero_contrato) from vt), '')),
         'igual en el postcheck', 'INFO'
  union all
  select 13, 'cotizaciones_de_carrito_abiertas',
         (select count(*) from public.cotizaciones where tipo = 'carrito' and estado = 'abierta')::text,
         'las ya creadas siguen siendo B2C: la venta B2B asistida aplica solo a las nuevas', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
