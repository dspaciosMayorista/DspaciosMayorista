-- ─────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO DE SOLO LECTURA · #43/#60 (vigencias por grupos de días)       versión 3 (optimizada)
-- Una sola consulta (un solo SELECT con CTE). No escribe, no crea objetos, no regenera nada.
--
-- VERSIÓN 3 · por qué cambió: la versión 2 agotaba el tiempo de espera del editor SQL. Se midió en un Postgres local desechable: con
-- 50 hoteles sintéticos la versión 2 no terminó en 600 s (tiempo máximo que se le dio). La causa medida (EXPLAIN ANALYZE): subconsultas
-- correlacionadas y bucles anidados sobre CTE sin índices (cientos de millones de comparaciones descartadas en `sin_precio` y `rescates`).
-- Cambios: (1) los días de un hotel y régimen con EXACTAMENTE las mismas vigencias activas se agrupan en una «firma» y se analizan una
-- vez, multiplicando por su número de días; (2) los cruces entre conjuntos grandes se resuelven con funciones de ventana sobre uniones
-- etiquetadas y agregaciones, no con subconsultas correlacionadas; (3) las acomodaciones viajan como máscara de bits por
-- (hotel, categoría, régimen, vigencia) y se abren a una fila por acomodación solo al final.
-- NO cambia nada de lo que se mide: mismos controles, mismas reglas, mismo horizonte completo (365 días), mismos avisos INCOMPLETO,
-- todos los hoteles. Equivalencia verificada contra la versión 2 (supabase/scripts/referencia/) en el fixture pequeño (todas las columnas)
-- y con datos sintéticos de volumen (controles, estados y todas las filas de detalle); solo el texto «ejemplo» puede elegir otro caso
-- entre empates que la versión 2 resolvía de forma arbitraria (ahora el desempate es determinista).
-- Tiempos y límites medidos: docs/tecnico/vigencias-por-dia-43-60.md, §J. El tiempo depende del volumen de datos y de la configuración del
-- servidor (p. ej. JIT); esta consulta no cambia ninguna configuración.
-- Pegar COMPLETA en el editor SQL de Supabase y ejecutar. Devuelve una fila por control
-- (más filas de detalle «n.xxxx» bajo los controles 3, 7, 8, 9 y 10) con las columnas:
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
-- ── OPTIMIZACIÓN (v4): firmas de días + ventanas en lugar de subconsultas correlacionadas ──
-- Los días de un mismo hotel y régimen que tienen EXACTAMENTE el mismo conjunto de vigencias activas se resuelven igual.
-- Se agrupan en una «firma» (con su número de días y su primer/último día) y todo el análisis posterior se hace por firma y se
-- multiplica por el número de días: la suma de `nodias` es el número de noches del horizonte; no se pierde ningún día ni hotel.
-- Los cruces entre conjuntos grandes (precio por acomodación, existencia de fila, prioridad máxima) se resuelven con funciones de
-- ventana sobre uniones etiquetadas: su costo no depende de las estimaciones del planificador (los bucles anidados sobre CTE sin
-- índices eran el origen del tiempo de espera).
dias_reg as (
  select d.hotel_id, r.regimen, d.dia, d.vig_id
  from dias d
  join hoteles_ok h on h.id = d.hotel_id and h.modelo <> 'unidad'
  join reg r on r.hotel_id = d.hotel_id and (d.regimen_restringido is null or d.regimen_restringido = r.regimen)
  where d.tipo <> 'promo_noche_gratis'
),
firma as (
  select row_number() over (order by hotel_id, regimen, vigs) as fid, hotel_id, regimen, vigs,
         count(*) as nodias, min(dia) as d1, max(dia) as d2
  from (select hotel_id, regimen, dia, array_agg(vig_id order by vig_id) as vigs from dias_reg group by 1, 2, 3) x
  group by hotel_id, regimen, vigs
),
ent0 as (  -- entradas por firma (equivale a «entradas por noche» agrupadas)
  select f.fid, f.hotel_id, f.regimen, f.nodias, f.d1, f.d2, v.id as vig_id, v.nombre, v.tipo, v.prioridad
  from firma f
  cross join lateral unnest(f.vigs) u(vig_id)
  join vig_all v on v.id = u.vig_id
),
ent1 as (  -- prioridad máxima de la firma y de sus vigencias base
  select e.*, max(e.prioridad) over (partition by e.fid) as mp,
         max(e.prioridad) filter (where e.tipo = 'tarifa') over (partition by e.fid) as mpb
  from ent0 e
),
ent as (  -- nombres mínimo y máximo de las bases ganadoras (una sola base gana exactamente cuando coinciden)
  select e.*, min(e.nombre) filter (where e.tipo = 'tarifa' and e.prioridad = e.mpb) over (partition by e.fid) as bmin,
              max(e.nombre) filter (where e.tipo = 'tarifa' and e.prioridad = e.mpb) over (partition by e.fid) as bmax
  from ent1 e
),
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
-- Las acomodaciones se llevan como MÁSCARA de bits por (hotel, categoría, régimen[, vigencia]): 1 sencilla, 2 doble, 4 triple, 8 múltiple, 16 niño 1, 32 niño 2.
-- Así cada fila candidata cubre las seis acomodaciones a la vez (antes era una fila por acomodación) y solo al final se abre en una fila por acomodación faltante.
--   c_rows : bases prioritarias de cada firma × categorías con acomodaciones ofertadas y con precio en la combinación (máscara omask).
--   p_agg  : por (firma, categoría), la prioridad más alta entre las entradas de la firma que tienen precio para cada acomodación (p1..p6).
--   sp1/sp2: se unen con C por ventana: pm1..pm6 (prioridad máxima con precio) y la máscara de precio de la propia vigencia.
-- Se marca la base sin precio propio cuando nadie de mayor prioridad tiene precio (pm nulo o ≤ su prioridad); hay otra vigencia con precio exactamente cuando pm no es nulo.
of_cp as (
  select hotel_id, categoria, regimen, acom from ofertadas
  intersect
  select hotel_id, categoria, regimen, acom from con_precio_en_combo
),
bits(acom, bit) as (values ('sencilla', 1), ('doble', 2), ('triple', 4), ('multiple', 8), ('nino', 16), ('nino2', 32)),
of_mask as (
  select o.hotel_id, o.categoria, o.regimen, bit_or(b.bit) as omask
  from of_cp o join bits b on b.acom = o.acom
  group by 1, 2, 3
),
px_m as (
  select tf.hotel_id, tf.tipo_habitacion as categoria, tf.alimentacion as regimen, tf.temporada as nombre,
         bit_or((case when coalesce(tf.neto_sencilla, 0) > 0 then 1 else 0 end) | (case when coalesce(tf.neto_doble, 0) > 0 then 2 else 0 end)
              | (case when coalesce(tf.neto_triple, 0) > 0 then 4 else 0 end) | (case when coalesce(tf.neto_multiple, 0) > 0 then 8 else 0 end)
              | (case when tf.neto_nino is not null then 16 else 0 end) | (case when tf.neto_nino2 is not null then 32 else 0 end)) as mask
  from public.tarifa_hotel tf
  group by 1, 2, 3, 4
),
p_agg as (
  select e.fid, x.categoria,
         max(e.prioridad) filter (where x.mask & 1 > 0) as p1, max(e.prioridad) filter (where x.mask & 2 > 0) as p2,
         max(e.prioridad) filter (where x.mask & 4 > 0) as p3, max(e.prioridad) filter (where x.mask & 8 > 0) as p4,
         max(e.prioridad) filter (where x.mask & 16 > 0) as p5, max(e.prioridad) filter (where x.mask & 32 > 0) as p6
  from ent e
  join px_m x on x.hotel_id = e.hotel_id and x.regimen = e.regimen and x.nombre = e.nombre
  group by 1, 2
),
c_rows as (
  select o.hotel_id, o.categoria, o.regimen, o.omask, e.fid, e.nombre, e.prioridad, e.nodias, e.d1, e.d2
  from of_mask o
  join ent e on e.hotel_id = o.hotel_id and e.regimen = o.regimen and e.tipo = 'tarifa' and e.prioridad = e.mpb
),
sp1 as (
  select u.*,
         max(u.p1) filter (where u.tag = 'P') over (partition by u.fid, u.categoria) as pm1, max(u.p2) filter (where u.tag = 'P') over (partition by u.fid, u.categoria) as pm2,
         max(u.p3) filter (where u.tag = 'P') over (partition by u.fid, u.categoria) as pm3, max(u.p4) filter (where u.tag = 'P') over (partition by u.fid, u.categoria) as pm4,
         max(u.p5) filter (where u.tag = 'P') over (partition by u.fid, u.categoria) as pm5, max(u.p6) filter (where u.tag = 'P') over (partition by u.fid, u.categoria) as pm6
  from (
    select 'C'::text as tag, c.fid, c.categoria, c.hotel_id, c.regimen, c.nombre, c.prioridad, c.omask, c.nodias, c.d1, c.d2,
           null::int as p1, null::int as p2, null::int as p3, null::int as p4, null::int as p5, null::int as p6 from c_rows c
    union all
    select 'P', p.fid, p.categoria, null::bigint, null::text, null::text, null::int, null::int, null::bigint, null::date, null::date, p.p1, p.p2, p.p3, p.p4, p.p5, p.p6 from p_agg p
  ) u
),
sp2 as (
  select w.*, bit_or(w.mk) filter (where w.tag = 'X') over (partition by w.hotel_id, w.categoria, w.regimen, w.nombre) as propio
  from (
    select 'C'::text as tag, s.hotel_id, s.categoria, s.regimen, s.nombre, s.prioridad, s.omask, s.nodias, s.d1, s.d2, s.pm1, s.pm2, s.pm3, s.pm4, s.pm5, s.pm6, null::int as mk from sp1 s where s.tag = 'C'
    union all
    select 'X', x.hotel_id, x.categoria, x.regimen, x.nombre, null::int, null::int, null::bigint, null::date, null::date, null::int, null::int, null::int, null::int, null::int, null::int, x.mask from px_m x
  ) w
),
sp_agr as (
  select c.hotel_id, c.categoria, c.regimen, b.acom, c.nombre, (b.pm is not null) as hay_otra_con_precio,
         sum(c.nodias)::bigint as noches, min(c.d1) as d1, max(c.d2) as d2
  from sp2 c
  cross join lateral (values ('sencilla', 1, c.pm1), ('doble', 2, c.pm2), ('triple', 4, c.pm3), ('multiple', 8, c.pm4), ('nino', 16, c.pm5), ('nino2', 32, c.pm6)) b(acom, bit, pm)
  where c.tag = 'C'
    and (c.omask & b.bit) > 0                    -- acomodación ofertada con precio en la combinación
    and (coalesce(c.propio, 0) & b.bit) = 0      -- la propia vigencia NO tiene precio para ella
    and (b.pm is null or b.pm <= c.prioridad)    -- y nadie de mayor prioridad lo tiene
  group by 1, 2, 3, 4, 5, 6
),
fe_u as (  -- ¿la vigencia tiene alguna fila para la combinación? (solo para redactar el detalle)
  select 'S'::text as tag, a.hotel_id, a.categoria, a.regimen, a.nombre, a.acom, a.hay_otra_con_precio, a.noches, a.d1, a.d2 from sp_agr a
  union all
  select 'F', f.hotel_id, f.categoria, f.regimen, f.nombre, null::text, null::boolean, null::bigint, null::date, null::date from fila_existe f
),
fe_w as (
  select u.*, bool_or(u.tag = 'F') over (partition by u.hotel_id, u.categoria, u.regimen, u.nombre) as fila_existe
  from fe_u u
),
sin_precio as (
  select hotel_id, categoria, regimen, acom, nombre as vigencia, fila_existe, hay_otra_con_precio, noches, d1, d2 from fe_w where tag = 'S'
),
det_sin_precio as (
  select hotel_id, categoria, regimen, acom, vigencia, fila_existe, hay_otra_con_precio, noches,
         'hotel ' || hotel_id || ' · ' || categoria || ' / ' || regimen || ' · ' || acom || ' · vigencia "' || vigencia || '" '
           || case when fila_existe then 'tiene fila pero sin precio en esa acomodación' else 'no tiene fila' end
           || ' · ' || noches || ' noche(s) del ' || d1 || ' al ' || d2 as texto
  from sin_precio
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
hab_con_precio as (
  select distinct tf.hotel_id, tf.alimentacion as regimen, tf.temporada as nombre
  from public.tarifa_hotel tf
  where coalesce(tf.neto_sencilla, 0) > 0 or coalesce(tf.neto_doble, 0) > 0 or coalesce(tf.neto_triple, 0) > 0 or coalesce(tf.neto_multiple, 0) > 0
),
emp_u as (
  select 'E'::text as tag, e.hotel_id, e.regimen, e.nombre, e.fid, e.nodias, e.d1, e.prioridad, e.mp from ent e
  union all
  select 'P', h.hotel_id, h.regimen, h.nombre, null::bigint, null::bigint, null::date, null::int, null::int from hab_con_precio h
),
emp_w as (
  select u.*, bool_or(u.tag = 'P') over (partition by u.hotel_id, u.regimen, u.nombre) as con_precio from emp_u u
),
empates as (
  select fid, hotel_id, regimen, nodias, d1, array_agg(distinct nombre order by nombre) as nombres
  from emp_w
  where tag = 'E' and con_precio and prioridad = mp
  group by fid, hotel_id, regimen, nodias, d1
  having count(distinct nombre) > 1
),
-- ── Promoción que gana con una base distinta de su temporada_base ──
promos as (
  select distinct tf.hotel_id, tf.temporada as promo, tf.alimentacion as regimen, tf.temporada_base as base
  from public.tarifa_hotel tf
  where coalesce(tf.precio_final_autoritativo, false) and tf.temporada_base is not null
),
rescates as (
  select pr.hotel_id, pr.promo, pr.regimen, pr.base, e.fid, e.nodias, e.d1
  from promos pr
  join ent e on e.hotel_id = pr.hotel_id and e.nombre = pr.promo and e.regimen = pr.regimen and e.prioridad = e.mp
  where e.bmin is null or e.bmin <> pr.base or e.bmax <> pr.base
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
         (select coalesce(sum(nodias), 0)::bigint from empates), '0',
         case when (select coalesce(sum(nodias), 0)::bigint from empates) > 0 and (select personas from inc) > 0 then 'REVISAR (INCOMPLETO)'
              when (select coalesce(sum(nodias), 0)::bigint from empates) > 0 then 'REVISAR'
              when (select personas from inc) > 0 then 'INCOMPLETO' else 'OK' end,
         (select personas from inc),
         (select 'hotel ' || hotel_id || ' · ' || regimen || ' · ' || d1 || ' · ' || array_to_string(nombres, ' = ') from empates order by hotel_id, d1, regimen, nombres limit 1)
  union all
  select 6, 'Noches en que una promoción con precio final gana con una base distinta de su temporada_base · horizonte ' || (select horizonte from p) || ' d',
         (select coalesce(sum(nodias), 0)::bigint from rescates), '0',
         case when (select coalesce(sum(nodias), 0)::bigint from rescates) > 0 and (select personas from inc) > 0 then 'REVISAR (INCOMPLETO)'
              when (select coalesce(sum(nodias), 0)::bigint from rescates) > 0 then 'REVISAR'
              when (select personas from inc) > 0 then 'INCOMPLETO' else 'OK' end,
         (select personas from inc),
         (select 'hotel ' || r.hotel_id || ' · promo "' || r.promo || '" (base declarada "' || r.base || '") · ' || r.regimen || ' · ' || r.d1
                 || ' · base que gana: ' || coalesce((select string_agg(distinct x.nombre, ' = ' order by x.nombre) from ent x where x.fid = r.fid and x.tipo = 'tarifa' and x.prioridad = x.mpb), 'ninguna')
          from (select * from rescates order by hotel_id, d1, promo, regimen, base limit 1) r)
  union all
  select 7, 'Noches × acomodación: la base prioritaria no tiene precio para esa acomodación y se vende con otra vigencia · horizonte ' || (select horizonte from p) || ' d',
         (select coalesce(sum(noches), 0)::bigint from sin_precio where hay_otra_con_precio), '0',
         case when (select coalesce(sum(noches), 0)::bigint from sin_precio where hay_otra_con_precio) > 0 and (select personas from inc) > 0 then 'REVISAR (INCOMPLETO)'
              when (select coalesce(sum(noches), 0)::bigint from sin_precio where hay_otra_con_precio) > 0 then 'REVISAR'
              when (select personas from inc) > 0 then 'INCOMPLETO' else 'OK' end,
         (select personas from inc),
         (select 'hotel ' || hotel_id || ' · ' || categoria || ' / ' || regimen || ' · ' || acom || ' · vigencia "' || vigencia || '" '
                 || case when fila_existe then 'tiene fila pero sin precio en esa acomodación' else 'no tiene fila' end || ' · ' || d1
          from sin_precio where hay_otra_con_precio order by hotel_id, d1, acom, categoria, regimen, vigencia limit 1)
  union all
  select 7 + (row_number() over (order by d.hotel_id, d.categoria, d.regimen, d.acom, d.vigencia))::numeric / 10000,
         '   detalle noches sin precio de la acomodación (cae a otra vigencia)', d.noches, '—', 'REVISAR', (select personas from inc), d.texto
  from (select * from det_sin_precio where hay_otra_con_precio order by hotel_id, categoria, regimen, acom, vigencia limit 200) d
  union all
  select 8, 'Noches × acomodación sin precio alguno (la base prioritaria no la cubre y ninguna otra vigencia tiene precio) · horizonte ' || (select horizonte from p) || ' d',
         (select coalesce(sum(noches), 0)::bigint from sin_precio where not hay_otra_con_precio), '0',
         case when (select coalesce(sum(noches), 0)::bigint from sin_precio where not hay_otra_con_precio) > 0 and (select personas from inc) > 0 then 'REVISAR (INCOMPLETO)'
              when (select coalesce(sum(noches), 0)::bigint from sin_precio where not hay_otra_con_precio) > 0 then 'REVISAR'
              when (select personas from inc) > 0 then 'INCOMPLETO' else 'OK' end,
         (select personas from inc),
         (select 'hotel ' || hotel_id || ' · ' || categoria || ' / ' || regimen || ' · ' || acom || ' · vigencia "' || vigencia || '" '
                 || case when fila_existe then 'tiene fila pero sin precio en esa acomodación' else 'no tiene fila' end || ' · ' || d1
          from sin_precio where not hay_otra_con_precio order by hotel_id, d1, acom, categoria, regimen, vigencia limit 1)
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
