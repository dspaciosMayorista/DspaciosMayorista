-- Seed of the VISUAL inspection of the ADL-041/042 amendments (visual_block1_vouchers.mjs). DISPOSABLE database only; applied on top of fixture_recorrido_block1.sql (+ migrations 334-338).
-- 9801 ally contract, ONE service (round trip, the same saved PNR on both legs), PAID            · 9802 same but UNPAID (internal preview hides the PNR)
-- 9803 TWO services, PAID, 3 passengers: service 1 = round trip with DIFFERENT PNRs per leg; service 2 = two separate legs with its own PNR
-- 9804 one service WITHOUT a saved PNR                                                            · 9805 TWO services that share the SAME PNR (they stay two vouchers), PAID ally
-- 9806 PAID ally contract with ONE service, used to walk the issued link through the transitions (leg removed, service removed)
-- Every leg carries its service explicitly (contrato_vuelos.servicio_aereo): the identity of a service is a saved association, never the PNR.
insert into public.ventas (numero_contrato, cliente, cliente_documento, tenant, tipo_paquete, aerolinea, asesor, estado, destino, fecha_salida, fecha_regreso, pax, precio_venta, moneda, hotel, aliado_id, tipo_asesor, agencia_nombre) values
  ('DTM-9801', 'María Fernanda Pérez', '1020304050', 'mayorista', 'dinamico', 'Avianca', 'B1 Administracion', 'confirmado', 'CARTAGENA', '2027-06-07', '2027-06-10', 2, 1000000, 'COP', 'Hotel Prueba', 9409, 'agencia', 'B1 ALIADO AGENCIA'),
  ('DTM-9802', 'Cliente sin pago completo', '1020304051', 'mayorista', 'dinamico', 'Avianca', 'B1 Administracion', 'confirmado', 'CARTAGENA', '2027-06-07', '2027-06-10', 2, 1000000, 'COP', 'Hotel Prueba', 9409, 'agencia', 'B1 ALIADO AGENCIA'),
  ('DTM-9803', 'Cliente con dos servicios aéreos', '1020304052', 'mayorista', 'dinamico', 'Avianca / LATAM', 'B1 Administracion', 'confirmado', 'CARTAGENA', '2027-06-07', '2027-06-20', 3, 3000000, 'COP', 'Hotel Prueba', null, null, null),
  ('DTM-9804', 'Cliente sin código guardado', '1020304053', 'mayorista', 'dinamico', 'Avianca', 'B1 Administracion', 'confirmado', 'CARTAGENA', '2027-06-07', '2027-06-10', 2, 900000, 'COP', 'Hotel Prueba', null, null, null),
  ('DTM-9805', 'Dos servicios, mismo código', '1020304054', 'mayorista', 'dinamico', 'Avianca', 'B1 Administracion', 'confirmado', 'CARTAGENA', '2027-06-07', '2027-06-10', 2, 1000000, 'COP', 'Hotel Prueba', 9409, 'agencia', 'B1 ALIADO AGENCIA'),
  ('DTM-9806', 'Cliente con cambios de vuelo', '1020304055', 'mayorista', 'dinamico', 'Avianca', 'B1 Administracion', 'confirmado', 'CARTAGENA', '2027-06-07', '2027-06-10', 2, 1000000, 'COP', 'Hotel Prueba', 9409, 'agencia', 'B1 ALIADO AGENCIA');
insert into public.contrato_hoteles (numero_contrato, nombre, categoria, ciudad, alimentacion, acomodacion, fecha_ingreso, fecha_salida, orden)
  select n, 'Hotel Prueba', 'Estándar', 'CARTAGENA', 'PAM', 'Estándar', '2027-06-07', '2027-06-10', 0 from unnest(array['DTM-9801','DTM-9802','DTM-9803','DTM-9804','DTM-9805','DTM-9806']) n;
