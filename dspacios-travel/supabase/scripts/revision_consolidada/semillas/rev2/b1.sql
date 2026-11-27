-- REV2 · Bloque 1 (B1-05 / B1-06) — semilla ADITIVA e idempotente. NO se ejecuta contra rev_consolidada sin la decisión del coordinador (se carga en el clon de ensayo o, aditivamente, antes de la entrega).
-- DTM-9871: contrato de la agencia aliada «Agencia Aliada Revision» (catálogo 9409, mismo aliado de DTM-9801…9807), 100 % pagado, CUATRO pasajeros y DOS servicios aéreos.
--   Servicio A (PNR RV2AAA): BOG → CTG ida (AV871) y CTG → BOG regreso (AV872).
--   Servicio B (PNR RV2BBB): MDE → CTG ida (LA881) y CTG → MDE regreso (LA882).
-- El sistema NO guarda qué pasajero viaja en cada servicio; la semilla tampoco lo inventa: los dos vouchers (que se generan con «Voucher de vuelo») listan a los cuatro y avisan la limitación.
-- Sin PNR distinto de los de la semilla 03 (DTM-98xx). Sin tocar ningún dato existente.
insert into public.ventas (numero_contrato, cliente, cliente_documento, tenant, tipo_paquete, aerolinea, asesor, estado, destino, fecha_salida, fecha_regreso, pax, precio_venta, moneda, hotel, aliado_id, tipo_asesor, agencia_nombre)
values ('DTM-9871', 'Ana Pérez (dos grupos de viaje)', '1020304871', 'mayorista', 'dinamico', 'Avianca / LATAM', 'Rev Administracion', 'confirmado', 'CARTAGENA', '2027-06-07', '2027-06-10', 4, 4000000, 'COP', 'Hotel Prueba', 9409, 'agencia', 'Agencia Aliada Revision')
on conflict (numero_contrato) do nothing;

insert into public.contrato_hoteles (numero_contrato, nombre, categoria, ciudad, alimentacion, acomodacion, fecha_ingreso, fecha_salida, orden)
select 'DTM-9871', 'Hotel Prueba', 'Estándar', 'CARTAGENA', 'PAM', 'Estándar', '2027-06-07', '2027-06-10', 0
 where not exists (select 1 from public.contrato_hoteles where numero_contrato = 'DTM-9871');

insert into public.contrato_vuelos (numero_contrato, servicio_aereo, aerolinea, direccion, origen_codigo, origen_ciudad, destino_codigo, destino_ciudad, fecha_salida, numero_vuelo, hora_salida, hora_llegada, servicios, record, orden)
select * from (values
  ('DTM-9871', '00000000-0000-4000-9000-000000987101'::uuid, 'Avianca', 'ida',     'BOG', 'Bogotá',   'CTG', 'Cartagena', '2027-06-07'::date, 'AV871', '07:00'::time, '08:30'::time, 'Equipaje de mano 10 kg', 'RV2AAA', 0),
  ('DTM-9871', '00000000-0000-4000-9000-000000987101'::uuid, 'Avianca', 'regreso', 'CTG', 'Cartagena', 'BOG', 'Bogotá',   '2027-06-10'::date, 'AV872', '17:00'::time, '18:30'::time, 'Equipaje de mano 10 kg', 'RV2AAA', 1),
  ('DTM-9871', '00000000-0000-4000-9000-000000987102'::uuid, 'LATAM',   'ida',     'MDE', 'Medellín',  'CTG', 'Cartagena', '2027-06-07'::date, 'LA881', '09:10'::time, '10:05'::time, 'Equipaje de bodega 23 kg', 'RV2BBB', 2),
  ('DTM-9871', '00000000-0000-4000-9000-000000987102'::uuid, 'LATAM',   'regreso', 'CTG', 'Cartagena', 'MDE', 'Medellín',  '2027-06-10'::date, 'LA882', '19:40'::time, '20:35'::time, 'Equipaje de bodega 23 kg', 'RV2BBB', 3)
) v(numero_contrato, servicio_aereo, aerolinea, direccion, origen_codigo, origen_ciudad, destino_codigo, destino_ciudad, fecha_salida, numero_vuelo, hora_salida, hora_llegada, servicios, record, orden)
 where not exists (select 1 from public.contrato_vuelos where numero_contrato = 'DTM-9871');

insert into public.contrato_pasajeros (numero_contrato, nombre, nombres, apellidos, orden)
select 'DTM-9871', n, split_part(n, ' ', 1), split_part(n, ' ', 2), i
  from (values (0, 'Ana Pérez'), (1, 'Luis Gómez'), (2, 'Marta Ríos'), (3, 'Pedro Soto')) v(i, n)
 where not exists (select 1 from public.contrato_pasajeros where numero_contrato = 'DTM-9871');

insert into public.abonos (numero_contrato, valor_abono)
select 'DTM-9871', 4000000 where not exists (select 1 from public.abonos where numero_contrato = 'DTM-9871');
