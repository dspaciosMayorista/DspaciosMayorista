-- PREFLIGHT de la 279 (#82). SOLO LECTURA. UNA consulta: control, observado, esperado, veredicto. FALLA = no correr la 279. AVISO = informativo.
select * from (
  select 1 as n, 'la 277 está aplicada (capacidad_ninos y trigger del hotel manual)' as control,
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'paquete_din_hoteles' and column_name = 'capacidad_ninos') || '|' ||
         (select count(*)::text from pg_trigger where not tgisinternal and tgname = 'trg_din_hotel_menores') as observado,
         '1|1' as esperado,
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'paquete_din_hoteles' and column_name = 'capacidad_ninos') = 1
               and (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_din_hotel_menores') = 1 then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'la 279 aún no está aplicada (no existen estrellas/ubicacion en paquete_din_hoteles)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'paquete_din_hoteles' and column_name in ('estrellas', 'ubicacion')),
         '0 (si es 2, ya se aplicó: es idempotente)',
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'paquete_din_hoteles' and column_name in ('estrellas', 'ubicacion')) = 0 then 'OK' else 'AVISO' end
  union all
  select 3, 'hoteles del paquete ya guardados: quedarán sin estrellas/ubicación hasta volver a guardar el paquete (no se inventan valores)',
         (select count(*)::text from public.paquete_din_hoteles),
         'informativo', 'OK'
  union all
  select 4, 'la ficha de hotel tiene las columnas que se copian (hoteles.estrellas, descripcion, ubicacion)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'hoteles' and column_name in ('estrellas', 'descripcion', 'ubicacion')),
         '3',
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hoteles' and column_name in ('estrellas', 'descripcion', 'ubicacion')) = 3 then 'OK' else 'FALLA' end
) q order by n;
