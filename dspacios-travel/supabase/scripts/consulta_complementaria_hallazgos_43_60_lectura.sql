-- ─────────────────────────────────────────────────────────────────────────
-- CONSULTA COMPLEMENTARIA DE SOLO LECTURA · #43/#60 — datos que el diagnóstico no muestra
-- Un solo SELECT (UNION ALL). No escribe, no crea objetos, no corrige nada. Es liviana (no expande días).
-- Pegar COMPLETA en el editor SQL de Supabase. Devuelve: bloque · hotel_id · detalle (json).
-- Sirve para clasificar los hallazgos de docs/tecnico/vigencias-por-dia-43-60.md §K con los datos reales:
--   A  tarifa duplicada del hotel 78 (Junior Suites / MEDIA 2027): las filas completas, todas las columnas.
--   B  las dos vigencias «ABRIL 2027» del hotel 172, todas las columnas (blackouts, condición de pago, mínimo de noches…).
--   C  las vigencias con fechas inválidas: hotel 9 (id 46) y hotel 53 (id 140), y las demás vigencias del hotel 53 para ver qué pisaría ALTA.
--   D  hotel 7: sus vigencias BAJA (condición de pago, prioridad, fechas, compra) y su configuración de acomodaciones.
--   E  pares de vigencias del mismo hotel, de igual prioridad y con fechas de viaje que se cruzan (aproximación por fecha principal;
--      el control 5 del diagnóstico cuenta las noches exactas): lista TODOS los hoteles con empates, no solo el hotel 7.
--   F  qué vigencias tienen filas con precio para los hoteles con más faltantes (38, 42, 54, 74, 145, 166): por categoría, régimen y vigencia.
--   G  configuración de acomodaciones de algunos hoteles de ejemplo (1, 7, 32, 37, 47, 74).
-- Cambie los números de hotel de los bloques A–D, F y G si quiere mirar otros.
-- ─────────────────────────────────────────────────────────────────────────
select bloque, hotel_id, detalle from (
  -- A
  select 'A tarifa duplicada hotel 78' as bloque, t.hotel_id, to_jsonb(t) as detalle, t.id as ord1, 0 as ord2
  from public.tarifa_hotel t
  where t.hotel_id = 78 and t.tipo_habitacion = 'Junior Suites' and t.temporada = 'MEDIA 2027'
  union all
  -- B
  select 'B vigencias ABRIL 2027 hotel 172', v.hotel_id, to_jsonb(v), v.id, 0
  from public.hotel_temporadas v
  where v.hotel_id = 172 and v.nombre = 'ABRIL 2027'
  union all
  -- C
  select 'C fechas inválidas hotel 9 y 53', v.hotel_id, to_jsonb(v), v.id, 0
  from public.hotel_temporadas v
  where v.id in (46, 140)
  union all
  select 'C otras vigencias del hotel 53', v.hotel_id,
         jsonb_build_object('id', v.id, 'nombre', v.nombre, 'tipo', v.tipo, 'prioridad', v.prioridad, 'fecha_inicio', v.fecha_inicio,
                            'fecha_fin', v.fecha_fin, 'rangos', v.rangos, 'blackouts', v.blackouts, 'compra_inicio', v.compra_inicio,
                            'compra_fin', v.compra_fin, 'regimen_restringido', v.regimen_restringido),
         v.id, 1
  from public.hotel_temporadas v
  where v.hotel_id = 53
  union all
  -- D
  select 'D vigencias BAJA hotel 7', v.hotel_id, to_jsonb(v), v.id, 0
  from public.hotel_temporadas v
  where v.hotel_id = 7 and v.nombre ilike '%BAJA%'
  union all
  select 'D acomodaciones hotel 7', a.hotel_id, to_jsonb(a), a.id, 1
  from public.hotel_acomodaciones a
  where a.hotel_id = 7
  union all
  -- E
  select 'E pares con igual prioridad y fechas cruzadas', a.hotel_id,
         jsonb_build_object('prioridad', a.prioridad, 'tipo_a', a.tipo, 'vigencia_a', a.nombre, 'id_a', a.id, 'viaje_a', a.fecha_inicio || ' → ' || a.fecha_fin,
                            'compra_a', coalesce(a.compra_inicio::text, '…') || ' → ' || coalesce(a.compra_fin::text, '…'), 'regimen_a', a.regimen_restringido,
                            'tipo_b', b.tipo, 'vigencia_b', b.nombre, 'id_b', b.id, 'viaje_b', b.fecha_inicio || ' → ' || b.fecha_fin,
                            'compra_b', coalesce(b.compra_inicio::text, '…') || ' → ' || coalesce(b.compra_fin::text, '…'), 'regimen_b', b.regimen_restringido),
         a.id, b.id
  from public.hotel_temporadas a
  join public.hotel_temporadas b on b.hotel_id = a.hotel_id and b.id > a.id and b.prioridad = a.prioridad and b.nombre <> a.nombre
       and a.fecha_inicio <= b.fecha_fin and b.fecha_inicio <= a.fecha_fin
  where coalesce(a.tipo, 'tarifa') <> 'promo_noche_gratis' and coalesce(b.tipo, 'tarifa') <> 'promo_noche_gratis'
  union all
  -- F
  select 'F filas con precio por vigencia', t.hotel_id,
         jsonb_build_object('categoria', t.tipo_habitacion, 'regimen', t.alimentacion, 'vigencia', t.temporada,
                            'filas', count(*),
                            'con_sencilla', count(*) filter (where coalesce(t.neto_sencilla, 0) > 0), 'con_doble', count(*) filter (where coalesce(t.neto_doble, 0) > 0),
                            'con_triple', count(*) filter (where coalesce(t.neto_triple, 0) > 0), 'con_multiple', count(*) filter (where coalesce(t.neto_multiple, 0) > 0),
                            'con_nino', count(*) filter (where t.neto_nino is not null), 'con_nino2', count(*) filter (where t.neto_nino2 is not null)),
         t.hotel_id, 2
  from public.tarifa_hotel t
  where t.hotel_id in (38, 42, 54, 74, 145, 166)
  group by t.hotel_id, t.tipo_habitacion, t.alimentacion, t.temporada
  union all
  select 'F vigencias de esos hoteles', v.hotel_id,
         jsonb_build_object('id', v.id, 'nombre', v.nombre, 'tipo', v.tipo, 'prioridad', v.prioridad, 'viaje', v.fecha_inicio || ' → ' || v.fecha_fin,
                            'compra', coalesce(v.compra_inicio::text, '…') || ' → ' || coalesce(v.compra_fin::text, '…'), 'regimen_restringido', v.regimen_restringido),
         v.id, 3
  from public.hotel_temporadas v
  where v.hotel_id in (38, 42, 54, 74, 145, 166)
  union all
  -- G
  select 'G acomodaciones configuradas', a.hotel_id, to_jsonb(a), a.id, 0
  from public.hotel_acomodaciones a
  where a.hotel_id in (1, 7, 32, 37, 47, 74)
) x
order by bloque, hotel_id, ord1, ord2;
