-- SEMILLA SINTÉTICA para el recorrido #14-A en la app compilada SIN simular el motor de precios: hotel, temporadas, tarifas netas (adulto y niño), paquete de porción terrestre con markup, un servicio adicional
-- con vigencia, dos aliados y los usuarios de la prueba. Todo ficticio; solo base LOCAL desechable. Después se corre `generarTarifario` (motor real) para publicar el tarifario.
--   adulto doble: neto 100.000 por persona y noche × 3 noches / (1 − 20 %) = 375.000 por adulto · Niño 1: 50.000 × 3 / 0,8 = 187.500 (el motor redondea al millar)
--   servicio «Tour Islas 14A»: neto 40.000 por persona / 0,8 = 50.000 por pasajero
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000014a001', 'staff14a@x.test'), ('00000000-0000-0000-0000-00000014a002', 'aliado14a@x.test'), ('00000000-0000-0000-0000-00000014a003', 'aliado14a_neto@x.test') on conflict do nothing;
insert into public.aliados (id, nombre, tipo, pct_comision, activo, nit, tipo_documento, direccion, banco, tipo_cuenta, numero_cuenta, telefono, email)
  values (9101, 'Agencia Real 14A', 'agencia', 0.10, true, '900111222-3', 'NIT', 'Calle 1 # 2-3, Medellín', 'Banco Prueba', 'ahorros', '000111222', '3001112233', 'agencia14a@example.test')
  on conflict (id) do update set pct_comision = 0.10, activo = true;
-- Freelance (persona natural): SÍ genera cuenta de cobro; la agencia (9101) factura electrónicamente. El aliado directo del recorrido es el freelance.
insert into public.aliados (id, nombre, tipo, pct_comision, activo, nit, tipo_documento, direccion, banco, tipo_cuenta, numero_cuenta, telefono, email)
  values (9102, 'Freelance Real 14A', 'freelance', 0.10, true, '1020304050', 'CC', 'Carrera 4 # 5-6, Bogotá', 'Banco Prueba', 'ahorros', '000333444', '3004445566', 'freelance14a@example.test')
  on conflict (id) do update set pct_comision = 0.10, activo = true;
insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
  ('00000000-0000-0000-0000-00000014a001', 'staff14a@x.test', 'Staff 14A', 'superadmin', true, 'mayorista', null),
  ('00000000-0000-0000-0000-00000014a002', 'aliado14a@x.test', 'Aliado 14A', 'freelance', true, 'mayorista', 9102),
  ('00000000-0000-0000-0000-00000014a003', 'aliado14a_neto@x.test', 'Aliado 14A NETO', 'agencia', true, 'mayorista', 9101)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = true, tenant = excluded.tenant, aliado_id = excluded.aliado_id;
insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion) values
  ('COMISION_AGENCIA', 0.12, 'base_comisionable', 'Comisión agencia'), ('COMISION_FREELANCE', 0.11, 'base_comisionable', 'Comisión freelance'),
  ('recobro_pct_aliado_b2b', 0.5, 'recobro', 'Distribución B2B')
  on conflict (parametro) do update set valor = excluded.valor;
insert into public.destinos (id, nombre) values (9101, 'CARTAGENA 14A') on conflict do nothing;
insert into public.proveedores (id, nombre) values (9101, 'Hotel Proveedor 14A'), (9102, 'Receptivo 14A') on conflict do nothing;
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
  values (9101, 9101, 'Hotel Real 14A', 9101, 'COP', 0, 5, 6, 12, 1, 6, true) on conflict do nothing;
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
  values (9101, 'doble', 2, 4, 2, 2, 0, 2, 0, 2) on conflict do nothing;
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (9101, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante)
  values (9101, 'Estandar', 'Desayuno', 'ALTA', 150000, 100000, 50000, 30000, 40000);
insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
  values (9101, 'Porción terrestre 14A', 'porcion_terrestre', 3, 9101, 0.2, 'fijo', 40000, '2030-01-01', '2030-12-31', 'COP', 'COP', true);
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (9101, 9101, array['Estandar'], array['Desayuno']);
insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, precio_infante, categoria, moneda, tipo_tarifa, liquidacion)
  values (9101, 'Tour Islas 14A', 9102, 9101, 40000, null, 'tour_traslado', 'COP', 'persona', 'paquete');
insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (9101, 'VIG 2030', '2030-01-01', '2030-12-31', 40000);
insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (9101, 9101, 'persona', false);
insert into public.asesores (nombre, email, rol, activo) values ('Staff 14A', 'staff14a@x.test', 'venta', true) on conflict do nothing;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000014a004', 'asesor14a@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-00000014a004', 'asesor14a@x.test', 'Asesor 14A', 'venta', true, 'mayorista')
  on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
