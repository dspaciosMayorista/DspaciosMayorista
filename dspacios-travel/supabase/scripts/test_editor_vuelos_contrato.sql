-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA AUTO-VERIFICABLE — editor operativo de vuelos del contrato
-- (migración 157: contrato_vuelo_control, contrato_vuelo_control_cambios,
-- acceso_editar_vuelos_contrato, guardar_tramos_contrato,
-- actualizar_estado_emision_contrato, contrato_vuelos_editor,
-- ventas_vuelo_sistema ampliada)
--
-- Corre contra una base local construida replayando supabase/migrations/.
-- DE SOLO LECTURA: termina en ROLLBACK, no deja fixtures.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/scripts/test_editor_vuelos_contrato.sql <conn>
--
-- Cada caso es una ASERCIÓN real (pg_temp.assert_eq, mismo helper que
-- test_empaquetados.sql/test_control_bloqueo_atomico.sql).
--
-- Cobertura (numeración según el pedido del dueño, sección 9):
--   A. Contrato sin PNR (record NULL) → "Sin PNR" derivable en la app.
--   B. Contrato con PNR real.
--   C. Aerolínea SOLO en contrato_vuelos (ventas.aerolinea distinto/NULL) —
--      la vista debe traer la de contrato_vuelos, nunca la de ventas.
--   D. Respaldo histórico: SIN contrato_vuelos → aerolinea = ventas.aerolinea.
--   E. Solo ida (one-way).
--   F. Ida y regreso.
--   G. Múltiples tramos (multi-ciudad, 3+).
--   H. Dos contratos con fechas/rutas IGUALES que nunca se mezclan.
--   I. Estado de pago: sin CxP aérea (null), todas pagadas (pagado), una
--      pendiente (pendiente), pago parcial (pendiente).
--   J. Estado de emisión: Por confirmar (null), Pendiente, Emitido — con
--      historial (actor + fecha).
--   K. control_vuelo puede editar el vuelo pero NUNCA alcanza
--      cliente/pasajeros/precios/costos/cuentas bancarias (ni por
--      contrato_vuelos_editor ni por ventas_vuelo_sistema).
--   L. Atomicidad: fallo forzado a mitad de guardar_tramos_contrato() NO
--      deja el contrato con menos vuelos que antes (rollback completo).
--   M. guardar_tramos_contrato(): conserva ids en UPDATE, borra los que ya
--      no vienen, inserta los nuevos.
--   N. Seguridad por rol/tenant: superadmin (ambos tenants), gerencia/
--      administracion/operaciones/control_vuelo (solo su tenant), venta
--      (bloqueado), inactivo (bloqueado), perfil ausente (bloqueado), anon
--      (permission denied), cambiar numero_contrato para cruzar de agencia
--      (bloqueado).
--   O. authenticated con EXECUTE pero SIN el rol permitido (venta) no puede
--      modificar — el chequeo lo hace la función, no una policy de tabla.
--   P. Privilegios de EXECUTE: anon=false/authenticated=true/PUBLIC=false
--      para las 3 funciones nuevas, simulando el escenario real de Supabase
--      (GRANT explícito previo a anon, no solo ausencia de default
--      privileges locales) — mismo patrón que la sección L de
--      test_empaquetados.sql.
--   Q. Errores de lectura/escritura visibles (payload inválido → excepción
--      clara, nunca un resultado vacío silencioso).
-- ─────────────────────────────────────────────────────────────────────────

begin;

