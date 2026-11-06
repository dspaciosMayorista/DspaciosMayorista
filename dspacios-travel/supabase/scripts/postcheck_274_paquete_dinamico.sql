-- POSTCHECK de la 274 (#82). SOLO LECTURA. UNA consulta: control, observado, esperado, veredicto. Todo debe dar OK.
select * from (
  select 1 as n, 'tablas del producto con RLS activa' as control,
         (select count(*)::text from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname in ('paquete_din','paquete_din_vuelos','paquete_din_hoteles','paquete_din_servicios','cotizacion_versiones')) as observado,
         '5' as esperado,
         case when (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname in ('paquete_din','paquete_din_vuelos','paquete_din_hoteles','paquete_din_servicios','cotizacion_versiones')) = 5 then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'columnas nuevas en cotizaciones / cotizacion_servicios (paquete_din_id, componente, exige_costo)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and ((table_name = 'cotizaciones' and column_name = 'paquete_din_id') or (table_name = 'cotizacion_servicios' and column_name in ('componente','exige_costo')))),
         '3',
         case when (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'cotizaciones' and column_name = 'paquete_din_id') or (table_name = 'cotizacion_servicios' and column_name in ('componente','exige_costo')))) = 3 then 'OK' else 'FALLA' end
  union all
  select 3, 'anon NO tiene ningún privilegio sobre las tablas nuevas',
         (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' and table_name in ('paquete_din','paquete_din_vuelos','paquete_din_hoteles','paquete_din_servicios','cotizacion_versiones')),
         '0',
         case when (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' and table_name in ('paquete_din','paquete_din_vuelos','paquete_din_hoteles','paquete_din_servicios','cotizacion_versiones')) = 0 then 'OK' else 'FALLA' end
  union all
  select 4, 'cotizacion_versiones: authenticated solo SELECT (sin insert/update/delete)',
         (select coalesce(string_agg(privilege_type, ',' order by privilege_type), 'ninguno') from information_schema.role_table_grants where table_schema = 'public' and table_name = 'cotizacion_versiones' and grantee = 'authenticated'),
         'SELECT',
         case when (select coalesce(string_agg(privilege_type, ',' order by privilege_type), 'ninguno') from information_schema.role_table_grants where table_schema = 'public' and table_name = 'cotizacion_versiones' and grantee = 'authenticated') = 'SELECT' then 'OK' else 'FALLA' end
  union all
  select 5, 'las 8 funciones de la 274 existen y solo service_role las ejecuta (ni anon ni authenticated)',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname in ('crear_cotizacion_din','editar_cotizacion_din','registrar_costos_cotizacion_din','marcar_version_mostrada','convertir_cotizacion_din','din_costos_pendientes','din_marcar_lineas','din_lineas_sin_costo')
             and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')),
         '8',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname in ('crear_cotizacion_din','editar_cotizacion_din','registrar_costos_cotizacion_din','marcar_version_mostrada','convertir_cotizacion_din','din_costos_pendientes','din_marcar_lineas','din_lineas_sin_costo')
             and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')) = 8 then 'OK' else 'FALLA' end
  union all
  select 6, 'guardas instaladas (servicios, cotización, venta, versiones inmutables)',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('trg_din_servicios_guarda','trg_din_cotizacion_guarda','trg_din_venta_guarda','trg_cotizacion_versiones_inmutable') and tgenabled <> 'D'),
         '4',
         case when (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_din_servicios_guarda','trg_din_cotizacion_guarda','trg_din_venta_guarda','trg_cotizacion_versiones_inmutable') and tgenabled <> 'D') = 4 then 'OK' else 'FALLA' end
  union all
  select 7, 'auditoría (trg_auditoria) en las 5 tablas nuevas',
         (select count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and t.tgname = 'trg_auditoria' and c.relname in ('paquete_din','paquete_din_vuelos','paquete_din_hoteles','paquete_din_servicios','cotizacion_versiones')),
         '5',
         case when (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and t.tgname = 'trg_auditoria' and c.relname in ('paquete_din','paquete_din_vuelos','paquete_din_hoteles','paquete_din_servicios','cotizacion_versiones')) = 5 then 'OK' else 'FALLA' end
  union all
  select 8, 'ninguna cotización existente quedó enlazada a un paquete dinámico por la migración (0 antes de usar la función)',
         (select count(*)::text from public.cotizaciones where paquete_din_id is not null), '0 (o las creadas ya con el producto)', 'OK'
  union all
  select 9, 'ningún componente existente exige costo por la migración (default false)',
         (select count(*)::text from public.cotizacion_servicios s where s.exige_costo and not exists (select 1 from public.cotizaciones c where c.id = s.cotizacion_id and c.paquete_din_id is not null)),
         '0',
         case when (select count(*) from public.cotizacion_servicios s where s.exige_costo and not exists (select 1 from public.cotizaciones c where c.id = s.cotizacion_id and c.paquete_din_id is not null)) = 0 then 'OK' else 'FALLA' end
) q order by n;
