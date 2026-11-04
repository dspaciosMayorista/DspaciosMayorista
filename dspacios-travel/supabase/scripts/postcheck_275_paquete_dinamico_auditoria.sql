-- POSTCHECK de la 275 (#82, auditoría). SOLO LECTURA. UNA consulta: control, observado, esperado, veredicto. Todo debe dar OK.
select * from (
  select 1 as n, 'las 4 políticas del producto filtran por agencia (usan puede_producto_din o heredan del padre)' as control,
         (select count(*)::text from pg_policies where schemaname = 'public' and policyname like '%: producto'
            and tablename in ('paquete_din','paquete_din_vuelos','paquete_din_hoteles','paquete_din_servicios')
            and (qual like '%puede_producto_din%' or qual like '%paquete_din p%')) as observado,
         '4' as esperado,
         case when (select count(*) from pg_policies where schemaname = 'public' and policyname like '%: producto'
            and tablename in ('paquete_din','paquete_din_vuelos','paquete_din_hoteles','paquete_din_servicios')
            and (qual like '%puede_producto_din%' or qual like '%paquete_din p%')) = 4 then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'ninguna de esas tablas conserva una política solo-por-rol (sin agencia)',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('paquete_din','paquete_din_vuelos','paquete_din_hoteles','paquete_din_servicios')
            and qual not like '%puede_producto_din%' and qual not like '%paquete_din p%'),
         '0',
         case when (select count(*) from pg_policies where schemaname = 'public' and tablename in ('paquete_din','paquete_din_vuelos','paquete_din_hoteles','paquete_din_servicios')
            and qual not like '%puede_producto_din%' and qual not like '%paquete_din p%') = 0 then 'OK' else 'FALLA' end
  union all
  select 3, 'funciones nuevas existen',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where (s.nspname = 'public' and p.proname in ('puede_producto_din','uso_destino_din','hotel_vinculable_din','hoteles_vinculables_din','crear_cotizacion_din_externa','guardar_paquete_din','tg_din_hotel_vinculable')) or (s.nspname = 'p82_priv' and p.proname = 'validar_solicitud')),
         '8',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where (s.nspname = 'public' and p.proname in ('puede_producto_din','uso_destino_din','hotel_vinculable_din','hoteles_vinculables_din','crear_cotizacion_din_externa','guardar_paquete_din','tg_din_hotel_vinculable')) or (s.nspname = 'p82_priv' and p.proname = 'validar_solicitud')) = 8 then 'OK' else 'FALLA' end
  union all
  select 4, 'crear_cotizacion_din_externa y la validación solo las ejecuta service_role (ni anon ni authenticated)',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where ((s.nspname = 'public' and p.proname = 'crear_cotizacion_din_externa') or (s.nspname = 'p82_priv' and p.proname = 'validar_solicitud'))
              and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')),
         '2',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where ((s.nspname = 'public' and p.proname = 'crear_cotizacion_din_externa') or (s.nspname = 'p82_priv' and p.proname = 'validar_solicitud'))
              and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')) = 2 then 'OK' else 'FALLA' end
  union all
  select 5, 'anon no ejecuta ninguna función de la 275 (public)',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
            and p.proname in ('puede_producto_din','uso_destino_din','hotel_vinculable_din','hoteles_vinculables_din','crear_cotizacion_din_externa','guardar_paquete_din') and has_function_privilege('anon', p.oid, 'execute')),
         '0',
         case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
            and p.proname in ('puede_producto_din','uso_destino_din','hotel_vinculable_din','hoteles_vinculables_din','crear_cotizacion_din_externa','guardar_paquete_din') and has_function_privilege('anon', p.oid, 'execute')) = 0 then 'OK' else 'FALLA' end
  union all
  select 6, 'trigger de hoteles vinculables instalado y habilitado',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname = 'trg_din_hotel_vinculable' and tgenabled <> 'D'), '1',
         case when (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_din_hotel_vinculable' and tgenabled <> 'D') = 1 then 'OK' else 'FALLA' end
  union all
  select 8, 'guardas de destinos_extra instaladas (validación de ids existentes y bloqueo de borrado)',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('trg_din_destinos_extra_validos','trg_din_destino_extra_guard') and tgenabled <> 'D'), '2',
         case when (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_din_destinos_extra_validos','trg_din_destino_extra_guard') and tgenabled <> 'D') = 2 then 'OK' else 'FALLA' end
  union all
  select 9, 'ningún paquete tiene destinos adicionales inexistentes',
         (select count(*)::text from public.paquete_din p where exists (select 1 from unnest(p.destinos_extra) x where not exists (select 1 from public.destinos d where d.id = x))), '0',
         case when (select count(*) from public.paquete_din p where exists (select 1 from unnest(p.destinos_extra) x where not exists (select 1 from public.destinos d where d.id = x))) = 0 then 'OK' else 'FALLA' end
  union all
  select 7, 'ningún paquete quedó publicado con fechas de compra ya vencidas sin que lo sepas (informativo)',
         (select count(*)::text from public.paquete_din where publicado and compra_fin is not null and compra_fin < public.fecha_negocio()), 'informativo (se rechazan al cotizar)', 'OK'
) q order by n;
