-- U1 (revisión consolidada): destino SINTÉTICO «CARTAGENA U1» con dos hoteles por UNIDAD (modelo Bernalo), tarifa publicada con reglas de edad explícitas en ambos.
-- Uno tiene su configuración de edades completa y el otro es un hotel «heredado» SIN ella: con un menor se explica en vez de cotizarse; solo adultos cotiza igual.
-- Solo LOCAL. Tarifa por persona: adulto 100.000 / niño 50.000 / infante 0 por noche, comisión 20 %, markup del paquete 20 %.
\set ON_ERROR_STOP 1
begin;
insert into public.destinos (id, nombre) values (10311, 'CARTAGENA U1') on conflict do nothing;
insert into public.proveedores (id, nombre, tipo) values (10311, 'Proveedor Hotel U1', 'hotelero') on conflict do nothing;
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, modelo_tarifario, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo, adults_only) values
  (10311, 10311, 'U1 · Hotel por unidad con edades', 10311, 'COP', 'unidad', 0, 2, 3, 10, 1, 6, true, false),
  (10312, 10311, 'U1 · Hotel por unidad SIN edades', 10311, 'COP', 'unidad', null, null, null, null, 1, 6, true, false);
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo)
  select h, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa' from unnest(array[10311, 10312]) h;
insert into public.hotel_tarifas_unidad (hotel_id, tarifa_id, version_tarifario, temporada, categoria, alimentacion, estado, comision_pct, payload)
  select h, 'u1-rev-' || h, 'u1-rev', 'ALTA', 'Estandar', 'PAM', 'publicada', 20,
    jsonb_build_object(
      'id', 'u1-rev-' || h, 'unidadCobro', 'persona',
      'valores', jsonb_build_object('adulto', 100000, 'nino', 50000, 'infante', 0, 'periodicidadInfante', 'por_noche'),
      'capacidad', jsonb_build_object('minPax', 1, 'maxPax', 6, 'paxIncluidos', 0),
      'suplementos', '[]'::jsonb,
      'reglaMenores', jsonb_build_object('reglas', jsonb_build_array(
        jsonb_build_object('categoria', 'infante', 'edadMinAnios', 0, 'edadMaxAnios', 2),
        jsonb_build_object('categoria', 'nino', 'edadMinAnios', 3, 'edadMaxAnios', 10),
        jsonb_build_object('categoria', 'adulto', 'edadMinAnios', 11, 'edadMaxAnios', 17))),
      'comisionPct', 20, 'versionTarifario', 'u1-rev', 'temporada', 'ALTA', 'categoria', 'Estandar', 'alimentacion', 'PAM')
  from unnest(array[10311, 10312]) h;
insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
  values (10311, 'Porción U1 (unidad)', 'porcion_terrestre', 3, 10311, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true);
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes)
  select 10311, h, array['Estandar'], array['PAM'] from unnest(array[10311, 10312]) h;
commit;
