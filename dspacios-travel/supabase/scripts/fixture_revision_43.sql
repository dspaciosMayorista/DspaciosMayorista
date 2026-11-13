-- Datos SINTÉTICOS solo para la revisión visual del dueño (revision_43_combinado.sh). Base LOCAL desechable; después de
-- fixture_recorrido_43_e6.sql. No los usan el humo ni los recorridos.
-- Hotel 9309 «R43 PROMO NUEVA»: base ALTA (febrero 2027) SIN ninguna promoción ni fila promocional. Grupos Semana (L–J) y
-- Fin de semana (V–D) con propuestas doble 100.000 y 150.000 por persona y noche, que el modo «revision» aplica a la venta con
-- la acción real. Paquete de porción 9605: 1 noche, sin markup ⇒ el «desde» es la doble de la Semana (100.000). En la revisión
-- el dueño crea la promoción −10 % por grupo (90.000 automático) y sube la base a 120.000 (108.000), sin cargar tarifa promocional.
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda) values (9309, 9301, 'R43 PROMO NUEVA', 'persona', 'COP');
insert into public.hotel_categorias (hotel_id, categoria_id) select 9309, id from public.categorias_habitacion where nombre = 'Estándar' limit 1;
insert into public.hotel_regimenes (hotel_id, plan_id) select 9309, id from public.planes_alimentacion where codigo = 'PAM' limit 1;
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (930901, 9309, 'ALTA', '2027-02-01', '2027-02-28', 1, 'tarifa');
insert into public.hotel_temporada_grupos (id, temporada_id, nombre, dias) values
  ('00000000-0000-4000-8000-0000000c0901', 930901, 'Semana', array[1,2,3,4]),
  ('00000000-0000-4000-8000-0000000c0902', 930901, 'Fin de semana', array[5,6,7]);
insert into public.hotel_grupo_tarifa_propuesta (grupo_id, tipo_habitacion, alimentacion, neto_doble, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max) values
  ('00000000-0000-4000-8000-0000000c0901', 'Estándar', 'PAM', 100000, 0, 1, 2, 11),
  ('00000000-0000-4000-8000-0000000c0902', 'Estándar', 'PAM', 150000, 0, 1, 2, 11);
insert into public.armado_paquetes (id, nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches, moneda_publicacion)
  values (9605, 'E6 promoción nueva por grupo', 9301, '2027-02-01', '2027-02-28', 0, 'porcion_terrestre', 1, 'COP');
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes, prioridad) values (9605, 9309, array['Estándar'], array['PAM'], 1);
