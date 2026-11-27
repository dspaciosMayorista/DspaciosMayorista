-- Seed of the VISUAL inspection (visual_block1.mjs) of the compiled app. DISPOSABLE database only; applied on top of fixture_recorrido_block1.sql.
-- 9701 complete data · 9702 missing data (no passengers, legs without flight/times/airline) · 9703 long data (multi-city, long names, long text)
-- 9704 land only (no editor link) · 9705 owned by the `venta` user · quotation with flights for the #17 PDF.
insert into public.ventas (numero_contrato, cliente, cliente_documento, tenant, tipo_paquete, aerolinea, asesor, estado, destino, fecha_salida, fecha_regreso, pax, precio_venta, moneda, hotel) values
  ('DTM-9701', 'María Fernanda Pérez', '1020304050', 'mayorista', 'dinamico', 'Avianca', 'B1 Administracion', 'confirmado', 'CARTAGENA', '2027-06-07', '2027-06-10', 2, 3200000, 'COP', 'Hotel Prueba'),
  ('DTM-9702', 'Cliente datos incompletos', '1020304051', 'mayorista', 'dinamico', null, 'B1 Administracion', 'confirmado', 'CARTAGENA', '2027-06-07', '2027-06-10', 1, 1200000, 'COP', null),
  ('DTM-9703', 'Cliente con nombre muy largo de prueba para el desbordamiento del documento impreso', '1020304052', 'mayorista', 'dinamico', 'Aerolínea Internacional de Servicios Aéreos Regionales del Caribe y Centroamérica S.A.S.', 'B1 Administracion', 'confirmado', 'CARTAGENA', '2027-06-07', '2027-06-20', 14, 28000000, 'COP', 'Hotel Prueba'),
  ('DTM-9704', 'Solo tierra', '1020304053', 'mayorista', 'porcion_terrestre', null, 'B1 Administracion', 'confirmado', 'CARTAGENA', '2027-06-07', '2027-06-10', 2, 900000, 'COP', 'Hotel Prueba'),
  ('DTM-9705', 'Contrato del asesor de ventas', '1020304054', 'mayorista', 'dinamico', 'Avianca', 'B1 Venta Dueno', 'confirmado', 'CARTAGENA', '2027-06-07', '2027-06-10', 2, 2000000, 'COP', 'Hotel Prueba');
insert into public.contrato_hoteles (numero_contrato, nombre, categoria, ciudad, alimentacion, acomodacion, fecha_ingreso, fecha_salida, orden)
  select n, 'Hotel Prueba', 'Estándar', 'CARTAGENA', 'PAM', 'Estándar', '2027-06-07', '2027-06-10', 0 from unnest(array['DTM-9701','DTM-9703','DTM-9704','DTM-9705']) n;
-- 9701: two legs, flight numbers, times, baggage, a PNR (must never reach the voucher).
insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion, origen_codigo, origen_ciudad, destino_codigo, destino_ciudad, fecha_salida, numero_vuelo, hora_salida, hora_llegada, servicios, record, orden) values
  ('DTM-9701', 'Avianca', 'ida', 'BOG', 'Bogotá', 'CTG', 'Cartagena', '2027-06-07', 'AV123', '08:15', '09:45', 'Equipaje de mano 10 kg · bodega 23 kg', 'PNR9701', 0),
  ('DTM-9701', 'Avianca', 'regreso', 'CTG', 'Cartagena', 'BOG', 'Bogotá', '2027-06-10', 'AV124', '18:00', '19:30', 'Equipaje de mano 10 kg · bodega 23 kg', 'PNR9701', 1),
-- 9702: nearly empty legs.
  ('DTM-9702', null, 'ida', 'BOG', null, 'CTG', null, null, null, null, null, null, null, 0),
  ('DTM-9702', null, 'regreso', null, null, null, null, null, null, null, null, null, null, 1),
-- 9705: venta-owned.
  ('DTM-9705', 'Avianca', 'ida', 'BOG', 'Bogotá', 'CTG', 'Cartagena', '2027-06-07', 'AV321', '07:00', '08:30', null, 'PNR9705', 0);