insert into public.contrato_vuelos (numero_contrato, servicio_aereo, aerolinea, direccion, origen_codigo, origen_ciudad, destino_codigo, destino_ciudad, fecha_salida, numero_vuelo, hora_salida, hora_llegada, servicios, record, orden) values
  ('DTM-9801', '00000000-0000-4000-9000-000000980101', 'Avianca', 'ida', 'BOG', 'Bogotá', 'CTG', 'Cartagena', '2027-06-07', 'AV123', '08:15', '09:45', 'Equipaje de mano 10 kg · bodega 23 kg', 'ABC123', 0),
  ('DTM-9801', '00000000-0000-4000-9000-000000980101', 'Avianca', 'regreso', 'CTG', 'Cartagena', 'BOG', 'Bogotá', '2027-06-10', 'AV124', '18:00', '19:30', 'Equipaje de mano 10 kg · bodega 23 kg', 'ABC123', 1),
  ('DTM-9802', '00000000-0000-4000-9000-000000980201', 'Avianca', 'ida', 'BOG', 'Bogotá', 'CTG', 'Cartagena', '2027-06-07', 'AV223', '08:15', '09:45', null, 'SECRET9802', 0),
  ('DTM-9802', '00000000-0000-4000-9000-000000980201', 'Avianca', 'regreso', 'CTG', 'Cartagena', 'BOG', 'Bogotá', '2027-06-10', 'AV224', '18:00', '19:30', null, 'SECRET9802', 1),
  ('DTM-9803', '00000000-0000-4000-9000-000000980301', 'Avianca', 'ida', 'BOG', 'Bogotá', 'CTG', 'Cartagena', '2027-06-07', 'AV301', '07:00', '08:30', 'Equipaje de mano 10 kg', 'AAA111', 0),
  ('DTM-9803', '00000000-0000-4000-9000-000000980301', 'Avianca', 'regreso', 'CTG', 'Cartagena', 'BOG', 'Bogotá', '2027-06-10', 'AV302', '17:00', '18:30', 'Equipaje de mano 10 kg', 'ZZZ999', 1),
  ('DTM-9803', '00000000-0000-4000-9000-000000980302', 'LATAM', 'suelto', 'BOG', 'Bogotá', 'MDE', 'Medellín', '2027-06-14', 'LA401', '09:10', '10:05', 'Equipaje de bodega 23 kg', 'BBB222', 2),
  ('DTM-9803', '00000000-0000-4000-9000-000000980302', 'LATAM', 'suelto', 'MDE', 'Medellín', 'BOG', 'Bogotá', '2027-06-20', 'LA402', '19:40', '20:35', 'Equipaje de bodega 23 kg', 'BBB222', 3),
  ('DTM-9804', '00000000-0000-4000-9000-000000980401', 'Avianca', 'ida', 'BOG', 'Bogotá', 'CTG', 'Cartagena', '2027-06-07', 'AV501', '08:15', '09:45', null, null, 0),
  ('DTM-9804', '00000000-0000-4000-9000-000000980401', 'Avianca', 'regreso', 'CTG', 'Cartagena', 'BOG', 'Bogotá', '2027-06-10', 'AV502', '18:00', '19:30', null, null, 1),
  ('DTM-9805', '00000000-0000-4000-9000-000000980501', 'Avianca', 'ida', 'BOG', 'Bogotá', 'CTG', 'Cartagena', '2027-06-07', 'AV701', '08:15', '09:45', null, 'SAME00', 0),
  ('DTM-9805', '00000000-0000-4000-9000-000000980502', 'Avianca', 'ida', 'BOG', 'Bogotá', 'SMR', 'Santa Marta', '2027-06-08', 'AV702', '10:15', '11:45', null, 'SAME00', 1),
  ('DTM-9806', '00000000-0000-4000-9000-000000980601', 'Avianca', 'ida', 'BOG', 'Bogotá', 'CTG', 'Cartagena', '2027-06-07', 'AV601', '08:15', '09:45', null, 'ZZZ601', 0),
  ('DTM-9806', '00000000-0000-4000-9000-000000980601', 'Avianca', 'regreso', 'CTG', 'Cartagena', 'BOG', 'Bogotá', '2027-06-10', 'AV602', '18:00', '19:30', null, 'ZZZ601', 1);
