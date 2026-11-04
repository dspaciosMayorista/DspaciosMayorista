-- PREFLIGHT de la 277 (#82). SOLO LECTURA. UNA consulta: control, observado, esperado, veredicto. FALLA = no correr la 277. AVISO = informativo.
select * from (
  select 1 as n, 'la 276 está aplicada (multidestino, triggers de vuelo/servicio y guardado)' as control,
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('trg_din_paquete_reglas', 'trg_din_vuelo_reglas', 'trg_din_servicio_reglas', 'trg_din_publicar')) as observado,
         '4' as esperado,
         case when (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_din_paquete_reglas', 'trg_din_vuelo_reglas', 'trg_din_servicio_reglas', 'trg_din_publicar')) = 4 then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'la 277 aún no está aplicada (no existe paquete_din_hoteles.capacidad_ninos)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'paquete_din_hoteles' and column_name = 'capacidad_ninos'),
         '0 (si es 1, ya se aplicó: es idempotente)',
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'paquete_din_hoteles' and column_name = 'capacidad_ninos') = 0 then 'OK' else 'AVISO' end
  union all
  select 3, 'hoteles MANUALES ya guardados: quedarán sin capacidad/edades (se cotizan sin validar capacidad hasta volver a guardar el paquete)',
         (select count(*)::text from public.paquete_din_hoteles where hotel_id is null),
         'informativo', 'OK'
  union all
  select 4, 'hoteles manuales de paquetes PUBLICADOS sin capacidad/edades (conviene volver a guardarlos y publicar)',
         (select count(*)::text from public.paquete_din_hoteles h join public.paquete_din p on p.id = h.paquete_id where h.hotel_id is null and p.publicado),
         '0',
         case when (select count(*) from public.paquete_din_hoteles h join public.paquete_din p on p.id = h.paquete_id where h.hotel_id is null and p.publicado) = 0 then 'OK' else 'AVISO' end
) q order by n;
