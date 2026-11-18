-- SEMILLA SINTÉTICA de la revisión local de #102 (Vista tabla: buscador externo y noche adicional · Vista Booking: ocupación por hotel).
-- Solo LOCAL: ningún dato de Producción. Destino CARTAGENA 102, un paquete de porción de 3 noches (id 10201), cinco hoteles sintéticos, mk 20 %, sin impuesto.
-- PVP por persona de una estadía de 3 noches = neto/noche × 3 ÷ 0,8.
--   ALTA (01/01–30/06/2030): sencilla 160.000 · doble 100.000 · triple 96.000 · múltiple 80.000 · Niño 1 40.000 · Niño 2 24.000 · infante 16.000 (neto por noche)
--   BAJA (01/07–31/12/2030) = 60 % de ALTA · «PROMO 5 JULIO» = −20 % sobre la BAJA solo esa noche (fila propia, como exige el sistema).
-- El tarifario se PUBLICA con la acción real (generar_tarifario_102.ts), no con INSERT directo.
\set ON_ERROR_STOP 1
insert into public.destinos (id, nombre) values (10201, 'CARTAGENA 102') on conflict do nothing;
insert into public.proveedores (id, nombre) values (10201, 'Proveedor Hotel 102') on conflict do nothing;
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo, adults_only) values
  (10201, 10201, 'Hotel A (niño hasta 12)', 10201, 'COP', 0, 2, 3, 12, 1, 6, true, false),
  (10202, 10201, 'Hotel B (niño hasta 17)', 10201, 'COP', 0, 2, 3, 17, 1, 6, true, false),
  (10203, 10201, 'Hotel C (sin múltiple)', 10201, 'COP', 0, 2, 3, 12, 1, 6, true, false),
  (10204, 10201, 'Hotel D (solo adultos)', 10201, 'COP', null, null, null, null, 1, 6, true, true),
  (10205, 10201, 'Hotel E (edades por temporada)', 10201, 'COP', 0, 2, 3, 12, 1, 6, true, false);
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values
  (10201, 'sencilla', 1, 2, 1, 1, 0, 1, 0, 1), (10201, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (10201, 'triple', 3, 4, 3, 3, 0, 1, 0, 1), (10201, 'multiple', 4, 5, 4, 4, 0, 1, 0, 1), (10202, 'sencilla', 1, 2, 1, 1, 0, 1, 0, 1), (10202, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (10202, 'triple', 3, 4, 3, 3, 0, 1, 0, 1), (10202, 'multiple', 4, 5, 4, 4, 0, 1, 0, 1),
  (10203, 'sencilla', 1, 2, 1, 1, 0, 1, 0, 1), (10203, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (10203, 'triple', 3, 4, 3, 3, 0, 1, 0, 1), (10204, 'sencilla', 1, 2, 1, 1, 0, 1, 0, 1), (10204, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (10205, 'sencilla', 1, 2, 1, 1, 0, 1, 0, 1), (10205, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (10205, 'triple', 3, 4, 3, 3, 0, 1, 0, 1), (10205, 'multiple', 4, 5, 4, 4, 0, 1, 0, 1);
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
  (10201, 'ALTA', '2030-01-01', '2030-06-30', 1, 'tarifa'), (10201, 'BAJA', '2030-07-01', '2030-12-31', 1, 'tarifa'), (10202, 'ALTA', '2030-01-01', '2030-06-30', 1, 'tarifa'), (10202, 'BAJA', '2030-07-01', '2030-12-31', 1, 'tarifa'), (10203, 'ALTA', '2030-01-01', '2030-06-30', 1, 'tarifa'), (10203, 'BAJA', '2030-07-01', '2030-12-31', 1, 'tarifa'), (10204, 'ALTA', '2030-01-01', '2030-06-30', 1, 'tarifa'), (10204, 'BAJA', '2030-07-01', '2030-12-31', 1, 'tarifa'), (10205, 'ALTA', '2030-01-01', '2030-06-30', 1, 'tarifa'), (10205, 'BAJA', '2030-07-01', '2030-12-31', 1, 'tarifa');
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor)
  values (10201, 'PROMO 5 JULIO', '2030-07-05', '2030-07-05', 5, 'descuento_pct', 20);
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante) values
  (10201, 'Estandar', 'Desayuno', 'ALTA', 160000, 100000, 96000, 80000, 40000, 24000, 16000), (10201, 'Estandar', 'Desayuno', 'BAJA', 96000, 60000, 57600, 48000, 24000, 14400, 9600),
  (10202, 'Estandar', 'Desayuno', 'ALTA', 160000, 100000, 96000, 80000, 40000, 24000, 16000), (10202, 'Estandar', 'Desayuno', 'BAJA', 96000, 60000, 57600, 48000, 24000, 14400, 9600),
  (10203, 'Estandar', 'Desayuno', 'ALTA', 160000, 100000, 96000, 80000, 40000, 24000, 16000), (10203, 'Estandar', 'Desayuno', 'BAJA', 96000, 60000, 57600, 48000, 24000, 14400, 9600),
  (10204, 'Estandar', 'Desayuno', 'ALTA', 160000, 100000, 96000, 80000, 40000, 24000, 16000), (10204, 'Estandar', 'Desayuno', 'BAJA', 96000, 60000, 57600, 48000, 24000, 14400, 9600),
  (10205, 'Estandar', 'Desayuno', 'ALTA', 160000, 100000, 96000, 80000, 40000, 24000, 16000), (10205, 'Estandar', 'Desayuno', 'BAJA', 96000, 60000, 57600, 48000, 24000, 14400, 9600),
  (10201, 'Estandar', 'Desayuno', 'PROMO 5 JULIO', 76800, 48000, 46080, 38400, 19200, 11520, 7680);
update public.tarifa_hotel set neto_triple = null, neto_multiple = null where hotel_id = 10204;
update public.tarifa_hotel set neto_multiple = null where hotel_id = 10203;
-- Hotel E: la ALTA clasifica niños hasta 12 años y la BAJA hasta 17 → una estadía que cruza ambas NO tiene una regla de edad única.
update public.tarifa_hotel set edad_infante_min = 0, edad_infante_max = 2, edad_nino_min = 3, edad_nino_max = 12 where hotel_id = 10205 and temporada = 'ALTA';
update public.tarifa_hotel set edad_infante_min = 0, edad_infante_max = 2, edad_nino_min = 3, edad_nino_max = 17 where hotel_id = 10205 and temporada = 'BAJA';
insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
  values (10201, 'Porción 102', 'porcion_terrestre', 3, 10201, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true);
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes)
  select 10201, h, array['Estandar'], array['Desayuno'] from unnest(array[10201,10202,10203,10204,10205]) h;
