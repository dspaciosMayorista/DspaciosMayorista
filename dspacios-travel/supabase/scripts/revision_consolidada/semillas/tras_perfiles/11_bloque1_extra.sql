-- REVISIÓN CONSOLIDADA — bloque 1, datos extra (se aplica después de fijar los perfiles).
-- 1) La semilla 03 guardó los tramos sueltos de DTM-9803 con direccion = 'suelto', valor que la aplicación NUNCA escribe (un tramo suelto se guarda en NULL) y que el editor de vuelos
--    rechaza al guardar («La dirección de un tramo debe ser ida, regreso o ninguna.»). Se normaliza a NULL, como lo dejaría el editor real.
update public.contrato_vuelos set direccion = null where direccion = 'suelto';
-- 2) DTM-5101: contrato con DOS tramos históricos de PNR distintos y SIN servicio aéreo asociado (caso ambiguo: nunca se adivina el servicio).
insert into public.ventas (numero_contrato, cliente, cliente_documento, tenant, tipo_paquete, aerolinea, asesor, estado, destino, fecha_salida, fecha_regreso, pax, precio_venta, moneda, hotel) values
  ('DTM-5101', 'Cliente con tramos históricos ambiguos', '1020305101', 'mayorista', 'dinamico', 'Avianca', 'Rev Administracion', 'confirmado', 'CARTAGENA', '2027-07-05', '2027-07-09', 2, 2000000, 'COP', 'Hotel Prueba')
on conflict (numero_contrato) do nothing;
-- Dos servicios ya guardados (A: ida; B: regreso, con PNR distintos) y un TERCER tramo histórico sin servicio: con dos servicios en el contrato la base no puede elegir y lo deja sin asociar.
insert into public.contrato_vuelos (numero_contrato, servicio_aereo, aerolinea, direccion, origen_codigo, origen_ciudad, destino_codigo, destino_ciudad, fecha_salida, numero_vuelo, hora_salida, hora_llegada, record, orden)
select * from (values
  ('DTM-5101', '00000000-0000-4000-9000-000000510101'::uuid, 'Avianca', 'ida', 'BOG', 'Bogotá', 'CTG', 'Cartagena', date '2027-07-05', 'AV510', '08:00', '09:30', 'AMB510', 0),
  ('DTM-5101', '00000000-0000-4000-9000-000000510102'::uuid, 'Avianca', 'regreso', 'CTG', 'Cartagena', 'BOG', 'Bogotá', date '2027-07-09', 'AV511', '18:00', '19:30', 'AMB511', 1)) v
where not exists (select 1 from public.contrato_vuelos where numero_contrato = 'DTM-5101');
insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion, origen_codigo, origen_ciudad, destino_codigo, destino_ciudad, fecha_salida, numero_vuelo, hora_salida, hora_llegada, record, orden)
select 'DTM-5101', 'Avianca', null, 'CTG', 'Cartagena', 'SMR', 'Santa Marta', date '2027-07-07', 'AV512', '10:00', '11:00', 'AMB512', 2
where (select count(*) from public.contrato_vuelos where numero_contrato = 'DTM-5101') = 2;
insert into public.contrato_pasajeros (numero_contrato, nombre, nombres, apellidos, orden)
select 'DTM-5101', n, split_part(n, ' ', 1), split_part(n, ' ', 2), i from (values (0, 'Sofía Duarte'), (1, 'Mario Duarte')) v(i, n)
where not exists (select 1 from public.contrato_pasajeros where numero_contrato = 'DTM-5101');
-- El trigger de inserción da un servicio nuevo a todo tramo sin servicio; un histórico ambiguo (como los que dejó el respaldo de la migración 338 en contratos de varias formas) queda sin asociar:
update public.contrato_vuelos set servicio_aereo = null where numero_contrato = 'DTM-5101' and numero_vuelo = 'AV512' and servicio_aereo is not null;
