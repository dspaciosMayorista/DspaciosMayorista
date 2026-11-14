-- Datos del recorrido local de #43/#60 (entregas 4 y 5). Hotel 9306 en COP, junio de 2027: ALTA (base) doble 100.000 y triple 90.000 por persona
-- y noche; promoción por grupo vinculada a ALTA: −20.000 POR HABITACIÓN y noche (todos los días); regla EBB 12 % a ≥ 30 días. La promoción
-- se crea cuando la regla ya existe ⇒ nace PENDIENTE (301) y el recorrido la configura con la RPC, como la ficha del hotel.
-- Paquete de porción 9306 (markup 20 %) con el hotel. Usuario de las acciones: operaciones 9302 (fixture 293).
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda) values (9306, 9301, 'R43 HABITACION', 'persona', 'COP');
insert into public.hotel_categorias (hotel_id, categoria_id) select 9306, id from public.categorias_habitacion where nombre = 'Estándar' limit 1;
insert into public.hotel_regimenes (hotel_id, plan_id) select 9306, id from public.planes_alimentacion where codigo = 'PAM' limit 1;
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
  (930601, 9306, 'ALTA', '2027-06-01', '2027-06-30', 1, 'tarifa');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble, neto_triple) values
  (9306, 'Estándar', 'PAM', 'ALTA', 100000, 90000);
insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct, activa) values (9306, 'ebb', 30, 12, true);
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, descuento_unidad, promo_base_id) values
  (930610, 9306, 'HAB 20K', '2027-06-01', '2027-06-30', 2, 'descuento_monto', 20000, 'habitacion_noche', 930601);
-- Sus primeras reglas, como las guarda promocion_guardar_reglas (300): marca de promoción nueva ⇒ nace pendiente, no se rechaza.
begin;
select set_config('app.e5_promocion_nueva', '930610', true);
insert into public.hotel_promocion_reglas (promocion_id, grupo_id, valor, dias) values (930610, null, 20000, null);
commit;
insert into public.armado_paquetes (id, nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches, moneda_publicacion)
  values (9306, 'R43 porción', 9301, '2027-06-01', '2027-06-30', 0.2, 'porcion_terrestre', 3, 'COP');
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (9306, 9306, array['Estándar'], array['PAM']);

-- Hotel 9307 (paquete 9307): ALTA doble 100.000 / triple 90.000; EBB 12 % (≥ 30 días) y Long Stay 15 % (≥ 3 noches).
--  · «PROMO DOBLE» (1–19 jun, materializada SOLO para la doble a 90.000): la precedencia decide distinto por acomodación
--    (doble: la promoción con EBB; triple: sin promoción, gana Long Stay por mayor %). Nace pendiente (las reglas ya existen).
--  · «P3 TARDIA» (20–30 jun, doble 80.000 / triple 70.000) se vende pero su compra está cerrada: no coincide con nada. Abrirle la
--    compra crea coincidencias ⇒ el cambio queda PENDIENTE (P3) y la versión autorizada sigue vendiéndose hasta activarlo.
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda) values (9307, 9301, 'R43 MIXTO', 'persona', 'COP');
insert into public.hotel_categorias (hotel_id, categoria_id) select 9307, id from public.categorias_habitacion where nombre = 'Estándar' limit 1;
insert into public.hotel_regimenes (hotel_id, plan_id) select 9307, id from public.planes_alimentacion where codigo = 'PAM' limit 1;
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
  (930701, 9307, 'ALTA', '2027-06-01', '2027-06-30', 1, 'tarifa');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble, neto_triple) values
  (9307, 'Estándar', 'PAM', 'ALTA', 100000, 90000);
insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct, activa) values (9307, 'ebb', 30, 12, true), (9307, 'long_stay', 3, 15, true);
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor) values
  (930710, 9307, 'PROMO DOBLE', '2027-06-01', '2027-06-19', 2, 'descuento_pct', 10);
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, compra_inicio, compra_fin) values
  (930711, 9307, 'P3 TARDIA', '2027-06-20', '2027-06-30', 2, 'descuento_pct', 20, '2026-01-01', '2026-02-01');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble, neto_triple, precio_final_autoritativo, temporada_base) values
  (9307, 'Estándar', 'PAM', 'PROMO DOBLE', 90000, null, true, 'ALTA'),
  (9307, 'Estándar', 'PAM', 'P3 TARDIA', 80000, 70000, true, 'ALTA');
insert into public.armado_paquetes (id, nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches, moneda_publicacion)
  values (9307, 'R43 mixto', 9301, '2027-06-01', '2027-06-30', 0.2, 'porcion_terrestre', 3, 'COP');
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (9307, 9307, array['Estándar'], array['PAM']);
