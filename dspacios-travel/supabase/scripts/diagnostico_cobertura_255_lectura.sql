-- DIAGNÓSTICO DE COBERTURA 255/256 — SOLO LECTURA (SELECT independientes; ejecútalos por separado dentro de  begin read only; … rollback;).
-- Antes era una propuesta de saneamiento por UPDATE/INSERT: el dueño NO autoriza extender vigencias, copiar GENERAL ni poner tarifas en huecos sin respaldo del proveedor,
-- así que se retiraron las plantillas de escritura y el precheck/postcheck de datos. Solo queda lo que identifica los datos: ningún dato se corrige desde aquí.
-- La solución es de código (migración 256): un servicio sin vigencia deja de ofrecerse en esas fechas/salidas en vez de tumbar la generación del paquete.
-- NO es el diagnóstico del statement timeout del paquete 73 (eso vive en diagnostico_timeout_tarifario_73_lectura.sql).
-- Cambia los ids (73, 33; servicios 112, 1, 131, 50) por los del caso.

-- ═══ S0-A. Vigencias INVÁLIDAS en TODO el catálogo (fecha nula o fin < inicio). El auditor y el motor las ignoran: cuentan como «sin cobertura». ═══
select 'S0-A' as consulta, t.id as vigencia_id, t.servicio_id, s.nombre as servicio, t.nombre as vigencia, t.fecha_inicio, t.fecha_fin, t.precio_persona,
       t.precio_infante, t.recargo_individual, t.prioridad, t.compra_inicio, t.compra_fin, t.created_at,
       case when t.fecha_inicio is null or t.fecha_fin is null then 'FECHA_NULA' else 'FIN_ANTES_DE_INICIO' end as problema,
       (select string_agg(a.paquete_id || case when coalesce(a.incluido, false) then ' (incluido)' else ' (opcional)' end, ', ' order by a.paquete_id)
          from public.armado_servicios a where a.servicio_id = t.servicio_id) as paquetes_que_lo_usan
  from public.servicio_temporadas t
  join public.servicios_adicionales s on s.id = t.servicio_id
 where t.fecha_inicio is null or t.fecha_fin is null or t.fecha_fin < t.fecha_inicio
 order by t.servicio_id, t.id;

-- ═══ S0-B. Identidad exacta de TODAS las vigencias (y rangos de grupo) de los servicios del caso: 112 (paquete 73), 1 (asistencia, 73) y 50 (paquete 33). ═══
select 'S0-B' as consulta, t.servicio_id, s.nombre as servicio, t.id as vigencia_id, t.nombre as vigencia, t.fecha_inicio, t.fecha_fin, t.precio_persona,
       t.precio_infante, t.recargo_individual, t.prioridad, t.orden, t.compra_inicio, t.compra_fin, t.created_at,
       (select string_agg(r.pax_desde || '-' || r.pax_hasta || ' $' || r.precio, ', ' order by r.pax_desde)
          from public.servicio_tarifa_pax r where r.servicio_id = t.servicio_id and r.temporada = t.nombre) as rangos_grupo,
       (select string_agg(a.paquete_id || case when coalesce(a.incluido, false) then ' (incluido)' else ' (opcional)' end, ', ' order by a.paquete_id)
          from public.armado_servicios a where a.servicio_id = t.servicio_id) as paquetes_que_lo_usan
  from public.servicio_temporadas t
  join public.servicios_adicionales s on s.id = t.servicio_id
 where t.servicio_id in (112, 1, 131, 50)
 order by t.servicio_id, t.fecha_inicio nulls first, t.id;

-- ═══ S0-C. GENERAL de esos servicios (solo para SABER qué hay; NO se copia a ninguna vigencia). ═══
select 'S0-C' as consulta, s.id as servicio_id, s.nombre, s.precio_persona as general_persona, s.precio_infante as general_infante, s.recargo_individual as general_recargo, s.moneda
  from public.servicios_adicionales s where s.id in (112, 1, 131, 50) order by s.id;

