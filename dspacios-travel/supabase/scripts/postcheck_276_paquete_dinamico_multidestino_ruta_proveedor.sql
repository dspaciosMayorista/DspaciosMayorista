-- POSTCHECK de la 276 (#82). SOLO LECTURA. UNA consulta: control, observado, esperado, veredicto. Todo debe dar OK.
select * from (
  select 1 as n, 'columnas nuevas: paquete_din.multidestino, vuelos.origen_iata/destino_iata, servicios.proveedor_id' as control,
         (select count(*)::text from information_schema.columns where table_schema = 'public' and ((table_name = 'paquete_din' and column_name = 'multidestino') or (table_name = 'paquete_din_vuelos' and column_name in ('origen_iata', 'destino_iata')) or (table_name = 'paquete_din_servicios' and column_name = 'proveedor_id'))) as observado,
         '4' as esperado,
         case when (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'paquete_din' and column_name = 'multidestino') or (table_name = 'paquete_din_vuelos' and column_name in ('origen_iata', 'destino_iata')) or (table_name = 'paquete_din_servicios' and column_name = 'proveedor_id'))) = 4 then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'los 5 triggers nuevos existen y están habilitados',
         (select count(*)::text from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('trg_din_paquete_reglas', 'trg_din_vuelo_reglas', 'trg_din_servicio_reglas', 'trg_din_hotel_moneda', 'trg_din_publicar')),
         '5',
         case when (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('trg_din_paquete_reglas', 'trg_din_vuelo_reglas', 'trg_din_servicio_reglas', 'trg_din_hotel_moneda', 'trg_din_publicar')) = 5 then 'OK' else 'FALLA' end
  union all
  select 3, 'guardar_paquete_din ya conoce multidestino y origen_iata (redefinida)',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'guardar_paquete_din' and p.prosrc like '%multidestino%' and p.prosrc like '%origen_iata%'),
         '1',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'guardar_paquete_din' and p.prosrc like '%multidestino%' and p.prosrc like '%origen_iata%') = 1 then 'OK' else 'FALLA' end
  union all
  select 8, 'hoteles_vinculables_din devuelve la moneda y solo la ejecutan usuarios autenticados',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'hoteles_vinculables_din' and pg_get_function_result(p.oid) like '%moneda%' and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')),
         '1',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'hoteles_vinculables_din' and pg_get_function_result(p.oid) like '%moneda%' and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')) = 1 then 'OK' else 'FALLA' end
  union all
  select 4, 'guardar_paquete_din sigue siendo SECURITY INVOKER (la RLS por agencia rige)',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'guardar_paquete_din' and not p.prosecdef),
         '1',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'guardar_paquete_din' and not p.prosecdef) = 1 then 'OK' else 'FALLA' end
  union all
  select 5, 'las funciones de trigger no son ejecutables por anon ni authenticated',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('tg_din_paquete_reglas', 'tg_din_vuelo_reglas', 'tg_din_servicio_reglas', 'tg_din_hotel_moneda', 'tg_din_publicar') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')),
         '5',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('tg_din_paquete_reglas', 'tg_din_vuelo_reglas', 'tg_din_servicio_reglas', 'tg_din_hotel_moneda', 'tg_din_publicar') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')) = 5 then 'OK' else 'FALLA' end
  union all
  select 6, 'ningún paquete con destinos adicionales quedó sin multidestino activado',
         (select count(*)::text from public.paquete_din where multidestino is false and coalesce(cardinality(destinos_extra), 0) > 0),
         '0',
         case when (select count(*) from public.paquete_din where multidestino is false and coalesce(cardinality(destinos_extra), 0) > 0) = 0 then 'OK' else 'FALLA' end
  union all
  select 7, 'las 275 siguen en pie: trigger de ficha vinculable y de destinos_extra',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('trg_din_hotel_vinculable', 'trg_din_destinos_extra_validos', 'trg_din_destino_extra_guard')),
         '3',
         case when (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_din_hotel_vinculable', 'trg_din_destinos_extra_validos', 'trg_din_destino_extra_guard')) = 3 then 'OK' else 'FALLA' end
  union all
  select 9, 'cotizar y publicar revisan vínculos desalineados (helper existe, solo service_role, y validar_solicitud lo usa)',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'p82_priv' and p.proname = 'vinculos_desalineados' and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute'))
           || '|' || (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'p82_priv' and p.proname = 'validar_solicitud' and p.prosrc like '%vinculos_desalineados%'),
         '1|1',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'p82_priv' and p.proname = 'vinculos_desalineados' and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')) = 1
              and (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'p82_priv' and p.proname = 'validar_solicitud' and p.prosrc like '%vinculos_desalineados%') = 1 then 'OK' else 'FALLA' end
) q order by n;
