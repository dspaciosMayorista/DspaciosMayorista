-- Datos del recorrido real de la entrega 6 (después de fixture_recorrido_43_e5.sql). Base LOCAL desechable.
-- 1) Hotel 9301 (fixture 293/297/299): ALTA de enero 2027 con grupos Semana (L–J) y Fin de semana (V–D). Propuestas listas para
--    aplicar a la venta: Semana doble 100.000 y Fin de semana doble 150.000 por persona y noche. PUENTE (10–12 ene) con prioridad 2
--    para que no empate con ALTA. Paquete de porción E6 (9601): ventana 4–10 ene 2027, 5 noches, SIN markup ⇒ el «desde» debe ser
--    550.000 (lun–vie: 4 × 100.000 + 150.000) con entrada 04/01/2027, nunca 500.000 (5 × la noche más barata).
-- 2) Conteo de solicitudes: hotel 9308 sin promociones (mismo EBB que 9306) y dos salidas dinámicas (tarifa PUBLICADA, que es donde
--    puede aparecer la lectura de combinaciones): 9602 con el hotel 9306 (promoción por habitación) y 9603 con el 9308.
--    Paquete de porción 9604 con el 9308 para comparar la cotización por fechas con y sin promociones.
insert into public.hotel_grupo_tarifa_propuesta (grupo_id, tipo_habitacion, alimentacion, neto_sencilla, neto_doble, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max)
values ('00000000-0000-4000-8000-0000000c0001', 'Estándar', 'PAM', 150000, 100000, 0, 1, 2, 11);
update public.hotel_grupo_tarifa_propuesta set neto_doble = 150000 where grupo_id = '00000000-0000-4000-8000-0000000c0002';
update public.hotel_temporadas set prioridad = 2 where id = 930106;
-- La promoción materializada «PROMO-ALTA» del fixture 295 (90.000 todo enero, prioridad 4) taparía la Semana y el Fin de semana:
-- este recorrido mide SOLO la diferencia entre días, así que se retira de la base desechable (con su fila de tarifa).
delete from public.tarifa_hotel where hotel_id = 9301 and temporada = 'PROMO-ALTA';
delete from public.hotel_temporadas where id = 930108;
insert into public.armado_paquetes (id, nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches, moneda_publicacion)
  values (9601, 'E6 porción semana/fin de semana', 9301, '2027-01-04', '2027-01-10', 0, 'porcion_terrestre', 5, 'COP');
-- prioridad 1 = oferta recomendada: la portada de la vitrina (sin destino ni búsqueda) solo muestra recomendadas (humo visual).
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes, prioridad) values (9601, 9301, array['Estándar'], array['PAM'], 1);

insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda) values (9308, 9301, 'R43 SIN PROMOCIONES', 'persona', 'COP');
insert into public.hotel_categorias (hotel_id, categoria_id) select 9308, id from public.categorias_habitacion where nombre = 'Estándar' limit 1;
insert into public.hotel_regimenes (hotel_id, plan_id) select 9308, id from public.planes_alimentacion where codigo = 'PAM' limit 1;
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (930801, 9308, 'ALTA', '2027-06-01', '2027-06-30', 1, 'tarifa');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble, neto_triple) values (9308, 'Estándar', 'PAM', 'ALTA', 100000, 90000);
insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct, activa) values (9308, 'ebb', 30, 12, true);
insert into public.armado_paquetes (id, nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches, moneda_publicacion) values
  (9602, 'E6 dinámico con promoción', 9301, '2027-06-01', '2027-06-30', 0.2, 'dinamico', 3, 'COP'),
  (9603, 'E6 dinámico sin promoción', 9301, '2027-06-01', '2027-06-30', 0.2, 'dinamico', 3, 'COP'),
  (9604, 'E6 porción sin promoción', 9301, '2027-06-01', '2027-06-30', 0.2, 'porcion_terrestre', 3, 'COP');
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values
  (9602, 9306, array['Estándar'], array['PAM']), (9603, 9308, array['Estándar'], array['PAM']), (9604, 9308, array['Estándar'], array['PAM']);
insert into public.salidas_dinamicas (id, paquete_id, fecha_ida, fecha_regreso, valor_tiquete, aplica_mk, ta, moneda, activo) values
  (960201, 9602, '2027-06-07', '2027-06-10', 0, false, 0, 'COP', true),
  (960301, 9603, '2027-06-07', '2027-06-10', 0, false, 0, 'COP', true);
