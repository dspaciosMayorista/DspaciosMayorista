-- Fixture de las carreras de la 293 (base local desechable). Un hotel por carrera para que
-- ninguna dependa de otra. Ids 94xx.
insert into public.destinos (id, nombre) values (9401, 'T293C DESTINO') on conflict do nothing;
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario) values
  (9400, 9401, 'T293C UNIDAD', 'unidad'),
  (9401, 9401, 'T293C R1 renombre', 'persona'),
  (9402, 9401, 'T293C R2 mover', 'persona'),
  (9403, 9401, 'T293C R3 modelo primero', 'persona'),
  (9404, 9401, 'T293C R4 grupo primero', 'persona'),
  (9405, 9401, 'T293C R5 mismos días', 'persona'),
  (9406, 9401, 'T293C R6 días distintos', 'persona'),
  (9407, 9401, 'T293C R7 renombre inverso', 'persona'),
  (9408, 9401, 'T293C R8 mover inverso', 'persona'),
  (9409, 9401, 'T293C R8 destino', 'persona'),
  (9410, 9401, 'T293C R9 renombre de otra', 'persona');
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
  (940101, 9401, 'ALTA',  '2027-01-01', '2027-01-31', 1, 'tarifa'),
  (940102, 9401, 'BAJA',  '2027-02-01', '2027-02-28', 1, 'tarifa'),
  (940201, 9402, 'ALTA',  '2027-01-01', '2027-01-31', 1, 'tarifa'),
  (940301, 9403, 'ALTA',  '2027-01-01', '2027-01-31', 1, 'tarifa'),
  (940401, 9404, 'ALTA',  '2027-01-01', '2027-01-31', 1, 'tarifa'),
  (940501, 9405, 'ALTA',  '2027-01-01', '2027-01-31', 1, 'tarifa'),
  (940601, 9406, 'ALTA',  '2027-01-01', '2027-01-31', 1, 'tarifa'),
  (940701, 9407, 'ALTA',  '2027-01-01', '2027-01-31', 1, 'tarifa'),
  (940702, 9407, 'BAJA',  '2027-02-01', '2027-02-28', 1, 'tarifa'),
  (940801, 9408, 'ALTA',  '2027-01-01', '2027-01-31', 1, 'tarifa'),
  (941001, 9410, 'ALTA',  '2027-01-01', '2027-01-31', 1, 'tarifa'),
  (941002, 9410, 'BAJA',  '2027-02-01', '2027-02-28', 1, 'tarifa');
