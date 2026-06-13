-- ============================================================================
-- CARGA DE INVENTARIO DE VUELOS — INVENTARIO SMR + INVENTARIO CTG (Google Sheets)
-- Generado el 2026-06-13 · SOLO bloques VIGENTES (fecha de ida >= 2026-06-13).
-- Fuente: hojas del dueño. Revisar antes de correr en Supabase.
--
-- SUPUESTOS / NOTAS (verificar):
--  * record es UNIQUE. Los bloques de sep-nov traían el MISMO record en SMR y CTG
--    (placeholders sin PNR real); a los duplicados se les añadió sufijo -SMR/-CTG.
--    Cuando tengas el PNR real, renómbralos.
--  * numero_contrato de sillas vendidas se deja NULL (esos contratos viejos -ej 00-0442-
--    no existen aun en la BD nueva y romperian la FK). El # de contrato original queda
--    como comentario al lado de cada silla para reconciliar luego.
--  * En CTG los nombres venian en orden Apellidos/Nombres: se intercambian.
--  * tarifa_para_empaquetar se deja en 0 (ajustar con la tarifa real del bloque).
--  * Para CARGA INICIAL (vuelos sin estos records). Reejecutar duplicaria las sillas;
--    si necesitas recargar, borra antes esos bloqueos.
-- ============================================================================
begin;

