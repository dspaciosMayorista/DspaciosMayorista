-- #124 (calculadora, versión desactualizada): UN hotel sintético «Dubai» con calculadora guardada, vigencias ALTA/BAJA/CERRADA y tarifas ya cargadas.
-- ALTA está referenciada por la calculadora (bases y promoción): renombrarla sube la versión de la calculadora (caso del dueño). CERRADA no está referenciada.
\set ON_ERROR_STOP 1
begin;
insert into public.planes_alimentacion (codigo, nombre) values ('PAM', 'Plan media pensión'), ('PC', 'Plan completo'), ('FULL', 'Todo incluido') on conflict (codigo) do nothing;
insert into public.categorias_habitacion (nombre) values ('Estándar'), ('Superior') on conflict (nombre) do nothing;
insert into public.destinos (id, nombre) values (12401, 'CARTAGENA 124') on conflict (id) do nothing;
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario) values (12401, 12401, 'Hotel 124 · Dubai (calculadora)', 'persona') on conflict (id) do nothing;
insert into public.hotel_categorias (hotel_id, categoria_id) select 12401, c.id from public.categorias_habitacion c where c.nombre in ('Estándar', 'Superior');
insert into public.hotel_regimenes (hotel_id, plan_id) select 12401, p.id from public.planes_alimentacion p where p.codigo in ('PAM', 'PC', 'FULL');
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, compra_inicio, compra_fin) values
  (124011, 12401, 'ALTA', '2030-01-01', '2030-03-31', 1, 'tarifa', null, null),
  (124012, 12401, 'BAJA', '2030-04-01', '2030-06-30', 1, 'tarifa', null, null),
  (124013, 12401, 'CERRADA', '2030-07-01', '2030-07-31', 1, 'tarifa', '2020-01-01', '2020-12-31');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino)
values (12401, 'Estándar', 'PAM', 'ALTA', 150000, 100000, 90000, 85000, null), (12401, 'Estándar', 'PAM', 'BAJA', 120000, 80000, 72000, 68000, 40000);
insert into public.hotel_calculadora (hotel_id, tipo, params) values
  (12401, 'dubai', '{"regimen_base":"PAM","modificadores":{"sencilla_pct":50,"pax3_pct":-20,"pax4_pct":-20,"nino_pct":-50,"infante_pct":-100},
    "suplementos":[{"regimen":"PC","monto":45000},{"regimen":"FULL","monto":100000}],
    "bases":[{"categoria":"Estándar","temporada":"ALTA","precio":100000}],"promos":[],"infante_nota":""}');
commit;
