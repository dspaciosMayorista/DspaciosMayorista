-- REVISIÓN CONSOLIDADA — semilla derivada de semilla_visual_historial_h81.sql.
-- Records AAA111/BBB222/CCC333 con historial de movimientos de sillas.
-- Semilla SINTÉTICA (solo bases desechables) para H8-1: inspección de la página compilada del record de vuelo con el historial de movimientos.
-- Tres records (AAA111, BBB222, CCC333), usuarios de control de vuelo / superadmin / venta, y movimientos que cubren: retiro cuyo motivo menciona otro record,
-- traslado agrupado de 3 sillas (visto desde los dos records), historial anterior incompleto, texto largo y fechas en el límite del día de Bogotá (UTC−5).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000008810a1', 'h8-control@x.test'), ('00000000-0000-4000-8000-0000008810a2', 'h8-super@x.test'), ('00000000-0000-4000-8000-0000008810a3', 'h8-venta@x.test')
  on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-4000-8000-0000008810a1', 'h8-control@x.test', 'H8 Control de vuelo', 'control_vuelo', true, 'mayorista'),
  ('00000000-0000-4000-8000-0000008810a2', 'h8-super@x.test', 'H8 Superadmin', 'superadmin', true, 'mayorista'),
  ('00000000-0000-4000-8000-0000008810a3', 'h8-venta@x.test', 'H8 Asesor de ventas', 'venta', true, 'mayorista')
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = true, tenant = excluded.tenant;

insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (9501, 'H8 CARTAGENA', 'CTG', 'Colombia', true);
insert into public.proveedores (id, nombre, tipo) values (9501, 'H8 AEROLINEA', 'aereo') on conflict do nothing;
insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, fecha_ida, fecha_regreso, cupos_total, tarifa_para_empaquetar, tarifa_neta, destino_id, proveedor_id, moneda, vuelo_ida, vuelo_regreso) values
  (9501, 'AAA111', 'Avianca', 'BOG - CTG - BOG', current_date + 60, current_date + 64, 9, 250000, 200000, 9501, 9501, 'COP', 'AV100', 'AV101'),
  (9502, 'BBB222', 'Avianca', 'BOG - CTG - BOG', current_date + 61, current_date + 65, 9, 250000, 200000, 9501, 9501, 'COP', 'AV200', 'AV201'),
  (9503, 'CCC333', 'Avianca', 'BOG - CTG - BOG', current_date + 62, current_date + 66, 5, 250000, 200000, 9501, 9501, 'COP', 'AV300', 'AV301');
insert into public.sillas (bloqueo_id, numero_silla, estado) select 9501, g, 'disponible' from generate_series(1, 13) g;
insert into public.sillas (bloqueo_id, numero_silla, estado) select 9502, g, 'disponible' from generate_series(1, 9) g;
insert into public.sillas (bloqueo_id, numero_silla, estado) select 9503, g, 'disponible' from generate_series(1, 5) g;
update public.sillas set estado = 'retirada' where bloqueo_id = 9501 and numero_silla = 4;
update public.sillas set estado = 'cambio' where bloqueo_id = 9501 and numero_silla in (10, 11, 12);

-- Operaciones (idempotencia): una fila por operación, como las deja la base antes de escribir los movimientos.
insert into public.operaciones_vuelo (operacion_id, tipo, huella, actor_id, created_at) values
  ('00000000-0000-4000-8000-000000881001', 'traslado_cupo', 'h81-1', '00000000-0000-4000-8000-0000008810a1', '2026-10-05T15:00:00Z'),
  ('00000000-0000-4000-8000-000000881002', 'retiro_cupo', 'h81-2', '00000000-0000-4000-8000-0000008810a1', '2026-11-24T04:30:00Z'),
  ('00000000-0000-4000-8000-000000881003', 'mover_pasajero', 'h81-3', '00000000-0000-4000-8000-0000008810a1', '2026-11-02T20:15:00Z'),
  ('00000000-0000-4000-8000-000000881004', 'retiro_cupo', 'h81-4', '00000000-0000-4000-8000-0000008810a1', '2026-11-23T04:59:00Z'),
  ('00000000-0000-4000-8000-000000881005', 'retiro_cupo', 'h81-5', '00000000-0000-4000-8000-0000008810a1', '2026-11-23T05:00:00Z'),
  ('00000000-0000-4000-8000-000000881006', 'retiro_cupo', 'h81-6', '00000000-0000-4000-8000-0000008810a1', '2026-01-01T04:59:00Z');
