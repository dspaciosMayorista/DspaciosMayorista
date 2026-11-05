-- POSTCHECK de la 279 (#82). SOLO LECTURA. UNA consulta: control, observado, esperado, veredicto. Todo debe dar OK.
select * from (
  select 1 as n, 'columnas nuevas paquete_din_hoteles.estrellas y .ubicacion' as control,
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'paquete_din_hoteles' and column_name in ('estrellas', 'ubicacion')) as observado,
         '2' as esperado,
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'paquete_din_hoteles' and column_name in ('estrellas', 'ubicacion')) = 2 then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'restricción de rangos (estrellas 1–5, ubicación ≤ 500) existe',
         (select count(*)::text from pg_constraint where conname = 'paquete_din_hoteles_info_check'),
         '1',
         case when (select count(*) from pg_constraint where conname = 'paquete_din_hoteles_info_check') = 1 then 'OK' else 'FALLA' end
  union all
  select 3, 'guardar_paquete_din guarda estrellas/ubicación, conserva lo anterior (capacidad, multidestino, pvp_infante) y sigue SECURITY INVOKER',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'guardar_paquete_din' and not p.prosecdef
            and p.prosrc like '%r.estrellas%' and p.prosrc like '%r.ubicacion%' and p.prosrc like '%capacidad_ninos%' and p.prosrc like '%multidestino%' and p.prosrc like '%pvp_infante%'),
         '1',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'guardar_paquete_din' and not p.prosecdef
            and p.prosrc like '%r.estrellas%' and p.prosrc like '%r.ubicacion%' and p.prosrc like '%capacidad_ninos%' and p.prosrc like '%multidestino%' and p.prosrc like '%pvp_infante%') = 1 then 'OK' else 'FALLA' end
  union all
  select 4, 'guardar_paquete_din no es ejecutable por anon',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'guardar_paquete_din' and not has_function_privilege('anon', p.oid, 'execute')),
         '1',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'guardar_paquete_din' and not has_function_privilege('anon', p.oid, 'execute')) = 1 then 'OK' else 'FALLA' end
) q order by n;
