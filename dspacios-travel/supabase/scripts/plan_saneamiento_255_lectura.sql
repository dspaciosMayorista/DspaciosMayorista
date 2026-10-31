-- PLAN DE SANEAMIENTO 255/256 — SOLO LECTURA (UNA consulta SELECT; no crea, no modifica, no propone valores, fechas ni tarifas).
-- Reutiliza TAL CUAL las reglas de auditoria_255_servicios_sin_vigencia.sql (mismas CTE) y las agrupa para ver el efecto por servicio compartido, por paquete y por salida.
-- Pégalo dentro de:  begin read only;  <consulta>  rollback;
-- Con la 256 un hueco ya no tumba la generación: los opcionales se ofrecen solo donde hay vigencia y un incluido sin vigencia impide publicar/reservar solo las salidas
-- afectadas. Cada fila es una vista distinta (columna «vista»); filtra por ella en el editor:
--   A_servicio            = una fila por SERVICIO compartido con algún vínculo con problema. «afectados» cuenta los vínculos con problema; el detalle lista los paquetes que hoy
--                           están OK y también usan el servicio (cualquier cambio de vigencia los toca: puede cambiar su precio «desde»).
--   B_paquete             = una fila por PAQUETE con servicios con problema (cuántos son incluidos y cuántos opcionales).
--   C_incluido            = cada servicio INCLUIDO con problema, con ventana/salidas evaluadas, vigencias existentes, primer hueco y efecto (en qué salidas se OMITE y en cuáles va incluido y cobrado).
--   D_opcional_publicado  = opcionales con problema que YA tienen filas publicadas: al regenerar con la 256 se ocultan o quedan solo en sus tramos.
--   E_paquete_oferta      = por PAQUETE ACTIVO: estado_oferta = OFERTA_COMPLETA (todas las salidas con TODOS sus incluidos cobrados) / OFERTA_CON_SERVICIOS_OMITIDOS (todas las salidas
--                           se ofrecen; en algunas falta algún incluido por falta de tarifa vigente: se ofrece SIN ese servicio) / OFERTA_SIN_SERVICIOS (todas se ofrecen sin algún incluido) /
--                           SIN_OFERTA (solo por error de configuración: un incluido con vigencias ambiguas en porción terrestre) / SIN_SALIDAS. «dias_sin_cobertura» = salidas sin algún incluido.
-- columnas: vigencias_existentes = lo cargado hoy (nombre [inicio a fin] precio); primer_hueco = primera fecha sin vigencia; afectados = vínculos o servicios.
-- Las decisiones (acortar la ventana, crear/ampliar una vigencia confirmada por el proveedor, o retirar el servicio) son del operador: esta consulta solo muestra los datos.
-- Un incluido SIN tarifa vigente nunca tumba el paquete: se omite de esa salida (no entra al PVP, al costo ni a la CxP, ni a «Incluye»/documentos) y el paquete se ofrece sin él.
-- Límite: la vista E evalúa por salida la cobertura de cada incluido (precio por persona o rangos de grupo de la vigencia); no evalúa franjas horarias (dependen de la 255).
with hoy as (
  select (now() at time zone 'America/Bogota')::date as d
),
armados as (
  select a.paquete_id, a.servicio_id, a.modo, coalesce(a.incluido, false) as incluido,
         p.nombre as paquete, p.tipo::text as tipo_paquete, p.fecha_viaje_inicio as ini, p.fecha_viaje_fin as fin,
         case when coalesce(a.incluido, false) and p.tipo::text in ('bloqueo', 'dinamico') then 'POR_SALIDAS'
              when coalesce(a.incluido, false) and p.tipo::text = 'servicios' then 'SIN_VENTANA'
              when p.fecha_viaje_inicio is null or p.fecha_viaje_fin is null then 'SIN_VENTANA'
              when p.fecha_viaje_fin < p.fecha_viaje_inicio or (p.fecha_viaje_fin - p.fecha_viaje_inicio) + 1 > 3660 then 'INVALIDA'
              else 'CON_VENTANA' end as tv
  from public.armado_servicios a
  join public.armado_paquetes p on p.id = a.paquete_id and p.activo is true
),
fechas as (  -- fechas de ida de las salidas que el motor publica (solo desde hoy), por tipo de paquete
  select p.id as paquete_id, b.fecha_ida as d
  from public.armado_paquetes p
  join public.armado_vuelos av on av.paquete_id = p.id
  join public.bloqueos_vuelo b on b.id = av.bloqueo_id
  where p.tipo::text = 'bloqueo' and b.fecha_ida >= (select d from hoy)
  union
  select p.id, e.fecha_ida
  from public.armado_paquetes p
  join public.armado_empaquetados ae on ae.paquete_id = p.id
  join public.empaquetados e on e.id = ae.empaquetado_id
  where p.tipo::text = 'bloqueo' and e.fecha_ida >= (select d from hoy)
  union
  select s.paquete_id, s.fecha_ida
  from public.salidas_dinamicas s
  join public.armado_paquetes p on p.id = s.paquete_id
  where p.tipo::text = 'dinamico' and s.activo is true and s.fecha_ida >= (select d from hoy)
),
nfechas as (select paquete_id, count(*) as n, min(d) as dmin, max(d) as dmax from fechas group by paquete_id),
vdat as (  -- vigencias con fechas completas (las únicas que pueden vender)
  select t.servicio_id, t.nombre, t.fecha_inicio, t.fecha_fin, t.precio_persona
  from public.servicio_temporadas t
  where t.fecha_inicio is not null and t.fecha_fin is not null and t.fecha_fin >= t.fecha_inicio
),
vstat as (
  select t.servicio_id,
         count(*) as n_fechadas,
         count(*) filter (where t.fecha_fin >= (select d from hoy)) as n_no_vencidas
  from vdat t group by t.servicio_id
),
sinfechas as (
  select t.servicio_id, count(*) as n_sin_fechas
  from public.servicio_temporadas t
  where t.fecha_inicio is null or t.fecha_fin is null or t.fecha_fin < t.fecha_inicio
  group by t.servicio_id
),
rg as (  -- rangos por (servicio, vigencia): cuántos, su firma y si dejan pax sin cubrir
  select x.servicio_id, x.temporada, count(*) as n_rangos,
         string_agg(x.pax_desde || '-' || x.pax_hasta, '|' order by x.pax_desde) as firma,
         bool_or(x.primer > 1 or (x.sig is not null and x.sig > x.pax_hasta + 1)) as hueco
  from (
    select r.servicio_id, r.temporada, r.pax_desde, r.pax_hasta,
           lead(r.pax_desde) over (partition by r.servicio_id, r.temporada order by r.pax_desde) as sig,
           first_value(r.pax_desde) over (partition by r.servicio_id, r.temporada order by r.pax_desde) as primer
    from public.servicio_tarifa_pax r
  ) x
  group by x.servicio_id, x.temporada
),
aplic as (  -- vigencias aplicables por (paquete, servicio) con su tarifa propia
  select v.paquete_id, v.servicio_id, t.nombre, t.precio_persona, v.modo,
         r.n_rangos, r.firma, coalesce(r.hueco, false) as hueco
  from armados v
  join vdat t on t.servicio_id = v.servicio_id
  left join rg r on r.servicio_id = t.servicio_id and r.temporada = t.nombre
  where (v.tv = 'CON_VENTANA' and t.fecha_inicio <= v.fin and t.fecha_fin >= v.ini)
     or (v.tv = 'SIN_VENTANA' and t.fecha_fin >= (select d from hoy))
     or (v.tv = 'POR_SALIDAS' and exists (select 1 from fechas f where f.paquete_id = v.paquete_id and f.d between t.fecha_inicio and t.fecha_fin))
),
aplic_agg as (
  select a.paquete_id, a.servicio_id,
         count(*) as n_aplicables,
         string_agg(a.nombre, ', ' order by a.nombre) as nombres,
         count(*) filter (where case when a.modo = 'grupo' then a.n_rangos is null
                                     else a.precio_persona is null or a.precio_persona < 0 end) as n_incompletas,
         string_agg(a.nombre, ', ' order by a.nombre) filter (where case when a.modo = 'grupo' then a.n_rangos is null
                                     else a.precio_persona is null or a.precio_persona < 0 end) as nombres_incompletas,
         count(distinct a.firma) filter (where a.modo = 'grupo' and a.n_rangos is not null) as n_firmas,
         count(*) filter (where a.modo = 'grupo' and a.hueco) as n_huecos
  from aplic a
  group by a.paquete_id, a.servicio_id
),
cob as (  -- cobertura día a día del viaje del paquete (solo con rango válido), o por fecha de ida de cada salida en los incluidos de bloqueo/dinámico
  select v.paquete_id, v.servicio_id,
         count(*) filter (where not x.cub) as dias_futuros, 0::bigint as dias_pasados, min(f.d) filter (where not x.cub) as primer_dia, count(*) as total
  from armados v
  join fechas f on f.paquete_id = v.paquete_id
  cross join lateral (
    select exists (select 1 from vdat t where t.servicio_id = v.servicio_id and t.fecha_inicio <= f.d and t.fecha_fin >= f.d) as cub
  ) x
  where v.tv = 'POR_SALIDAS'
  group by v.paquete_id, v.servicio_id
  union all
  select v.paquete_id, v.servicio_id,
         count(*) filter (where not x.cub and g.d::date >= (select d from hoy)) as dias_futuros,
         count(*) filter (where not x.cub and g.d::date < (select d from hoy)) as dias_pasados,
         min(g.d::date) filter (where not x.cub) as primer_dia, count(*) as total
  from armados v
  cross join lateral generate_series(v.ini, v.fin, interval '1 day') as g(d)
  cross join lateral (
    select exists (select 1 from vdat t where t.servicio_id = v.servicio_id and t.fecha_inicio <= g.d::date and t.fecha_fin >= g.d::date) as cub
  ) x
  where v.tv = 'CON_VENTANA'
  group by v.paquete_id, v.servicio_id
),
gen as (
  select s.id as servicio_id,
         (s.precio_persona is not null and s.precio_persona > 0) as precio_general,
         exists (select 1 from public.servicio_tarifa_pax g where g.servicio_id = s.id and g.temporada = 'GENERAL') as rangos_general,
         -- tarifa base PERMANENTE (solo asistencia médica, y solo si NO hay ninguna fila en servicio_temporadas): persona = precio base >= 0; grupo = rangos GENERAL
         (s.categoria = 'asistencia' and not exists (select 1 from public.servicio_temporadas t where t.servicio_id = s.id)
            and s.precio_persona is not null and s.precio_persona >= 0) as perm_persona,
         (s.categoria = 'asistencia' and not exists (select 1 from public.servicio_temporadas t where t.servicio_id = s.id)
            and exists (select 1 from public.servicio_tarifa_pax g where g.servicio_id = s.id and g.temporada = 'GENERAL')) as perm_grupo
  from public.servicios_adicionales s
),
pub as (
  select paquete_id, servicio_id, count(*) as filas_publicadas
  from public.tarifario_resultado where modulo = 'servicios' group by paquete_id, servicio_id
),
aud as (
select * from (
  select ar.paquete_id,
         ar.paquete,
         ar.tipo_paquete,
         ar.servicio_id,
         s.nombre as servicio,
         s.categoria,
         ar.modo,
         ar.incluido,
         (select d from hoy) as hoy_negocio,
         case ar.tv when 'SIN_VENTANA' then 'sin rango de viaje (vigencias no vencidas)'
                    when 'POR_SALIDAS' then coalesce(nf.n::text || ' salida(s) con ida ' || nf.dmin::text || ' a ' || nf.dmax::text, 'sin salidas futuras')
                    else ar.ini::text || ' a ' || ar.fin::text end as ventana,
         coalesce(vs.n_fechadas, 0) as vigencias_con_fechas,
         coalesce(sf.n_sin_fechas, 0) as vigencias_sin_fechas,
         coalesce(aa.n_aplicables, 0) as vigencias_aplicables,
         aa.nombres as nombres_vigencias_aplicables,
         aa.nombres_incompletas as vigencias_aplicables_incompletas,
         coalesce(c.dias_futuros, 0) as dias_sin_cobertura_futuros,
         coalesce(c.dias_pasados, 0) as dias_sin_cobertura_pasados,
         c.primer_dia as primer_dia_sin_cobertura,
         coalesce(c.total, 0) as fechas_evaluadas,
         coalesce(c.total, 0) - coalesce(c.dias_futuros, 0) - coalesce(c.dias_pasados, 0) as fechas_cubiertas,
         coalesce(aa.n_firmas, 0) > 1 as rangos_distintos,
         coalesce(aa.n_huecos, 0) as vigencias_con_huecos_pax,
         g.precio_general as tiene_precio_general,
         g.rangos_general as tiene_rangos_general,
         coalesce(pb.filas_publicadas, 0) as filas_publicadas_en_tarifario,
         case
           when ar.tv = 'INVALIDA' then 'VENTANA_INVALIDA'
           when ar.tv = 'CON_VENTANA' and ar.fin < (select d from hoy) then 'VIAJE_PASADO'
           when ar.tv = 'POR_SALIDAS' and coalesce(nf.n, 0) = 0 and coalesce(vs.n_fechadas, 0) > 0 then 'SIN_SALIDAS_FUTURAS'
           when (case when ar.modo = 'grupo' then g.perm_grupo else g.perm_persona end) then 'OK_TARIFA_PERMANENTE'
           when coalesce(vs.n_fechadas, 0) = 0 and (g.precio_general or g.rangos_general) then 'SOLO_GENERAL'
           when coalesce(vs.n_fechadas, 0) = 0 then 'SIN_NINGUNA_TARIFA'
           when coalesce(vs.n_no_vencidas, 0) = 0 then 'VIGENCIAS_VENCIDAS'
           when ar.incluido and ar.tv in ('CON_VENTANA', 'POR_SALIDAS') and coalesce(c.dias_futuros, 0) + coalesce(c.dias_pasados, 0) > 0
                and ar.tv = 'POR_SALIDAS' and coalesce(c.total, 0) - coalesce(c.dias_futuros, 0) > 0 then 'INCLUIDO_OMITIDO_EN_SALIDAS'
           when ar.incluido and ar.tv in ('CON_VENTANA', 'POR_SALIDAS') and coalesce(c.dias_futuros, 0) + coalesce(c.dias_pasados, 0) > 0 then 'INCLUIDO_OMITIDO_EN_TODAS'
           when not ar.incluido and ar.tv = 'CON_VENTANA' and coalesce(c.dias_futuros, 0) + coalesce(c.dias_pasados, 0) > 0
                and coalesce(c.total, 0) - coalesce(c.dias_futuros, 0) - coalesce(c.dias_pasados, 0) = 0 then 'OPCIONAL_OCULTO'
           when not ar.incluido and ar.tv = 'CON_VENTANA' and coalesce(c.dias_futuros, 0) + coalesce(c.dias_pasados, 0) > 0 then 'OPCIONAL_PARCIAL'
           when ar.incluido and ar.tv = 'CON_VENTANA' and coalesce(aa.n_aplicables, 0) > 1 then 'INCLUIDO_VARIAS_VIGENCIAS'
           when coalesce(aa.n_incompletas, 0) > 0 and ar.modo = 'grupo' then 'VIGENCIA_SIN_RANGOS'
           when coalesce(aa.n_incompletas, 0) > 0 then 'VIGENCIA_SIN_PRECIO'
           when coalesce(aa.n_firmas, 0) > 1 then 'RANGOS_DISTINTOS'
           when coalesce(aa.n_huecos, 0) > 0 then 'OK_CON_HUECOS_PAX'
           else 'OK'
         end as estado,
         case
           when (case when ar.modo = 'grupo' then g.perm_grupo else g.perm_persona end) then 'ASISTENCIA MÉDICA sin vigencias: la tarifa base es permanente y se aplica en cualquier fecha (no rellena huecos si hubiera vigencias)'
           when ar.tv = 'CON_VENTANA' and coalesce(c.dias_futuros, 0) = 0 and coalesce(c.dias_pasados, 0) > 0
             then 'Los días sin cobertura son solo PASADOS: la publicación igual los rechaza hasta ajustar el rango del viaje o la vigencia'
           when ar.incluido and ar.tv = 'POR_SALIDAS'
             then 'INCLUIDO en el hotel: se evaluó la fecha de ida de cada salida (no toda la ventana); franjas horarias no se evalúan aquí'
           when ar.incluido then 'INCLUIDO en el precio del hotel (franjas horarias no se evalúan aquí)'
           else 'opcional / tour'
         end as nota,
         -- Qué pasa al publicar/vender con la 256 (columna calculada con el mismo estado de arriba; ver la cabecera).
         case
           when (case when ar.modo = 'grupo' then g.perm_grupo else g.perm_persona end) then case when ar.incluido then 'INCLUIDO Y COBRADO en todas las salidas (tarifa base permanente)' else 'se ofrece completo (tarifa base permanente)' end
           when ar.incluido then
             case
               when ar.tv = 'INVALIDA' or (ar.tv = 'CON_VENTANA' and ar.fin < (select d from hoy)) or (ar.tv = 'POR_SALIDAS' and coalesce(nf.n, 0) = 0) then 'sin salidas vendibles'
               when coalesce(vs.n_fechadas, 0) = 0 or coalesce(vs.n_no_vencidas, 0) = 0 then 'OMITIDO en todas las salidas/estadías (sin vigencia vendible): el paquete se ofrece SIN este servicio'
               when ar.tv in ('CON_VENTANA', 'POR_SALIDAS') and coalesce(c.dias_futuros, 0) + coalesce(c.dias_pasados, 0) > 0
                    and ar.tv = 'POR_SALIDAS' and coalesce(c.total, 0) - coalesce(c.dias_futuros, 0) > 0
                 then 'OMITIDO en ' || coalesce(c.dias_futuros, 0) || ' de ' || coalesce(c.total, 0) || ' salida(s): se ofrecen SIN este servicio; en las otras ' || (coalesce(c.total, 0) - coalesce(c.dias_futuros, 0)) || ' va INCLUIDO Y COBRADO'
               when ar.tv in ('CON_VENTANA', 'POR_SALIDAS') and coalesce(c.dias_futuros, 0) + coalesce(c.dias_pasados, 0) > 0 then 'OMITIDO en todas las salidas/estadías (ninguna tiene vigencia): el paquete se ofrece SIN este servicio'
               when ar.tv = 'CON_VENTANA' and coalesce(aa.n_aplicables, 0) > 1 then 'BLOQUEA las estadías afectadas: la ventana cae en varias vigencias (precio ambiguo: error de configuración)'
               when coalesce(aa.n_incompletas, 0) > 0 or coalesce(aa.n_firmas, 0) > 1 then 'OMITIDO en las estadías afectadas: tarifa incompleta; el paquete se ofrece SIN este servicio'
               else 'INCLUIDO Y COBRADO en todas las salidas/estadías'
             end
           else
             case
               when ar.tv = 'INVALIDA' or (ar.tv = 'CON_VENTANA' and ar.fin < (select d from hoy)) then 'no se ofrece (viaje inválido o pasado)'
               when coalesce(vs.n_fechadas, 0) = 0 or coalesce(vs.n_no_vencidas, 0) = 0 then 'no se ofrece (oculto): sin vigencia vendible'
               when ar.tv = 'CON_VENTANA' and coalesce(c.dias_futuros, 0) + coalesce(c.dias_pasados, 0) > 0
                    and coalesce(c.total, 0) - coalesce(c.dias_futuros, 0) - coalesce(c.dias_pasados, 0) = 0 then 'no se ofrece (oculto): ninguna fecha del viaje tiene vigencia'
               when ar.tv = 'CON_VENTANA' and coalesce(c.dias_futuros, 0) + coalesce(c.dias_pasados, 0) > 0
                 then 'se ofrece SOLO en ' || (coalesce(c.total, 0) - coalesce(c.dias_futuros, 0) - coalesce(c.dias_pasados, 0)) || ' de ' || coalesce(c.total, 0) || ' día(s) del viaje'
               when coalesce(aa.n_incompletas, 0) > 0 or coalesce(aa.n_firmas, 0) > 1 then 'no se ofrece (oculto): tarifa incompleta o rangos incompatibles'
               when coalesce(aa.n_huecos, 0) > 0 then 'se ofrece; algunos pax no se pueden vender'
               else 'se ofrece completo'
             end
         end as efecto
  from armados ar
  join public.servicios_adicionales s on s.id = ar.servicio_id
  left join vstat vs on vs.servicio_id = ar.servicio_id
  left join sinfechas sf on sf.servicio_id = ar.servicio_id
  left join aplic_agg aa on aa.paquete_id = ar.paquete_id and aa.servicio_id = ar.servicio_id
  left join cob c on c.paquete_id = ar.paquete_id and c.servicio_id = ar.servicio_id
  left join nfechas nf on nf.paquete_id = ar.paquete_id
  left join gen g on g.servicio_id = ar.servicio_id
  left join pub pb on pb.paquete_id = ar.paquete_id and pb.servicio_id = ar.servicio_id
) r
),
vigs as (  -- lo que hoy está cargado por servicio, tal cual (sin interpretar)
  select t.servicio_id,
         string_agg(t.nombre || ' [' || coalesce(t.fecha_inicio::text, '?') || ' a ' || coalesce(t.fecha_fin::text, '?') || '] '
                    || case when t.precio_persona is null then 'sin precio persona' else 'persona ' || t.precio_persona::text end
                    || case when t.fecha_inicio is not null and t.fecha_fin is not null and t.fecha_fin < t.fecha_inicio then ' INVÁLIDA (fin antes de inicio): no cubre ninguna fecha' else '' end,
                    '; ' order by t.fecha_inicio nulls last, t.nombre) as detalle
  from public.servicio_temporadas t
  group by t.servicio_id
),
srv as (
  select a.servicio_id,
         count(*) as vinculos_total,
         count(*) filter (where a.estado not in ('OK', 'OK_TARIFA_PERMANENTE')) as vinculos_con_problema,
         string_agg(a.paquete_id::text, ', ' order by a.paquete_id) filter (where a.estado not in ('OK', 'OK_TARIFA_PERMANENTE')) as paquetes_con_problema,
         string_agg(a.paquete_id::text, ', ' order by a.paquete_id) filter (where a.estado in ('OK', 'OK_TARIFA_PERMANENTE')) as paquetes_hoy_ok
  from aud a group by a.servicio_id
),
sal as (  -- por salida: ¿todos los incluidos (por salida) del paquete tienen vigencia con tarifa válida en esa fecha de ida?
  select f.paquete_id, f.d,
         not exists (
           select 1 from armados v
           where v.paquete_id = f.paquete_id and v.incluido and v.tv = 'POR_SALIDAS'
             and not exists (select 1 from gen gp where gp.servicio_id = v.servicio_id and case when v.modo = 'grupo' then gp.perm_grupo else gp.perm_persona end)  -- asistencia con tarifa base permanente: vale en cualquier fecha
             and not exists (
               select 1 from vdat t
               where t.servicio_id = v.servicio_id and t.fecha_inicio <= f.d and t.fecha_fin >= f.d
                 and case when v.modo = 'grupo' then exists (select 1 from rg r where r.servicio_id = t.servicio_id and r.temporada = t.nombre)
                          else t.precio_persona is not null and t.precio_persona >= 0 end)
         ) as vendible
  from fechas f
),
sal_agg as (select paquete_id, count(*) as n, count(*) filter (where vendible) as n_vendibles from sal group by paquete_id),
bloqueantes as (  -- incluidos OMITIDOS por falta de tarifa vigente (todos los vínculos incluidos con problema, por paquete)
  select a.paquete_id, count(*) as n, string_agg(a.servicio_id || ' ' || a.servicio || ' (' || a.estado || ')', '; ' order by a.servicio_id) as lista
  from aud a
  where a.incluido and a.estado not in ('OK', 'OK_TARIFA_PERMANENTE', 'OK_CON_HUECOS_PAX', 'SIN_SALIDAS_FUTURAS', 'VIAJE_PASADO')
  group by a.paquete_id
),
config_bloquea as (  -- error de configuración que sí impide ofrecer la estadía: vigencias ambiguas de un incluido en porción terrestre
  select a.paquete_id, count(*) as n from aud a where a.incluido and a.estado = 'INCLUIDO_VARIAS_VIGENCIAS' group by a.paquete_id
),
pq as (
  select p.id as paquete_id, p.nombre, p.tipo::text as tipo
  from public.armado_paquetes p
  where p.activo is true and exists (select 1 from public.armado_servicios s where s.paquete_id = p.id)
)
select * from (
  select 'A_servicio' as vista, null::bigint as paquete_id, null::text as paquete, null::text as tipo_paquete,
         a.servicio_id, max(a.servicio) as servicio, string_agg(distinct a.estado, ', ' order by a.estado) as estados, null::text as ventana,
         max(v.detalle) as vigencias_existentes, min(a.primer_dia_sin_cobertura) as primer_hueco, null::bigint as dias_sin_cobertura,
         sum(a.filas_publicadas_en_tarifario)::bigint as filas_publicadas, max(s.vinculos_con_problema) as afectados,
         'paquetes con problema: ' || coalesce(max(s.paquetes_con_problema), '-') || ' | paquetes hoy OK que también usan el servicio: ' || coalesce(max(s.paquetes_hoy_ok), '-') as detalle
  from aud a
  join srv s on s.servicio_id = a.servicio_id
  left join vigs v on v.servicio_id = a.servicio_id
  where a.estado not in ('OK', 'OK_TARIFA_PERMANENTE')
  group by a.servicio_id
  union all
  select 'B_paquete', a.paquete_id, max(a.paquete), max(a.tipo_paquete), null, null, string_agg(distinct a.estado, ', ' order by a.estado), max(a.ventana),
         null, min(a.primer_dia_sin_cobertura), null, sum(a.filas_publicadas_en_tarifario)::bigint, count(*),
         count(*) filter (where a.incluido) || ' incluido(s) y ' || count(*) filter (where not a.incluido) || ' opcional(es) con problema; servicios: '
           || string_agg(a.servicio_id::text, ', ' order by a.servicio_id)
  from aud a
  where a.estado not in ('OK', 'OK_TARIFA_PERMANENTE')
  group by a.paquete_id
  union all
  select 'C_incluido', a.paquete_id, a.paquete, a.tipo_paquete, a.servicio_id, a.servicio, a.estado, a.ventana,
         v.detalle, a.primer_dia_sin_cobertura, (a.dias_sin_cobertura_futuros + a.dias_sin_cobertura_pasados)::bigint, a.filas_publicadas_en_tarifario::bigint,
         null::bigint, a.efecto || ' | ' || a.nota
  from aud a
  left join vigs v on v.servicio_id = a.servicio_id
  where a.incluido and a.estado not in ('OK', 'OK_TARIFA_PERMANENTE')
  union all
  select 'D_opcional_publicado', a.paquete_id, a.paquete, a.tipo_paquete, a.servicio_id, a.servicio, a.estado, a.ventana,
         v.detalle, a.primer_dia_sin_cobertura, (a.dias_sin_cobertura_futuros + a.dias_sin_cobertura_pasados)::bigint, a.filas_publicadas_en_tarifario::bigint,
         null::bigint, a.efecto || ' | ' || a.nota
  from aud a
  left join vigs v on v.servicio_id = a.servicio_id
  where not a.incluido and a.estado not in ('OK', 'OK_TARIFA_PERMANENTE') and a.filas_publicadas_en_tarifario > 0
  union all
  select 'E_paquete_oferta', pq.paquete_id, pq.nombre, pq.tipo, null, null,
         case
           when pq.tipo in ('bloqueo', 'dinamico') and coalesce(sa.n, 0) = 0 then 'SIN_SALIDAS'
           when pq.tipo in ('bloqueo', 'dinamico') and coalesce(b.n, 0) = 0 and coalesce(sa.n_vendibles, 0) = coalesce(sa.n, 0) then 'OFERTA_COMPLETA'
           when pq.tipo in ('bloqueo', 'dinamico') and coalesce(sa.n_vendibles, 0) = 0 then 'OFERTA_SIN_SERVICIOS'
           when pq.tipo in ('bloqueo', 'dinamico') then 'OFERTA_CON_SERVICIOS_OMITIDOS'
           when pq.tipo = 'servicios' then 'OFERTA_COMPLETA'
           when coalesce(cb.n, 0) > 0 then 'SIN_OFERTA'
           when coalesce(b.n, 0) > 0 then 'OFERTA_SIN_SERVICIOS'
           else 'OFERTA_COMPLETA'
         end,
         case when pq.tipo in ('bloqueo', 'dinamico') then coalesce(sa.n_vendibles, 0) || ' de ' || coalesce(sa.n, 0) || ' salida(s) con TODOS sus incluidos cobrados; ' || (coalesce(sa.n, 0) - coalesce(sa.n_vendibles, 0)) || ' se ofrecen sin algún incluido' else 'estadía por fechas del asesor' end,
         null, null, (coalesce(sa.n, 0) - coalesce(sa.n_vendibles, 0))::bigint,
         (select sum(ap.filas_publicadas_en_tarifario) from aud ap where ap.paquete_id = pq.paquete_id)::bigint,
         coalesce(b.n, 0),
         coalesce('incluidos OMITIDOS (el paquete se ofrece sin ellos): ' || b.lista, 'ningún incluido se omite')
  from pq
  left join sal_agg sa on sa.paquete_id = pq.paquete_id
  left join bloqueantes b on b.paquete_id = pq.paquete_id
  left join config_bloquea cb on cb.paquete_id = pq.paquete_id
) x
order by x.vista, x.paquete_id nulls first, x.servicio_id nulls first;