create function pg_temp.assert_eq(actual anyelement, expected anyelement, etiqueta text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'ASSERT FALLÓ (%): esperado=%, obtuvo=%', etiqueta, expected, actual;
  end if;
end;
$$;

-- ── Fixtures de usuarios ────────────────────────────────────────────────
insert into auth.users (id, email) values ('a0000001-0000-0000-0000-000000000001', 'sa-evc@test.com');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('a0000001-0000-0000-0000-000000000001', 'sa-evc@test.com', 'Superadmin EVC', 'superadmin', true, 'mayorista')
  on conflict (id) do update set nombre=excluded.nombre, rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant;

insert into auth.users (id, email) values ('a0000002-0000-0000-0000-000000000002', 'cv-may-evc@test.com');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('a0000002-0000-0000-0000-000000000002', 'cv-may-evc@test.com', 'Control Vuelo Mayorista EVC', 'control_vuelo', true, 'mayorista')
  on conflict (id) do update set nombre=excluded.nombre, rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant;

insert into auth.users (id, email) values ('a0000003-0000-0000-0000-000000000003', 'cv-min-evc@test.com');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('a0000003-0000-0000-0000-000000000003', 'cv-min-evc@test.com', 'Control Vuelo Minorista EVC', 'control_vuelo', true, 'minorista')
  on conflict (id) do update set nombre=excluded.nombre, rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant;

insert into auth.users (id, email) values ('a0000004-0000-0000-0000-000000000004', 'ger-may-evc@test.com');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('a0000004-0000-0000-0000-000000000004', 'ger-may-evc@test.com', 'Gerencia Mayorista EVC', 'gerencia', true, 'mayorista')
  on conflict (id) do update set nombre=excluded.nombre, rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant;

insert into auth.users (id, email) values ('a0000005-0000-0000-0000-000000000005', 'adm-may-evc@test.com');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('a0000005-0000-0000-0000-000000000005', 'adm-may-evc@test.com', 'Administracion Mayorista EVC', 'administracion', true, 'mayorista')
  on conflict (id) do update set nombre=excluded.nombre, rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant;

insert into auth.users (id, email) values ('a0000006-0000-0000-0000-000000000006', 'op-may-evc@test.com');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('a0000006-0000-0000-0000-000000000006', 'op-may-evc@test.com', 'Operaciones Mayorista EVC', 'operaciones', true, 'mayorista')
  on conflict (id) do update set nombre=excluded.nombre, rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant;

insert into auth.users (id, email) values ('a0000007-0000-0000-0000-000000000007', 'venta-evc@test.com');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('a0000007-0000-0000-0000-000000000007', 'venta-evc@test.com', 'Venta EVC', 'venta', true, 'mayorista')
  on conflict (id) do update set nombre=excluded.nombre, rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant;

-- Usuario INACTIVO (rol control_vuelo guardado, activo=false).
insert into auth.users (id, email) values ('a0000008-0000-0000-0000-000000000008', 'inactivo-evc@test.com');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('a0000008-0000-0000-0000-000000000008', 'inactivo-evc@test.com', 'Inactivo EVC', 'control_vuelo', false, 'mayorista')
  on conflict (id) do update set nombre=excluded.nombre, rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant;

-- Perfil AUSENTE: 'a0000009-0000-0000-0000-000000000009', nunca insertado.

-- Helper: impersona un usuario y corre un thunk como bloque DO no es directo
-- en psql plano — se hace inline en cada caso con set local role + set_config.

-- ═════════════════════════════════════════════════════════════════════════
-- Fixtures de contratos
-- ═════════════════════════════════════════════════════════════════════════
insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete, aerolinea) values
  ('77-0001', 'Cliente sin PNR', 'mayorista', 'dinamico', 'Avianca (ventas, viejo)'),   -- A: sin contrato_vuelos todavía
  ('77-0002', 'Cliente con PNR', 'mayorista', 'dinamico', null),                        -- B/C: con contrato_vuelos, aerolinea SOLO ahí
  ('77-0003', 'Cliente respaldo historico', 'mayorista', 'dinamico', 'Wingo'),          -- D: SIN contrato_vuelos — respaldo
  ('77-0004', 'Cliente one-way', 'mayorista', 'dinamico', null),                        -- E: solo ida
  ('77-0005', 'Cliente redondo', 'mayorista', 'dinamico', null),                        -- F: ida y regreso
  ('77-0006', 'Cliente multiciudad', 'mayorista', 'dinamico', null),                    -- G: 3 tramos
  ('77-0007', 'Cliente mezcla A', 'mayorista', 'dinamico', null),                       -- H: mismas fechas/ruta que 77-0008
  ('77-0008', 'Cliente mezcla B', 'mayorista', 'dinamico', null),                       -- H
  ('77-0009', 'Cliente sin CxP aerea', 'mayorista', 'dinamico', null),                  -- I: null
  ('77-0010', 'Cliente CxP pagada', 'mayorista', 'dinamico', null),                     -- I: pagado
  ('77-0011', 'Cliente CxP pendiente', 'mayorista', 'dinamico', null),                  -- I: pendiente
  ('77-0012', 'Cliente CxP parcial', 'mayorista', 'dinamico', null),                    -- I: pago parcial -> pendiente
  ('77-0013', 'Cliente emision', 'mayorista', 'dinamico', null),                        -- J: estado de emision
  ('77-0020', 'Cliente minorista cross', 'minorista', 'dinamico', null);                -- N: cross-tenant

-- A: 77-0001 sin contrato_vuelos.
-- B/C: 77-0002 con contrato_vuelos.aerolinea propia, distinta de ventas.aerolinea (que además es NULL aquí).
insert into public.contrato_vuelos (numero_contrato, aerolinea, record, direccion, origen_codigo, destino_codigo, numero_vuelo, hora_salida, hora_llegada, fecha_salida, orden) values
  ('77-0002', 'JetSMART (contrato_vuelos)', 'PNR777', 'ida', 'MDE', 'CTG', 'JA200', '07:00', '08:00', current_date + 10, 0);
-- E: solo ida.
insert into public.contrato_vuelos (numero_contrato, aerolinea, record, direccion, origen_codigo, destino_codigo, numero_vuelo, hora_salida, hora_llegada, fecha_salida, orden) values
  ('77-0004', 'Avianca', 'OW444', 'ida', 'MDE', 'SMR', 'AV044', '06:00', '07:15', current_date + 8, 0);
