-- CATÁLOGO SINTÉTICO de la revisión local del #53 (solo LOCAL, ficticio): un destino, un hotel en COP y otro en USD, tarifas netas y dos paquetes de PORCIÓN TERRESTRE
-- (3 noches; el USD es un paquete DINÁMICO por la restricción de la oferta #63). Es la misma técnica del recorrido real #14-A (`humo_14a_semilla_real.sql`): se siembra el CATÁLOGO y después los contratos/cotizaciones se crean con las ACCIONES REALES
-- de la aplicación (`generarTarifario`, `crearCotizacion`, `convertirCotizacion`, `crearContrato`); nada de los contratos se inserta a mano.
--   COP: neto doble 150.000 por persona y noche × 3 noches ÷ (1 − 25 %) = 600.000 por adulto → 2 adultos = COP 1.200.000.
--   USD: neto doble   125 por persona y noche × 3 noches ÷ (1 − 25 %) =    500 por adulto → 2 adultos = USD 1.000 (oferta #63 «cop_trm_63», sin TRM publicada: la TRM la elige quien contrata).
\set ON_ERROR_STOP 1
begin;

insert into public.destinos (id, nombre) values (5301, 'CARTAGENA EJEMPLO 53') on conflict do nothing;
insert into public.proveedores (id, nombre) values (5301, 'Hotel COP Ejemplo 53'), (5302, 'Hotel USD Ejemplo 53') on conflict do nothing;

insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo) values
  (5301, 5301, 'Hotel Ejemplo COP 53', 5301, 'COP', 0, 5, 6, 12, 1, 6, true),
  (5302, 5301, 'Hotel Ejemplo USD 53', 5302, 'USD', 0, 5, 6, 12, 1, 6, true);
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values
  (5301, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (5302, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
  (5301, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa'), (5302, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante) values
  (5301, 'Estandar', 'Desayuno', 'ALTA', 200000, 150000, 75000, 45000, 60000),
  (5302, 'Estandar', 'Desayuno', 'ALTA', 190, 125, 60, 40, 50);

insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, modo_oferta, trm_oferta, activo) values
  (5301, 'Porción terrestre COP Ejemplo 53', 'porcion_terrestre', 3, 5301, 0.25, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', 'legacy', null, true),
  (5302, 'Dinámico USD Ejemplo 53', 'dinamico', 3, 5301, 0.25, 'fijo', 0, '2030-01-01', '2030-12-31', 'USD', 'USD', 'cop_trm_63', null, true);
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values
  (5301, 5301, array['Estandar'], array['Desayuno']), (5302, 5302, array['Estandar'], array['Desayuno']);
-- La oferta #63 (USD cobrada en COP con TRM) SOLO existe en paquetes DINÁMICOS (restricción armado_paquetes_modo63_chk), que llevan una salida. Esta salida NO cobra tiquete (valor 0): así el valor del
-- hotel es el total de la oferta (USD 1.000) y su condición congelada por defecto (30 %) es USD 300, coherente con su valor de componente.
insert into public.salidas_dinamicas (id, paquete_id, aerolinea, ruta, origen, fecha_ida, fecha_regreso, valor_tiquete, aplica_mk, ta, fee_infante, activo, moneda)
  values (5302, 5302, 'Operador Ejemplo 53', 'BOG - CTG - BOG', 'BOG', '2030-03-01', '2030-03-04', 0, false, 0, 0, true, 'USD');
commit;