-- Movimientos (insertados como los dejarían las funciones de la base; fechas en UTC, la página debe mostrarlas en hora de Bogotá).
create function pg_temp.silla(p_bloqueo bigint, p_num int) returns bigint language sql as $$ select id from public.sillas where bloqueo_id = p_bloqueo and numero_silla = p_num $$;
-- 1) Traslado agrupado AAA111 → BBB222 de 3 sillas libres (una operación, tres filas): 05/10/2026 10:00 en Bogotá.
insert into public.movimientos_silla (silla_id, bloqueo_origen_id, bloqueo_destino_id, motivo, registrado_por, tipo, operacion_id, numero_silla_origen, numero_silla_destino, estado_silla, cupos_origen_antes, cupos_origen_despues, cupos_destino_antes, cupos_destino_despues, fecha_movimiento) values
  (pg_temp.silla(9501, 10), 9501, 9502, 'Cupos libres para el grupo de octubre', 'Javier', 'traslado_cupo', '00000000-0000-4000-8000-000000881001', 10, 7, 'disponible', 12, 9, 6, 9, '2026-10-05T15:00:00Z'),
  (pg_temp.silla(9501, 11), 9501, 9502, 'Cupos libres para el grupo de octubre', 'Javier', 'traslado_cupo', '00000000-0000-4000-8000-000000881001', 11, 8, 'disponible', 12, 9, 6, 9, '2026-10-05T15:00:00Z'),
  (pg_temp.silla(9501, 12), 9501, 9502, 'Cupos libres para el grupo de octubre', 'Javier', 'traslado_cupo', '00000000-0000-4000-8000-000000881001', 12, 9, 'disponible', 12, 9, 6, 9, '2026-10-05T15:00:00Z');
-- 2) Retiro de cupo cuyo MOTIVO menciona otro record (y es largo, con una cadena sin espacios); actor con nombre largo; 24/11/2026 04:30 UTC = 23/11/2026 23:30 en Bogotá.
insert into public.movimientos_silla (silla_id, bloqueo_origen_id, bloqueo_destino_id, motivo, registrado_por, tipo, operacion_id, numero_silla_origen, estado_silla, cupos_origen_antes, cupos_origen_despues, fecha_movimiento) values
  (pg_temp.silla(9501, 4), 9501, null,
   'Se pasa al record BBB222 por pedido del cliente (esto es solo texto libre: la operación guardada es un retiro). Referencia interna REFERENCIA-' || repeat('X', 140) || ' y observaciones adicionales del operador para probar el ajuste de línea en pantallas angostas sin romper el diseño ni salirse de la tarjeta.',
   'Javier Alberto de Jesús Hernández-Quintero (control de vuelo, turno de la madrugada del lunes festivo)', 'retiro_cupo', '00000000-0000-4000-8000-000000881002', 4, 'retirada', 10, 9, '2026-11-24T04:30:00Z');
-- 3) Pasajero movido con su cupo BBB222 → AAA111 (con contrato manual guardado): 02/11/2026 15:15 en Bogotá.
insert into public.movimientos_silla (silla_id, bloqueo_origen_id, bloqueo_destino_id, motivo, registrado_por, tipo, operacion_id, numero_silla_origen, numero_silla_destino, estado_silla, contrato_manual, cupos_origen_antes, cupos_origen_despues, cupos_destino_antes, cupos_destino_despues, fecha_movimiento) values
  (pg_temp.silla(9502, 3), 9502, 9501, null, 'Javier', 'mover_con_cupo', '00000000-0000-4000-8000-000000881003', 3, 13, 'confirmada', 'CM-0451', 9, 8, 9, 10, '2026-11-02T20:15:00Z');
-- 4) Historial ANTERIOR incompleto: sin actor, sin destino, sin cupos, motivo que menciona otro record; y otro anterior con origen y destino pero sin actor ni cupos.
insert into public.movimientos_silla (silla_id, bloqueo_origen_id, bloqueo_destino_id, motivo, registrado_por, tipo, numero_silla_origen, fecha_movimiento) values
  (pg_temp.silla(9501, 2), 9501, null, 'pasó al record CCC333', null, 'legado', 2, '2026-01-02T12:00:00Z'),
  (pg_temp.silla(9503, 1), 9503, 9501, null, null, 'legado', 1, '2026-01-03T12:00:00Z');
-- 5) Límites del día de Bogotá (UTC−5): 04:59Z → 23:59 del día anterior; 05:00Z → 00:00 del mismo día; 04:59Z de año nuevo → 31/12 23:59.
insert into public.movimientos_silla (silla_id, bloqueo_origen_id, bloqueo_destino_id, motivo, registrado_por, tipo, operacion_id, numero_silla_origen, estado_silla, cupos_origen_antes, cupos_origen_despues, fecha_movimiento) values
  (pg_temp.silla(9501, 5), 9501, null, 'límite de día A', 'Javier', 'retiro_cupo', '00000000-0000-4000-8000-000000881004', 5, 'retirada', 13, 12, '2026-11-23T04:59:00Z'),
  (pg_temp.silla(9501, 6), 9501, null, 'límite de día B', 'Javier', 'retiro_cupo', '00000000-0000-4000-8000-000000881005', 6, 'retirada', 12, 11, '2026-11-23T05:00:00Z'),
  (pg_temp.silla(9501, 7), 9501, null, 'límite de año', 'Javier', 'retiro_cupo', '00000000-0000-4000-8000-000000881006', 7, 'retirada', 11, 10, '2026-01-01T04:59:00Z');
update public.sillas set estado = 'retirada' where bloqueo_id = 9501 and numero_silla in (5, 6, 7);
