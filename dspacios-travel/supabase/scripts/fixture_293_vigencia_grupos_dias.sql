-- Fixture de la prueba de la 293 (se carga ANTES de la migración, en una base local desechable).
-- Ids 93xx para no chocar con datos de la plantilla.
insert into public.destinos (id, nombre) values (9301, 'T293 DESTINO');
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario) values
  (9301, 9301, 'T293 PERSONA', 'persona'),
  (9302, 9301, 'T293 UNIDAD', 'unidad'),
  (9303, 9301, 'T293 PERSONA 2', 'persona');
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
  (930101, 9301, 'ALTA',  '2027-01-01', '2027-01-31', 1, 'tarifa'),
  (930102, 9301, 'BAJA',  '2027-02-01', '2027-02-28', 1, 'tarifa'),
  (930103, 9301, 'DUP',   '2027-03-01', '2027-03-15', 1, 'tarifa'),
  (930104, 9301, 'DUP',   '2027-03-16', '2027-03-31', 1, 'tarifa'),
  (930105, 9301, 'NUEVA', '2027-04-01', '2027-04-30', 2, 'tarifa'),
  (930201, 9302, 'U1',    '2027-01-01', '2027-01-31', 1, 'tarifa'),
  (930301, 9303, 'ALTA',  '2027-01-01', '2027-01-31', 1, 'tarifa');
-- Tarifas «todos los días», incluido un DUPLICADO histórico exacto (no se corrige).
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble) values
  (9301, 'Estándar', 'PAM', 'ALTA', 150000, 100000),
  (9301, 'Estándar', 'PAM', 'ALTA', 150000, 100000),
  (9301, 'Estándar', 'PAM', 'BAJA', 120000,  80000),
  (9301, 'Superior', 'PC',  'DUP',  200000, 160000),
  (9303, 'Estándar', 'PAM', 'ALTA', 130000,  90000);

-- Usuarios para RLS: auth.users + auth.sessions + usuarios (+ sesión de agencia del superadmin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000009301', 't293-super@x.test'),
  ('00000000-0000-4000-8000-000000009302', 't293-oper-may@x.test'),
  ('00000000-0000-4000-8000-000000009303', 't293-oper-min@x.test'),
  ('00000000-0000-4000-8000-000000009304', 't293-venta@x.test');
insert into auth.sessions (id, user_id) values
  ('00000000-0000-4000-8000-00000000a301', '00000000-0000-4000-8000-000000009301'),
  ('00000000-0000-4000-8000-00000000a302', '00000000-0000-4000-8000-000000009302'),
  ('00000000-0000-4000-8000-00000000a303', '00000000-0000-4000-8000-000000009303'),
  ('00000000-0000-4000-8000-00000000a304', '00000000-0000-4000-8000-000000009304');
insert into public.usuarios (id, email, nombre, rol, tenant, activo) values
  ('00000000-0000-4000-8000-000000009301', 't293-super@x.test',    'T293 Super',    'superadmin',  'mayorista', true),
  ('00000000-0000-4000-8000-000000009302', 't293-oper-may@x.test', 'T293 Oper May', 'operaciones', 'mayorista', true),
  ('00000000-0000-4000-8000-000000009303', 't293-oper-min@x.test', 'T293 Oper Min', 'operaciones', 'minorista', true),
  ('00000000-0000-4000-8000-000000009304', 't293-venta@x.test',    'T293 Venta',    'venta',       'mayorista', true)
on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, tenant = excluded.tenant, activo = excluded.activo;
insert into public.sesion_agencia (session_id, user_id, tenant) values
  ('00000000-0000-4000-8000-00000000a301', '00000000-0000-4000-8000-000000009301', 'mayorista');
