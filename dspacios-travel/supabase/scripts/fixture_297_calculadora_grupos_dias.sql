-- Fixture de la 297 (DESPUÉS de fixture_293, la 295, fixture_295 y la 297; base local desechable).
-- Hotel 9301: calculadora Dubai y dos grupos en ALTA (930101). Hotel 9303: calculadora Mixta, un grupo.
insert into public.hotel_calculadora (hotel_id, tipo, params) values
  (9301, 'dubai', '{"regimen_base":"PAM","modificadores":{"sencilla_pct":50,"pax3_pct":-20,"pax4_pct":-20,"nino_pct":-50,"infante_pct":-100},"suplementos":[{"regimen":"PC","monto":45000}],"bases":[{"categoria":"Estándar","temporada":"ALTA","precio":100000}]}'),
  (9303, 'mixta', '{"regimen":"PAM","iva_pct":19,"bases":[]}');
insert into public.hotel_temporada_grupos (id, temporada_id, nombre, dias) values
  ('00000000-0000-4000-8000-0000000c0001', 930101, 'Semana', array[1,2,3,4]),
  ('00000000-0000-4000-8000-0000000c0002', 930101, 'Fin de semana', array[5,6,7]),
  ('00000000-0000-4000-8000-0000000c0003', 930301, 'Todos', array[1,2,3,4,5,6,7]);
-- Propuesta previa del Fin de semana con notas y edades propias (deben conservarse si la fila no las trae).
insert into public.hotel_grupo_tarifa_propuesta (grupo_id, tipo_habitacion, alimentacion, neto_doble, notas, nota_infante,
  edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max)
values ('00000000-0000-4000-8000-0000000c0002', 'Estándar', 'PAM', 130000, 'Vista al mar', 'Cuna', 0, 1, 2, 11);
-- Vigencia con la compra CERRADA (compra_fin en el pasado) y su grupo: no se calcula ni se guarda por grupo.
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, compra_inicio, compra_fin)
values (930109, 9301, 'CERRADA', '2027-05-01', '2027-05-31', 1, 'tarifa', '2020-01-01', '2020-12-31');
insert into public.hotel_temporada_grupos (id, temporada_id, nombre, dias) values
  ('00000000-0000-4000-8000-0000000c0004', 930109, 'Todos', array[1,2,3,4,5,6,7]),
  ('00000000-0000-4000-8000-0000000c0005', 930102, 'Lunes', array[1]);
