-- Fixture de la 299 (DESPUÉS de fixture_293, 295, fixture_295, 297, fixture_297 y la 299; base local desechable).
-- Hotel 9301, ALTA (930101, enero 2027, prioridad 1): tarifa «todos los días» Estándar/PAM (duplicada, legado),
-- grupos Semana (L–J) y Fin de semana (V–D) con propuesta del Fin de semana (fixture_297).
-- PUENTE (930106, 10–12 ene, prioridad 1): compite con ALTA en Estándar/PAM doble ⇒ empate al activar ALTA.
-- Hotel 9304: sin grupos (control: nada cambia).
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
  (930106, 9301, 'PUENTE', '2027-01-10', '2027-01-12', 1, 'tarifa');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble)
values (9301, 'Estándar', 'PAM', 'PUENTE', 90000);
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario) values (9304, 9301, 'T299 SIN GRUPOS', 'persona');
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
  (930401, 9304, 'ALTA', '2027-01-01', '2027-01-31', 1, 'tarifa'),
  (930402, 9304, 'OTRA', '2027-01-01', '2027-01-31', 1, 'tarifa');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble) values
  (9304, 'Estándar', 'PAM', 'ALTA', 100000, 80000),
  (9304, 'Estándar', 'PAM', 'OTRA', 110000, 90000);
