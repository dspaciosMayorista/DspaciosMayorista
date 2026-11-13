-- REVISIÓN LOCAL DEL LOTE DE MEJORAS — datos SINTÉTICOS (nada de Producción). Ids 9150xx, nombres «LOTE …».
-- Solo para la base desechable lote_revision. Las fechas se calculan desde el día de Bogotá en que se siembra.
\set ON_ERROR_STOP 1
begin;
create temp table hoy_lote as select (now() at time zone 'America/Bogota')::date as d;

-- Catálogo (destino 1 = CARTAGENA/CTG ya viene de las migraciones del repo)
insert into public.categorias_habitacion (nombre) values ('Estándar'), ('Superior'), ('Suite') on conflict (nombre) do nothing;
insert into public.proveedores (id, nombre, tipo) values (915001, 'LOTE Proveedor receptivo', 'receptivo'), (915002, 'LOTE Proveedor hotel', 'hotel') on conflict (id) do nothing;

-- Hotel con 3 categorías (blackouts #50) y tarifas del 1-dic-2026 al 31-mar-2027
insert into public.hoteles (id, destino_id, nombre, proveedor_id, modelo_tarifario, descripcion)
values (915001, 1, 'LOTE Hotel Cartagena', 915002, 'persona', 'Hotel sintético para la revisión del lote.');
insert into public.hotel_categorias (hotel_id, categoria_id) select 915001, id from public.categorias_habitacion where nombre in ('Estándar', 'Superior', 'Suite');
insert into public.hotel_regimenes (hotel_id, plan_id) select 915001, id from public.planes_alimentacion where codigo = 'PAM';
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo)
values (9150011, 915001, 'LOTE TEMPORADA', '2026-12-01', '2027-03-31', 1, 'tarifa');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino)
values (915001, 'Estándar', 'PAM', 'LOTE TEMPORADA', 300000, 200000, 180000, 170000, 90000),
       (915001, 'Superior', 'PAM', 'LOTE TEMPORADA', 400000, 260000, 240000, 230000, 110000),
       (915001, 'Suite',    'PAM', 'LOTE TEMPORADA', 600000, 380000, 350000, 330000, 150000);

-- Servicios receptivos con portada (fotos de public/: cada una distinta para detectar una portada ajena)
insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, liquidacion, activo, tipo_tarifa, precio_persona, categoria, tipo_receptivo, descripcion, moneda, foto_url)
values (915001, 'LOTE Tour 1 (paquete Servicios)', 915001, 1, 'paquete', true, 'persona', 80000, 'tour', 'tour', 'Tour sintético del paquete tipo Servicios.', 'COP', '/marca/isotipo-full.png'),
       (915002, 'LOTE Tour 2 (opcional de Porción/Bloqueo)', 915001, 1, 'paquete', true, 'persona', 90000, 'tour', 'tour', 'Tour sintético que solo es opcional de Porción y Bloqueo.', 'COP', '/marca/logo-full.png'),
       (915003, 'LOTE City tour', 915001, 1, 'paquete', true, 'persona', 60000, 'tour', 'tour', 'Tour sintético por persona.', 'COP', '/globe.svg'),
       (915004, 'LOTE Traslado grupal (10 a 20 pax)', 915001, 1, 'paquete', true, 'grupo', null, 'traslado', 'tour', 'Solo tiene precio de 10 a 20 pasajeros.', 'COP', null);
insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, prioridad, precio_persona)
select 915000 + s, s, 'LOTE 2026-2027', '2026-11-01', '2027-03-31', 1, p
from (values (915001, 80000), (915002, 90000), (915003, 60000), (915004, null)) v(s, p);
insert into public.servicio_tarifa_pax (servicio_id, pax_desde, pax_hasta, precio, temporada)
values (915004, 10, 20, 900000, 'GENERAL'), (915004, 10, 20, 900000, 'LOTE 2026-2027');

