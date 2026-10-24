-- ───────────────────────────────────────────────────────────────────────────
-- 230 · FIXTURE de la situación medida en Producción, para probar la corrección de datos en una base DESECHABLE (nunca remota).
-- Réplica de lo descrito por el dueño: 17 empaquetados MDE-SDQ-MDE (ids 3-9 y 11-20) en COP con R 415-445 y fee 45; 16 vinculados
-- (todos menos el 5, sin ruta) al paquete 70 (Dinámico modo cop_trm_63, INACTIVO); salidas manuales 1 y 2 del paquete 71 (WINGO 370/45/45)
-- en COP; más un empaquetado legítimo en COP (id 10, R 1.130.000) que la corrección NO debe tocar.
-- Se aplica sobre una base con 001-228 y la 230 (la corrección exige la 230).
-- ───────────────────────────────────────────────────────────────────────────
begin;

insert into public.destinos (id, nombre, codigo_iata, pais, activo) values
  (230900, 'T230 SANTO DOMINGO', 'SDQ', 'República Dominicana', true)
on conflict (id) do nothing;
insert into public.proveedores (id, nombre) values (230901, 'T230 PROV AEREO') on conflict (id) do nothing;

insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id, modo_oferta, trm_oferta, tarifario_snapshot_publicable) values
  (70, 'JUAN DOLIO (R.D.)', 'dinamico', false, 230900, 'cop_trm_63', 3200, false),
  (71, 'T230 DINAMICO 71', 'dinamico', true, 230900, 'cop_trm_63', 3200, false);

-- 17 empaquetados objetivo + 1 legítimo en COP.
insert into public.empaquetados (id, record, aerolinea, ruta, destino_id, fecha_ida, fecha_regreso, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo, proveedor_id, moneda)
select g, null, 'WINGO', case when g = 5 then null else 'MDE - SDQ - MDE' end, 230900,
       date '2027-01-10' + (g * 7), date '2027-01-14' + (g * 7), 380, 410 + g, 45, true, 230901, 'COP'
  from unnest(array[3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) g;
insert into public.empaquetados (id, record, aerolinea, ruta, destino_id, fecha_ida, fecha_regreso, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo, proveedor_id, moneda)
values (10, null, 'AVIANCA', 'BOG - CTG - BOG', 230900, date '2027-03-01', date '2027-03-04', 1000000, 1130000, 80500, true, 230901, 'COP');

-- Salidas manuales 1 y 2 del paquete 71 (explícitas), luego las 16 vinculadas del 70.
insert into public.salidas_dinamicas (id, paquete_id, aerolinea, ruta, fecha_ida, fecha_regreso, valor_tiquete, aplica_mk, ta, fee_infante, activo, moneda) values
  (1, 71, 'WINGO', 'MDE - SDQ - MDE', date '2027-02-01', date '2027-02-05', 370, false, 45, 45, true, 'COP'),
  (2, 71, 'WINGO', 'MDE - SDQ - MDE', date '2027-02-08', date '2027-02-12', 370, false, 45, 45, true, 'COP');
select setval(pg_get_serial_sequence('public.salidas_dinamicas', 'id'), 100);

set constraints all deferred;
insert into public.salidas_dinamicas (paquete_id, empaquetado_id, aerolinea, ruta, fecha_ida, fecha_regreso, valor_tiquete, fee_infante, aplica_mk, ta, activo, moneda)
select 70, e.id, e.aerolinea, e.ruta, e.fecha_ida, e.fecha_regreso, e.tarifa_para_empaquetar, e.fee_infante, false, 0, true, 'COP'
  from public.empaquetados e where e.id = any (array[3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
set constraints all immediate;

commit;
