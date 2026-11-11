-- ─────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO DE SOLO LECTURA · #43/#60 (vigencias por grupos de días)       versión 2
-- Una sola consulta (un solo SELECT con CTE). No escribe, no crea objetos, no regenera nada.
-- Pegar COMPLETA en el editor SQL de Supabase y ejecutar. Devuelve una fila por control
-- (más filas de detalle «n.xxx» en los controles 3 y 10) con las columnas:
--   orden · control · observado · esperado · estado · hoteles_incompletos · ejemplo
--
-- ESTADOS
--   OK          observado = 0 y ningún hotel afectado por datos inválidos.
--   REVISAR     observado > 0.
--   INCOMPLETO  observado = 0 PERO hay hoteles con fechas inválidas: el resultado puede estar subestimado.
--   REVISAR (INCOMPLETO)  observado > 0 y además hay hoteles con fechas inválidas: faltan casos por ver.
--   INFO        informativo; no es un error por sí mismo.
--
-- HORIZONTE: hoy (Bogotá) → hoy + 365 días. Está en la fila 0 y en el nombre de cada control por noche.
-- Las vigencias con noches posteriores al horizonte se cuentan en el control 12 (no se analizan).
--
-- FECHAS INVÁLIDAS: ninguna aborta la consulta ni se descarta en silencio. Un rango/blackout con texto que no es
-- AAAA-MM-DD, con día inexistente (p. ej. 2027-02-30) o con inicio posterior al fin se lista en el control 3 y, si
-- está en una vigencia con compra vigente, marca al hotel como INCOMPLETO (control 4).
-- OJO, el motor NO se comporta igual con todas: JavaScript desborda un día inexistente al mes siguiente
-- (2027-02-30 se lee como 2 de marzo) y por eso el motor SÍ cubre o excluye con esa fecha; un mes 13 o un día 32 no
-- cubre ni excluye. Este diagnóstico NO imita el desborde: trata toda fecha inválida como si no cubriera ni excluyera,
-- así que los resultados de esos hoteles pueden diferir del motor y por eso se marcan INCOMPLETO hasta corregir el dato.
--
-- ACOMODACIONES (modelo por persona). Se evalúa cada una por separado:
--   · habitación (sencilla, doble, triple, múltiple): tiene precio si neto > 0 (0 = «no aplica» para el motor).
--   · niño 1 y niño 2: tiene precio si neto no es nulo (0 = gratis, válido). No se evalúan en hoteles Adults Only.
--   · infante: no se evalúa (el motor lo trata como gratis cuando falta, por decisión vigente).
--   «Ofertada» = el hotel la tiene habilitada en `hotel_acomodaciones` (fila con pax_max y pax_tarifa > 0) o tiene
--   precio para ella en alguna fila del hotel. Aplica a toda combinación (categoría × régimen) del hotel con al menos un precio.
--   Limitación: aún no existen restricciones por categoría (#44), así que una categoría que no vende una acomodación
--   aparecerá como falta; es información para decidir, no un error por sí sola.
--
-- Reglas del motor que replica (lib/calc/paquetes.ts): cobertura por `rangos` (si no hay ninguno con textos, usa
-- fecha_inicio/fecha_fin) menos `blackouts`; compra vigente HOY; `regimen_restringido`; gana la mayor `prioridad`;
-- `promo_noche_gratis` no participa por noche.
-- ─────────────────────────────────────────────────────────────────────────
with
p as (select public.fecha_negocio() as hoy, 365 as horizonte),
hoteles_ok as (
  select h.id, coalesce(h.modelo_tarifario, 'persona') as modelo, coalesce(h.adults_only, false) as adults_only from public.hoteles h
),
-- ── Vigencias y fechas declaradas (todas las filas; la compra vigente se aplica después) ──
vig_all as (
  select t.id, t.hotel_id, t.nombre, coalesce(t.tipo, 'tarifa') as tipo, coalesce(t.prioridad, 1) as prioridad,
         t.regimen_restringido, t.rangos, t.blackouts, t.fecha_inicio, t.fecha_fin,
         ((t.compra_inicio is null or p.hoy >= t.compra_inicio) and (t.compra_fin is null or p.hoy <= t.compra_fin)) as compra_vigente
  from public.hotel_temporadas t, p
  where t.nombre is not null
),
-- Un renglón por cada elemento declarado (rango o blackout) + uno por cada columna jsonb con forma inválida.
items_raw as (
  select v.id as vig_id, 'rango'::text as clase, e.val->>'fecha_inicio' as ini, e.val->>'fecha_fin' as fin,
         (jsonb_typeof(e.val) = 'object') as es_obj, e.val::text as crudo
  from vig_all v
  cross join lateral jsonb_array_elements(case when jsonb_typeof(v.rangos) = 'array' then v.rangos else '[]'::jsonb end) e(val)
  union all
  select v.id, 'blackout', e.val->>'fecha_inicio', e.val->>'fecha_fin', (jsonb_typeof(e.val) = 'object'), e.val::text
  from vig_all v
  cross join lateral jsonb_array_elements(case when jsonb_typeof(v.blackouts) = 'array' then v.blackouts else '[]'::jsonb end) e(val)
  union all
  select v.id, 'rango', null, null, false, 'rangos no es una lista: ' || coalesce(v.rangos::text, 'NULL')
  from vig_all v where v.rangos is not null and jsonb_typeof(v.rangos) <> 'array'
  union all
  select v.id, 'blackout', null, null, false, 'blackouts no es una lista: ' || coalesce(v.blackouts::text, 'NULL')
  from vig_all v where v.blackouts is not null and jsonb_typeof(v.blackouts) <> 'array'
),
-- Validación SIN lanzar errores: cada conversión está dentro de un CASE que ya comprobó el formato y el mes.
items_val as (
  select i.*, f.ok_ini, f.ok_fin,
         case when f.ok_ini and f.ok_fin then i.ini::date end as d_ini,
         case when f.ok_ini and f.ok_fin then i.fin::date end as d_fin
  from items_raw i
  cross join lateral (
    select
      case when i.ini ~ '^\d{4}-\d{2}-\d{2}$' then
             case when substr(i.ini, 1, 4)::int between 1900 and 2200 and substr(i.ini, 6, 2)::int between 1 and 12 then
                    substr(i.ini, 9, 2)::int between 1 and extract(day from (make_date(substr(i.ini, 1, 4)::int, substr(i.ini, 6, 2)::int, 1) + interval '1 month' - interval '1 day'))::int
                  else false end
           else false end as ok_ini,
      case when i.fin ~ '^\d{4}-\d{2}-\d{2}$' then
             case when substr(i.fin, 1, 4)::int between 1900 and 2200 and substr(i.fin, 6, 2)::int between 1 and 12 then
                    substr(i.fin, 9, 2)::int between 1 and extract(day from (make_date(substr(i.fin, 1, 4)::int, substr(i.fin, 6, 2)::int, 1) + interval '1 month' - interval '1 day'))::int
                  else false end
           else false end as ok_fin
  ) f
),
items_estado as (
  select iv.*, (iv.es_obj and iv.ok_ini and iv.ok_fin and iv.d_ini <= iv.d_fin) as valido
  from items_val iv
),
invalidos as (
  select ie.vig_id, v.hotel_id, v.nombre, v.compra_vigente, ie.clase, ie.crudo
  from items_estado ie join vig_all v on v.id = ie.vig_id
  where not ie.valido
),
-- Hoteles con datos inválidos en vigencias que SÍ cuentan hoy (compra vigente): sus resultados pueden estar incompletos.
hoteles_incompletos as (
  select distinct i.hotel_id from invalidos i where i.compra_vigente
),
vig as (select * from vig_all where compra_vigente),
-- Elementos que el motor considera (objetos con textos), válidos o no: si hay alguno, el rango principal NO se usa.
n_items_motor as (
  select ie.vig_id, count(*) filter (where ie.clase = 'rango' and ie.es_obj and ie.ini is not null and ie.fin is not null) as n
  from items_estado ie group by 1
),
rangos_ok as (
  select v.id as vig_id, ie.d_ini as ini, ie.d_fin as fin
  from vig v join items_estado ie on ie.vig_id = v.id and ie.clase = 'rango' and ie.valido
  union all
  select v.id, v.fecha_inicio, v.fecha_fin
  from vig v left join n_items_motor n on n.vig_id = v.id
  where coalesce(n.n, 0) = 0 and v.fecha_inicio is not null and v.fecha_fin is not null and v.fecha_inicio <= v.fecha_fin
),
bloqueos_ok as (
  select ie.vig_id, ie.d_ini as ini, ie.d_fin as fin from items_estado ie where ie.clase = 'blackout' and ie.valido
),
dias as (
  select distinct v.id as vig_id, v.hotel_id, v.nombre, v.tipo, v.prioridad, v.regimen_restringido, d::date as dia
  from vig v
  join rangos_ok r on r.vig_id = v.id
  cross join p
  cross join lateral generate_series(greatest(r.ini, p.hoy), least(r.fin, p.hoy + p.horizonte), interval '1 day') d
  where not exists (select 1 from bloqueos_ok b where b.vig_id = v.id and d::date between b.ini and b.fin)
),
fuera_horizonte as (
  select distinct v.id as vig_id, v.hotel_id, v.nombre, max(r.fin) as fin_max
  from vig v join rangos_ok r on r.vig_id = v.id cross join p
  where r.fin > p.hoy + p.horizonte
  group by 1, 2, 3
),
-- ── Regímenes, categorías y entradas por noche ──
reg as (
  select hr.hotel_id, pa.codigo as regimen from public.hotel_regimenes hr join public.planes_alimentacion pa on pa.id = hr.plan_id
  union
  select tf.hotel_id, tf.alimentacion from public.tarifa_hotel tf where tf.alimentacion is not null
),
cat as (
  select hc.hotel_id, ch.nombre as categoria from public.hotel_categorias hc join public.categorias_habitacion ch on ch.id = hc.categoria_id
  union
  select tf.hotel_id, tf.tipo_habitacion from public.tarifa_hotel tf where tf.tipo_habitacion is not null
),
ent as (
  select d.vig_id, d.hotel_id, d.nombre, d.tipo, d.prioridad, d.dia, r.regimen
  from dias d
  join hoteles_ok h on h.id = d.hotel_id and h.modelo <> 'unidad'
  join reg r on r.hotel_id = d.hotel_id and (d.regimen_restringido is null or d.regimen_restringido = r.regimen)
  where d.tipo <> 'promo_noche_gratis'
),
tope as (select hotel_id, regimen, dia, max(prioridad) as mp from ent group by 1, 2, 3),
tope_base as (select hotel_id, regimen, dia, max(prioridad) as mpb from ent where tipo = 'tarifa' group by 1, 2, 3),
-- ── Precio por acomodación ──
acoms(acom) as (values ('sencilla'), ('doble'), ('triple'), ('multiple'), ('nino'), ('nino2')),
px_a as (
  select tf.hotel_id, tf.tipo_habitacion as categoria, tf.alimentacion as regimen, tf.temporada as nombre, v.acom
  from public.tarifa_hotel tf
  cross join lateral (values ('sencilla', tf.neto_sencilla), ('doble', tf.neto_doble), ('triple', tf.neto_triple),
                             ('multiple', tf.neto_multiple), ('nino', tf.neto_nino), ('nino2', tf.neto_nino2)) v(acom, neto)
  where case when v.acom in ('nino', 'nino2') then v.neto is not null else coalesce(v.neto, 0) > 0 end
),
fila_existe as (
  select distinct tf.hotel_id, tf.tipo_habitacion as categoria, tf.alimentacion as regimen, tf.temporada as nombre
  from public.tarifa_hotel tf
),
combos as (  -- combinaciones vendidas: al menos un precio de cualquier acomodación
  select distinct hotel_id, categoria, regimen from px_a
),
cfg as (
  select ha.hotel_id, ha.acomodacion::text as acom, (ha.pax_max > 0 and ha.pax_tarifa > 0) as habilitada
  from public.hotel_acomodaciones ha
),
ofertada_hotel as (  -- (hotel, acomodación) ofertada
  select hotel_id, acom from cfg where habilitada and acom in ('sencilla', 'doble', 'triple', 'multiple')
  union
  select distinct x.hotel_id, x.acom from px_a x join hoteles_ok h on h.id = x.hotel_id and not (x.acom in ('nino', 'nino2') and h.adults_only)
),
ofertadas as (
  select c.hotel_id, c.categoria, c.regimen, o.acom
  from combos c
  join ofertada_hotel o on o.hotel_id = c.hotel_id
  join hoteles_ok h on h.id = c.hotel_id and h.modelo <> 'unidad'
),
con_precio_en_combo as (select distinct hotel_id, categoria, regimen, acom from px_a),
-- Control 9: ofertada y sin precio en NINGUNA vigencia de la combinación.
nunca_cargada as (
  select o.* from ofertadas o
  where not exists (select 1 from con_precio_en_combo x where x.hotel_id = o.hotel_id and x.categoria = o.categoria and x.regimen = o.regimen and x.acom = o.acom)
),
-- Controles 7/8: la base prioritaria de la noche no tiene precio PARA ESA ACOMODACIÓN (que sí se vende en otra vigencia de la combinación).
sin_precio as (
  select o.hotel_id, o.categoria, o.regimen, o.acom, e.nombre as vigencia, e.dia,
         exists (select 1 from fila_existe f where f.hotel_id = e.hotel_id and f.categoria = o.categoria and f.regimen = o.regimen and f.nombre = e.nombre) as fila_existe,
         exists (
           select 1 from ent q join px_a x on x.hotel_id = q.hotel_id and x.categoria = o.categoria and x.regimen = o.regimen and x.nombre = q.nombre and x.acom = o.acom
           where q.hotel_id = o.hotel_id and q.regimen = o.regimen and q.dia = e.dia and q.vig_id <> e.vig_id
         ) as hay_otra_con_precio
  from ofertadas o
  join con_precio_en_combo cp on cp.hotel_id = o.hotel_id and cp.categoria = o.categoria and cp.regimen = o.regimen and cp.acom = o.acom
  join ent e on e.hotel_id = o.hotel_id and e.regimen = o.regimen and e.tipo = 'tarifa'
  where not exists (select 1 from px_a x where x.hotel_id = o.hotel_id and x.categoria = o.categoria and x.regimen = o.regimen and x.nombre = e.nombre and x.acom = o.acom)
    and not exists (  -- ninguna vigencia de MAYOR prioridad, de cualquier tipo, con precio para esa acomodación
      select 1 from ent q join px_a x on x.hotel_id = q.hotel_id and x.categoria = o.categoria and x.regimen = o.regimen and x.nombre = q.nombre and x.acom = o.acom
      where q.hotel_id = o.hotel_id and q.regimen = o.regimen and q.dia = e.dia and q.prioridad > e.prioridad
    )
    and e.prioridad = (select b.mpb from tope_base b where b.hotel_id = e.hotel_id and b.regimen = e.regimen and b.dia = e.dia)
),
det_sin_precio as (
  select hotel_id, categoria, regimen, acom, vigencia, fila_existe, hay_otra_con_precio, count(*) as noches,
         'hotel ' || hotel_id || ' · ' || categoria || ' / ' || regimen || ' · ' || acom || ' · vigencia "' || vigencia || '" '
           || case when fila_existe then 'tiene fila pero sin precio en esa acomodación' else 'no tiene fila' end
           || ' · ' || count(*) || ' noche(s) del ' || min(dia) || ' al ' || max(dia) as texto
  from sin_precio group by 1, 2, 3, 4, 5, 6, 7
),
-- ── Duplicados ──
dup_exacta as (
  select hotel_id, tipo_habitacion, alimentacion, temporada, count(*) as n
  from public.tarifa_hotel group by 1, 2, 3, 4 having count(*) > 1
),
dup_recortada as (
  select hotel_id, btrim(coalesce(tipo_habitacion, '')) as c, btrim(coalesce(alimentacion, '')) as a, btrim(coalesce(temporada, '')) as t, count(*) as n
  from public.tarifa_hotel group by 1, 2, 3, 4
  having count(*) > 1
     and count(distinct (coalesce(tipo_habitacion, ''), coalesce(alimentacion, ''), coalesce(temporada, ''))) > 1
),
-- ── Empates ──
empates as (
  select e.hotel_id, e.regimen, e.dia, array_agg(distinct e.nombre order by e.nombre) as nombres
  from ent e
  join tope t on t.hotel_id = e.hotel_id and t.regimen = e.regimen and t.dia = e.dia and t.mp = e.prioridad
  where exists (select 1 from public.tarifa_hotel tf where tf.hotel_id = e.hotel_id and tf.temporada = e.nombre and tf.alimentacion = e.regimen
                  and (coalesce(tf.neto_sencilla, 0) > 0 or coalesce(tf.neto_doble, 0) > 0 or coalesce(tf.neto_triple, 0) > 0 or coalesce(tf.neto_multiple, 0) > 0))
  group by 1, 2, 3
  having count(distinct e.nombre) > 1
),
-- ── Promoción que gana con una base distinta de su temporada_base ──
promos as (
  select distinct tf.hotel_id, tf.temporada as promo, tf.alimentacion as regimen, tf.temporada_base as base
  from public.tarifa_hotel tf
  where coalesce(tf.precio_final_autoritativo, false) and tf.temporada_base is not null
),
base_ganadora as (
  select e.hotel_id, e.regimen, e.dia, array_agg(distinct e.nombre order by e.nombre) as nombres
  from ent e join tope_base b on b.hotel_id = e.hotel_id and b.regimen = e.regimen and b.dia = e.dia and b.mpb = e.prioridad
  where e.tipo = 'tarifa' group by 1, 2, 3
),
rescates as (
  select pr.hotel_id, pr.promo, pr.regimen, pr.base, e.dia, bg.nombres as base_que_gana
  from promos pr
  join ent e on e.hotel_id = pr.hotel_id and e.nombre = pr.promo and e.regimen = pr.regimen
  join tope t on t.hotel_id = e.hotel_id and t.regimen = e.regimen and t.dia = e.dia and t.mp = e.prioridad
  left join base_ganadora bg on bg.hotel_id = e.hotel_id and bg.regimen = e.regimen and bg.dia = e.dia
  where bg.nombres is distinct from array[pr.base]
),
-- ── Nombres repetidos (condición para habilitar grupos ligados al id de la vigencia) ──
nombres_multiples as (
  select t.hotel_id, t.nombre, count(*) as n,
         string_agg('id=' || t.id || ' [' || coalesce(t.tipo, 'tarifa') || ', prioridad ' || coalesce(t.prioridad, 1)
                    || ', régimen ' || coalesce(t.regimen_restringido, 'todos')
                    || ', compra ' || coalesce(t.compra_inicio::text, '…') || '→' || coalesce(t.compra_fin::text, '…')
                    || ', viaje ' || coalesce(t.fecha_inicio::text, '…') || '→' || coalesce(t.fecha_fin::text, '…') || ']',
                    ' · ' order by t.id) as filas
  from public.hotel_temporadas t where t.nombre is not null group by 1, 2 having count(*) > 1
),
unidad_cruce as (
  select d.hotel_id, d.dia, count(distinct d.nombre) as n
  from dias d join hoteles_ok h on h.id = d.hotel_id and h.modelo = 'unidad'
  group by 1, 2 having count(distinct d.nombre) > 1
),
combos_sin_tarifa as (
  select hc.hotel_id, ch.nombre as categoria, r.regimen
  from public.hotel_categorias hc
  join public.categorias_habitacion ch on ch.id = hc.categoria_id
  join (select hr.hotel_id, pa.codigo as regimen from public.hotel_regimenes hr join public.planes_alimentacion pa on pa.id = hr.plan_id) r on r.hotel_id = hc.hotel_id
  join hoteles_ok h on h.id = hc.hotel_id and h.modelo <> 'unidad'
  where not exists (select 1 from combos c where c.hotel_id = hc.hotel_id and c.categoria = ch.nombre and c.regimen = r.regimen)
),
promos_sin_base as (
  select distinct tf.hotel_id, tf.temporada, tf.alimentacion
  from public.tarifa_hotel tf
  join public.hotel_temporadas t on t.hotel_id = tf.hotel_id and t.nombre = tf.temporada and coalesce(t.tipo, 'tarifa') in ('descuento_pct', 'descuento_monto')
  where not coalesce(tf.precio_final_autoritativo, false)
),
acom_deshabilitadas as (select hotel_id, acom from cfg where not habilitada and acom in ('sencilla', 'doble', 'triple', 'multiple')),
inc as (
  select (select count(*) from hoteles_incompletos hi join hoteles_ok h on h.id = hi.hotel_id and h.modelo <> 'unidad') as personas,
         (select count(*) from hoteles_incompletos hi join hoteles_ok h on h.id = hi.hotel_id and h.modelo = 'unidad') as unidad
),
resultado as (
  -- 0 · parámetros
  select 0::numeric as ord, 'Parámetros: horizonte de análisis en días (noches de hoy a hoy + horizonte, hoy en Bogotá)' as control,
         (select horizonte from p)::bigint as observado, '365 (fijo)' as esperado, 'INFO' as estado, 0::bigint as hoteles_incompletos,
         (select 'del ' || hoy || ' al ' || (hoy + horizonte) from p) as ejemplo
  union all
  select 1, 'Tarifas duplicadas (clave exacta: hotel, categoría, régimen, temporada)',
         (select count(*) from dup_exacta), '0',
         case when (select count(*) from dup_exacta) = 0 then 'OK' else 'REVISAR' end, 0,
         (select 'hotel ' || hotel_id || ' · ' || coalesce(tipo_habitacion, '∅') || ' / ' || coalesce(alimentacion, '∅') || ' / ' || coalesce(temporada, '∅') || ' (' || n || ' filas)'
          from dup_exacta order by n desc, hotel_id limit 1)
  union all
  select 2, 'Tarifas duplicadas solo tras recortar espacios (clave de la generación, migración 203)',
         (select count(*) from dup_recortada), '0',
         case when (select count(*) from dup_recortada) = 0 then 'OK' else 'REVISAR' end, 0,
         (select 'hotel ' || hotel_id || ' · ' || c || ' / ' || a || ' / ' || t || ' (' || n || ' filas)' from dup_recortada order by n desc, hotel_id limit 1)
  union all
  select 3, 'Rangos o blackouts inválidos (todas las vigencias): formato, día inexistente, inicio > fin o estructura no válida',
         (select count(*) from invalidos), '0',
         case when (select count(*) from invalidos) = 0 then 'OK' else 'REVISAR' end, 0,
         (select 'hotel ' || hotel_id || ' · "' || nombre || '" (' || clase || ') ' || crudo from invalidos order by hotel_id, nombre limit 1)
  union all
  select 3 + (row_number() over (order by i.hotel_id, i.nombre, i.vig_id, i.crudo))::numeric / 10000,
         '   detalle fecha/estructura inválida', 1, '0', 'REVISAR', 0,
         'hotel ' || i.hotel_id || ' · vigencia id=' || i.vig_id || ' "' || i.nombre || '" · ' || i.clase || ' · ' || i.crudo
           || case when i.compra_vigente then ' · con compra vigente (afecta el diagnóstico)' else ' · compra cerrada (no afecta el diagnóstico)' end
  from (select * from invalidos order by hotel_id, nombre, vig_id, crudo limit 200) i
  union all
  select 4, 'Hoteles con fechas/estructura inválidas en vigencias con compra vigente: sus resultados de los controles 5–9 y 11 pueden estar INCOMPLETOS',
         (select count(*) from hoteles_incompletos), '0',
         case when (select count(*) from hoteles_incompletos) = 0 then 'OK' else 'INCOMPLETO' end,
         (select count(*) from hoteles_incompletos),
         (select 'hotel ' || hotel_id from hoteles_incompletos order by hotel_id limit 1)
  union all
  select 5, 'Noches con empate de prioridad entre vigencias con precio (hotel × régimen × día) · horizonte ' || (select horizonte from p) || ' d',
         (select count(*) from empates), '0',
         case when (select count(*) from empates) > 0 and (select personas from inc) > 0 then 'REVISAR (INCOMPLETO)'
              when (select count(*) from empates) > 0 then 'REVISAR'
              when (select personas from inc) > 0 then 'INCOMPLETO' else 'OK' end,
         (select personas from inc),
         (select 'hotel ' || hotel_id || ' · ' || regimen || ' · ' || dia || ' · ' || array_to_string(nombres, ' = ') from empates order by hotel_id, dia limit 1)
  union all
  select 6, 'Noches en que una promoción con precio final gana con una base distinta de su temporada_base · horizonte ' || (select horizonte from p) || ' d',
         (select count(*) from rescates), '0',
         case when (select count(*) from rescates) > 0 and (select personas from inc) > 0 then 'REVISAR (INCOMPLETO)'
              when (select count(*) from rescates) > 0 then 'REVISAR'
              when (select personas from inc) > 0 then 'INCOMPLETO' else 'OK' end,
         (select personas from inc),
         (select 'hotel ' || hotel_id || ' · promo "' || promo || '" (base declarada "' || base || '") · ' || regimen || ' · ' || dia
                 || ' · base que gana: ' || coalesce(array_to_string(base_que_gana, ' = '), 'ninguna') from rescates order by hotel_id, dia limit 1)
  union all
  select 7, 'Noches × acomodación: la base prioritaria no tiene precio para esa acomodación y se vende con otra vigencia · horizonte ' || (select horizonte from p) || ' d',
         (select count(*) from sin_precio where hay_otra_con_precio), '0',
         case when (select count(*) from sin_precio where hay_otra_con_precio) > 0 and (select personas from inc) > 0 then 'REVISAR (INCOMPLETO)'
              when (select count(*) from sin_precio where hay_otra_con_precio) > 0 then 'REVISAR'
              when (select personas from inc) > 0 then 'INCOMPLETO' else 'OK' end,
         (select personas from inc),
         (select 'hotel ' || hotel_id || ' · ' || categoria || ' / ' || regimen || ' · ' || acom || ' · vigencia "' || vigencia || '" '
                 || case when fila_existe then 'tiene fila pero sin precio en esa acomodación' else 'no tiene fila' end || ' · ' || dia
          from sin_precio where hay_otra_con_precio order by hotel_id, dia, acom limit 1)
  union all
  select 7 + (row_number() over (order by d.hotel_id, d.categoria, d.regimen, d.acom, d.vigencia))::numeric / 10000,
         '   detalle noches sin precio de la acomodación (cae a otra vigencia)', d.noches, '—', 'REVISAR', (select personas from inc), d.texto
  from (select * from det_sin_precio where hay_otra_con_precio order by hotel_id, categoria, regimen, acom, vigencia limit 200) d
  union all
  select 8, 'Noches × acomodación sin precio alguno (la base prioritaria no la cubre y ninguna otra vigencia tiene precio) · horizonte ' || (select horizonte from p) || ' d',
         (select count(*) from sin_precio where not hay_otra_con_precio), '0',
         case when (select count(*) from sin_precio where not hay_otra_con_precio) > 0 and (select personas from inc) > 0 then 'REVISAR (INCOMPLETO)'
              when (select count(*) from sin_precio where not hay_otra_con_precio) > 0 then 'REVISAR'
              when (select personas from inc) > 0 then 'INCOMPLETO' else 'OK' end,
         (select personas from inc),
         (select 'hotel ' || hotel_id || ' · ' || categoria || ' / ' || regimen || ' · ' || acom || ' · vigencia "' || vigencia || '" '
                 || case when fila_existe then 'tiene fila pero sin precio en esa acomodación' else 'no tiene fila' end || ' · ' || dia
          from sin_precio where not hay_otra_con_precio order by hotel_id, dia, acom limit 1)
  union all
  select 8 + (row_number() over (order by d.hotel_id, d.categoria, d.regimen, d.acom, d.vigencia))::numeric / 10000,
         '   detalle noches sin precio alguno de la acomodación', d.noches, '—', 'REVISAR', (select personas from inc), d.texto
  from (select * from det_sin_precio where not hay_otra_con_precio order by hotel_id, categoria, regimen, acom, vigencia limit 200) d
  union all
  select 9, 'Acomodaciones ofertadas sin precio en NINGUNA vigencia de una combinación vendida (hotel × categoría × régimen × acomodación)',
         (select count(*) from nunca_cargada), '0',
         case when (select count(*) from nunca_cargada) > 0 and (select personas from inc) > 0 then 'REVISAR (INCOMPLETO)'
              when (select count(*) from nunca_cargada) > 0 then 'REVISAR'
              when (select personas from inc) > 0 then 'INCOMPLETO' else 'OK' end,
         (select personas from inc),
         (select 'hotel ' || hotel_id || ' · ' || categoria || ' / ' || regimen || ' · ' || acom || ' sin precio en ninguna vigencia' from nunca_cargada order by hotel_id, categoria, regimen, acom limit 1)
  union all
  select 9 + (row_number() over (order by n.hotel_id, n.categoria, n.regimen, n.acom))::numeric / 10000,
         '   detalle acomodación ofertada nunca cargada', 1, '—', 'REVISAR', (select personas from inc),
         'hotel ' || n.hotel_id || ' · ' || n.categoria || ' / ' || n.regimen || ' · ' || n.acom || ' sin precio en ninguna vigencia'
  from (select * from nunca_cargada order by hotel_id, categoria, regimen, acom limit 200) n
  union all
  select 10, 'Nombres de vigencia con más de una fila en hotel_temporadas (condición para enlazar grupos al id de la vigencia)',
         (select count(*) from nombres_multiples), '0 (o decisión caso por caso; ver detalle 10.xxxx)',
         case when (select count(*) from nombres_multiples) = 0 then 'OK' else 'INFO' end, 0,
         (select 'hotel ' || hotel_id || ' · "' || nombre || '" (' || n || ' filas)' from nombres_multiples order by n desc, hotel_id limit 1)
  union all
  select 10 + (row_number() over (order by m.hotel_id, m.nombre))::numeric / 10000,
         '   detalle nombre repetido', m.n, '—', 'INFO', 0,
         'hotel ' || m.hotel_id || ' · "' || m.nombre || '" · ' || m.filas
  from (select * from nombres_multiples order by hotel_id, nombre limit 200) m
  union all
  select 11, 'Hoteles por unidad con noches cubiertas por más de una vigencia (hotel × día) · horizonte ' || (select horizonte from p) || ' d',
         (select count(*) from unidad_cruce), '0 (el modelo por unidad bloquea estadías con varias temporadas)',
         case when (select unidad from inc) > 0 and (select count(*) from unidad_cruce) > 0 then 'INFO (INCOMPLETO)'
              when (select unidad from inc) > 0 then 'INCOMPLETO' else 'INFO' end,
         (select unidad from inc),
         (select 'hotel ' || hotel_id || ' · ' || dia || ' · ' || n || ' vigencias' from unidad_cruce order by hotel_id, dia limit 1)
  union all
  select 12, 'Vigencias con compra vigente y noches posteriores al horizonte (NO analizadas más allá de hoy + ' || (select horizonte from p) || ' d)',
         (select count(*) from fuera_horizonte), 'informativo',
         'INFO', 0,
         (select 'hotel ' || hotel_id || ' · "' || nombre || '" hasta ' || fin_max from fuera_horizonte order by fin_max desc, hotel_id limit 1)
  union all
  select 13, 'Combinaciones configuradas (categoría × régimen) sin ningún precio cargado',
         (select count(*) from combos_sin_tarifa), 'informativo', 'INFO', 0,
         (select 'hotel ' || hotel_id || ' · ' || categoria || ' / ' || regimen from combos_sin_tarifa order by hotel_id limit 1)
  union all
  select 14, 'Promociones con tarifa escrita a mano (sin precio final ni temporada_base): sin protección contra el rescate de base',
         (select count(*) from promos_sin_base), 'informativo', 'INFO', 0,
         (select 'hotel ' || hotel_id || ' · "' || temporada || '" / ' || coalesce(alimentacion, '∅') from promos_sin_base order by hotel_id limit 1)
  union all
  select 15, 'Acomodaciones de habitación deshabilitadas en hotel_acomodaciones (pax_max o pax_tarifa = 0): se excluyen de «ofertadas» salvo que tengan precio',
         (select count(*) from acom_deshabilitadas), 'informativo', 'INFO', 0,
         (select 'hotel ' || hotel_id || ' · ' || acom from acom_deshabilitadas order by hotel_id, acom limit 1)
)
select case when ord = trunc(ord) then trunc(ord)::text else to_char(ord, 'FM990.0000') end as orden, control, observado, esperado, estado, hoteles_incompletos, ejemplo
from resultado order by ord;