-- F: ida y regreso.
insert into public.contrato_vuelos (numero_contrato, aerolinea, record, direccion, origen_codigo, destino_codigo, numero_vuelo, hora_salida, hora_llegada, fecha_salida, orden) values
  ('77-0005', 'Avianca', 'RT555', 'ida', 'MDE', 'CTG', 'AV055', '08:00', '09:00', current_date + 12, 0),
  ('77-0005', 'Avianca', 'RT555', 'regreso', 'CTG', 'MDE', 'AV056', '18:00', '19:00', current_date + 15, 1);
-- G: multi-ciudad, 3 tramos sueltos.
insert into public.contrato_vuelos (numero_contrato, aerolinea, record, direccion, origen_codigo, destino_codigo, numero_vuelo, hora_salida, hora_llegada, fecha_salida, orden) values
  ('77-0006', 'Avianca', 'MC666', null, 'MDE', 'BOG', 'AV601', '06:00', '07:00', current_date + 20, 0),
  ('77-0006', 'Avianca', 'MC666', null, 'BOG', 'LIM', 'AV602', '09:00', '11:00', current_date + 20, 1),
  ('77-0006', 'Avianca', 'MC666', null, 'LIM', 'MDE', 'AV603', '20:00', '23:00', current_date + 25, 2);
-- H: dos contratos con MISMAS fechas/ruta — nunca deben mezclarse.
insert into public.contrato_vuelos (numero_contrato, aerolinea, record, direccion, origen_codigo, destino_codigo, numero_vuelo, hora_salida, hora_llegada, fecha_salida, orden) values
  ('77-0007', 'Avianca', 'AAA111', 'ida', 'MDE', 'CTG', 'AV100', '08:00', '09:00', current_date + 30, 0),
  ('77-0008', 'Avianca', 'BBB222', 'ida', 'MDE', 'CTG', 'AV100', '08:00', '09:00', current_date + 30, 0);

-- I: CxP aéreas con distintos estados de pago.
insert into public.cuentas_por_pagar (id, numero_contrato, proveedor, tipo_proveedor, servicio, valor_total) overriding system value values
  (91001, '77-0010', 'Avianca', 'aereo', 'Aereo', 500000),
  (91002, '77-0011', 'Avianca', 'aereo', 'Aereo', 500000),
  (91003, '77-0012', 'Avianca', 'aereo', 'Aereo', 500000);
insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor) values
  (91001, current_date, 500000),   -- 77-0010: pagada completa
  (91003, current_date, 200000);   -- 77-0012: pago PARCIAL (saldo 300000 > 0)
-- 91002 (77-0011): sin pagos -> pendiente. 77-0009: sin ninguna CxP aérea -> null.

