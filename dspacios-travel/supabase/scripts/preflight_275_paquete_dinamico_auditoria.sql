-- PREFLIGHT de la 275 (#82, auditoría). SOLO LECTURA. UNA consulta: control, observado, esperado, veredicto.
-- Todo debe dar OK (o AVISO informativo) antes de correr 20260601000275_paquete_dinamico_auditoria.sql.
select * from (
  select 1 as n, 'la 274 está aplicada (tablas del producto)' as control,
         (select count(*)::text from unnest(array['paquete_din','paquete_din_vuelos','paquete_din_hoteles','paquete_din_servicios','cotizacion_versiones']) t where to_regclass('public.'||t) is not null) as observado,
         '5' as esperado,
         case when (select count(*) from unnest(array['paquete_din','paquete_din_vuelos','paquete_din_hoteles','paquete_din_servicios','cotizacion_versiones']) t where to_regclass('public.'||t) is not null) = 5 then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'funciones de la 274 que la 275 reemplaza o usa existen',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('crear_cotizacion_din','din_marcar_lineas','din_lineas_sin_costo','din_costos_pendientes')),
         '4',
         case when (select count(distinct p.proname) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('crear_cotizacion_din','din_marcar_lineas','din_lineas_sin_costo','din_costos_pendientes')) = 4 then 'OK' else 'FALLA' end
  union all
  select 3, 'tablas de tarifas de hotel que definen «ficha vinculable» existen',
         (select count(*)::text from unnest(array['hoteles','hotel_temporadas','tarifa_hotel','hotel_tarifas_unidad','hotel_calculadora']) t where to_regclass('public.'||t) is not null),
         '5',
         case when (select count(*) from unnest(array['hoteles','hotel_temporadas','tarifa_hotel','hotel_tarifas_unidad','hotel_calculadora']) t where to_regclass('public.'||t) is not null) = 5 then 'OK' else 'FALLA' end
  union all
  select 4, 'helpers de rol/agencia existen (mi_rol, mi_tenant, fecha_negocio, p39_priv.validar_servicios)',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where (s.nspname = 'public' and p.proname in ('mi_rol','mi_tenant','fecha_negocio')) or (s.nspname = 'p39_priv' and p.proname = 'validar_servicios')),
         '4',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where (s.nspname = 'public' and p.proname in ('mi_rol','mi_tenant','fecha_negocio')) or (s.nspname = 'p39_priv' and p.proname = 'validar_servicios')) = 4 then 'OK' else 'FALLA' end
  union all
  select 5, 'paquetes dinámicos ya cargados (informativo: la 275 los deja SIN cambios, pero los vigentes se revisan contra las reglas al cotizar)',
         (select count(*)::text from public.paquete_din), 'informativo', 'OK'
  union all
  select 6, 'paquetes publicados con un hotel ficha que ya tiene vigencias/tarifas (la 275 los rechazará al volver a guardarlos; no se borran)',
         (select count(*)::text from public.paquete_din_hoteles h where h.hotel_id is not null and (
            exists (select 1 from public.hotel_temporadas t where t.hotel_id = h.hotel_id) or exists (select 1 from public.tarifa_hotel t where t.hotel_id = h.hotel_id)
            or exists (select 1 from public.hotel_tarifas_unidad t where t.hotel_id = h.hotel_id) or exists (select 1 from public.hotel_calculadora t where t.hotel_id = h.hotel_id))),
         '0 (si no es 0: revisar y cambiar a hotel manual)',
         case when (select count(*) from public.paquete_din_hoteles h where h.hotel_id is not null and (
            exists (select 1 from public.hotel_temporadas t where t.hotel_id = h.hotel_id) or exists (select 1 from public.tarifa_hotel t where t.hotel_id = h.hotel_id)
            or exists (select 1 from public.hotel_tarifas_unidad t where t.hotel_id = h.hotel_id) or exists (select 1 from public.hotel_calculadora t where t.hotel_id = h.hotel_id))) = 0 then 'OK' else 'AVISO' end
  union all
  select 7, 'paquetes con agencia distinta de mayorista/minorista (la RLS por agencia los dejaría inaccesibles)',
         (select count(*)::text from public.paquete_din where tenant not in ('mayorista','minorista')), '0',
         case when (select count(*) from public.paquete_din where tenant not in ('mayorista','minorista')) = 0 then 'OK' else 'FALLA' end
union all
  select 8, 'paquetes con destinos adicionales que ya no existen (la 275 los rechazará al guardar; revisar y limpiar)',
         (select count(*)::text from public.paquete_din p where exists (select 1 from unnest(p.destinos_extra) x where not exists (select 1 from public.destinos d where d.id = x))), '0',
         case when (select count(*) from public.paquete_din p where exists (select 1 from unnest(p.destinos_extra) x where not exists (select 1 from public.destinos d where d.id = x))) = 0 then 'OK' else 'AVISO' end
) q order by n;
