-- Datos mínimos para REVISAR en navegador el hotel bajo solicitud (#120) contra una base local desechable (la 270 ya aplicada). No es esquema de la app.
-- Bloqueo P1 con H1 como ÚNICO hotel (marcado) · porción terrestre P3 con H3 (marcado) + H3B tarifado. Sin filas en tarifario_resultado.
-- Usuario SUPERADMIN para revisar la pantalla del operador (la sesión viva y su agencia que exigen las policies de catálogo).
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000270001', 'super270@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000270001', 'super270@x.test', 'Super 270', 'superadmin', true, 'mayorista') on conflict (id) do update set rol = 'superadmin', activo = true, tenant = 'mayorista';
insert into auth.sessions (id, user_id) values ('5e550000-0000-0000-0000-000000270001', '00000000-0000-0000-0000-000000270001') on conflict do nothing;
insert into public.sesion_agencia (session_id, user_id, tenant) values ('5e550000-0000-0000-0000-000000270001', '00000000-0000-0000-0000-000000270001', 'mayorista') on conflict do nothing;
insert into public.destinos (id, nombre) values (7001, 'CARTAGENA 270') on conflict do nothing;
insert into public.proveedores (id, nombre) values (7001, 'Proveedor 270') on conflict do nothing;
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, estrellas, descripcion) overriding system value values
  (7201, 7001, 'Hotel Bloqueo 270', 7001, 'COP', 4, 'Hotel sin tarifa publicada: se cotiza bajo solicitud.'),
  (7203, 7001, 'Hotel Porcion 270', 7001, 'COP', 5, 'Hotel de porción terrestre bajo solicitud.'),
  (7204, 7001, 'Hotel Tarifado 270', 7001, 'COP', 4, 'Hotel con tarifa publicada de siempre.'),
  (7205, 7001, 'Hotel Sin Acomodaciones 270', 7001, 'COP', 3, 'Marcado bajo solicitud pero SIN hotel_acomodaciones: rigen los defaults del motor.');
insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, vuelo_ida, vuelo_regreso, fecha_ida, fecha_regreso, cupos_total, tarifa_para_empaquetar, tarifa_neta, fee_infante, destino_id, moneda) overriding system value
  values (7301, 'R270A', 'AVIANCA', 'BOG-CTG', 'AV123', 'AV124', '2030-03-10', '2030-03-13', 10, 400000, 400000, 50000, 7001, 'COP');
insert into public.sillas (bloqueo_id, numero_silla) select 7301, g from generate_series(1, 10) g;
insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) overriding system value values
  (7101, 'Bloqueo 270', 'bloqueo', 3, 7001, 0.2, 'tiquete', 0, '2030-03-01', '2030-03-31', 'COP', 'COP', true),
  (7103, 'Porcion terrestre 270', 'porcion_terrestre', 3, 7001, 0.2, 'fijo', 0, '2030-05-01', '2030-05-31', 'COP', 'COP', true);
insert into public.armado_vuelos (paquete_id, bloqueo_id, aplica_mk, ta) values (7101, 7301, true, 0);
insert into public.armado_hoteles (paquete_id, hotel_id) values (7101, 7201), (7103, 7203), (7103, 7204), (7103, 7205);
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, tipo, prioridad) values (7204, 'ALTA', '2030-05-01', '2030-05-31', 'tarifa', 1);
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante)
  values (7204, 'Estandar', 'PC', 'ALTA', 300000, 300000, 300000, 300000, 150000, 150000, 0);
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (7203, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (7201, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);

-- Cierre #120: bloqueo en USD (hotel USD a solicitud, vuelo USD, asistencia INCLUIDA en USD) para revisar la TRM de costos y /dashboard/pagos.
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, estrellas, descripcion) overriding system value values
  (7206, 7001, 'Hotel USD 270', 7001, 'USD', 4, 'Hotel en dólares sin tarifa publicada: se cotiza bajo solicitud.');
insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, vuelo_ida, vuelo_regreso, fecha_ida, fecha_regreso, cupos_total, tarifa_para_empaquetar, tarifa_neta, fee_infante, destino_id, moneda) overriding system value
  values (7302, 'R270U', 'AVIANCA', 'BOG-CTG', 'AV223', 'AV224', '2030-07-10', '2030-07-13', 10, 400, 400, 50, 7001, 'USD');
insert into public.sillas (bloqueo_id, numero_silla) select 7302, g from generate_series(1, 10) g;
insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) overriding system value values
  (7106, 'Bloqueo USD 270', 'bloqueo', 3, 7001, 0.2, 'tiquete', 0, '2030-07-01', '2030-07-31', 'USD', 'USD', true);
insert into public.armado_vuelos (paquete_id, bloqueo_id, aplica_mk, ta) values (7106, 7302, true, 0);
insert into public.armado_hoteles (paquete_id, hotel_id) values (7106, 7206);
insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion) values
  (7002, 'Asistencia USD 270', 7001, 7001, 0, 'asistencia', 'USD', 'persona', 'paquete');
insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (770002, 7002, 'ALTA', '2030-01-01', '2030-12-31', 20);
insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (7106, 7002, 'persona', true);
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (7206, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
update public.hoteles set tarifa_bajo_solicitud = true where id in (7201, 7203, 7205, 7206);
