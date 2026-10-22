-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 226 · tarifa de infante. SOLO LECTURA (read only + ROLLBACK).
-- Correr DESPUÉS de aplicar la 226. UNA fila consolidada: veredicto OK si todos los controles dan verdadero.
--   C1  las 4 columnas nuevas existen con su tipo y nulabilidad (fee_infante not null default 0; precio_infante y
--       precio_pvp_menor2 nullable)
--   C2  los 4 CHECK (>= 0) están presentes
--   C3  publicar_tarifario_resultado: SECURITY DEFINER, search_path fijo, persiste precio_pvp_menor2 y CONSERVA las
--       guardas de la 181 (rol interno, generación, revisión de fuente, moneda gobernada); ACL intacta
--   C4  crear_bloqueo: SECURITY DEFINER, acepta fee_infante y conserva la autorización AUT-1 y la creación de sillas; ACL intacta
--   C5  tarifario_resultado_publicable: security_barrier, sin security_invoker, expone precio_pvp_menor2 como ÚLTIMA
--       columna y conserva el filtro de publicable Y activo; ACL intacta (anon/authenticated/service_role solo SELECT)
--   C6  tarifario_resumen: security_invoker, precio_infante sale del precio del menor de 2 años; ACL intacta
--   C7  los triggers de invalidación de servicios_adicionales, bloqueos_vuelo y empaquetados escuchan la columna nueva;
--       la función del catálogo de servicios la compara
--   C8  los demás triggers de invalidación siguen presentes (tarifa_hotel, hotel_temporadas, servicio_tarifa_pax,
--       servicio_temporadas, salidas_dinamicas) y las funciones de trigger no son ejecutables por los roles de la API
--   C9  las policies de lectura/escritura de tarifario_resultado y la RLS de las tablas tocadas siguen presentes
--   C10 las columnas nuevas viven SOLO donde corresponde (sin columnas con esos nombres en otras tablas)
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
-- SOLO tablas base: information_schema.columns incluye también las VISTAS, y ahí ya existen columnas con esos nombres
-- bien puestas (fee_infante en empaquetados_basica, 224; precio_infante en tarifario_resumen, 162/182).
cols as (
  select c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
   where c.table_schema = 'public'
),
prof as (
  select p.proname, p.prosecdef, p.proconfig, p.prosrc, p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
),
c as (
  select 'C1' as codigo,
         exists (select 1 from cols where table_name = 'bloqueos_vuelo' and column_name = 'fee_infante' and data_type = 'numeric'
                  and is_nullable = 'NO' and column_default like '0%')
         and exists (select 1 from cols where table_name = 'servicios_adicionales' and column_name = 'precio_infante' and data_type = 'numeric' and is_nullable = 'YES')
         and exists (select 1 from cols where table_name = 'servicio_temporadas' and column_name = 'precio_infante' and data_type = 'numeric' and is_nullable = 'YES')
         and exists (select 1 from cols where table_name = 'tarifario_resultado' and column_name = 'precio_pvp_menor2' and data_type = 'numeric' and is_nullable = 'YES') as ok,
         'Columnas nuevas con tipo y nulabilidad correctos' as detalle
  union all
  select 'C2',
         (select count(*) from pg_constraint where contype = 'c' and conname in (
            'bloqueos_vuelo_fee_infante_chk', 'servicios_adicionales_precio_infante_chk',
            'servicio_temporadas_precio_infante_chk', 'tarifario_resultado_precio_pvp_menor2_chk')) = 4,
         'Los 4 CHECK (>= 0) presentes'
  union all
  select 'C3',
         exists (select 1 from prof where proname = 'publicar_tarifario_resultado' and prosecdef
                  and coalesce(proconfig::text, '') like '%search_path%'
                  and prosrc like '%precio_pvp_menor2%'
                  and prosrc like '%mi_rol()%' and prosrc like '%tarifario_generacion%' and prosrc like '%tarifario_revision_fuente%'
                  and prosrc like '%p_moneda%' and prosrc like '%tarifario_snapshot_publicable%')
         and not has_function_privilege('anon', 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)', 'EXECUTE'),
         'Publicador atómico con la columna nueva y las guardas de la 181 intactas'
  union all
  select 'C4',
         exists (select 1 from prof where proname = 'crear_bloqueo' and prosecdef
                  and coalesce(proconfig::text, '') like '%search_path%'
                  and prosrc like '%fee_infante%' and prosrc like '%_vuelos_actor()%' and prosrc like '%generate_series%')
         and not has_function_privilege('anon', 'public.crear_bloqueo(jsonb, integer)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.crear_bloqueo(jsonb, integer)', 'EXECUTE'),
         'crear_bloqueo acepta fee_infante y conserva AUT-1 y la creación atómica de sillas'
  union all
  select 'C5',
         exists (select 1 from pg_class cl
                  where cl.oid = to_regclass('public.tarifario_resultado_publicable') and cl.relkind = 'v'
                    and coalesce(cl.reloptions @> array['security_barrier=true'], false)
                    and not coalesce(cl.reloptions @> array['security_invoker=true'], false))
         and (select column_name from information_schema.columns
               where table_schema = 'public' and table_name = 'tarifario_resultado_publicable'
               order by ordinal_position desc limit 1) = 'precio_pvp_menor2'
         and coalesce(pg_get_viewdef(to_regclass('public.tarifario_resultado_publicable'), true), '') ~* 'tarifario_snapshot_publicable'
         and coalesce(pg_get_viewdef(to_regclass('public.tarifario_resultado_publicable'), true), '') ~* 'activo'
         and has_table_privilege('anon', 'public.tarifario_resultado_publicable', 'SELECT')
         and has_table_privilege('authenticated', 'public.tarifario_resultado_publicable', 'SELECT')
         and has_table_privilege('service_role', 'public.tarifario_resultado_publicable', 'SELECT')
         and not has_table_privilege('anon', 'public.tarifario_resultado_publicable', 'INSERT')
         and not has_table_privilege('anon', 'public.tarifario_resultado_publicable', 'UPDATE')
         and not has_table_privilege('anon', 'public.tarifario_resultado_publicable', 'DELETE')
         and not has_table_privilege('authenticated', 'public.tarifario_resultado_publicable', 'INSERT')
         and not has_table_privilege('authenticated', 'public.tarifario_resultado_publicable', 'UPDATE')
         and not has_table_privilege('authenticated', 'public.tarifario_resultado_publicable', 'DELETE'),
         'Vista publicable: security_barrier, columna nueva al final, filtro publicable Y activo, ACL de solo lectura'
  union all
  select 'C6',
         exists (select 1 from pg_class cl
                  where cl.oid = to_regclass('public.tarifario_resumen') and cl.relkind = 'v'
                    and coalesce(cl.reloptions @> array['security_invoker=true'], false))
         and coalesce(pg_get_viewdef(to_regclass('public.tarifario_resumen'), true), '') ~* 'precio_pvp_menor2'
         and has_table_privilege('anon', 'public.tarifario_resumen', 'SELECT')
         and has_table_privilege('authenticated', 'public.tarifario_resumen', 'SELECT')
         and not has_table_privilege('anon', 'public.tarifario_resumen', 'INSERT')
         and not has_table_privilege('authenticated', 'public.tarifario_resumen', 'INSERT'),
         'tarifario_resumen: precio_infante = precio del menor de 2 años; ACL de solo lectura'
  union all
  select 'C7',
         (select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgname = 'tarifario_trg_servicios_adicionales' and not t.tgisinternal and t.tgrelid = 'public.servicios_adicionales'::regclass) like '%precio_infante%'
         and (select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgname = 'tarifario_trg_bloqueos_vuelo' and not t.tgisinternal and t.tgrelid = 'public.bloqueos_vuelo'::regclass) like '%fee_infante%'
         and (select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgname = 'tarifario_trg_empaquetados' and not t.tgisinternal and t.tgrelid = 'public.empaquetados'::regclass) like '%fee_infante%'
         and exists (select 1 from prof where proname = 'tarifario_trg_bump_servicio_catalogo' and prosrc like '%precio_infante%' and prosecdef),
         'Triggers de invalidación escuchan fee_infante y precio_infante'
  union all
  select 'C8',
         (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in (
            'tarifario_trg_tarifa_hotel', 'tarifario_trg_hotel_temporadas', 'tarifario_trg_servicio_tarifa_pax',
            'tarifario_trg_servicio_temporadas', 'tarifario_trg_salidas_dinamicas', 'tarifario_trg_armado_hoteles',
            'tarifario_trg_armado_vuelos', 'tarifario_trg_armado_servicios', 'tarifario_trg_armado_empaquetados')) = 9
         and not exists (select 1 from prof where proname in (
            'tarifario_trg_bump_servicio_catalogo', 'tarifario_trg_bump_por_bloqueo', 'tarifario_trg_bump_por_empaquetado')
            and (has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE'))),
         'Los demás triggers de invalidación siguen presentes y las funciones de trigger no son invocables por la API'
  union all
  select 'C9',
         exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tarifario_resultado'
                  and policyname = 'tarifario_resultado: lectura' and qual like '%tarifario_paquete_publicable%')
         and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'tarifario_resultado' and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')) >= 1
         and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.tarifario_resultado')), false)
         and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.bloqueos_vuelo')), false)
         and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.servicios_adicionales')), false),
         'Policies y RLS de las tablas tocadas conservadas'
  union all
  select 'C10',
         not exists (select 1 from cols
                      where (column_name = 'precio_infante' and table_name not in ('servicios_adicionales', 'servicio_temporadas'))
                         or (column_name = 'precio_pvp_menor2' and table_name not in ('tarifario_resultado'))
                         or (column_name = 'fee_infante' and table_name not in ('bloqueos_vuelo', 'empaquetados', 'salidas_dinamicas'))),
         'Las columnas nuevas viven solo donde corresponde (solo tablas base; las vistas no cuentan)'
),
-- Un NULL (objeto ausente) cuenta como FALLA: bool_and ignoraría los NULL.
c2 as (select codigo, coalesce(ok, false) as ok, detalle from c)
select case when bool_and(ok) then 'OK' else 'FALLA' end as veredicto,
       count(*) filter (where ok) as ok,
       count(*) filter (where not ok) as fallos,
       count(*) as chequeos,
       coalesce(string_agg(codigo, ',' order by length(codigo), codigo) filter (where not ok), 'ninguno') as fallidos,
       string_agg(codigo || '=' || case when ok then 't' else 'f' end, ';' order by length(codigo), codigo) as resumen,
       jsonb_agg(jsonb_build_object('codigo', codigo, 'ok', ok, 'detalle', detalle) order by length(codigo), codigo) as detalle
  from c2;

rollback;
