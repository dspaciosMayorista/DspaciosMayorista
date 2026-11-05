-- PREFLIGHT de la 280 (#82). SOLO LECTURA. UNA consulta: control, observado, esperado, veredicto. FALLA = no correr la 280. AVISO = informativo.
select * from (
  select 1 as n, 'la 279 está aplicada (estrellas y ubicacion)' as control,
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'paquete_din_hoteles' and column_name in ('estrellas', 'ubicacion')) as observado,
         '2' as esperado,
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'paquete_din_hoteles' and column_name in ('estrellas', 'ubicacion')) = 2 then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'existen las funciones que la 280 reemplaza (275) y el trigger de moneda (276)',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('hotel_vinculable_din', 'tg_din_hotel_vinculable'))
           || '|' || (select count(*)::text from pg_trigger where not tgisinternal and tgname = 'trg_din_hotel_moneda'),
         '2|1 (si ya se aplicó: 2|0, es idempotente)',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('hotel_vinculable_din', 'tg_din_hotel_vinculable')) = 2 then 'OK' else 'FALLA' end
  union all
  select 3, 'hoteles del paquete con categoría o plan de más de 80 caracteres (la restricción nueva los rechazaría)',
         (select count(*)::text from public.paquete_din_hoteles where char_length(coalesce(categoria, '')) > 80 or char_length(coalesce(regimen, '')) > 80),
         '0',
         case when (select count(*) from public.paquete_din_hoteles where char_length(coalesce(categoria, '')) > 80 or char_length(coalesce(regimen, '')) > 80) = 0 then 'OK' else 'FALLA' end
  union all
  select 4, 'fichas activas hoy ofrecidas (sin tarifario) de las activas; el resto pasará a ofrecerse',
         (select count(*)::text from public.hoteles h where h.activo is true and not exists (select 1 from public.hotel_temporadas t where t.hotel_id = h.id)
            and not exists (select 1 from public.tarifa_hotel t where t.hotel_id = h.id) and not exists (select 1 from public.hotel_tarifas_unidad t where t.hotel_id = h.id)
            and not exists (select 1 from public.hotel_calculadora t where t.hotel_id = h.id)) || ' de ' || (select count(*)::text from public.hoteles where activo is true),
         'informativo', 'OK'
) q order by n;