-- ═════════════════════════════════════════════════════════════════════════
-- Helper de aserción de acceso vía RPC/vista, impersonando un usuario
-- ═════════════════════════════════════════════════════════════════════════
create function pg_temp.como(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- A/B/C/D — record, aerolínea (contrato_vuelos primero, ventas de respaldo)
-- ═════════════════════════════════════════════════════════════════════════
select pg_temp.como('a0000001-0000-0000-0000-000000000001'); -- superadmin, alcance global

do $$
declare v record;
begin
  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0001';
  perform pg_temp.assert_eq(v.record, null::text, 'A: 77-0001 sin contrato_vuelos -> record NULL ("Sin PNR" en la app)');

  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0002';
  perform pg_temp.assert_eq(v.record, 'PNR777'::text, 'B: 77-0002 con contrato_vuelos -> record real');
  perform pg_temp.assert_eq(v.aerolinea, 'JetSMART (contrato_vuelos)'::text, 'C: aerolinea SOLO en contrato_vuelos -> la vista trae ESA, nunca ventas.aerolinea (que aquí es NULL)');

  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0003';
  perform pg_temp.assert_eq(v.aerolinea, 'Wingo'::text, 'D: 77-0003 SIN contrato_vuelos -> respaldo histórico = ventas.aerolinea');
  perform pg_temp.assert_eq(v.record, null::text, 'D: sin contrato_vuelos -> record NULL, nunca inventado');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- E/F/G — solo ida, ida+regreso, múltiples tramos
-- ═════════════════════════════════════════════════════════════════════════
do $$
declare v record; n bigint;
begin
  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0004';
  perform pg_temp.assert_eq(v.vuelo_ida, 'AV044'::text, 'E: solo ida -> vuelo_ida correcto');
  perform pg_temp.assert_eq(v.vuelo_regreso, null::text, 'E: solo ida -> vuelo_regreso NULL, nunca inventado');
  perform pg_temp.assert_eq(v.ruta, 'MDE - SMR'::text, 'E: ruta de un solo tramo');

  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0005';
  perform pg_temp.assert_eq(v.vuelo_ida, 'AV055'::text, 'F: ida y regreso -> vuelo_ida');
  perform pg_temp.assert_eq(v.vuelo_regreso, 'AV056'::text, 'F: ida y regreso -> vuelo_regreso');
  perform pg_temp.assert_eq(v.ruta, 'MDE - CTG - MDE'::text, 'F: ruta ida+regreso');

  select count(*) into n from public.contrato_vuelos_editor where numero_contrato = '77-0006';
  perform pg_temp.assert_eq(n, 3::bigint, 'G: multi-ciudad -> contrato_vuelos_editor devuelve LOS 3 tramos (no solo el "principal" de la vista resumen)');
  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0006';
  perform pg_temp.assert_eq(v.vuelo_ida, 'AV601'::text, 'G: resumen toma el tramo de menor orden como "principal"');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- H — dos contratos con MISMAS fechas/ruta nunca se mezclan
-- ═════════════════════════════════════════════════════════════════════════
do $$
declare v record;
begin
  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0007';
  perform pg_temp.assert_eq(v.record, 'AAA111'::text, 'H: 77-0007 conserva su PROPIO record pese a compartir fecha/ruta con 77-0008');
  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0008';
  perform pg_temp.assert_eq(v.record, 'BBB222'::text, 'H: 77-0008 conserva el suyo — nunca se cruzan');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- I — estado de pago derivado de las CxP aéreas reales
-- ═════════════════════════════════════════════════════════════════════════
do $$
declare v record;
begin
  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0009';
  perform pg_temp.assert_eq(v.estado_pago, null::text, 'I: sin ninguna CxP aérea -> estado_pago NULL ("Por confirmar")');
  perform pg_temp.assert_eq(v.cxp_aereas_total, 0::bigint, 'I: cxp_aereas_total = 0');

  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0010';
  perform pg_temp.assert_eq(v.estado_pago, 'pagado'::text, 'I: única CxP aérea pagada completa -> pagado');
  perform pg_temp.assert_eq(v.cxp_aereas_pagadas, 1::bigint, 'I: 1 de 1 pagada');

  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0011';
  perform pg_temp.assert_eq(v.estado_pago, 'pendiente'::text, 'I: CxP aérea sin ningún pago -> pendiente');

  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0012';
  perform pg_temp.assert_eq(v.estado_pago, 'pendiente'::text, 'I: CxP aérea con PAGO PARCIAL (200000 de 500000) -> sigue pendiente, no "pagado"');
  perform pg_temp.assert_eq(v.cxp_aereas_pagadas, 0::bigint, 'I: pago parcial NO cuenta como pagada');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- ═════════════════════════════════════════════════════════════════════════
-- J — estado de emisión: Por confirmar / Pendiente / Emitido, con historial
-- ═════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.como('a0000002-0000-0000-0000-000000000002'); -- control_vuelo mayorista

do $$
declare v record;
begin
  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0013';
  perform pg_temp.assert_eq(v.estado_emision, null::text, 'J1: sin contrato_vuelo_control -> Por confirmar (NULL)');
end $$;

select public.actualizar_estado_emision_contrato('77-0013', 'pendiente', 'primera nota');

do $$
declare v record; h record;
begin
  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0013';
  perform pg_temp.assert_eq(v.estado_emision, 'pendiente'::text, 'J2: estado_emision = pendiente tras el RPC');
  perform pg_temp.assert_eq((select count(*) from public.contrato_vuelo_control_cambios where numero_contrato = '77-0013'), 1::bigint, 'J2: un historial');
  select detalle, nota, registrado_por into h from public.contrato_vuelo_control_cambios where numero_contrato = '77-0013';
  perform pg_temp.assert_eq(h.detalle, 'Estado de emisión: Por confirmar → Pendiente'::text, 'J2: detalle antes→después');
  perform pg_temp.assert_eq(h.nota, 'primera nota'::text, 'J2: nota registrada');
  perform pg_temp.assert_eq(h.registrado_por, 'Control Vuelo Mayorista EVC'::text, 'J2: actor resuelto por auth.uid()');
end $$;

select public.actualizar_estado_emision_contrato('77-0013', 'emitido', '');

do $$
declare v record;
begin
  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0013';
  perform pg_temp.assert_eq(v.estado_emision, 'emitido'::text, 'J3: estado_emision = emitido');
  perform pg_temp.assert_eq((select count(*) from public.contrato_vuelo_control_cambios where numero_contrato = '77-0013'), 2::bigint, 'J3: dos historiales');
end $$;

-- Round-trip explícito de vuelta a "Por confirmar" — no es un valor que solo suba.
select public.actualizar_estado_emision_contrato('77-0013', null, '');

do $$
declare v record;
begin
  select * into v from public.ventas_vuelo_sistema where numero_contrato = '77-0013';
  perform pg_temp.assert_eq(v.estado_emision, null::text, 'J4: puede volver explícitamente a Por confirmar (NULL)');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- ═════════════════════════════════════════════════════════════════════════
-- K — control_vuelo edita el vuelo pero NUNCA alcanza PII/finanzas
-- ═════════════════════════════════════════════════════════════════════════
do $$
declare v_cols bigint;
begin
  select count(*) into v_cols
    from information_schema.columns
   where table_name in ('ventas_vuelo_sistema', 'contrato_vuelos_editor')
     and column_name in ('cliente', 'cliente_documento', 'cliente_telefono', 'cliente_email',
                          'precio_venta', 'costo_hotel', 'costo_aereo', 'comision_b2b');
  perform pg_temp.assert_eq(v_cols, 0::bigint, 'K1: ninguna de las dos vistas del editor tiene columnas de cliente/precio/costo/comisión');
end $$;

set local role authenticated;
select pg_temp.como('a0000002-0000-0000-0000-000000000002'); -- control_vuelo mayorista

do $$
declare v_n bigint;
begin
  -- control_vuelo no tiene NINGÚN SELECT sobre la tabla base ventas ni
  -- contrato_pasajeros — confirma que el editor no le abre una puerta lateral.
  begin
    select count(*) into v_n from public.ventas where numero_contrato = '77-0013';
  exception when insufficient_privilege then v_n := -1;
  end;
  perform pg_temp.assert_eq(v_n, 0::bigint, 'K2: control_vuelo sigue sin poder leer la tabla base ventas directo (0 filas por RLS, no por excepción — la policy simplemente no lo incluye)');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- ═════════════════════════════════════════════════════════════════════════
-- L — atomicidad: fallo forzado a mitad de guardar_tramos_contrato()
-- ═════════════════════════════════════════════════════════════════════════
insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete) values ('77-0014', 'Cliente atomicidad', 'mayorista', 'dinamico');
insert into public.contrato_vuelos (numero_contrato, aerolinea, record, direccion, numero_vuelo, orden) values
  ('77-0014', 'Avianca', 'ATOM1', 'ida', 'AV900', 0);