-- Record para el paquete Bloqueo (12-15 dic 2026)
insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, destino_id, moneda, fecha_devolucion, fecha_emision)
values (915001, 'LOTEBQ', 'LOTE AIR', 'MDE - CTG - MDE', 'LT10', '2026-12-12', '08:00', '09:10', 'LT11', '2026-12-15', '17:00', '18:10', 20, 300000, 1, 'COP', '2026-12-02', '2026-12-09');
-- Records de cupos (#59): sale hoy, el día 14 y el día 15 (Bogotá)
insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, vuelo_ida, fecha_ida, vuelo_regreso, fecha_regreso, cupos_total, tarifa_para_empaquetar, destino_id, moneda)
select 915000 + n, 'LOTE' || lpad(dias::text, 2, '0'), 'LOTE AIR', 'MDE - CTG - MDE', 'LT2' || n, (select d from hoy_lote) + dias, 'LT3' || n, (select d from hoy_lote) + dias + 3, cupos, 250000, 1, 'COP'
from (values (2, 0, 4), (3, 14, 3), (4, 15, 5)) v(n, dias, cupos);
insert into public.sillas (bloqueo_id, numero_silla, estado)
select b.id, g, 'disponible' from public.bloqueos_vuelo b cross join generate_series(1, b.cupos_total) g where b.id between 915001 and 915004;

-- Paquetes: Porción (con opcionales), Bloqueo (con Tour 2 opcional) y Servicios (Tour 1). Descripción para #34.
insert into public.armado_paquetes (id, nombre, activo, tipo, noches, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, moneda, moneda_publicacion,
  programa_incluye, programa_no_incluye, programa_condiciones_comerciales)
values
 (915001, 'LOTE Porción terrestre Cartagena', true, 'porcion_terrestre', 3, 1, '2026-12-01', '2027-03-28', 0.2, 'COP', 'COP',
  E'Alojamiento 3 noches\nDesayunos y cenas (PAM)\nTraslado aeropuerto - hotel - aeropuerto', E'Tiquetes aéreos\nPropinas', 'Tarifa sintética de revisión'),
 (915002, 'LOTE Bloqueo Cartagena', true, 'bloqueo', 3, 1, '2026-12-01', '2027-03-28', 0.2, 'COP', 'COP',
  E'Tiquete aéreo MDE - CTG - MDE\nAlojamiento 3 noches PAM', E'Seguro de viaje\nGastos personales', null),
 (915003, 'LOTE Receptivos Cartagena', true, 'servicios', 3, 1, '2026-12-01', '2027-03-28', 0.2, 'COP', 'COP', null, null, null);
-- prioridad 1 = «Recomendado»: sin destino ni búsqueda la portada del tarifario solo muestra recomendados.
insert into public.armado_hoteles (paquete_id, hotel_id, prioridad) values (915001, 915001, 1), (915002, 915001, 1);
insert into public.armado_vuelos (paquete_id, bloqueo_id) values (915002, 915001);
insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values
  (915001, 915002, 'persona', false), (915001, 915003, 'persona', false), (915001, 915004, 'grupo', false),
  (915002, 915002, 'persona', false),
  (915003, 915001, 'persona', false);

-- Programa (#34: conserva «El programa incluye»). Se crea sin publicar, con días e inclusiones, y luego se publica.
insert into public.programas (id, nombre, subtitulo, dias, noches, moneda, activo, publicado, tipo_transporte, pct_mk, desde_precio, texto_condiciones)
values (915001, 'LOTE Programa Europa', 'Circuito sintético', 8, 7, 'USD', true, false, 'ninguno', 0.2, 1500, 'Condiciones sintéticas.');
insert into public.programa_dias (programa_id, dia, titulo, descripcion) select 915001, d, 'Día ' || d, 'Actividad sintética del día ' || d from generate_series(1, 8) d;
insert into public.programa_inclusiones (programa_id, tipo, texto, orden) values
  (915001, 'incluye', '7 noches de alojamiento', 1), (915001, 'incluye', 'Desayunos diarios', 2), (915001, 'no_incluye', 'Tiquetes aéreos', 1);
update public.programas set publicado = true where id = 915001;
commit;