-- ===================== SMR (12 bloques vigentes) =====================
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('QFF79E', 'JETSMART', 'MDE - SMR - MDE', '5440', '2026-06-26', '08:47', '10:07', '5445', '2026-06-29', '19:25', '20:42', 10, 0, '2026-06-19')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('O59L8F', 'JETSMART', 'MDE - SMR - MDE', '5440', '2026-06-19', '08:47', '10:07', '5445', '2026-06-22', '19:25', '20:42', 10, 0, '2026-06-12')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  -- contrato orig: 00-0442
  ((select id from b), 1, 'confirmada', 'HEIDY VANNESA', 'VALENCIA PUERTA', 'CC', '1.214.719.625', '1993-07-03', 'ANGELA DUQUE', 'NUEVO RECORD                        PCGY8N', 'IROTAMA', null),
  -- contrato orig: 00-0442
  ((select id from b), 2, 'confirmada', 'SOR MARITZA', 'PUERTA MARULANDA', 'CC', '43.593.859', '1975-01-28', 'ANGELA DUQUE', null, 'IROTAMA', null),
  -- contrato orig: 00-0442
  ((select id from b), 3, 'confirmada', 'LUZ MARINA', 'MARULANDA', 'CC', '32.461.448', '1949-05-10', 'ANGELA DUQUE', null, 'IROTAMA', null),
  -- contrato orig: 00-0442
  ((select id from b), 4, 'confirmada', 'LAURA VALENTINA', 'RAMIREZ PUERTA', 'CC', '1.000.414.028', '2003-10-16', 'ANGELA DUQUE', null, 'IROTAMA', null),
  -- contrato orig: 00-0480
  ((select id from b), 5, 'confirmada', 'MARIO ALEJANDRO', 'DUQUE FRANCO', 'CC', '15.429.812', '1965-09-09', 'VIAJES FANTASIA TROPICAL', null, 'TAYRONA DEL MAR', null),
  -- contrato orig: 00-0481
  ((select id from b), 6, 'confirmada', 'JUAN DIEGO', 'DUQUE FRANCO', 'CC', '71.691.432', '1967-07-09', 'VIAJES FANTASIA TROPICAL', null, 'TAYRONA DEL MAR', null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'cambio', 'CAMBIADAS 26 AL 29 JUNIO', 'PG5RNE', null, null, null, null, null, null, null),
  ((select id from b), 10, 'cambio', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('MCHVUA', 'JETSMART', 'MDE - SMR - MDE', '5440', '2026-07-17', '08:47', '10:07', '5445', '2026-07-20', '19:25', '20:42', 10, 0, '2026-07-10')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('M4TEPI', 'JETSMART', 'MDE - SMR - MDE', '5440', '2026-08-21', '08:47', '10:07', '5445', '2026-08-24', '19:25', '20:42', 10, 0, '2026-08-14')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  -- contrato orig: 00-0474
  ((select id from b), 1, 'confirmada', 'MARIO DE JESUS', 'RAMIREZ HERNANDEZ', 'CC', '71.682.280', '1967-01-31', 'MARIA C', null, 'PORTO HORIZONTE', '1X2 DOBLE'),
  -- contrato orig: 00-0474
  ((select id from b), 2, 'confirmada', 'CAROLINA MARIA', 'ACOSTA ORTIZ', 'CC', '42.785.517', '1970-10-10', 'MARIA C', null, 'PORTO HORIZONTE', '1X2 DOBLE'),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('OEFQNX', 'JETSMART', 'MDE - SMR - MDE', '5440', '2026-09-04', '08:47', '10:07', '5445', '2026-09-07', '19:25', '20:42', 10, 0, '2026-08-28')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('KBBH2A', 'JETSMART', 'MDE - SMR - MDE', '5440', '2026-09-11', '08:47', '10:07', '5445', '2026-09-14', '19:25', '20:42', 10, 0, '2026-09-04')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('PG2LNE', 'JETSMART', 'MDE - SMR - MDE', '5440', '2026-09-18', '08:47', '10:07', '5445', '2026-09-21', '19:25', '20:42', 10, 0, '2026-09-11')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('V985YM', 'JETSMART', 'MDE - SMR - MDE', '5440', '2026-09-25', '08:47', '10:07', '5445', '2026-09-28', '19:25', '20:42', 10, 0, '2026-09-18')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', 'PENDIENTE POR CARGAR DATOS', null, null, null, null, null, 'CONTRATO 00-0479', null, null),
  ((select id from b), 2, 'disponible', 'PENDIENTE POR CARGAR DATOS', null, null, null, null, null, 'CONTRATO 00-0479', null, null),
  ((select id from b), 3, 'disponible', 'PENDIENTE POR CARGAR DATOS', null, null, null, null, null, 'CONTRATO 00-0479', null, null),
  ((select id from b), 4, 'disponible', 'PENDIENTE POR CARGAR DATOS', null, null, null, null, null, 'CONTRATO 00-0479', null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('B9S2WG', 'JETSMART', 'MDE - SMR - MDE', '5440', '2026-10-16', '08:47', '10:07', '5445', '2026-10-19', '19:25', '20:42', 10, 0, '2026-10-09')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('UF8G9U', 'JETSMART', 'MDE - SMR - MDE', '5440', '2026-11-06', '07:50', '09:07', '5435', '2026-11-09', '20:09', '21:26', 10, 0, '2026-10-30')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('QC2DKQ', 'JETSMART', 'MDE - SMR - MDE', '5440', '2026-11-20', '07:50', '09:07', '5435', '2026-11-23', '20:09', '21:26', 10, 0, '2026-11-13')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('Q38P4L', 'JETSMART', 'MDE - SMR - MDE', '5440', '2026-11-27', '07:50', '09:07', '5435', '2026-11-30', '20:09', '21:26', 10, 0, '2026-11-20')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);

-- ===================== CTG (13 bloques vigentes) =====================
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('D3KMMY', 'JETSMART', 'MDE - CTG - MDE', '5410', '2026-08-21', '08:47', '09:59', '5414', '2026-08-24', '17:21', '18:40', 10, 0, '2026-08-14')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('E7IB3Z', 'JETSMART', 'MDE - CTG - MDE', '5410', '2026-08-28', '08:47', '09:59', '5414', '2026-08-31', '17:21', '18:40', 10, 0, '2026-08-21')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('R5GJMV', 'JETSMART', 'MDE - CTG - MDE', '5428', '2026-08-06', '09:30', '10:42', '5423', '2026-08-09', '13:35', '14:54', 10, 0, '2026-07-30')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'confirmada', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'confirmada', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'confirmada', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'confirmada', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'confirmada', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'confirmada', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'confirmada', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'confirmada', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'confirmada', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'confirmada', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('L93FYZ', 'JETSMART', 'MDE - CTG - MDE', '5410', '2026-06-19', '08:47', '09:59', '5414', '2026-06-22', '17:21', '18:40', 10, 0, '2026-06-12')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'confirmada', 'CARLOS MARIO', 'RESTREPO RESTREPO', 'CC', '70.509.599', '1959-12-07', 'SANTIAGO BEDOYA', 'SC VIAJEROS', 'DUBAI', '1x2 DBLXVM'),
  ((select id from b), 2, 'confirmada', 'MARIA NORELA', 'VELEZ COLORADO', 'CC', '42.761.293', '1963-08-10', null, null, null, null),
  ((select id from b), 3, 'confirmada', 'PAULINA', 'RESTREPO VELEZ', 'CC', '1.128.266.082', '1986-09-18', null, null, null, '1x2 DBLXVM'),
  ((select id from b), 4, 'confirmada', 'NICOLAS', 'SANTANA RESTREPO', 'TI', '1.022.004.822', '2009-04-17', null, null, null, null),
  ((select id from b), 5, 'confirmada', 'DANIELA', 'RESTREPO VELEZ', 'CC', '1.017.212.404', '1993-09-09', null, null, null, null),
  ((select id from b), 6, 'confirmada', 'CRISTIAN DAVID', 'PATINO GRANADOS', 'CC', '1.017.200.003', '1992-02-09', null, null, null, null),
  ((select id from b), 7, 'confirmada', 'CELESTE', 'PATINO RESTREPO', 'TI', '1.023.548.363', '2018-10-22', null, null, null, null),
  ((select id from b), 8, 'devuelta', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'devuelta', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'devuelta', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('FEYPMH', 'JETSMART', 'MDE - CTG - MDE', '5410', '2026-06-26', '08:47', '09:59', '5414', '2026-06-29', '17:21', '18:40', 10, 0, '2026-06-19')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  -- contrato orig: 00-0457
  ((select id from b), 1, 'confirmada', 'TAPASCO BUENO', 'OLGA MARINA', 'CC', '43.537.061', '1968-03-01', 'PAOLA ALVAREZ', null, 'CARTAGENA PLAZA', '1x3 ESTANDAR'),
  -- contrato orig: 00-0457
  ((select id from b), 2, 'confirmada', 'DAVILA TAPASCO', 'VANESA', 'CC', '1.059.694.957', '2004-06-28', 'PAOLA ALVAREZ', null, 'CARTAGENA PLAZA', '1x3 ESTANDAR'),
  -- contrato orig: 00-0457
  ((select id from b), 3, 'confirmada', 'DAVILA TAPASCO', 'ISABELLA', 'CC', '1.059.700.118', '2007-06-18', 'PAOLA ALVAREZ', null, 'CARTAGENA PLAZA', '1x3 ESTANDAR'),
  ((select id from b), 4, 'confirmada', null, 'SILLAS GRUPO 465', null, null, null, null, null, null, null),
  ((select id from b), 5, 'confirmada', null, 'SILLAS GRUPO 465', null, null, null, null, null, null, null),
  ((select id from b), 6, 'confirmada', null, 'SILLAS GRUPO 465', null, null, null, null, null, null, null),
  ((select id from b), 7, 'confirmada', null, 'SILLAS GRUPO 465', null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('OEFQNX-CTG', 'JETSMART', 'MDE - CTG - MDE', '5410', '2026-09-04', '08:47', '09:59', '5414', '2026-09-07', '17:21', '18:40', 10, 0, '2026-08-28')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('KBBH2A-CTG', 'JETSMART', 'MDE - CTG - MDE', '5410', '2026-09-11', '08:47', '09:59', '5414', '2026-09-14', '17:21', '18:40', 10, 0, '2026-09-04')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('PG2LNE-CTG', 'JETSMART', 'MDE - CTG - MDE', '5410', '2026-09-18', '08:47', '09:59', '5414', '2026-09-21', '17:21', '18:40', 10, 0, '2026-09-11')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('V985YM-CTG', 'JETSMART', 'MDE - CTG - MDE', '5410', '2026-09-25', '08:47', '09:59', '5414', '2026-09-28', '17:21', '18:40', 10, 0, '2026-09-18')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('B9S2WG-CTG', 'JETSMART', 'MDE - CTG - MDE', '5410', '2026-10-16', '08:47', '09:59', '5414', '2026-10-19', '17:21', '18:40', 10, 0, '2026-10-09')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, '1.235.044.301', null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('UF8G9U-CTG', 'JETSMART', 'MDE - CTG - MDE', '5410', '2026-11-06', '08:51', '10:02', '5414', '2026-11-09', '17:26', '18:41', 10, 0, '2026-10-30')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('QC2DKQ-CTG', 'JETSMART', 'MDE - CTG - MDE', '5410', '2026-11-20', '08:51', '10:02', '5414', '2026-11-23', '17:26', '18:41', 10, 0, '2026-11-13')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);
with b as (
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total, tarifa_para_empaquetar, fecha_emision)
  values ('Q38P4L-CTG', 'JETSMART', 'MDE - CTG - MDE', '5410', '2026-11-27', '08:51', '10:02', '5414', '2026-11-30', '17:26', '18:41', 10, 0, '2026-11-20')
  on conflict (record) do update set aerolinea=excluded.aerolinea, ruta=excluded.ruta, vuelo_ida=excluded.vuelo_ida, fecha_ida=excluded.fecha_ida, hora_salida_ida=excluded.hora_salida_ida, hora_llegada_ida=excluded.hora_llegada_ida, vuelo_regreso=excluded.vuelo_regreso, fecha_regreso=excluded.fecha_regreso, hora_salida_reg=excluded.hora_salida_reg, hora_llegada_reg=excluded.hora_llegada_reg, cupos_total=excluded.cupos_total, fecha_emision=excluded.fecha_emision
  returning id
)
insert into public.sillas (bloqueo_id, numero_silla, estado, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel, acomodacion)
values
  ((select id from b), 1, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 2, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 3, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 4, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 5, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 6, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 7, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 8, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 9, 'disponible', null, null, null, null, null, null, null, null, null),
  ((select id from b), 10, 'disponible', null, null, null, null, null, null, null, null, null);

commit;

-- Resumen: 25 bloqueos, 250 sillas, 27 con pasajero.