create or replace function pg_temp._forzar_fallo_tramo() returns trigger
language plpgsql as $$
begin
  if new.servicios = 'FORZAR_FALLO_TEST' then raise exception 'Fallo forzado por la prueba'; end if;
  return new;
end;
$$;
create trigger _trg_forzar_fallo_tramo before insert on public.contrato_vuelos
  for each row execute function pg_temp._forzar_fallo_tramo();

set local role authenticated;
select pg_temp.como('a0000001-0000-0000-0000-000000000001'); -- superadmin

do $$
declare v_lanzo boolean := false; v_msg text;
begin
  begin
    -- 2 tramos nuevos (sin id): el primero se insertaría bien, el segundo
    -- dispara el trigger de prueba — TODO el UPDATE/INSERT anterior de esta
    -- misma llamada debe revertirse, incluida la fila que "ya se había
    -- insertado" dentro de la misma transacción.
    perform public.guardar_tramos_contrato('77-0014', '[
      {"aerolinea":"Avianca","direccion":"ida","numeroVuelo":"AV901","servicios":"ok"},
      {"aerolinea":"Avianca","direccion":"regreso","numeroVuelo":"AV902","servicios":"FORZAR_FALLO_TEST"}
    ]'::jsonb);
  exception when others then
    v_lanzo := true;
    get stacked diagnostics v_msg = message_text;
  end;
  if not v_lanzo then raise exception 'ASSERT FALLÓ (L): debía propagar el fallo forzado'; end if;
  perform pg_temp.assert_eq(v_msg, 'Fallo forzado por la prueba'::text, 'L: mensaje del fallo forzado propagado tal cual');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);
drop trigger _trg_forzar_fallo_tramo on public.contrato_vuelos;

do $$
declare v_n bigint; v_num text;
begin
  select count(*) into v_n from public.contrato_vuelos where numero_contrato = '77-0014';
  perform pg_temp.assert_eq(v_n, 1::bigint, 'L: el contrato sigue con EXACTAMENTE su tramo original (1) — el intento fallido no dejó 0 ni un estado a medias');
  select numero_vuelo into v_num from public.contrato_vuelos where numero_contrato = '77-0014';
  perform pg_temp.assert_eq(v_num, 'AV900'::text, 'L: el tramo original SIGUE intacto (no se sobrescribió con el intento fallido)');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- M — conserva ids en UPDATE, borra los que ya no vienen, inserta nuevos
-- ═════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.como('a0000001-0000-0000-0000-000000000001');

