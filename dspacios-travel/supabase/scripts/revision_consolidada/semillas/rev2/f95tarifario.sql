-- REV2 · B95-16 — semilla ADITIVA e idempotente (sintética) del paquete «Porción 95T» con DOS hoteles de plan y tarifa de niño distintos, para recorrer en el navegador
-- Tarifario → comparativa → opción elegida → contrato. NO siembra nada derivado: el tarifario lo genera el paso B95-16a con el botón «Generar tarifario» (como B95-01).
-- ids 9560–9562 (libres en las demás semillas). Cargar con el administrador de la base de la revisión; nunca borra ni modifica filas existentes (on conflict do nothing).
-- Cifras (markup 20 %, PVP = neto / 0,8, 3 noches 2030-03-01 → 2030-03-04; adultos exactos al peso):
--   Hotel Alfa 95T «Estandar» / «Desayuno»: adulto neto 100.000/noche → 375.000; niño neto 40.000/noche → 150.000.
--   Hotel Beta 95T «Superior» / «Todo incluido»: adulto neto 128.000/noche → 480.000; niño GRATIS en el hotel.
--   Asistencia médica 95T (opcional, por persona): neto 32.000 → 40.000 por persona.
-- Con 2 adultos y la asistencia: A = 830.000 · B = 1.040.000 (con 1 niño y 3 personas: A = 1.020.000 · B = 1.080.000).
insert into public.destinos (id, nombre) values (9560, 'CARTAGENA 95T') on conflict do nothing;
insert into public.proveedores (id, nombre) values (9560, 'Proveedor 95T') on conflict do nothing;
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
  values (9561, 9560, 'Hotel Alfa 95T', 9560, 'COP', 0, 5, 6, 12, 1, 6, true), (9562, 9560, 'Hotel Beta 95T', 9560, 'COP', 0, 5, 6, 12, 1, 6, true) on conflict do nothing;
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
  select h, 'doble', 2, 4, 2, 2, 0, 2, 0, 2 from (values (9561), (9562)) v(h)
  where not exists (select 1 from public.hotel_acomodaciones a where a.hotel_id = v.h and a.acomodacion = 'doble');
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo)
  select h, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa' from (values (9561), (9562)) v(h)
  where not exists (select 1 from public.hotel_temporadas t where t.hotel_id = v.h and t.nombre = 'ALTA');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante)
  select * from (values (9561, 'Estandar', 'Desayuno', 'ALTA', 150000, 100000, 40000, 30000, 20000), (9562, 'Superior', 'Todo incluido', 'ALTA', 200000, 128000, 0, 0, 0)) v(h, c, a, t, s, d, n, n2, i)
  where not exists (select 1 from public.tarifa_hotel x where x.hotel_id = v.h and x.tipo_habitacion = v.c and x.alimentacion = v.a and x.temporada = v.t);
insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
  values (9560, 'Porción 95T', 'porcion_terrestre', 3, 9560, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true) on conflict do nothing;
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes)
  select 9560, v.h, v.c, v.r from (values (9561, array['Estandar'], array['Desayuno']), (9562, array['Superior'], array['Todo incluido'])) v(h, c, r)
  where not exists (select 1 from public.armado_hoteles a where a.paquete_id = 9560 and a.hotel_id = v.h);
insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion, tipo_receptivo)
  values (9561, 'Asistencia médica 95T', 9560, 9560, 32000, 'asistencia', 'COP', 'persona', 'paquete', 'asistencia_medica') on conflict do nothing;
insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (956561, 9561, 'ALTA', '2030-01-01', '2030-12-31', 32000) on conflict do nothing;
insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido)
  select 9560, 9561, 'persona', false where not exists (select 1 from public.armado_servicios a where a.paquete_id = 9560 and a.servicio_id = 9561);
