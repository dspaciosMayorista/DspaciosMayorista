-- REVISIÓN CONSOLIDADA — bloque #95 / #61 / #41 / #42 / #51 / #33 (copia manual del catálogo, duplicar paquetes y vuelos, plan de cobro con pagos, asistencia opcional, comparativa con niño gratis).
-- Todo SINTÉTICO. Ids 80000–89999; contratos DTM-8101…8103 y DTM-8150. Fechas relativas a hoy en Bogotá (public.fecha_negocio()). Se aplica UNA sola vez, después de fijar los perfiles.
-- NO se siembra ningún dato derivado de la aplicación: el tarifario del paquete porción (80101) y el contrato con asistencia opcional (#51) los produce el dueño con la propia pantalla («Generar tarifario» y «Reservar»).
begin;

-- ── Catálogo base ───────────────────────────────────────────────────────────
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values
  (80001, 'BOGOTÁ B95', 'BOG', 'Colombia', true), (80002, 'CARTAGENA B95', 'CGB', 'Colombia', true) on conflict (id) do nothing;
insert into public.proveedores (id, nombre, tipo) values
  (80101, 'Aerolínea B95', 'aereo'), (80102, 'Proveedor Hotel Mar B95', 'hotel'), (80103, 'Receptivo B95', null), (80104, 'Aseguradora B95', null),
  (80105, 'Proveedor Adultos B95', 'hotel'), (80106, 'Receptivo Alterno B95', null) on conflict (id) do nothing;
insert into public.categorias_habitacion (nombre) values ('Superior B95') on conflict do nothing;

-- Hoteles: 80201 (el del paquete; UNA sola categoría/régimen), 80202 y 80203 con el MISMO nombre en destinos distintos (80203 es Adults Only), 80204 (niño gratis), 80205 (acepta mascotas).
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, modelo_tarifario, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo, adults_only, pet_friendly) values
  (80201, 80002, 'Hotel Mar B95',          80102, 'COP', 'persona', 0, 2, 3, 11, 1, 6, true, false, false),
  (80202, 80002, 'Hotel Duplicado B95',    80102, 'COP', 'persona', 0, 2, 3, 11, 1, 6, true, false, false),
  (80203, 80001, 'Hotel Duplicado B95',    80105, 'COP', 'persona', 0, 2, 3, 11, 1, 4, true, true,  false),
  (80204, 80002, 'Hotel Niño Gratis B95',  80102, 'COP', 'persona', 0, 2, 3, 11, 1, 6, true, false, false),
  (80205, 80002, 'Hotel Mascotas B95',     80102, 'COP', 'persona', 0, 2, 3, 11, 1, 6, true, false, true) on conflict (id) do nothing;
insert into public.hotel_categorias (hotel_id, categoria_id)
  select h, c.id from (values (80201, 'Estándar'), (80202, 'Estándar'), (80202, 'Superior B95'), (80203, 'Estándar'), (80204, 'Estándar'), (80205, 'Estándar')) v(h, n)
  join public.categorias_habitacion c on c.nombre = v.n on conflict do nothing;
insert into public.hotel_regimenes (hotel_id, plan_id)
  select h, p.id from (values (80201, 'PAM'), (80202, 'PC'), (80202, 'PAM'), (80203, 'PA'), (80204, 'PAM'), (80205, 'PC')) v(h, c)
  join public.planes_alimentacion p on p.codigo = v.c on conflict do nothing;
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
  select h, a::public.acomodacion_tipo, pt, pm, amin, amax, 0, cmax, 0, imax
  from (values (80201, 'doble', 2, 4, 2, 2, 2, 2), (80201, 'sencilla', 1, 2, 1, 1, 1, 1), (80201, 'triple', 3, 5, 3, 3, 2, 2),
               (80202, 'doble', 2, 4, 2, 2, 2, 2), (80202, 'triple', 3, 5, 3, 3, 2, 2),
               (80203, 'sencilla', 1, 1, 1, 1, 0, 0), (80203, 'doble', 2, 2, 2, 2, 0, 0),
               (80204, 'doble', 2, 4, 2, 2, 2, 2), (80205, 'doble', 2, 4, 2, 2, 2, 2)) v(h, a, pt, pm, amin, amax, cmax, imax)
  where not exists (select 1 from public.hotel_acomodaciones x where x.hotel_id = v.h and x.acomodacion = v.a::public.acomodacion_tipo);
