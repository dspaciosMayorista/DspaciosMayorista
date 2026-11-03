-- PREFLIGHT de la 274 (#82, paquete 100 % dinámico). SOLO LECTURA. UNA consulta: control, observado, esperado, veredicto.
-- Todo debe dar OK antes de correr 20260601000274_paquete_dinamico_puro.sql.
select * from (
  select 1 as n, 'la 273 está aplicada (tarifario_resultado_composicion existe)' as control,
         coalesce(to_regclass('public.tarifario_resultado_composicion')::text, 'no existe') as observado, 'public.tarifario_resultado_composicion' as esperado,
         case when to_regclass('public.tarifario_resultado_composicion') is not null then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'las tablas de la 274 NO existen todavía (primera ejecución)',
         (select coalesce(string_agg(t, ','), 'ninguna') from unnest(array['paquete_din','paquete_din_vuelos','paquete_din_hoteles','paquete_din_servicios','cotizacion_versiones']) t where to_regclass('public.'||t) is not null),
         'ninguna (si ya existen, la 274 es re-ejecutable)',
         case when to_regclass('public.paquete_din') is null and to_regclass('public.cotizacion_versiones') is null then 'OK' else 'AVISO: ya existen' end
  union all
  select 3, 'la conversión controlada (216/242) existe',
         coalesce(to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)')::text, 'no existe'), 'convertir_cotizacion_manual_controlada(bigint,uuid)',
         case when to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)') is not null then 'OK' else 'FALLA' end
  union all
  select 4, 'crear_cotizacion_manual (216) existe',
         coalesce(to_regprocedure('public.crear_cotizacion_manual(uuid,text,jsonb,jsonb)')::text, 'no existe'), 'crear_cotizacion_manual(uuid,text,jsonb,jsonb)',
         case when to_regprocedure('public.crear_cotizacion_manual(uuid,text,jsonb,jsonb)') is not null then 'OK' else 'FALLA' end
  union all
  select 5, 'p39_priv.bloquear_para_editar (216) existe',
         coalesce(to_regprocedure('p39_priv.bloquear_para_editar(bigint,uuid,integer,text)')::text, 'no existe'), 'p39_priv.bloquear_para_editar(bigint,uuid,integer,text)',
         case when to_regprocedure('p39_priv.bloquear_para_editar(bigint,uuid,integer,text)') is not null then 'OK' else 'FALLA' end
  union all
  select 6, 'helpers de RLS y auditoría existen (mi_rol, puede_ver_tenant_cotizacion, fn_auditoria, fecha_negocio)',
         (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('mi_rol','puede_ver_tenant_cotizacion','fn_auditoria','fecha_negocio')),
         '4',
         case when (select count(distinct p.proname) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('mi_rol','puede_ver_tenant_cotizacion','fn_auditoria','fecha_negocio')) = 4 then 'OK' else 'FALLA' end
  union all
  select 7, 'tablas base que la 274 referencia existen (destinos, hoteles, servicios_adicionales, empaquetados, cotizaciones, cotizacion_servicios, ventas)',
         (select count(*)::text from unnest(array['destinos','hoteles','servicios_adicionales','empaquetados','cotizaciones','cotizacion_servicios','ventas']) t where to_regclass('public.'||t) is not null),
         '7',
         case when (select count(*) from unnest(array['destinos','hoteles','servicios_adicionales','empaquetados','cotizaciones','cotizacion_servicios','ventas']) t where to_regclass('public.'||t) is not null) = 7 then 'OK' else 'FALLA' end
  union all
  select 8, 'cotizaciones con servicios ya existentes NO se alteran (solo se agregan columnas con default)',
         (select count(*)::text from public.cotizacion_servicios), 'informativo', 'OK'
) q order by n;