do $$
declare v_id_original bigint;
begin
  select id into v_id_original from public.contrato_vuelos where numero_contrato = '77-0014';

  -- Guarda: mantiene el tramo original (por id, con un cambio de horario) +
  -- agrega uno nuevo (sin id).
  perform public.guardar_tramos_contrato('77-0014', jsonb_build_array(
    jsonb_build_object('id', v_id_original, 'aerolinea', 'Avianca', 'direccion', 'ida', 'numeroVuelo', 'AV900', 'horaSalida', '10:00'),
    jsonb_build_object('id', null, 'aerolinea', 'Avianca', 'direccion', 'regreso', 'numeroVuelo', 'AV999')
  ));

  perform pg_temp.assert_eq(
    (select hora_salida from public.contrato_vuelos where id = v_id_original),
    '10:00'::text, 'M1: el tramo original conservó su id Y se actualizó (hora_salida)'
  );
  perform pg_temp.assert_eq(
    (select count(*) from public.contrato_vuelos where numero_contrato = '77-0014'), 2::bigint,
    'M1: ahora hay 2 tramos (el original + el nuevo)'
  );

  -- Guarda de nuevo: SOLO el tramo nuevo (por su id ya asignado) — el
  -- original (v_id_original) debe desaparecer (ya no viene en el payload).
  perform public.guardar_tramos_contrato('77-0014', jsonb_build_array(
    jsonb_build_object('id', (select id from public.contrato_vuelos where numero_contrato = '77-0014' and numero_vuelo = 'AV999'), 'aerolinea', 'Avianca', 'direccion', 'ida', 'numeroVuelo', 'AV999')
  ));

  perform pg_temp.assert_eq(
    (select count(*) from public.contrato_vuelos where numero_contrato = '77-0014'), 1::bigint,
    'M2: solo queda 1 tramo — el que ya no vino en el payload (v_id_original) se borró'
  );
  perform pg_temp.assert_eq(
    (select count(*) from public.contrato_vuelos where id = v_id_original), 0::bigint,
    'M2: el id original ya no existe'
  );
end $$;

-- Un id de OTRO contrato en el payload debe rechazarse (nunca pisar un vuelo ajeno).
insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete) values ('77-0015', 'Cliente ajeno', 'mayorista', 'dinamico');
do $$
declare v_id_ajeno bigint; v_lanzo boolean := false;
begin
  select id into v_id_ajeno from public.contrato_vuelos where numero_contrato = '77-0014';
  begin
    perform public.guardar_tramos_contrato('77-0015', jsonb_build_array(
      jsonb_build_object('id', v_id_ajeno, 'aerolinea', 'X', 'direccion', 'ida', 'numeroVuelo', '1')
    ));
  exception when others then v_lanzo := true;
  end;
  perform pg_temp.assert_eq(v_lanzo, true, 'M3: un id de OTRO contrato en el payload se rechaza, nunca se le "roba" el tramo');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- ═════════════════════════════════════════════════════════════════════════
-- N — seguridad por rol/tenant
-- ═════════════════════════════════════════════════════════════════════════
set local role authenticated;

-- superadmin: ambos tenants.
select pg_temp.como('a0000001-0000-0000-0000-000000000001');
do $$
declare v_ok boolean;
begin
  select public.acceso_editar_vuelos_contrato('77-0013') into v_ok;
  perform pg_temp.assert_eq(v_ok, true, 'N1: superadmin, contrato mayorista -> true');
  select public.acceso_editar_vuelos_contrato('77-0020') into v_ok;
  perform pg_temp.assert_eq(v_ok, true, 'N1: superadmin, contrato minorista -> true (alcance global)');
end $$;

-- gerencia/administracion/operaciones/control_vuelo: SOLO su tenant.
do $$
begin
  perform pg_temp.como('a0000004-0000-0000-0000-000000000004'); -- gerencia mayorista
  perform pg_temp.assert_eq((select public.acceso_editar_vuelos_contrato('77-0013')), true, 'N2: gerencia mayorista, contrato mayorista -> true');
  perform pg_temp.assert_eq((select public.acceso_editar_vuelos_contrato('77-0020')), false, 'N2: gerencia mayorista, contrato minorista -> false');

  perform pg_temp.como('a0000005-0000-0000-0000-000000000005'); -- administracion mayorista
  perform pg_temp.assert_eq((select public.acceso_editar_vuelos_contrato('77-0013')), true, 'N3: administracion mayorista, contrato mayorista -> true');
  perform pg_temp.assert_eq((select public.acceso_editar_vuelos_contrato('77-0020')), false, 'N3: administracion mayorista, contrato minorista -> false');

  perform pg_temp.como('a0000006-0000-0000-0000-000000000006'); -- operaciones mayorista
  perform pg_temp.assert_eq((select public.acceso_editar_vuelos_contrato('77-0013')), true, 'N4: operaciones mayorista, contrato mayorista -> true');
  perform pg_temp.assert_eq((select public.acceso_editar_vuelos_contrato('77-0020')), false, 'N4: operaciones mayorista, contrato minorista -> false');

  perform pg_temp.como('a0000002-0000-0000-0000-000000000002'); -- control_vuelo mayorista
  perform pg_temp.assert_eq((select public.acceso_editar_vuelos_contrato('77-0013')), true, 'N5: control_vuelo mayorista, contrato mayorista -> true');
  perform pg_temp.assert_eq((select public.acceso_editar_vuelos_contrato('77-0020')), false, 'N5: control_vuelo mayorista, contrato minorista -> false (cambiar numero_contrato en la URL NO cruza de agencia)');
