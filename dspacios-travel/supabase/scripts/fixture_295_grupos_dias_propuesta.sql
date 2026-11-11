-- Fixture de la 295 (se carga DESPUÉS de fixture_293 y de la 295, en una base local desechable).
-- Catálogo del hotel 9301: categorías Estándar/Superior y regímenes PAM/PC; una promoción vinculada a ALTA.
insert into public.categorias_habitacion (id, nombre) values (9301, 'Estándar'), (9302, 'Superior') on conflict do nothing;
insert into public.planes_alimentacion (id, codigo, nombre) values (9301, 'PAM', 'PAM t295'), (9302, 'PC', 'PC t295') on conflict do nothing;
insert into public.hotel_categorias (hotel_id, categoria_id)
  select h, c.id from (values (9301), (9303)) x(h), public.categorias_habitacion c
  where c.nombre in ('Estándar', 'Superior') and (h = 9301 or c.nombre = 'Estándar');
insert into public.hotel_regimenes (hotel_id, plan_id)
  select h, p.id from (values (9301), (9303)) x(h), public.planes_alimentacion p
  where p.codigo in ('PAM', 'PC') and (h = 9301 or p.codigo = 'PAM');
-- Promoción de ALTA (Dubai/Mixta: fila final con temporada_base = ALTA) y su vigencia.
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor)
values (930108, 9301, 'PROMO-ALTA', '2027-01-01', '2027-01-31', 4, 'descuento_pct', 10);
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble, precio_final_autoritativo, temporada_base)
values (9301, 'Estándar', 'PAM', 'PROMO-ALTA', 90000, true, 'ALTA');