-- ═══ S0-D. D3: qué hay PUBLICADO hoy de los paquetes 73 y 33 y el estado de su última generación. ═══
select 'S0-D' as consulta, p.id as paquete_id, p.nombre as paquete, p.tipo::text as tipo, coalesce(t.modulo::text, '(sin filas)') as modulo, t.servicio_id,
       count(t.*) as filas, min(t.precio_pvp) as pvp_min, max(t.precio_pvp) as pvp_max,
       'activo=' || p.activo || ' estado=' || coalesce(p.tarifario_estado::text, '-') || ' generacion=' || coalesce(p.tarifario_generacion::text, '-') as estado_paquete
  from public.armado_paquetes p
  left join public.tarifario_resultado t on t.paquete_id = p.id
 where p.id in (73, 33)
 group by p.id, p.nombre, p.tipo, p.activo, p.tarifario_estado, p.tarifario_generacion, t.modulo, t.servicio_id
 order by p.id, t.modulo, t.servicio_id;

-- ═══ S0-E. Salidas futuras SIN cobertura por (paquete, servicio) del caso, con la fecha exacta. Una fecha cuenta como cubierta solo si una vigencia VÁLIDA la contiene. ═══
with par(paquete_id, servicio_id) as (values (73, 112), (73, 1), (73, 131), (33, 50)),
hoy as (select (now() at time zone 'America/Bogota')::date as d),
salidas as (
  select p.paquete_id, b.fecha_ida as fecha, 'bloqueo' as origen from par p join public.armado_vuelos av on av.paquete_id = p.paquete_id join public.bloqueos_vuelo b on b.id = av.bloqueo_id
  union all select p.paquete_id, e.fecha_ida, 'empaquetado' from par p join public.armado_empaquetados ae on ae.paquete_id = p.paquete_id join public.empaquetados e on e.id = ae.empaquetado_id
  union all select p.paquete_id, s.fecha_ida, 'dinamica' from par p join public.salidas_dinamicas s on s.paquete_id = p.paquete_id where s.activo is true
)
select 'S0-E' as consulta, p.paquete_id, p.servicio_id, sa.origen, sa.fecha as fecha_ida,
       exists (select 1 from public.servicio_temporadas t where t.servicio_id = p.servicio_id and t.fecha_inicio is not null and t.fecha_fin is not null
                 and t.fecha_inicio <= sa.fecha and t.fecha_fin >= sa.fecha) as cubierta
  from par p join salidas sa on sa.paquete_id = p.paquete_id, hoy
 where sa.fecha >= hoy.d
 order by p.paquete_id, p.servicio_id, sa.fecha;

-- ═══ S0-F. CLASIFICACIÓN de los servicios del caso (asistencias 1 y 131; 50, 112, 132, 133) y si su tarifa base permanente aplicaría. ═══
-- Regla (256+): solo categoria = 'asistencia' SIN NINGUNA fila en servicio_temporadas usa su tarifa base en cualquier fecha; traslados/tours siempre exigen vigencia.
select 'S0-F' as consulta, s.id as servicio_id, s.nombre, s.categoria, s.moneda, s.precio_persona as base_persona,
       (select count(*) from public.servicio_tarifa_pax g where g.servicio_id = s.id and g.temporada = 'GENERAL') as rangos_general,
       (select count(*) from public.servicio_temporadas t where t.servicio_id = s.id) as vigencias_total,
       (select string_agg(a.paquete_id || case when a.incluido then ' incluido' else ' opcional' end, ', ' order by a.paquete_id) from public.armado_servicios a where a.servicio_id = s.id) as paquetes,
       case when s.categoria = 'asistencia' and not exists (select 1 from public.servicio_temporadas t where t.servicio_id = s.id)
                 and (s.precio_persona >= 0 or exists (select 1 from public.servicio_tarifa_pax g where g.servicio_id = s.id and g.temporada = 'GENERAL'))
            then 'TARIFA PERMANENTE (aplica en cualquier fecha)'
            when s.categoria = 'asistencia' and not exists (select 1 from public.servicio_temporadas t where t.servicio_id = s.id) then 'asistencia sin vigencias y SIN tarifa base válida: no se vende'
            when s.categoria = 'asistencia' then 'asistencia CON vigencias: solo ellas (la base no rellena huecos)'
            else 'exige vigencia' end as regla
  from public.servicios_adicionales s
 where s.id in (1, 131, 50, 112, 132, 133)
 order by s.id;