insert into public.contrato_pasajeros (numero_contrato, nombre, nombres, apellidos, orden)
  select c, n, split_part(n, ' ', 1), split_part(n, ' ', 2), i
    from (values ('DTM-9801', 0, 'María Pérez'), ('DTM-9801', 1, 'Luis Gómez'), ('DTM-9802', 0, 'Ana Ruiz'), ('DTM-9802', 1, 'Pedro Soto'),
                 ('DTM-9803', 0, 'Carla Mora'), ('DTM-9803', 1, 'Juan Mora'), ('DTM-9803', 2, 'Eva Mora'), ('DTM-9804', 0, 'Sara Peña'), ('DTM-9804', 1, 'Raúl Peña'),
                 ('DTM-9805', 0, 'Tomás Rey'), ('DTM-9805', 1, 'Lía Rey'), ('DTM-9806', 0, 'Nora Vega'), ('DTM-9806', 1, 'Iván Vega')) v(c, i, n);
-- payment: 9801, 9803, 9805 and 9806 are 100 % paid; 9802 is not; 9804 is not needed.
insert into public.abonos (numero_contrato, valor_abono) values ('DTM-9801', 1000000), ('DTM-9803', 3000000), ('DTM-9805', 1000000), ('DTM-9806', 1000000), ('DTM-9802', 400000);
-- 9807: LEGACY single-row itinerary (outbound + return in ONE row: vuelo_ida / vuelo_regreso / horas / fecha_regreso), PAID ally contract — V5-2.
insert into public.ventas (numero_contrato, cliente, cliente_documento, tenant, tipo_paquete, aerolinea, asesor, estado, destino, fecha_salida, fecha_regreso, pax, precio_venta, moneda, hotel, aliado_id, tipo_asesor, agencia_nombre) values
  ('DTM-9807', 'Cliente con itinerario heredado', '1020304056', 'mayorista', 'dinamico', 'Avianca', 'B1 Administracion', 'confirmado', 'CARTAGENA', '2027-06-07', '2027-06-10', 2, 1000000, 'COP', 'Hotel Prueba', 9409, 'agencia', 'B1 ALIADO AGENCIA');
insert into public.contrato_hoteles (numero_contrato, nombre, categoria, ciudad, alimentacion, acomodacion, fecha_ingreso, fecha_salida, orden) values ('DTM-9807', 'Hotel Prueba', 'Estándar', 'CARTAGENA', 'PAM', 'Estándar', '2027-06-07', '2027-06-10', 0);
insert into public.contrato_vuelos (numero_contrato, servicio_aereo, aerolinea, origen_codigo, origen_ciudad, destino_codigo, destino_ciudad, fecha_salida, vuelo_ida, hora_salida_ida, hora_llegada_ida, fecha_regreso, vuelo_regreso, hora_salida_reg, hora_llegada_reg, record, orden) values
  ('DTM-9807', '00000000-0000-4000-9000-000000980701', 'Avianca', 'BOG', 'Bogotá', 'CTG', 'Cartagena', '2027-06-07', 'LG100', '08:00', '09:30', '2027-06-10', 'LG200', '18:00', '19:30', 'LEGPNR1', 0);
insert into public.contrato_pasajeros (numero_contrato, nombre, nombres, apellidos, orden) values ('DTM-9807', 'Rosa Luna', 'Rosa', 'Luna', 0), ('DTM-9807', 'Hugo Luna', 'Hugo', 'Luna', 1);
insert into public.abonos (numero_contrato, valor_abono) values ('DTM-9807', 1000000);
update public.agencias set rnt = '147000' where tenant = 'mayorista' and coalesce(btrim(rnt), '') = '';
