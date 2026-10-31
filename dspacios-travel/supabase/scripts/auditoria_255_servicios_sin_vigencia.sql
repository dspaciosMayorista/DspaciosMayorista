-- Auditoría 255/256 (SOLO LECTURA, UNA consulta SELECT): ¿qué servicios/paquetes quedan SIN tarifa vendible al retirar «GENERAL» como fuente de precio, y qué se
-- publica, oculta o bloquea por fecha/salida? (La 256 cambió «un hueco tumba la generación» por «se ofrece solo donde hay vigencia»: ver estados y columna efecto.)
-- No modifica nada (ni siquiera crea objetos temporales). Una fila por (paquete ACTIVO, servicio armado en él). Ejecutar ANTES de desplegar el código nuevo.
-- Para blindarlo aún más, pégalo dentro de:  begin read only;  <consulta>  rollback;
--
-- Regla que replica el motor (lib/calc/servicioVigencias.ts → referenciaPublicacion): un servicio solo se publica y se vende con VIGENCIAS (servicio_temporadas con
-- fecha_inicio y fecha_fin) que cubran TODOS los días del viaje del paquete (armado_paquetes.fecha_viaje_inicio/fin); cada vigencia aplicable debe tener precio por
-- persona (0 cuenta: es gratis) o, por grupo, rangos de pasajeros PROPIOS (servicio_tarifa_pax.temporada = nombre de la vigencia), iguales entre vigencias.
-- La ventana de compra se ignora (es una puerta comercial). Si el paquete no tiene rango de viaje, el motor toma las vigencias que aún no vencieron.
-- Qué fechas exige el motor depende del servicio (generarTarifario):
--   · OPCIONAL (incluido = false): se evalúa toda la ventana de viaje del paquete (referenciaPublicacion), pero un hueco YA NO tumba la generación (256): se publica con
--     los tramos cubiertos (OPCIONAL_PARCIAL) y, sin ningún día cubierto, no se ofrece (OPCIONAL_OCULTO). La venta re-valida contra la vigencia de la fecha pedida.
--   · INCLUIDO (se hornea en el precio del hotel): solo las ESTADÍAS que se publican (incluidoEnEstadia), no toda la ventana:
--       - porción terrestre: la ventana completa, dentro de UNA sola vigencia;
--       - bloqueo: la fecha de ida de cada vuelo bloqueado / empaquetado del paquete; dinámico: la de cada salida activa;
--       - tipo servicios: no se hornea nada, no se evalúa cobertura.
--     (Aquí se evalúan las salidas con fecha de ida desde hoy; las pasadas ya no se venden.)
--     Un incluido SIN tarifa vigente en la fecha se OMITE de esa salida/estadía (no entra al PVP, al costo ni a la CxP, ni a «Incluye»/documentos) y el paquete se ofrece
--     igual SIN ese servicio (INCLUIDO_OMITIDO_EN_SALIDAS: solo en algunas salidas; INCLUIDO_OMITIDO_EN_TODAS: en todas). En las salidas cubiertas el servicio es «incluido y cobrado».
-- «Hoy» es la fecha de NEGOCIO de Bogotá (no el reloj UTC del servidor). Vigencia vencida = fecha_fin anterior a hoy.
--
-- estado (en este orden de prioridad):
--   VENTANA_INVALIDA        = el rango de viaje del paquete es inválido (regreso antes de la ida, o más de 3660 días): el motor lo rechaza.
--   VIAJE_PASADO            = el viaje del paquete ya terminó: nada vendible; revisar si el paquete debe seguir activo.
--   SIN_SALIDAS_FUTURAS     = (incluido en bloqueo/dinámico) el paquete no tiene salidas con ida desde hoy: no hay estadía que evaluar.
--   OK_TARIFA_PERMANENTE    = ASISTENCIA MÉDICA (categoria = 'asistencia') SIN NINGUNA vigencia y con tarifa base válida (precio por persona o rangos GENERAL): su tarifa base vale en
--                             cualquier fecha. No bloquea ni se oculta. Con una sola vigencia (aunque esté vencida, invertida o sin fechas) la base NO aplica y rige el resto de estados.
--   SOLO_GENERAL            = (traslados, tours y demás; o asistencia con vigencias inválidas) tiene precio/rangos GENERAL pero NINGUNA vigencia con fechas: hoy se vende, mañana no. REQUIERE CARGAR VIGENCIA.
--   SIN_NINGUNA_TARIFA      = ni vigencias con fechas ni tarifa general: ya hoy no se vende.
--   VIGENCIAS_VENCIDAS      = tiene vigencias pero todas vencieron: no se vende ninguna fecha futura.
--   OPCIONAL_PARCIAL        = (opcional) hay días del viaje con vigencia y días sin ella: se ofrece SOLO en los tramos cubiertos; fuera de ellos no está disponible.
--   OPCIONAL_OCULTO         = (opcional) ningún día del viaje tiene vigencia válida: el servicio no se ofrece en ninguna fecha.
--   INCLUIDO_OMITIDO_EN_SALIDAS = (incluido) algunas salidas/estadías no tienen vigencia y otras sí: en las no cubiertas el paquete se ofrece SIN el servicio; en las cubiertas se cobra.
--   INCLUIDO_OMITIDO_EN_TODAS = (incluido) ninguna salida/estadía tiene vigencia: el paquete se ofrece SIN el servicio en todas (porción terrestre: la ventana completa debe caer en
--                             UNA vigencia, si no se omite). Ver primer_dia_sin_cobertura y salidas_*.
--   INCLUIDO_VARIAS_VIGENCIAS = (incluido en porción terrestre) la ventana cae en más de una vigencia: el precio horneado sería ambiguo y el motor lo rechaza.
--   VIGENCIA_SIN_PRECIO     = (persona) alguna vigencia aplicable no tiene precio por persona (ver vigencias_aplicables_incompletas).
--   VIGENCIA_SIN_RANGOS     = (grupo) alguna vigencia aplicable no tiene rangos propios (los GENERAL ya no cuentan).
--   RANGOS_DISTINTOS        = (grupo) las vigencias aplicables tienen rangos de pasajeros distintos entre sí: el motor no puede publicar un precio único.
--   OK_CON_HUECOS_PAX       = (grupo) OK, pero una vigencia aplicable no cubre algunos pax (ver vigencias_con_huecos_pax): esos pax no se podrán vender.
--   OK                      = el viaje queda cubierto día a día y cada vigencia aplicable tiene tarifa (y rangos sin huecos en modo grupo).
-- Solo cuentan las vigencias APLICABLES (las que se cruzan con el viaje, o las no vencidas si no hay rango): los huecos de vigencias vencidas no se mezclan.
-- Las columnas *_general son informativas: ese dato NO se borra ni se transforma.
-- Límites conocidos: no evalúa la prioridad entre vigencias que se solapan; las franjas horarias de un incluido (el motor las rechaza) dependen de la tabla
-- de la 255 y no se consultan aquí para que el script corra antes de aplicarla; de las salidas solo se miran las no vencidas (el motor puede filtrar más).
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
)
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
order by (r.estado in ('OK', 'OK_TARIFA_PERMANENTE')), r.estado, r.paquete_id, r.servicio_id;