-- Tarifas con tarifa de niño DISTINTA por hotel (80201: 50.000 · 80204: gratis = 0). Temporada ALTA cubre todo el rango de viaje del paquete.
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
  (80201, 80201, 'ALTA', public.fecha_negocio() + 30, public.fecha_negocio() + 420, 1, 'tarifa'),
  (80204, 80204, 'ALTA', public.fecha_negocio() + 30, public.fecha_negocio() + 420, 1, 'tarifa') on conflict (id) do nothing;
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_nino, neto_nino2, neto_infante)
  select * from (values (80201, 'Estándar', 'PAM', 'ALTA', 150000, 100000, 90000, 50000, 30000, 40000), (80204, 'Estándar', 'PAM', 'ALTA', 150000, 100000, 90000, 0, 0, 0)) v(a, b, c, d, e, f, g, h, i, j)
  where not exists (select 1 from public.tarifa_hotel t where t.hotel_id = v.a);

-- Servicios: el TOUR (80301) va INCLUIDO en el paquete 80101; la ASISTENCIA (80302) es OPCIONAL. Dos traslados con el MISMO nombre y proveedor distinto (80303/80304) para distinguir homónimos.
insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion, tipo_receptivo, activo) values
  (80301, 'Tour de ciudad B95',          80103, 80002, 40000, 'tour_traslado', 'COP', 'persona', 'paquete', 'tour', true),
  (80302, 'Asistencia médica B95',       80104, 80002, 30000, 'asistencia',    'COP', 'persona', 'paquete', 'asistencia_medica', true),
  (80303, 'Traslado aeropuerto B95',     80103, 80002, 25000, 'tour_traslado', 'COP', 'persona', 'paquete', 'traslado', true),
  (80304, 'Traslado aeropuerto B95',     80106, 80002, 28000, 'tour_traslado', 'COP', 'persona', 'paquete', 'traslado', true) on conflict (id) do nothing;
insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona)
  select 800000 + s, s, 'ALTA', public.fecha_negocio() + 30, public.fecha_negocio() + 420, p from (values (80301, 40000), (80302, 30000), (80303, 25000), (80304, 28000)) v(s, p) on conflict (id) do nothing;

-- ── Vuelos (#41) ────────────────────────────────────────────────────────────
-- Contrato que ocupa UNA silla del bloqueo (la copia NO debe heredarla).
insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, fecha_regreso, pax, estado, asesor, precio_venta, moneda, tipo_paquete) values
  ('DTM-8150', 'Cliente Silla B95', 'mayorista', 'CARTAGENA B95', public.fecha_negocio() + 100, public.fecha_negocio() + 103, 1, 'confirmado', 'Rev Administracion', 900000, 'COP', 'bloqueo') on conflict (numero_contrato) do nothing;
insert into public.bloqueos_vuelo (id, record, aerolinea, proveedor_id, ruta, origen, destino_id, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg,
                                   cupos_total, tarifa_neta, tarifa_para_empaquetar, fee_infante, fecha_devolucion, fecha_emision, moneda, modalidad_emision, notas)
  values (80101, 'B95AA1', 'Aerolínea B95', 80101, 'BOG - CGB - BOG', 'BOG', 80002, 'B95101', public.fecha_negocio() + 100, '07:30', '09:00', 'B95102', public.fecha_negocio() + 103, '17:00', '18:30',
          6, 200000, 250000, 0, public.fecha_negocio() + 60, public.fecha_negocio() + 45, 'COP', 'grupo', 'Bloqueo sintético B95 (duplicar con nuevas fechas)') on conflict (id) do nothing;
insert into public.sillas (bloqueo_id, numero_silla, estado, numero_contrato, pasajero_nombres, pasajero_apellidos, plazo)
  select 80101, g, case when g = 1 then 'confirmada' when g in (2, 3) then 'en_plazo' else 'disponible' end::public.estado_silla,
         case when g = 1 then 'DTM-8150' end, case when g = 1 then 'Silla' end, case when g = 1 then 'Confirmada B95' end, case when g in (2, 3) then public.fecha_negocio() + 5 end
  from generate_series(1, 6) g where not exists (select 1 from public.sillas where bloqueo_id = 80101);
