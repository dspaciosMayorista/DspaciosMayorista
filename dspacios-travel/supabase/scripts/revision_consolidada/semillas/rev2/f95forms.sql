-- Semilla ADITIVA e idempotente para la revisión del dueño (F6: formularios manuales, B95-13/14/15/20). Solo agrega filas sintéticas con ids altos (970xxx) y `on conflict do nothing`; no modifica ni borra nada.
-- NO se ejecuta contra rev_consolidada desde esta entrega: la carga la decide quien coordina (preferiblemente primero en una copia desechable).
-- Requisito de esquema: ninguno (los datos usan tablas ya existentes; la migración 346 solo hace falta para GUARDAR el contrato manual con origen de compra).
insert into public.destinos (id, nombre) values (970001, 'SAN ANDRÉS F6'), (970002, 'CARTAGENA F6') on conflict (id) do nothing;
insert into public.proveedores (id, nombre) values (970001, 'Hoteles Isla F6 SAS') on conflict (id) do nothing;
-- Hotel Marina: San Andrés, CON proveedor configurado. Hotel Capilla del Mar: Cartagena, SIN proveedor configurado (caso «compra directa sin proveedor»). Hotel Solo Adultos: San Andrés, adults_only.
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo, adults_only) values
  (970001, 970001, 'Hotel Marina F6', 970001, 'COP', 0, 2, 3, 10, 1, 6, true, false),
  (970002, 970002, 'Hotel Capilla del Mar F6', null, 'COP', 0, 2, 3, 10, 1, 6, true, false),
  (970003, 970001, 'Hotel Solo Adultos F6', 970001, 'COP', 0, 2, 3, 10, 1, 6, true, true)
on conflict (id) do nothing;
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
select v.hotel_id, v.acomodacion, v.pax_tarifa, v.pax_max, 0, 0, v.chd_max, v.chd_max, 0, v.inf_max from (values
  (970001, 'sencilla'::acomodacion_tipo, 1, 2, 1, 1), (970001, 'doble'::acomodacion_tipo, 2, 4, 2, 1),
  (970002, 'sencilla'::acomodacion_tipo, 1, 2, 1, 1), (970002, 'doble'::acomodacion_tipo, 2, 4, 2, 1),
  (970003, 'doble'::acomodacion_tipo, 2, 2, 0, 0)) as v(hotel_id, acomodacion, pax_tarifa, pax_max, chd_max, inf_max)
where not exists (select 1 from public.hotel_acomodaciones a where a.hotel_id = v.hotel_id and a.acomodacion = v.acomodacion);

-- Ajuste para el recorrido B95-20 (comparativa en USD con 3 adultos): el «Hotel Niño Gratis B95» (80204) solo ofrecía Doble; se le agrega Triple para que 3 adultos quepan en UNA habitación. Solo si ese hotel existe.
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
select 80204, 'triple'::acomodacion_tipo, 3, 5, 3, 3, 0, 2, 0, 2
where exists (select 1 from public.hoteles where id = 80204)
  and not exists (select 1 from public.hotel_acomodaciones x where x.hotel_id = 80204 and x.acomodacion = 'triple'::acomodacion_tipo);
