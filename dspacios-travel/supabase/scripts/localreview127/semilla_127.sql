-- #127 — SYNTHETIC review fixture (local disposable database only). Owner case reproduced with invented data:
--   hotel «GRAND SIRENIS CARTAGENA 127» (id 12701), bloqueo package 12701, stay 2026-12-30 → 2027-01-02 (3 nights), double room, flight net 200.000, markup 20 %.
--   Prices by hand (per person): Estandar double 100.000 × 3 / 0,8 + 200.000 / 0,8 = 375.000 + 250.000 = 625.000.
-- Users are created through GoTrue by entorno_127_local.sh (never inserted here); the admin profile row is added by that script.
insert into public.destinos (id, nombre) values (12701, 'CARTAGENA 127') on conflict do nothing;
insert into public.proveedores (id, nombre, tipo) values (12701, 'Proveedor Hotel 127', 'hotelero'), (12702, 'Aerolínea 127', 'aereo') on conflict do nothing;
insert into public.categorias_habitacion (nombre) values ('Estandar'), ('Suite') on conflict do nothing;
insert into public.planes_alimentacion (codigo, nombre) values ('PAM', 'Pensión alimenticia media') on conflict do nothing;
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
  values (12701, 12701, 'GRAND SIRENIS CARTAGENA 127', 12701, 'COP', 0, 5, 6, 12, 1, 6, true), (12702, 12701, 'HOTEL OTRO CARTAGENA 127', 12701, 'COP', 0, 5, 6, 12, 1, 6, true) on conflict do nothing;
insert into public.hotel_categorias (hotel_id, categoria_id) select h, c.id from unnest(array[12701, 12702]) h, public.categorias_habitacion c where c.nombre in ('Estandar', 'Suite') on conflict do nothing;
insert into public.hotel_regimenes (hotel_id, plan_id) select h, p.id from unnest(array[12701, 12702]) h, public.planes_alimentacion p where p.codigo = 'PAM' on conflict do nothing;
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
  select h, a.acomodacion::public.acomodacion_tipo, a.pax_tarifa, a.pax_max, a.adt_min, a.adt_max, a.chd_min, a.chd_max, a.inf_min, a.inf_max from unnest(array[12701, 12702]) h,
    (values ('doble', 2, 4, 2, 2, 0, 2, 0, 2), ('sencilla', 1, 2, 1, 1, 0, 1, 0, 1)) a(acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) on conflict do nothing;
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (12701, 'ALTA', '2026-11-25', '2027-03-31', 1, 'tarifa'), (12702, 'ALTA', '2026-11-25', '2027-03-31', 1, 'tarifa');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante) values
  (12701, 'Estandar', 'PAM', 'ALTA', 160000, 100000, 50000, 30000, 40000), (12701, 'Suite', 'PAM', 'ALTA', 320000, 200000, 100000, 60000, 80000), (12702, 'Estandar', 'PAM', 'ALTA', 160000, 100000, 50000, 30000, 40000);
insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
  values (12701, 'Bloqueo Cartagena 127', 'bloqueo', 3, 12701, 0.2, 'fijo', 0, '2026-11-25', '2027-03-31', 'COP', 'COP', true);
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (12701, 12701, array['Estandar','Suite'], array['PAM']), (12701, 12702, array['Estandar'], array['PAM']);
-- Five flight blocks = the five stays of the matrix (A = the owner stay).
insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, vuelo_ida, fecha_ida, vuelo_regreso, fecha_regreso, cupos_total, tarifa_para_empaquetar, fee_infante, destino_id, proveedor_id, moneda, origen) values
  (12701, 'R127A', 'Aerolínea 127', 'BOG - CTG - BOG', 'AVA1', '2026-12-30', 'AVA2', '2027-01-02', 10, 200000, 0, 12701, 12702, 'COP', 'BOG'),
  (12702, 'R127B', 'Aerolínea 127', 'BOG - CTG - BOG', 'AVB1', '2026-12-26', 'AVB2', '2026-12-29', 10, 200000, 0, 12701, 12702, 'COP', 'BOG'),
  (12704, 'R127D', 'Aerolínea 127', 'BOG - CTG - BOG', 'AVD1', '2027-01-10', 'AVD2', '2027-01-13', 10, 200000, 0, 12701, 12702, 'COP', 'BOG');
insert into public.sillas (bloqueo_id, numero_silla, estado) select b, g, 'disponible' from unnest(array[12701, 12702, 12704]) b, generate_series(1, 10) g;
insert into public.armado_vuelos (paquete_id, bloqueo_id, aplica_mk, ta) select 12701, b, true, 0 from unnest(array[12701, 12702, 12704]) b;

-- G1 (porción «from» price): hotel 12704 with ALTA 100.000/night and a cheaper BAJA 60.000/night inside 2026-12-29 → 2027-01-09; porción package 12702, 3 nights, window 2026-12-01 → 2027-03-31.
--   «desde» double: BAJA 60.000 × 3 / 0,8 = 225.000 · ALTA 100.000 × 3 / 0,8 = 375.000.
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
  values (12704, 12701, 'HOTEL PORCION CARTAGENA 127', 12701, 'COP', 0, 5, 6, 12, 1, 6, true) on conflict do nothing;
insert into public.hotel_categorias (hotel_id, categoria_id) select 12704, c.id from public.categorias_habitacion c where c.nombre = 'Estandar' on conflict do nothing;
insert into public.hotel_regimenes (hotel_id, plan_id) select 12704, p.id from public.planes_alimentacion p where p.codigo = 'PAM' on conflict do nothing;
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
  values (12704, 'doble', 2, 4, 2, 2, 0, 2, 0, 2) on conflict do nothing;
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (12704, 'ALTA', '2026-11-25', '2027-03-31', 1, 'tarifa'), (12704, 'BAJA', '2026-12-29', '2027-01-09', 2, 'tarifa');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante) values
  (12704, 'Estandar', 'PAM', 'ALTA', 160000, 100000, 50000, 30000, 40000), (12704, 'Estandar', 'PAM', 'BAJA', 96000, 60000, 30000, 18000, 24000);
insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
  values (12702, 'Porcion Cartagena 127', 'porcion_terrestre', 3, 12701, 0.2, 'fijo', 0, '2026-12-01', '2027-03-31', 'COP', 'COP', true);
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (12702, 12704, array['Estandar'], array['PAM']);

-- Unit-priced hotel (no per-person accommodations): used to show how an unsupported closure dimension is reported. The stored row is accommodation-only and therefore NOT applied to a unit tariff.
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, modelo_tarifario, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
  values (12703, 12701, 'HOTEL UNIDAD CARTAGENA 127', 12701, 'COP', 'unidad', 0, 2, 3, 10, 1, 6, true) on conflict do nothing;
insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total, acomodaciones, categorias, motivo) values (12703, '2026-12-29', '2027-01-09', false, array['doble'], null, 'cierre por acomodación (no aplica a unidad)');