insert into public.empaquetados (id, record, aerolinea, proveedor_id, destino_id, ruta, origen, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg,
                                 tarifa_proveedor, tarifa_para_empaquetar, fee_infante, compra_inicio, compra_fin, activo, moneda, notas)
  values (80101, null, 'JetSMART B95', 80101, 80002, 'BOG - CGB - BOG', 'BOG', 'JB95201', public.fecha_negocio() + 110, '06:10', '07:40', 'JB95202', public.fecha_negocio() + 113, '19:00', '20:30',
          180000, 230000, 0, public.fecha_negocio(), public.fecha_negocio() + 90, true, 'COP', 'Empaquetado sintético B95 (duplicar con nuevas fechas)') on conflict (id) do nothing;

-- ── Paquetes armados de cada tipo (#61) ─────────────────────────────────────
insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_compra_fin, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo, notas) values
  (80101, 'B95 Porción terrestre — Hotel Mar', 'porcion_terrestre', 3, 80002, 0.2, 'fijo', 0, public.fecha_negocio() + 300, public.fecha_negocio() + 30,  public.fecha_negocio() + 420, 'COP', 'COP', true, 'Paquete sintético B95: hotel + tour incluido + asistencia opcional'),
  (80102, 'B95 Bloqueo — vuelo y hotel',       'bloqueo',           3, 80002, 0.2, 'fijo', 0, public.fecha_negocio() + 90,  public.fecha_negocio() + 90,  public.fecha_negocio() + 130, 'COP', 'COP', true, 'Paquete sintético B95: bloqueo + empaquetado'),
  (80103, 'B95 Servicios sueltos',             'servicios',         3, 80002, 0.2, 'fijo', 0, public.fecha_negocio() + 300, public.fecha_negocio() + 30,  public.fecha_negocio() + 420, 'COP', 'COP', true, 'Paquete sintético B95: solo servicios'),
  (80104, 'B95 Dinámico con salida',           'dinamico',          3, 80002, 0.2, 'fijo', 0, public.fecha_negocio() + 300, public.fecha_negocio() + 60,  public.fecha_negocio() + 200, 'COP', 'COP', true, 'Paquete sintético B95: hotel + salida por sistema') on conflict (id) do nothing;
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes, prioridad) values
  (80101, 80201, array['Estándar'], array['PAM'], null), (80102, 80201, array['Estándar'], array['PAM'], 1), (80102, 80204, array['Estándar'], array['PAM'], 2), (80104, 80201, array['Estándar'], array['PAM'], null);
insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values
  (80101, 80301, 'persona', true), (80101, 80302, 'persona', false), (80103, 80301, 'persona', false), (80103, 80302, 'persona', false);
insert into public.armado_vuelos (paquete_id, bloqueo_id) values (80102, 80101);
insert into public.armado_empaquetados (paquete_id, empaquetado_id) values (80102, 80101);
insert into public.salidas_dinamicas (id, paquete_id, aerolinea, ruta, origen, fecha_ida, fecha_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg, valor_tiquete, aplica_mk, ta, fee_infante, compra_inicio, compra_fin, activo, notas, orden, moneda)
  values (80101, 80104, 'JetSMART B95', 'BOG - CGB - BOG', 'BOG', public.fecha_negocio() + 100, public.fecha_negocio() + 103, '06:00', '07:30', '18:00', '19:30', 300000, true, 0, 0, public.fecha_negocio(), public.fecha_negocio() + 90, true, 'Salida sintética B95', 0, 'COP');

-- Paquete DINÁMICO TOTAL (otra estructura: paquete_din*): un hotel con ficha, un hotel manual y un servicio con ficha.
insert into public.paquete_din (id, nombre, destino_id, moneda, esquema, pvp_modo, pct_mk, usa_vuelo, usa_hotel, usa_servicios, noches, compra_inicio, compra_fin, viaje_inicio, viaje_fin, descripcion, incluye, no_incluye, activo, publicado)
  values (80101, 'B95 Paquete dinámico total — Cartagena 3 noches', 80002, 'COP', 'solo_pvp', 'por_componente', 0, false, true, true, 3, public.fecha_negocio(), public.fecha_negocio() + 300, public.fecha_negocio() + 60, public.fecha_negocio() + 200,
          'Paquete total sintético B95 para duplicar.', E'Alojamiento\nTour de ciudad', E'Tiquetes aéreos\nGastos personales', true, true) on conflict (id) do nothing;
