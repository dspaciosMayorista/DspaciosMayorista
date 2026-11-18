-- #1 (personas de cotizaciones en el CRM): SOLO el catálogo sintético de humo_1_semilla.sql (porción terrestre con hotel «a solicitud» y hotel tarifado). Los usuarios son los de la revisión consolidada.
insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values
  (9801, 'Agencia Humo Uno', '9801', 'agencia', 0.10, false, 0, true), (9802, 'Agencia Humo Dos', '9802', 'agencia', 0.10, false, 0, true) on conflict (id) do nothing;
insert into public.destinos (id, nombre) values (9801, 'CARTAGENA HUMO') on conflict do nothing;
insert into public.proveedores (id, nombre) values (9801, 'Proveedor Humo') on conflict do nothing;
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, activo) overriding system value values
  (9803, 9801, 'Hotel Solicitud Humo', 9801, 'COP', true), (9804, 9801, 'Hotel Tarifado Humo', 9801, 'COP', true);
insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) overriding system value values
  (9803, 'Porcion terrestre Humo', 'porcion_terrestre', 3, 9801, 0.2, 'fijo', 0, '2030-05-01', '2030-05-31', 'COP', 'COP', true);
insert into public.armado_hoteles (paquete_id, hotel_id) values (9803, 9803), (9803, 9804);
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, tipo, prioridad) values (9804, 'ALTA', '2030-05-01', '2030-05-31', 'tarifa', 1);
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante)
  values (9804, 'Estandar', 'PC', 'ALTA', 300000, 300000, 300000, 300000, 150000, 150000, 0);
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
  values (9803, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (9804, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
update public.hoteles set tarifa_bajo_solicitud = true where id = 9803;