end $$;

-- venta: bloqueado SIEMPRE, aunque el contrato sea de SU tenant.
do $$
declare v_lanzo boolean := false; v_msg text;
begin
  perform pg_temp.como('a0000007-0000-0000-0000-000000000007');
  perform pg_temp.assert_eq((select public.acceso_editar_vuelos_contrato('77-0013')), false, 'N6: venta -> false aunque sea su propio tenant (este editor no es para asesores)');
  begin
    perform public.guardar_tramos_contrato('77-0013', '[{"aerolinea":"X","direccion":"ida","numeroVuelo":"1"}]'::jsonb);
  exception when others then
    v_lanzo := true; get stacked diagnostics v_msg = message_text;
  end;
  perform pg_temp.assert_eq(v_lanzo, true, 'N6: venta invocando el RPC directo -> rechazado');
  perform pg_temp.assert_eq(v_msg, 'Contrato no encontrado o sin permiso para editarlo.'::text, 'N6: mensaje de rechazo');
end $$;

-- usuario INACTIVO (rol control_vuelo guardado, activo=false): bloqueado.
do $$
begin
  perform pg_temp.como('a0000008-0000-0000-0000-000000000008');
  perform pg_temp.assert_eq((select public.acceso_editar_vuelos_contrato('77-0013')), false, 'N7: usuario inactivo -> false pese a tener rol control_vuelo guardado');
end $$;

-- perfil AUSENTE: bloqueado.
do $$
begin
  perform pg_temp.como('a0000009-0000-0000-0000-000000000009');
  perform pg_temp.assert_eq((select public.acceso_editar_vuelos_contrato('77-0013')), false, 'N8: perfil ausente -> false');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- anon: permission denied al invocar CUALQUIERA de las 3 funciones directo.
set local role anon;
select set_config('request.jwt.claims', '{}', true);

do $$
declare v_lanzo boolean;
begin
  v_lanzo := false;
  begin perform public.acceso_editar_vuelos_contrato('77-0013');
  exception when insufficient_privilege then v_lanzo := true; end;
  perform pg_temp.assert_eq(v_lanzo, true, 'N9a: anon -> permission denied en acceso_editar_vuelos_contrato()');

  v_lanzo := false;
  begin perform public.guardar_tramos_contrato('77-0013', '[{"aerolinea":"X"}]'::jsonb);
  exception when insufficient_privilege then v_lanzo := true; end;
  perform pg_temp.assert_eq(v_lanzo, true, 'N9b: anon -> permission denied en guardar_tramos_contrato()');

  v_lanzo := false;
  begin perform public.actualizar_estado_emision_contrato('77-0013', 'emitido', '');
  exception when insufficient_privilege then v_lanzo := true; end;
  perform pg_temp.assert_eq(v_lanzo, true, 'N9c: anon -> permission denied en actualizar_estado_emision_contrato()');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- ═════════════════════════════════════════════════════════════════════════
-- O — authenticated con EXECUTE pero SIN el rol permitido no puede modificar
--     (repite N6 con foco explícito en "EXECUTE no sustituye la autorización")
-- ═════════════════════════════════════════════════════════════════════════
do $$
begin
  perform pg_temp.assert_eq(
    has_function_privilege('authenticated', 'public.guardar_tramos_contrato(text, jsonb)', 'EXECUTE'),
    true, 'O1: authenticated (incl. venta, que comparte ese rol de Postgres) SÍ tiene EXECUTE otorgado a nivel de rol'
  );
  -- Y sin embargo N6 ya demostró que, como venta, la llamada es rechazada:
  -- el chequeo real vive DENTRO de la función (acceso_editar_vuelos_contrato),
  -- nunca en el GRANT de EXECUTE por sí solo.
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- P — Privilegios de EXECUTE bajo el escenario real de Supabase (GRANT
--     explícito previo a anon, no solo ausencia de default privileges local)
-- ═════════════════════════════════════════════════════════════════════════
grant execute on function public.acceso_editar_vuelos_contrato(text) to anon, public;
grant execute on function public.guardar_tramos_contrato(text, jsonb) to anon, public;
grant execute on function public.actualizar_estado_emision_contrato(text, text, text) to anon, public;

do $$
begin
  perform pg_temp.assert_eq(has_function_privilege('anon', 'public.acceso_editar_vuelos_contrato(text)', 'EXECUTE'), true, 'P0a: precondición — anon SÍ tiene EXECUTE tras el GRANT simulado');
  perform pg_temp.assert_eq(has_function_privilege('anon', 'public.guardar_tramos_contrato(text, jsonb)', 'EXECUTE'), true, 'P0b: precondición');
  perform pg_temp.assert_eq(has_function_privilege('anon', 'public.actualizar_estado_emision_contrato(text, text, text)', 'EXECUTE'), true, 'P0c: precondición');
