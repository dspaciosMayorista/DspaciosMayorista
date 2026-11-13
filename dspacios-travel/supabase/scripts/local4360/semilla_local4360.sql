-- ENTORNO LOCAL #43/#60 — datos SINTÉTICOS (ningún dato copiado de Producción). Ids 4360xx.
-- Se carga una sola vez al preparar el entorno; «restaurar» vuelve a esta foto.
\set ON_ERROR_STOP 1
begin;

-- Catálogo
insert into public.planes_alimentacion (codigo, nombre) values ('PAM', 'Plan media pensión (local)'), ('PC', 'Plan completo (local)'), ('FULL', 'Todo incluido (local)')
on conflict (codigo) do nothing;
insert into public.categorias_habitacion (nombre) values ('Estándar'), ('Superior') on conflict (nombre) do nothing;
insert into public.destinos (id, nombre) values (436001, 'LOCAL CARTAGENA') on conflict (id) do nothing;

-- Hoteles: uno por calculadora + uno sin grupos + uno por unidad (este último nunca muestra grupos ni calculadora por grupo).
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario) values
  (436001, 436001, 'LOCAL 1 · Dubai con grupos', 'persona'),
  (436002, 436001, 'LOCAL 2 · Mixta con grupos', 'persona'),
  (436003, 436001, 'LOCAL 3 · Corporativa con grupos', 'persona'),
  (436004, 436001, 'LOCAL 4 · Dubai sin grupos', 'persona'),
  (436005, 436001, 'LOCAL 5 · Por unidad', 'unidad')
on conflict (id) do nothing;
insert into public.hotel_categorias (hotel_id, categoria_id)
  select h, c.id from generate_series(436001, 436005) h, public.categorias_habitacion c where c.nombre in ('Estándar', 'Superior');
insert into public.hotel_regimenes (hotel_id, plan_id)
  select h, p.id from generate_series(436001, 436005) h, public.planes_alimentacion p where p.codigo in ('PAM', 'PC', 'FULL');

-- Vigencias: ALTA y BAJA (compra abierta), CERRADA (compra cerrada en 2020) y una promoción del hotel 1.
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, compra_inicio, compra_fin)
  select h * 10 + n, h, v.nombre, v.ini::date, v.fin::date, v.prio, 'tarifa', v.ci::date, v.cf::date
  from generate_series(436001, 436005) h,
       (values (1, 'ALTA', '2027-01-01', '2027-03-31', 1, null, null),
               (2, 'BAJA', '2027-04-01', '2027-06-30', 1, null, null),
               (3, 'CERRADA', '2027-07-01', '2027-07-31', 1, '2020-01-01', '2020-12-31')) v(n, nombre, ini, fin, prio, ci, cf);
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor)
values (4360014, 436001, 'PROMO-ALTA', '2027-02-01', '2027-02-28', 4, 'descuento_pct', 10);

-- Tarifas «todos los días» (lo que se vende hoy): sin triple en Superior y sin niño en Estándar PAM, para
-- que la revisión del grupo muestre acomodaciones «antes sin venta».
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino)
  select h, c, r, t, s, d, tr, m, n
  from generate_series(436001, 436004) h,
       (values ('Estándar', 'PAM', 'ALTA', 150000, 100000, 90000, 85000, null),
               ('Superior', 'PAM', 'ALTA', 225000, 150000, 0, 120000, 75000),
               ('Estándar', 'PAM', 'BAJA', 120000, 80000, 72000, 68000, 40000)) x(c, r, t, s, d, tr, m, n);

-- Calculadoras guardadas (generales del hotel): Dubai, Mixta, Corporativa y Dubai sin grupos.
insert into public.hotel_calculadora (hotel_id, tipo, params) values
  (436001, 'dubai', '{"regimen_base":"PAM","modificadores":{"sencilla_pct":50,"pax3_pct":-20,"pax4_pct":-25,"nino_pct":-50,"infante_pct":-100},
    "suplementos":[{"regimen":"PC","monto":45000},{"regimen":"FULL","monto":100000}],
    "bases":[{"categoria":"Estándar","temporada":"ALTA","precio":100000},{"categoria":"Superior","temporada":"ALTA","precio":150000}],
    "promos":[{"temporadaBase":"ALTA","temporadaPromo":"PROMO-ALTA","regimen":"PAM","descuentoPct":10}],"infante_nota":"Comparte cama"}'),
  (436002, 'mixta', '{"regimen":"PAM","iva_pct":19,"acom":{"sencilla":{"modo":"pax","iva":true},"doble":{"modo":"hab","iva":false},"triple":{"modo":"pax","iva":false},"multiple":{"modo":"pax","iva":false}},
    "nino":{"iva":true},"pax":{"sencilla":1,"doble":2,"triple":3,"multiple":4},
    "bases":[{"categoria":"Estándar","temporada":"ALTA","sencilla":200000,"doble":300000,"triple":0,"multiple":0,"nino":50000,"nino2":null,"infante":0}],
    "bases_por_regimen":{"PAM":[{"categoria":"Estándar","temporada":"ALTA","sencilla":200000,"doble":300000,"triple":0,"multiple":0,"nino":50000,"nino2":null,"infante":0}]},
    "infante_nota":"Cuna"}'),
  (436003, 'corporativa', '{"regimen_base":"PAM","persona_adicional":90000,"nino_adicional":40000,"impuesto_pct":0,"descuento_pct":10,
    "suplementos_regimen":[{"regimen":"PC","adulto":30000,"nino":15000},{"regimen":"FULL","adulto":80000,"nino":40000}],
    "bases":[{"categoria":"Estándar","temporada":"ALTA","precio":400000}],"infante_nota":"Infante cortesía"}'),
  (436004, 'dubai', '{"regimen_base":"PAM","modificadores":{"sencilla_pct":50,"pax3_pct":-20,"pax4_pct":-20,"nino_pct":-50,"infante_pct":-100},
    "suplementos":[{"regimen":"PC","monto":45000},{"regimen":"FULL","monto":100000}],"bases":[{"categoria":"Estándar","temporada":"ALTA","precio":100000}],"infante_nota":""}');

-- Grupos de días (inactivos, candado de la 293): Semana y Finde en ALTA de los hoteles 1–3; un grupo en la
-- vigencia CERRADA del hotel 1 (debe verse «compra cerrada: no se calcula»).
insert into public.hotel_temporada_grupos (id, temporada_id, nombre, dias)
  select ('00000000-0000-4000-8000-' || lpad((h - 436000)::text || g.n, 12, '0'))::uuid, h * 10 + 1, g.nombre, g.dias
  from generate_series(436001, 436003) h, (values ('1', 'Semana', array[1,2,3,4]::smallint[]), ('2', 'Finde', array[5,6,7]::smallint[])) g(n, nombre, dias);
insert into public.hotel_temporada_grupos (id, temporada_id, nombre, dias)
values ('00000000-0000-4000-8000-000000000013', 4360013, 'Todos', array[1,2,3,4,5,6,7]::smallint[]);

commit;
