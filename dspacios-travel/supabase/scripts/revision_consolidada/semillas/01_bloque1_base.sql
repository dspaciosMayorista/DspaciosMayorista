-- REVISIÓN CONSOLIDADA — semilla derivada de fixture_recorrido_block1.sql.
-- Se omite el bloque de disparadores de inyección de fallos (solo para pruebas automáticas).
-- Fixture of the real-action driver for block 1 (F1 conversion concurrency, F2 flight voucher). DISPOSABLE database only.
-- Users (one auth session each, as the agency-active-session guard of 237 requires), a land-portion package that the REAL actions can quote/convert,
-- and the test-only gate/failure-injection triggers (they exist only in this throwaway database; they do nothing unless the driver arms them).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000b101', 'b1-oper-a@x.test'), ('00000000-0000-4000-8000-00000000b102', 'b1-oper-b@x.test'),
  ('00000000-0000-4000-8000-00000000b103', 'b1-admin@x.test'),  ('00000000-0000-4000-8000-00000000b104', 'b1-venta-dueno@x.test'),
  ('00000000-0000-4000-8000-00000000b105', 'b1-venta-otro@x.test'), ('00000000-0000-4000-8000-00000000b106', 'b1-control-vuelo@x.test'),
  ('00000000-0000-4000-8000-00000000b107', 'b1-minorista@x.test'),
  ('00000000-0000-4000-8000-00000000b108', 'b1-super@x.test'), ('00000000-0000-4000-8000-00000000b109', 'b1-aliado@x.test');
-- ADL-041 fixture: one ally (catalogue row 9409) whose user opens vouchers of ITS contracts only when 100 % paid.
insert into public.aliados (id, nombre, tipo) values (9409, 'Agencia Aliada Revision', 'agencia');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-4000-8000-00000000b101', 'b1-oper-a@x.test', 'B1 Operaciones A', 'operaciones', true, 'mayorista'),
  ('00000000-0000-4000-8000-00000000b102', 'b1-oper-b@x.test', 'B1 Operaciones B', 'operaciones', true, 'mayorista'),
  ('00000000-0000-4000-8000-00000000b103', 'b1-admin@x.test', 'Rev Administracion', 'administracion', true, 'mayorista'),
  ('00000000-0000-4000-8000-00000000b104', 'b1-venta-dueno@x.test', 'Rev Venta', 'venta', true, 'mayorista'),
  ('00000000-0000-4000-8000-00000000b105', 'b1-venta-otro@x.test', 'B1 Venta Otro', 'venta', true, 'mayorista'),
  ('00000000-0000-4000-8000-00000000b106', 'b1-control-vuelo@x.test', 'B1 Control Vuelo', 'control_vuelo', true, 'mayorista'),
  ('00000000-0000-4000-8000-00000000b107', 'b1-minorista@x.test', 'B1 Minorista', 'operaciones', true, 'minorista'),
  ('00000000-0000-4000-8000-00000000b108', 'b1-super@x.test', 'B1 Superadmin', 'superadmin', true, 'mayorista'),
  ('00000000-0000-4000-8000-00000000b109', 'b1-aliado@x.test', 'B1 Aliado', 'agencia', true, 'mayorista')
on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = true, tenant = excluded.tenant;
update public.usuarios set aliado_id = 9409 where id = '00000000-0000-4000-8000-00000000b109';
insert into auth.sessions (id, user_id) select ('00000000-0000-4000-8000-00000000c' || right(id::text, 3))::uuid, id from auth.users where email like 'b1-%@x.test';

-- Land-portion package (like the #43 recorrido): hotel 9401, destination 9401, 3 nights, markup 20 %.
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (9401, 'B1 DESTINO', 'BXA', 'Colombia', true);
insert into public.categorias_habitacion (nombre) values ('Estándar') on conflict do nothing;
insert into public.proveedores (id, nombre, tipo) values (9401, 'B1 PROVEEDOR HOTEL', 'hotel') on conflict do nothing;
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda, proveedor_id) values (9401, 9401, 'B1 HOTEL', 'persona', 'COP', 9401);
insert into public.hotel_categorias (hotel_id, categoria_id) select 9401, id from public.categorias_habitacion where nombre = 'Estándar' limit 1;
insert into public.hotel_regimenes (hotel_id, plan_id) select 9401, id from public.planes_alimentacion where codigo = 'PAM' limit 1;
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (940101, 9401, 'ALTA', '2027-06-01', '2027-06-30', 1, 'tarifa');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble, neto_triple) values (9401, 'Estándar', 'PAM', 'ALTA', 100000, 90000);
insert into public.armado_paquetes (id, nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches, moneda_publicacion)
  values (9401, 'B1 porción', 9401, '2027-06-01', '2027-06-30', 0.2, 'porcion_terrestre', 3, 'COP');
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (9401, 9401, array['Estándar'], array['PAM']);

-- Flight package (9402): one negotiated block (record BLQ100, 10 seats) and two Promociones (Empaquetados): one WITHOUT record, one WITH record.
insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, fecha_ida, fecha_regreso, cupos_total, tarifa_para_empaquetar, tarifa_neta, destino_id, moneda, vuelo_ida, vuelo_regreso)
  values (9402, 'BLQ100', 'Avianca', 'BOG - BXA - BOG', '2027-06-07', '2027-06-10', 10, 250000, 200000, 9401, 'COP', 'AV100', 'AV101');
insert into public.empaquetados (id, record, aerolinea, destino_id, ruta, fecha_ida, fecha_regreso, tarifa_proveedor, tarifa_para_empaquetar, activo, moneda, vuelo_ida, vuelo_regreso)
  values (9403, null,     'LATAM', 9401, 'BOG - BXA - BOG', '2027-06-07', '2027-06-10', 200000, 250000, true, 'COP', 'LA300', 'LA301'),
         (9404, 'REC200', 'LATAM', 9401, 'BOG - BXA - BOG', '2027-06-07', '2027-06-10', 200000, 250000, true, 'COP', 'LA400', 'LA401');
insert into public.armado_paquetes (id, nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches, moneda_publicacion)
  values (9402, 'B1 vuelo', 9401, '2027-06-01', '2027-06-30', 0.2, 'bloqueo', 3, 'COP');
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (9402, 9401, array['Estándar'], array['PAM']);
insert into public.armado_vuelos (paquete_id, bloqueo_id) values (9402, 9402);
insert into public.armado_empaquetados (paquete_id, empaquetado_id) values (9402, 9403), (9402, 9404);
update public.hoteles set edad_infante_max = 2, edad_nino_max = 11 where id = 9401;
insert into public.sillas (bloqueo_id, numero_silla, estado) select 9402, g, 'disponible' from generate_series(1, 10) g;