end $$;

-- Re-aplica el revoke/grant EXACTO de la migración 157.
revoke all on function public.acceso_editar_vuelos_contrato(text) from public;
revoke all on function public.acceso_editar_vuelos_contrato(text) from anon;
grant execute on function public.acceso_editar_vuelos_contrato(text) to authenticated;

revoke all on function public.guardar_tramos_contrato(text, jsonb) from public;
revoke all on function public.guardar_tramos_contrato(text, jsonb) from anon;
grant execute on function public.guardar_tramos_contrato(text, jsonb) to authenticated;

revoke all on function public.actualizar_estado_emision_contrato(text, text, text) from public;
revoke all on function public.actualizar_estado_emision_contrato(text, text, text) from anon;
grant execute on function public.actualizar_estado_emision_contrato(text, text, text) to authenticated;

do $$
begin
  perform pg_temp.assert_eq(has_function_privilege('anon', 'public.acceso_editar_vuelos_contrato(text)', 'EXECUTE'), false, 'P1a: acceso_editar_vuelos_contrato — anon=false tras el revoke (había sido otorgado, no es ausencia trivial)');
  perform pg_temp.assert_eq(has_function_privilege('authenticated', 'public.acceso_editar_vuelos_contrato(text)', 'EXECUTE'), true, 'P1a: authenticated=true');
  perform pg_temp.assert_eq(has_function_privilege('public', 'public.acceso_editar_vuelos_contrato(text)', 'EXECUTE'), false, 'P1a: PUBLIC=false');

  perform pg_temp.assert_eq(has_function_privilege('anon', 'public.guardar_tramos_contrato(text, jsonb)', 'EXECUTE'), false, 'P1b: guardar_tramos_contrato — anon=false');
  perform pg_temp.assert_eq(has_function_privilege('authenticated', 'public.guardar_tramos_contrato(text, jsonb)', 'EXECUTE'), true, 'P1b: authenticated=true');
  perform pg_temp.assert_eq(has_function_privilege('public', 'public.guardar_tramos_contrato(text, jsonb)', 'EXECUTE'), false, 'P1b: PUBLIC=false');

  perform pg_temp.assert_eq(has_function_privilege('anon', 'public.actualizar_estado_emision_contrato(text, text, text)', 'EXECUTE'), false, 'P1c: actualizar_estado_emision_contrato — anon=false');
  perform pg_temp.assert_eq(has_function_privilege('authenticated', 'public.actualizar_estado_emision_contrato(text, text, text)', 'EXECUTE'), true, 'P1c: authenticated=true');
  perform pg_temp.assert_eq(has_function_privilege('public', 'public.actualizar_estado_emision_contrato(text, text, text)', 'EXECUTE'), false, 'P1c: PUBLIC=false');
end $$;

-- Reconfirma que el acceso legítimo sigue funcionando tras el ACL endurecido.
set local role authenticated;
select pg_temp.como('a0000002-0000-0000-0000-000000000002');
do $$
begin
  perform pg_temp.assert_eq((select public.acceso_editar_vuelos_contrato('77-0013')), true, 'P2: control_vuelo mayorista sigue con acceso a su tenant tras el ACL endurecido de P');
end $$;
reset role;
select set_config('request.jwt.claims', null, true);

-- ═════════════════════════════════════════════════════════════════════════
-- Q — errores visibles: payload inválido nunca da un resultado vacío mudo
-- ═════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.como('a0000001-0000-0000-0000-000000000001');

do $$
declare v_lanzo boolean := false; v_msg text;
begin
  begin
    perform public.guardar_tramos_contrato('77-0013', '[]'::jsonb); -- arreglo vacío
  exception when others then v_lanzo := true; get stacked diagnostics v_msg = message_text;
  end;
  perform pg_temp.assert_eq(v_lanzo, true, 'Q1: arreglo vacío -> excepción explícita, nunca "sin cambios" silencioso');
  perform pg_temp.assert_eq(v_msg, 'Debe haber al menos un tramo — este editor no vacía el itinerario a cero.'::text, 'Q1: mensaje claro');
end $$;

do $$
declare v_lanzo boolean := false;
begin
  begin
    perform public.guardar_tramos_contrato('99-9999-NO-EXISTE', '[{"aerolinea":"X","direccion":"ida","numeroVuelo":"1"}]'::jsonb);
  exception when others then v_lanzo := true;
  end;
  perform pg_temp.assert_eq(v_lanzo, true, 'Q2: contrato inexistente -> excepción explícita, nunca un "guardado" silencioso de la nada');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

do $$
begin
  raise notice 'TODAS LAS PRUEBAS PASARON: test_editor_vuelos_contrato.sql (secciones A-Q)';
end $$;

rollback;
