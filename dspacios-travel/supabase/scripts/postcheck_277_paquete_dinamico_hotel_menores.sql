-- POSTCHECK de la 277 (#82). SOLO LECTURA. UNA consulta: control, observado, esperado, veredicto. Todo debe dar OK.
select * from (
  select 1 as n, 'columnas nuevas: hotel manual (capacidad_ninos, edad_infante_max, edad_nino_max) y servicios.pvp_infante' as control,
         (select count(*)::text from information_schema.columns where table_schema = 'public' and ((table_name = 'paquete_din_hoteles' and column_name in ('capacidad_ninos', 'edad_infante_max', 'edad_nino_max')) or (table_name = 'paquete_din_servicios' and column_name = 'pvp_infante'))) as observado,
         '4' as esperado,
         case when (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'paquete_din_hoteles' and column_name in ('capacidad_ninos', 'edad_infante_max', 'edad_nino_max')) or (table_name = 'paquete_din_servicios' and column_name = 'pvp_infante'))) = 4 then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'restricción de rangos y trigger del hotel manual existen y están habilitados',
         (select count(*)::text from pg_constraint where conname = 'paquete_din_hoteles_menores_check') || '|' || (select count(*)::text from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname = 'trg_din_hotel_menores'),
         '1|1',
         case when (select count(*) from pg_constraint where conname = 'paquete_din_hoteles_menores_check') = 1 and (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname = 'trg_din_hotel_menores') = 1 then 'OK' else 'FALLA' end
  union all
  select 3, 'guardar_paquete_din guarda capacidad y edades y sigue siendo SECURITY INVOKER',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'guardar_paquete_din' and not p.prosecdef and p.prosrc like '%capacidad_ninos%' and p.prosrc like '%multidestino%' and p.prosrc like '%pvp_infante%'),
         '1',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'guardar_paquete_din' and not p.prosecdef and p.prosrc like '%capacidad_ninos%' and p.prosrc like '%multidestino%' and p.prosrc like '%pvp_infante%') = 1 then 'OK' else 'FALLA' end
  union all
  select 4, 'la función del trigger no es ejecutable por anon ni authenticated',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'tg_din_hotel_menores' and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')),
         '1',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'tg_din_hotel_menores' and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')) = 1 then 'OK' else 'FALLA' end
) q order by n;