-- 9703: multi-city (4 legs, direction 'suelto'), long airline and long text.
insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion, origen_codigo, origen_ciudad, destino_codigo, destino_ciudad, fecha_salida, numero_vuelo, hora_salida, hora_llegada, servicios, record, orden)
  select 'DTM-9703', 'Aerolínea Internacional de Servicios Aéreos Regionales del Caribe y Centroamérica S.A.S.', null, o, 'Ciudad de origen con un nombre bastante largo ' || o, d, 'Ciudad de destino con un nombre bastante largo ' || d, f, 'XX' || (900 + i), '06:05', '23:55',
         repeat('Equipaje de bodega y mano incluido; cambios sujetos a penalidad y a la política de la aerolínea. ', 4), 'PNR9703', i
    from (values (0, 'BOG', 'MDE', date '2027-06-07'), (1, 'MDE', 'CTG', date '2027-06-10'), (2, 'CTG', 'SMR', date '2027-06-14'), (3, 'SMR', 'BOG', date '2027-06-20')) v(i, o, d, f);
insert into public.contrato_pasajeros (numero_contrato, nombre, nombres, apellidos, orden)
  select 'DTM-9701', n, split_part(n, ' ', 1), split_part(n, ' ', 2), i from (values (0, 'María Pérez'), (1, 'Luis Gómez')) v(i, n);
insert into public.contrato_pasajeros (numero_contrato, nombre, nombres, apellidos, orden)
  select 'DTM-9703', 'Pasajero ' || i || ' Apellido-Compuesto-Muy-Largo-Para-Probar-El-Ajuste-De-Linea', 'Pasajero ' || i, 'Apellido-Compuesto-Muy-Largo-Para-Probar-El-Ajuste-De-Linea', i from generate_series(0, 13) i;

-- Destination used ONLY as an alternative air destination (the delete modal must offer a merge, not a plain delete).
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (9405, 'B1 ALTERNATIVO', 'BAL', 'Colombia', true);
insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id) values (9402, 9405);
update public.armado_paquetes set destinos_aereos_alternativos = true where id = 9402;
-- A destination with no use at all (plain delete).
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (9406, 'B1 SIN USO', 'BSU', 'Colombia', true);

-- Quotation with flights (#17): the public document /cot/<token> reads `detalle`.
insert into public.cotizaciones (id, tenant, estado, share_token, detalle, vigencia_hasta) values (934001, 'mayorista', 'abierta', '11111111-1111-4111-8111-111111111111',
  '{"venta":{"cliente":"Cliente Cotización","destino":"CARTAGENA","fecha_salida":"2027-06-07","fecha_regreso":"2027-06-10","pax":2,"precio_venta":3200000,"moneda":"COP","hotel":"Hotel Prueba","tipo_paquete":"bloqueo","estado":"pendiente"},
    "pasajeros":[],"hoteles":[{"nombre":"Hotel Prueba","categoria":"Estándar","ciudad":"CARTAGENA","alimentacion":"PAM","acomodacion":"Estándar","fecha_ingreso":"2027-06-07","fecha_salida":"2027-06-10","orden":0}],
    "vuelos":[{"aerolinea":"Avianca","direccion":"ida","origen_codigo":"BOG","destino_codigo":"CTG","fecha_salida":"2027-06-07","numero_vuelo":"AV123","hora_salida":"08:15","hora_llegada":"09:45","orden":0},
              {"aerolinea":"Avianca","direccion":"regreso","origen_codigo":"CTG","destino_codigo":"BOG","fecha_salida":"2027-06-10","numero_vuelo":"AV124","hora_salida":"18:00","hora_llegada":"19:30","orden":1}],
    "items":[{"descripcion":"Paquete turístico","adultos":2,"ninos":0,"tarifa_adulto":1600000,"tarifa_nino":0,"orden":0}]}'::jsonb, '2027-12-31');

-- Public documents need the issuing agency RNT (the production row carries it; the template copy does not).
update public.agencias set rnt = '147000' where tenant = 'mayorista' and coalesce(btrim(rnt), '') = '';
