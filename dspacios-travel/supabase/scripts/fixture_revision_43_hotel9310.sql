-- Hotel SINTÉTICO adicional para la revisión visual de «Promociones dinámicas por grupo» (agrupación por categoría y desplazamiento del
-- modal). SOLO base local de revisión; separado de los hoteles del dueño (no toca ninguna fila existente ni el catálogo: usa las
-- categorías y alimentaciones que ya existen). Se aplica UNA vez: si el hotel 9310 ya existe, no hace nada.
--   Hotel 9310 «R43 VARIAS CATEGORIAS» (COP, julio de 2027, sin reglas EBB / Long Stay: nada queda pendiente).
--   Base ALTA (931001) con 9 filas: Estándar × PAM, PC, PAE, PA, FULL y Superior × PAM, PC, PAE, FULL; cada una con las 7 acomodaciones.
--   «PROMO JULIO» −15 % (931010, prioridad 2) y «HAB 30K» −30.000 por habitación y noche (931011, prioridad 3), ambas sobre ALTA,
--   todos los días. Estándar abre un modal de 5 alimentaciones × 7 acomodaciones (35 líneas): obliga a desplazarse a 375 y 1280 px.
do $$
begin
  if exists (select 1 from public.hoteles where id = 9310) then raise notice 'el hotel 9310 ya existe: no se toca'; return; end if;
  insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda) values (9310, 9301, 'R43 VARIAS CATEGORIAS', 'persona', 'COP');
  insert into public.hotel_categorias (hotel_id, categoria_id) select 9310, id from public.categorias_habitacion where nombre in ('Estándar', 'Superior');
  insert into public.hotel_regimenes (hotel_id, plan_id) select 9310, id from public.planes_alimentacion where codigo in ('PAM', 'PC', 'PAE', 'PA', 'FULL');
  insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (931001, 9310, 'ALTA', '2027-07-01', '2027-07-31', 1, 'tarifa');
  insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante)
  select 9310, c.cat, r.reg, 'ALTA', 180000 + c.d + r.d, 120000 + c.d + r.d, 105000 + c.d + r.d, 95000 + c.d + r.d, 50000 + r.d / 2, 30000 + r.d / 2, 0
  from (values ('Estándar', 0), ('Superior', 40000)) c(cat, d)
  cross join (values ('PAM', 0), ('PC', 15000), ('PAE', 25000), ('PA', 35000), ('FULL', 60000)) r(reg, d)
  where not (c.cat = 'Superior' and r.reg = 'PA');
  insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, descuento_unidad, promo_base_id) values
    (931010, 9310, 'PROMO JULIO', '2027-07-01', '2027-07-31', 2, 'descuento_pct', 15, null, 931001),
    (931011, 9310, 'HAB 30K', '2027-07-01', '2027-07-31', 3, 'descuento_monto', 30000, 'habitacion_noche', 931001);
  -- Primeras reglas, como las guarda promocion_guardar_reglas (300).
  perform set_config('app.e5_promocion_nueva', '931010', true);
  insert into public.hotel_promocion_reglas (promocion_id, grupo_id, valor, dias) values (931010, null, 15, null);
  perform set_config('app.e5_promocion_nueva', '931011', true);
  insert into public.hotel_promocion_reglas (promocion_id, grupo_id, valor, dias) values (931011, null, 30000, null);
end $$;
