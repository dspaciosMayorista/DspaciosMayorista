-- O3 + O4 (revisión consolidada): destino SINTÉTICO «CARTAGENA O3» con seis hoteles para ver la configuración de edades obligatoria y la noche adicional como referencia.
-- Solo LOCAL. Cifras idénticas a las de #102: ALTA (01/01–30/06/2030) por persona y noche: sencilla 160.000 · doble 100.000 · triple 96.000 · Niño 1 40.000 · Niño 2 24.000 · infante 16.000 (neto);
-- mk 20 % → 2 adultos en Doble, 3 noches = 750.000 y la noche adicional de referencia = 250.000. El hotel «con edades completas» tiene además BAJA (01/07–31/12/2030) = 60 % de ALTA.
-- Los hoteles nacen CON edades válidas porque publicar el tarifario las exige; semilla_revision_o3_despues.sql (tras publicar con la acción real) deja sin ellas a los «heredados» (como un hotel viejo).
\set ON_ERROR_STOP 1
begin;
insert into public.destinos (id, nombre) values (10301, 'CARTAGENA O3') on conflict do nothing;
insert into public.proveedores (id, nombre, tipo) values (10301, 'Proveedor Hotel O3', 'hotelero') on conflict do nothing;
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo, adults_only) values
  (10301, 10301, 'O3 · Hotel con edades completas', 10301, 'COP', 0, 2, 3, 12, 1, 6, true, false),
  (10302, 10301, 'O3 · Hotel SIN edades configuradas', 10301, 'COP', 0, 2, 3, 12, 1, 6, true, false),
  (10303, 10301, 'O3 · Hotel solo adultos', 10301, 'COP', null, null, null, null, 1, 6, true, true),
  (10304, 10301, 'O3 · Hotel con edades inválidas', 10301, 'COP', 0, 2, 3, 12, 1, 6, true, false),
  (10305, 10301, 'O3 · Hotel sin edades, con override en la tarifa', 10301, 'COP', 0, 2, 3, 12, 1, 6, true, false),
  (10306, 10301, 'O4 · Hotel promoción 4 noches, 1 gratis', 10301, 'COP', 0, 2, 3, 12, 1, 6, true, false);
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
  select h, a.acomodacion::public.acomodacion_tipo, a.pax_tarifa, a.pax_max, a.adt_min, a.adt_max, a.chd_min, a.chd_max, a.inf_min, a.inf_max
  from unnest(array[10301, 10302, 10303, 10304, 10305, 10306]) h
  cross join (values ('sencilla', 1, 2, 1, 1, 0, 1, 0, 1), ('doble', 2, 4, 2, 2, 0, 2, 0, 2), ('triple', 3, 4, 3, 3, 0, 1, 0, 1)) as a(acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max);
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo)
  select h, 'ALTA', '2030-01-01', '2030-06-30', 1, 'tarifa' from unnest(array[10301, 10302, 10303, 10304, 10305, 10306]) h;
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (10301, 'BAJA', '2030-07-01', '2030-12-31', 1, 'tarifa');
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, min_noches)
  values (10306, 'CUATRO NOCHES 1 GRATIS', '2030-01-01', '2030-06-30', 5, 'promo_noche_gratis', 4);
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante)
  select h, 'Estandar', 'Desayuno', 'ALTA', 160000, 100000, 96000, 80000, 40000, 24000, 16000 from unnest(array[10301, 10302, 10303, 10304, 10305, 10306]) h;
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante)
  values (10301, 'Estandar', 'Desayuno', 'BAJA', 96000, 60000, 57600, 48000, 24000, 14400, 9600);
-- Hotel «con override»: la tarifa trae su propia regla de edad completa, pero esa regla NO reemplaza la configuración obligatoria del hotel.
update public.tarifa_hotel set edad_infante_min = 0, edad_infante_max = 2, edad_nino_min = 3, edad_nino_max = 12 where hotel_id = 10305;
insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
  values (10301, 'Porción O3/O4', 'porcion_terrestre', 3, 10301, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true);
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes)
  select 10301, h, array['Estandar'], array['Desayuno'] from unnest(array[10301, 10302, 10303, 10304, 10305, 10306]) h;
commit;
