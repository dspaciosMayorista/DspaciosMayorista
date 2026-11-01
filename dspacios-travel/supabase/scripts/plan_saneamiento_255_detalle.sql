-- DETALLE para decidir por paquete/servicio (SOLO LECTURA; tres SELECT independientes, ejecútalos por separado). Cambia los ids por los del caso.
-- Ejemplo del caso reportado: paquete 73, servicios 112 (incluido) y 1 (asistencia). No inventan datos: muestran lo cargado hoy.

-- D1. Vigencias y rangos cargados hoy de los servicios (nombre, fechas, precios y rangos de grupo de cada vigencia).
select t.servicio_id, s.nombre as servicio, t.nombre as vigencia, t.fecha_inicio, t.fecha_fin, t.precio_persona, t.precio_infante, t.recargo_individual,
       (select string_agg(r.pax_desde || '-' || r.pax_hasta || ' $' || r.precio, ', ' order by r.pax_desde)
          from public.servicio_tarifa_pax r where r.servicio_id = t.servicio_id and r.temporada = t.nombre) as rangos_grupo
  from public.servicio_temporadas t
  join public.servicios_adicionales s on s.id = t.servicio_id
 where t.servicio_id in (112, 1)
 order by t.servicio_id, t.fecha_inicio nulls last, t.nombre;

-- D2. Ventana del paquete, estado de su última generación y las fechas de ida de sus salidas (lo que evalúa un servicio INCLUIDO en bloqueo/dinámico).
select 'paquete' as que, p.id::text as ref, p.nombre as detalle, p.tipo::text as tipo, p.fecha_viaje_inicio as desde, p.fecha_viaje_fin as hasta,
       'activo=' || p.activo || ' estado=' || coalesce(p.tarifario_estado::text, '-') || ' generacion=' || coalesce(p.tarifario_generacion::text, '-') as estado
  from public.armado_paquetes p where p.id = 73
union all
select 'salida bloqueo', b.id::text, b.ruta, null, b.fecha_ida, b.fecha_regreso, null
  from public.armado_vuelos av join public.bloqueos_vuelo b on b.id = av.bloqueo_id where av.paquete_id = 73
union all
select 'salida empaquetado', e.id::text, e.ruta, null, e.fecha_ida, e.fecha_regreso, null
  from public.armado_empaquetados ae join public.empaquetados e on e.id = ae.empaquetado_id where ae.paquete_id = 73
union all
select 'salida dinámica', s.id::text, s.ruta, null, s.fecha_ida, s.fecha_regreso, 'activo=' || s.activo
  from public.salidas_dinamicas s where s.paquete_id = 73
order by 1, 5 nulls first;

-- D3. Qué hay PUBLICADO hoy del paquete (filas por módulo y servicio): es lo que se sigue viendo mientras no se regenere.
select t.modulo::text, t.servicio_id, count(*) as filas, min(t.precio_pvp) as pvp_min, max(t.precio_pvp) as pvp_max
  from public.tarifario_resultado t
 where t.paquete_id = 73
 group by t.modulo, t.servicio_id
 order by t.modulo, t.servicio_id;
