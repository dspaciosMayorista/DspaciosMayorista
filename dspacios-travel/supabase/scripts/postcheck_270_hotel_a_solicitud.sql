-- POSTCHECK 270 (#120) · SOLO LECTURA · UNA consulta integral: n · control · observado · esperado · estado. Pegar COMPLETA en el editor SQL (sin begin/rollback).
-- Última fila (n = 99) = VEREDICTO GLOBAL: «270 CORRECTA» solo si ninguna fila es FALLA. Verifica el ESTADO FINAL de la 270 (esquema, permisos, candados) y que NO clasificó ningún hotel.
with
fn(proname, doc) as (values ('tg_hotel_bajo_solicitud', 'trigger'), ('tg_tarifa_hotel_no_bajo_solicitud', 'trigger'), ('tg_cotizacion_pendiente_tarifa', 'trigger'), ('cargar_neta_solicitud', 'rpc')),
fninfo as (
  select f.proname, f.doc, p.oid, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as cfg,
         has_function_privilege('anon', p.oid, 'execute') as anon_x, has_function_privilege('authenticated', p.oid, 'execute') as auth_x,
         (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) as public_x
    from fn f left join pg_proc p on p.pronamespace = 'public'::regnamespace and p.proname = f.proname
),
tg(tgname, tabla) as (values ('trg_hotel_bajo_solicitud', 'hoteles'), ('trg_tarifa_hotel_no_bajo_solicitud', 'tarifa_hotel'), ('trg_cotizacion_pendiente_tarifa', 'cotizaciones'), ('trg_auditoria', 'cotizacion_tarifa_solicitud')),
filas as (
  select 1 as n, 'hoteles.tarifa_bajo_solicitud: boolean NOT NULL DEFAULT false' as control,
         coalesce((select data_type || ' · nullable=' || is_nullable || ' · default=' || coalesce(column_default, 'null') from information_schema.columns where table_schema = 'public' and table_name = 'hoteles' and column_name = 'tarifa_bajo_solicitud'), 'AUSENTE') as observado,
         'boolean · nullable=NO · default=false' as esperado,
         coalesce((select data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false' from information_schema.columns where table_schema = 'public' and table_name = 'hoteles' and column_name = 'tarifa_bajo_solicitud'), false) as ok, null::text as nivel
  union all select 2, 'SIN backfill ni clasificación automática: hoteles marcados justo tras aplicar (0 salvo que ya los hayas marcado a mano después)',
         (select count(*) from public.hoteles where tarifa_bajo_solicitud)::text, '0', (select count(*) from public.hoteles where tarifa_bajo_solicitud) = 0, 'REVISAR'
  union all select 3, 'CHECK hoteles_bajo_solicitud_no_unidad presente y ningún hotel por unidad marcado',
         (select count(*) from pg_constraint where conname = 'hoteles_bajo_solicitud_no_unidad' and conrelid = 'public.hoteles'::regclass)::text || ' · violan=' || (select count(*) from public.hoteles where tarifa_bajo_solicitud and modelo_tarifario = 'unidad')::text,
         '1 · violan=0',
         (select count(*) from pg_constraint where conname = 'hoteles_bajo_solicitud_no_unidad' and conrelid = 'public.hoteles'::regclass) = 1 and (select count(*) from public.hoteles where tarifa_bajo_solicitud and modelo_tarifario = 'unidad') = 0, null
  union all select 4, 'cotizacion_tarifa_solicitud: existe, RLS activa y unique (cotizacion_id, item_ref)',
         (to_regclass('public.cotizacion_tarifa_solicitud') is not null)::text || ' · rls=' || coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.cotizacion_tarifa_solicitud')), 'n/a')
           || ' · unique=' || (select count(*) from pg_constraint where conrelid = to_regclass('public.cotizacion_tarifa_solicitud') and contype = 'u')::text,
         'true · rls=true · unique=1',
         to_regclass('public.cotizacion_tarifa_solicitud') is not null and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.cotizacion_tarifa_solicitud')), false)
           and (select count(*) from pg_constraint where conrelid = to_regclass('public.cotizacion_tarifa_solicitud') and contype = 'u') = 1, null
  union all select 5, 'cotizacion_tarifa_solicitud: anon sin ningún permiso; authenticated solo SELECT (la escribe únicamente la RPC)',
         'anon=' || (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'cotizacion_tarifa_solicitud' and grantee = 'anon')::text
           || ' · authenticated_escritura=' || (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'cotizacion_tarifa_solicitud' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))::text,
         'anon=0 · authenticated_escritura=0',
         (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'cotizacion_tarifa_solicitud' and grantee = 'anon') = 0
           and (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'cotizacion_tarifa_solicitud' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')) = 0, null
  union all select 6, 'política de lectura de cotizacion_tarifa_solicitud (producto + tenant)',
         (select count(*) from pg_policies where schemaname = 'public' and tablename = 'cotizacion_tarifa_solicitud' and cmd = 'SELECT')::text, '1',
         (select count(*) from pg_policies where schemaname = 'public' and tablename = 'cotizacion_tarifa_solicitud' and cmd = 'SELECT') = 1, null
  union all select 7, 'funciones de la 270: SECURITY DEFINER con search_path fijo',
         (select count(*) filter (where oid is not null and prosecdef and cfg like '%search_path%') from fninfo)::text || '/4', '4/4',
         (select count(*) filter (where oid is not null and prosecdef and cfg like '%search_path%') from fninfo) = 4, null
  union all select 8, 'funciones de trigger: nadie puede ejecutarlas por API (ni anon, ni authenticated, ni PUBLIC)',
         (select count(*) filter (where doc = 'trigger' and (anon_x or auth_x or public_x)) from fninfo)::text, '0',
         (select count(*) filter (where doc = 'trigger' and (anon_x or auth_x or public_x)) from fninfo) = 0, null
  union all select 9, 'cargar_neta_solicitud: ejecutable por authenticated y NO por anon ni PUBLIC',
         'auth=' || coalesce((select auth_x::text from fninfo where proname = 'cargar_neta_solicitud'), 'n/a') || ' · anon=' || coalesce((select anon_x::text from fninfo where proname = 'cargar_neta_solicitud'), 'n/a') || ' · public=' || coalesce((select public_x::text from fninfo where proname = 'cargar_neta_solicitud'), 'n/a'),
         'auth=true · anon=false · public=false',
         coalesce((select auth_x and not anon_x and not public_x from fninfo where proname = 'cargar_neta_solicitud'), false), null
  union all select 10, 'disparadores presentes (3 candados + auditoría)',
         (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join tg on tg.tgname = t.tgname and tg.tabla = c.relname where not t.tgisinternal)::text || '/4', '4/4',
         (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join tg on tg.tgname = t.tgname and tg.tabla = c.relname where not t.tgisinternal) = 4, null
  union all select 11, 'candado de estado: ninguna cotización pendiente_tarifa con precio, contrato o neta ya cargada',
         (select count(*) from public.cotizaciones c where c.estado = 'pendiente_tarifa' and (coalesce(c.precio_venta, 0) <> 0 or c.numero_contrato is not null or exists (select 1 from public.cotizacion_tarifa_solicitud t where t.cotizacion_id = c.id)))::text, '0',
         (select count(*) from public.cotizaciones c where c.estado = 'pendiente_tarifa' and (coalesce(c.precio_venta, 0) <> 0 or c.numero_contrato is not null or exists (select 1 from public.cotizacion_tarifa_solicitud t where t.cotizacion_id = c.id))) = 0, null
  union all select 12, 'coherencia: toda neta cargada tiene su cotización abierta/convertida con el mismo precio congelado',
         (select count(*) from public.cotizacion_tarifa_solicitud t left join public.cotizaciones c on c.id = t.cotizacion_id where c.id is null or c.precio_venta is distinct from t.precio_venta)::text, '0',
         (select count(*) from public.cotizacion_tarifa_solicitud t left join public.cotizaciones c on c.id = t.cotizacion_id where c.id is null or c.precio_venta is distinct from t.precio_venta) = 0, null
  union all select 13, 'invariante: ningún hotel marcado tiene tarifas en tarifa_hotel',
         (select count(*) from public.hoteles h where h.tarifa_bajo_solicitud and exists (select 1 from public.tarifa_hotel t where t.hotel_id = h.id))::text, '0',
         (select count(*) from public.hoteles h where h.tarifa_bajo_solicitud and exists (select 1 from public.tarifa_hotel t where t.hotel_id = h.id)) = 0, null
)
select n, control, observado, esperado, case when ok then 'OK' else coalesce(nivel, 'FALLA') end as estado from filas
union all
select 99, 'VEREDICTO GLOBAL', case when count(*) filter (where not ok and nivel is null) = 0 then '270 CORRECTA' else '270 CON FALLAS' end, '270 CORRECTA',
       case when count(*) filter (where not ok and nivel is null) = 0 then 'OK' else 'FALLA' end from filas
order by n;