insert into public.paquete_din_hoteles (id, paquete_id, hotel_id, nombre, categoria, regimen, proveedor, neto, pvp, orden) values
  (80101, 80101, 80201, 'Hotel Mar B95', 'Estándar', 'PAM', 'Proveedor Hotel Mar B95', '{}'::jsonb, '{"sencilla": 450000, "doble": 300000, "triple": 270000, "multiple": 250000, "nino": 150000, "nino2": 100000, "infante": 0}'::jsonb, 0) on conflict (id) do nothing;
insert into public.paquete_din_hoteles (id, paquete_id, hotel_id, nombre, categoria, regimen, proveedor, neto, pvp, orden, capacidad_ninos, edad_infante_max, edad_nino_max) values
  (80102, 80101, null, 'Hotel manual B95', 'Superior', 'PC', 'Proveedor manual B95', '{}'::jsonb, '{"sencilla": 520000, "doble": 340000, "triple": 300000, "multiple": 280000, "nino": 170000, "nino2": 120000, "infante": 0}'::jsonb, 1, 2, 2, 11) on conflict (id) do nothing;
insert into public.paquete_din_servicios (id, paquete_id, servicio_id, destino_id, nombre, proveedor, proveedor_id, neto, pvp, pvp_infante, orden) values
  (80101, 80101, 80301, 80002, 'Tour de ciudad B95', 'Receptivo B95', 80103, null, 60000, 0, 0) on conflict (id) do nothing;
commit;

-- ── Contratos con pagos (#42) ───────────────────────────────────────────────
-- DTM-8101 pagado en parte (400.000 de 1.000.000) con un plan VIEJO de 2 filas calculado antes del pago; DTM-8102 pagado por completo; DTM-8103 en dólares con centavos (100,50 con 40,00 pagados).
begin;
insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, fecha_regreso, pax, estado, asesor, precio_venta, moneda, tipo_paquete, fecha_emision) values
  ('DTM-8101', 'Cliente Pago Parcial B95',   'mayorista', 'CARTAGENA B95', public.fecha_negocio() + 120, public.fecha_negocio() + 123, 2, 'confirmado', 'Rev Administracion', 1000000,  'COP', 'dinamico', public.fecha_negocio() - 12),
  ('DTM-8102', 'Cliente Pago Completo B95',  'mayorista', 'CARTAGENA B95', public.fecha_negocio() + 120, public.fecha_negocio() + 123, 2, 'confirmado', 'Rev Administracion', 1000000,  'COP', 'dinamico', public.fecha_negocio() - 12),
  ('DTM-8103', 'Cliente Dólares B95',        'mayorista', 'CARTAGENA B95', public.fecha_negocio() + 120, public.fecha_negocio() + 123, 2, 'confirmado', 'Rev Administracion', 100.50,   'USD', 'dinamico', public.fecha_negocio() - 12)
  on conflict (numero_contrato) do nothing;
insert into public.abonos (numero_contrato, cliente, valor_abono, forma_pago, referencia, tenant, fecha_abono) values
  ('DTM-8101', 'Cliente Pago Parcial B95',  400000, 'Transferencia', 'B95-REF-1', 'mayorista', public.fecha_negocio() - 10),
  ('DTM-8102', 'Cliente Pago Completo B95', 1000000, 'Transferencia', 'B95-REF-2', 'mayorista', public.fecha_negocio() - 10);
insert into public.abonos (numero_contrato, cliente, valor_abono, forma_pago, referencia, tenant, fecha_abono, trm, monto_cop, moneda_pago) values
  ('DTM-8103', 'Cliente Dólares B95', 40.00, 'Transferencia', 'B95-REF-3', 'mayorista', public.fecha_negocio() - 10, 4000, 160000, 'USD');
insert into public.cuotas (numero_contrato, orden, tipo, fecha_limite, monto) values
  ('DTM-8101', 0, 'abono', public.fecha_negocio() - 12, 300000), ('DTM-8101', 1, 'cuota', public.fecha_negocio() + 90, 700000);
commit;
