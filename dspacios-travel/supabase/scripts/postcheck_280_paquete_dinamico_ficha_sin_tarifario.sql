-- POSTCHECK de la 280 (#82). SOLO LECTURA. UNA consulta: control, observado, esperado, veredicto. Todo debe dar OK.
select * from (
  select 1 as n, 'hotel_vinculable_din solo exige ficha activa (no consulta tarifas, vigencias ni calculadora)' as control,
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'hotel_vinculable_din' and p.prosrc like '%activo is true%'
            and p.prosrc not like '%tarifa_hotel%' and p.prosrc not like '%hotel_temporadas%' and p.prosrc not like '%hotel_tarifas_unidad%' and p.prosrc not like '%hotel_calculadora%') as observado,
         '1' as esperado,
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'hotel_vinculable_din' and p.prosrc like '%activo is true%'
            and p.prosrc not like '%tarifa_hotel%' and p.prosrc not like '%hotel_temporadas%' and p.prosrc not like '%hotel_tarifas_unidad%' and p.prosrc not like '%hotel_calculadora%') = 1 then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'el trigger de moneda de la ficha ya no existe y el de vinculación sigue',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname = 'trg_din_hotel_moneda') || '|' || (select count(*)::text from pg_trigger where not tgisinternal and tgname = 'trg_din_hotel_vinculable'),
         '0|1',
         case when (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_din_hotel_moneda') = 0 and (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_din_hotel_vinculable') = 1 then 'OK' else 'FALLA' end
  union all
  select 3, 'restricción de longitud de categoría y plan existe',
         (select count(*)::text from pg_constraint where conname = 'paquete_din_hoteles_texto_check'), '1',
         case when (select count(*) from pg_constraint where conname = 'paquete_din_hoteles_texto_check') = 1 then 'OK' else 'FALLA' end
  union all
  select 4, 'hotel_vinculable_din y hoteles_vinculables_din no son ejecutables por anon y sí por authenticated',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('hotel_vinculable_din', 'hoteles_vinculables_din')
            and not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')),
         '2',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('hotel_vinculable_din', 'hoteles_vinculables_din')
            and not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')) = 2 then 'OK' else 'FALLA' end
) q order by n;
