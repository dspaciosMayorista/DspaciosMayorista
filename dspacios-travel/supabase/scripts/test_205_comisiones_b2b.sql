-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBAS · migración 205 (comisiones B2B: base explícita, valor al peso,
-- descontada en precio, abonos protegidos, permisos). SOLO base LOCAL
-- desechable (Docker) con la 205 aplicada; nunca en remoto.
--
-- Todo vive en UNA transacción que termina en ROLLBACK: crea sus propios
-- usuarios (auth.users + usuarios), contratos y comisiones con números DTM-920x / MIN-00-9204,
-- y suplanta cada rol con request.jwt.claims + `set local role authenticated`
-- (el mismo mecanismo de PostgREST). Correr como superusuario:
--   psql -h localhost -U supabase_admin -d <base> -f test_205_comisiones_b2b.sql
-- Cualquier fila con resultado distinto de 'OK' es un fallo.
-- ─────────────────────────────────────────────────────────────────────────
begin;

create temp table _r (n serial, caso text, resultado text) on commit drop;

-- Ejecuta p_sql como el usuario p_uid (null = superusuario actual) y
-- devuelve 'filas=N' o 'error: <mensaje>'.
create function pg_temp.como(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v_n bigint; v_res text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  if p_uid is not null then execute 'set local role authenticated'; end if;
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    v_res := 'filas=' || v_n;
  exception when others then
    v_res := 'error: ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_res;
end $$;

create function pg_temp.chk(p_caso text, p_obtenido text, p_esperado text) returns void language sql as $$
  insert into _r(caso, resultado)
  values (p_caso, case when p_obtenido ilike p_esperado then 'OK'
                       else 'FALLA: obtuve [' || coalesce(p_obtenido, 'NULL') || '], esperaba [' || p_esperado || ']' end);
$$;

-- ── Usuarios ─────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000205001', 't205-super@x.test'),
  ('00000000-0000-0000-0000-000000205002', 't205-admin-may@x.test'),
  ('00000000-0000-0000-0000-000000205003', 't205-admin-min@x.test'),
  ('00000000-0000-0000-0000-000000205004', 't205-ger-min@x.test'),
  ('00000000-0000-0000-0000-000000205005', 't205-ops-may@x.test'),
  ('00000000-0000-0000-0000-000000205006', 't205-venta-may@x.test'),
  ('00000000-0000-0000-0000-000000205007', 't205-admin-inactivo@x.test'),
  ('00000000-0000-0000-0000-000000205008', 't205-agencia@x.test'),
  ('00000000-0000-0000-0000-000000205009', 't205-venta-min@x.test'),
  ('00000000-0000-0000-0000-000000205010', 't205-control-vuelo@x.test');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-0000-0000-000000205001', 't205-super@x.test',     'T205 Super',    'superadmin',     true,  'mayorista'),
  ('00000000-0000-0000-0000-000000205002', 't205-admin-may@x.test', 'T205 AdmMay',   'administracion', true,  'mayorista'),
  ('00000000-0000-0000-0000-000000205003', 't205-admin-min@x.test', 'T205 AdmMin',   'administracion', true,  'minorista'),
  ('00000000-0000-0000-0000-000000205004', 't205-ger-min@x.test',   'T205 GerMin',   'gerencia',       true,  'minorista'),
  ('00000000-0000-0000-0000-000000205005', 't205-ops-may@x.test',   'T205 OpsMay',   'operaciones',    true,  'mayorista'),
  ('00000000-0000-0000-0000-000000205006', 't205-venta-may@x.test', 'T205 VentaMay', 'venta',          true,  'mayorista'),
  ('00000000-0000-0000-0000-000000205007', 't205-admin-inactivo@x.test', 'T205 Inactivo', 'administracion', false, 'mayorista'),
  ('00000000-0000-0000-0000-000000205008', 't205-agencia@x.test',   'T205 Agencia',  'agencia',        true,  'mayorista'),
  ('00000000-0000-0000-0000-000000205009', 't205-venta-min@x.test', 'T205 VentaMin', 'venta',          true,  'minorista'),
  ('00000000-0000-0000-0000-000000205010', 't205-control-vuelo@x.test', 'T205 Control', 'control_vuelo', true,  'mayorista')
-- auth.users ya crea su fila en usuarios (trigger de alta): se sobrescribe.
on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;

-- ── Contratos ────────────────────────────────────────────────────────────
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, modo_compra, comision_b2b, comision_estado) values
  ('DTM-9201',  'Cliente', 'mayorista', 1000000, 200000, null,           null,  null),
  ('DTM-9202',  'Cliente', 'mayorista', 1000000, 200000, 'comisionable', 80000, 'pendiente'),
  ('DTM-9203', 'Cliente', 'mayorista',  920000, 200000, 'neta',         80000, 'descontada'),
  ('MIN-00-9204',  'Cliente', 'minorista', 1000000, 0,      null,           null,  null);

-- Filas "históricas": base_explicita NULL, como queda toda fila anterior a la 205.
insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, base_explicita, pct_comision, estado) values
  (9205001, 'DTM-9201', 'mayorista', 'A', 1000000, 0,       null, 0.10, 'pendiente'),  -- legado base 0
  (9205002, 'DTM-9201', 'mayorista', 'A', 1000000, null,    null, 0.10, 'pendiente'),  -- legado base NULL
  (9205006, 'DTM-9201', 'mayorista', 'A', 1000000, 1000000, null, 0.10, 'pendiente'),  -- legado con abonos
  (9205008, 'DTM-9203','mayorista', 'A', 1000000, 800000,  null, 0.10, 'pagada'),     -- NETO legado (firma de reservar)
  (9205009, 'MIN-00-9204', 'minorista', 'B', 1000000, 1000000, null, 0.10, 'pendiente');  -- otra agencia
-- Filas del código nuevo: marcan base_explicita = true EXPLÍCITAMENTE (la
-- columna no tiene default: NULL = legado).
insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, base_explicita, comision_valor, pct_comision, estado, descontada_en_precio) values
  (9205003, 'DTM-9201', 'mayorista', 'A', 1000000, 0,       true, null,   0.10,   'pendiente', false), -- base 0 explícita
  (9205004, 'DTM-9201', 'mayorista', 'A', 1000000, null,    true, null,   0.10,   'pendiente', false), -- sin base definida
  (9205005, 'DTM-9201', 'mayorista', 'A', 4000000, 3250000, true, 300000, 0.0923, 'pendiente', false), -- por valor
  (9205007, 'DTM-9203','mayorista', 'A', 1000000, 800000,  true, null,   0.10,   'pagada',    true);  -- NETO nuevo

-- Abono real a la fila legado 9205006 y abono SINTÉTICO de la 131 a la NETO
-- legado 9205008 (se inserta saltando triggers, como lo dejó el backfill).
insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9205006, current_date, 50000, 'mayorista');
set local session_replication_role = replica;
insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9205008, current_date, 80000, 'mayorista');
set local session_replication_role = origin;

-- ── 1. Lectura: legado intacto, base explícita, valor al peso ────────────
select pg_temp.chk('L1 legado base 0 sigue cayendo al PVP',
  (select public.comision_b2b_total(a)::text from public.aliados_b2b a where id = 9205001), '100000.0%');
select pg_temp.chk('L2 legado base NULL sigue cayendo al PVP',
  (select public.comision_b2b_total(a)::text from public.aliados_b2b a where id = 9205002), '100000.0%');
select pg_temp.chk('L3 nueva base 0 explícita = comisión 0',
  (select public.comision_b2b_total(a)::text from public.aliados_b2b a where id = 9205003), '0.0%');
select pg_temp.chk('L4 nueva sin base definida (NULL) cae al PVP',
  (select public.comision_b2b_total(a)::text from public.aliados_b2b a where id = 9205004), '100000.0%');
select pg_temp.chk('L5 por valor 3.250.000 / 300.000 se conserva al peso',
  (select public.comision_b2b_total(a)::text from public.aliados_b2b a where id = 9205005), '300000.0%');
select pg_temp.chk('L6 sin el valor, el % redondeado daría 299.975',
  (select (3250000 * 0.0923)::text), '299975.0%');
select pg_temp.chk('L7 base_explicita NO tiene default (NULL = legado)',
  (select coalesce(column_default, 'sin default') from information_schema.columns where table_schema='public' and table_name='aliados_b2b' and column_name='base_explicita'), 'sin default');
select pg_temp.chk('L8a insert con el payload del código viejo (sin base_explicita), vía RLS',
  pg_temp.como('00000000-0000-0000-0000-000000205002', $q$insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id, precio_venta, base_comision, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado) values (9205010, 'DTM-9201', 'mayorista', 'Viejo', null, 'freelance', null, 1000000, 0, 0.10, 0, 0.5, false, 0, 'pendiente')$q$),
  'filas=1');
select pg_temp.chk('L8b esa fila queda legado y conserva su importe (base 0 → PVP)',
  (select coalesce(base_explicita::text, 'NULL') || ' / ' || public.comision_b2b_total(a)::text from public.aliados_b2b a where id = 9205010),
  'NULL / 100000.0%');

-- ── 2. Abonos: nunca se pierden ──────────────────────────────────────────
select pg_temp.chk('D1 FK de abonos es RESTRICT (no CASCADE)',
  (select confdeltype::text from pg_constraint where conname = 'comision_b2b_pagos_aliado_b2b_id_fkey'), 'r');
select pg_temp.chk('D2 superadmin no borra comisión con abonos',
  pg_temp.como('00000000-0000-0000-0000-000000205001', 'delete from public.aliados_b2b where id = 9205006'), 'error: %tiene abonos%');
select pg_temp.chk('D3 superusuario/service-role tampoco (trigger, sin RLS)',
  pg_temp.como(null, 'delete from public.aliados_b2b where id = 9205006'), 'error: %tiene abonos%');
select pg_temp.chk('D4 rol service_role tampoco',
  (select pg_temp.como(null, 'set local role service_role; delete from public.aliados_b2b where id = 9205006')), 'error: %tiene abonos%');
select pg_temp.chk('D5 eliminar_contrato no se lleva los abonos de la comisión',
  pg_temp.como('00000000-0000-0000-0000-000000205001', $q$select public.eliminar_contrato('DTM-9201', false)$q$), 'error: %tiene abonos%');
select pg_temp.chk('D6 el abono y la venta siguen ahí',
  (select count(*)::text from public.comision_b2b_pagos where aliado_b2b_id = 9205006) || '/' ||
  (select count(*)::text from public.ventas where numero_contrato = 'DTM-9201'), '1/1');
select pg_temp.chk('D7 administración sí borra una comisión SIN abonos',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'delete from public.aliados_b2b where id = 9205003'), 'filas=1');

-- ── 3. Edición de comisiones abonadas ────────────────────────────────────
select pg_temp.chk('U1 no se cambia el total de una comisión con abonos',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'update public.aliados_b2b set pct_comision = 0.2 where id = 9205006'), 'error: %alteraría su total%');
select pg_temp.chk('U2 ni siquiera con service-role',
  pg_temp.como(null, 'update public.aliados_b2b set base_comision = 1 where id = 9205006'), 'error: %alteraría su total%');
select pg_temp.chk('U3 sí se permite un cambio que conserva el total (500.000 × 20 %)',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'update public.aliados_b2b set base_comision = 500000, base_explicita = true, pct_comision = 0.2 where id = 9205006'), 'filas=1');
select pg_temp.chk('U4 una comisión sin abonos se edita libremente',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'update public.aliados_b2b set pct_comision = 0.15 where id = 9205002'), 'filas=1');

-- ── 4. NETO: descontada en precio ────────────────────────────────────────
select pg_temp.chk('N1 NETO nuevo no admite abonos',
  pg_temp.como('00000000-0000-0000-0000-000000205002', $q$insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9205007, current_date, 1, 'mayorista')$q$), 'error: %descontó del precio%');
select pg_temp.chk('N2 NETO legado (firma de reservar) tampoco',
  pg_temp.como('00000000-0000-0000-0000-000000205002', $q$insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9205008, current_date, 1, 'mayorista')$q$), 'error: %descontó del precio%');
select pg_temp.chk('N3 el abono sintético de la 131 sigue intacto',
  (select count(*)::text || '/' || sum(valor)::text from public.comision_b2b_pagos where aliado_b2b_id = 9205008), '1/80000.00');
select pg_temp.chk('N4 no se cambia el total de una comisión descontada',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'update public.aliados_b2b set pct_comision = 0.2 where id = 9205007'), 'error: %alteraría su total%');
select pg_temp.chk('N5 la marca descontada_en_precio no se puede quitar',
  pg_temp.como(null, 'update public.aliados_b2b set descontada_en_precio = false where id = 9205007'), 'error: %descontada en el precio%');
select pg_temp.chk('N6 el estado de una NETO legado no se edita (quitaría la firma)',
  pg_temp.como(null, $q$update public.aliados_b2b set estado = 'pendiente' where id = 9205008$q$), 'error: %estado no se edita%');
select pg_temp.chk('N7 comision_b2b_descontada reconoce la marca y la firma legado, y nada más',
  (select string_agg(id::text || '=' || public.comision_b2b_descontada(a)::text, ',' order by id)
     from public.aliados_b2b a where id in (9205001, 9205007, 9205008)), '9205001=false,9205007=true,9205008=true');
-- Borrar una NETO suelta (sin abonos) la sacaría de Comisiones y de
-- Rentabilidad aunque el precio guardado siga neto de ella. Solo se va con el
-- contrato entero (eliminar_contrato / revertir_contrato_incompleto).
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, modo_compra, comision_b2b, comision_estado) values
  ('DTM-9206', 'Cliente', 'mayorista', 920000, 200000, 'neta', 80000, 'descontada');
insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, base_explicita, pct_comision, estado) values
  (9205060, 'DTM-9206', 'mayorista', 'A', 1000000, 800000, null, 0.10, 'pagada');    -- NETO legado SIN abonos
-- Segunda fila NO descontada en el mismo contrato NETO, como dato HISTÓRICO
-- (anterior a la 205: hoy la guarda 4e ya no deja crearla).
set local session_replication_role = replica;
insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, base_explicita, pct_comision, estado) values
  (9205061, 'DTM-9206', 'mayorista', 'B', 1000000, 800000, null, 0.10, 'pendiente');
set local session_replication_role = origin;
select pg_temp.chk('N8 superadmin por la API no borra una NETO nueva sin abonos',
  pg_temp.como('00000000-0000-0000-0000-000000205001', 'delete from public.aliados_b2b where id = 9205007'), 'error: %no se borra suelta%');
select pg_temp.chk('N9 administración tampoco borra una NETO legado sin abonos',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'delete from public.aliados_b2b where id = 9205060'), 'error: %no se borra suelta%');
select pg_temp.chk('N10 service_role tampoco',
  (select pg_temp.como(null, 'set local role service_role; delete from public.aliados_b2b where id = 9205060')), 'error: %no se borra suelta%');
select pg_temp.chk('N11 una comisión NO descontada sin abonos se sigue borrando (administración)',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'delete from public.aliados_b2b where id = 9205061'), 'filas=1');
select pg_temp.chk('N12a la NETO sigue ahí tras los intentos',
  (select count(*)::text from public.aliados_b2b where id = 9205060), '1');
select pg_temp.chk('N12b eliminar_contrato (superadmin) sí elimina el contrato NETO entero',
  pg_temp.como('00000000-0000-0000-0000-000000205001', $q$select public.eliminar_contrato('DTM-9206', false)$q$), 'filas=1');
select pg_temp.chk('N12c ... con su comisión descontada',
  (select count(*)::text from public.ventas where numero_contrato = 'DTM-9206') || '/' ||
  (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9206'), '0/0');

-- ── 4b. Contrato NETO: comisión B2B ≠ comisión del asesor ≠ abonos históricos
-- Decisión del dueño (2026-10-09): en un contrato NETO la comisión B2B del
-- aliado ya se descontó del precio. No corresponde una segunda comisión B2B
-- ni abonos B2B nuevos. La comisión del asesor interno es aparte (liquidación
-- por ventas; no vive en estas tablas) y no se toca. Los abonos B2B históricos
-- se conservan tal cual (revisión manual).
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, modo_compra, comision_b2b, comision_estado, asesor_firma_nombre, estado) values
  ('DTM-9250', 'Cliente', 'mayorista', 920000, 200000, 'neta', 80000, 'descontada', 'T205 VentaMay', 'confirmado'),
  ('DTM-9251', 'Cliente', 'mayorista', 1000000, 200000, 'comisionable', 80000, 'pendiente', 'T205 VentaMay', 'confirmado'),
  ('DTM-9252', 'Cliente', 'mayorista', 920000, 200000, 'neta', 80000, 'descontada', 'T205 VentaMay', 'confirmado');
insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, base_explicita, pct_comision, estado, descontada_en_precio) values
  (9205080, 'DTM-9250', 'mayorista', 'A', 1000000, 800000, true, 0.10, 'pagada', true),     -- la B2B descontada
  (9205083, 'DTM-9251', 'mayorista', 'A', 1000000, 800000, true, 0.10, 'pendiente', false); -- comisionable (control)
-- Segundas filas B2B HISTÓRICAS del contrato NETO (anteriores a la 205), una con abonos.
set local session_replication_role = replica;
insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, base_explicita, pct_comision, estado) values
  (9205081, 'DTM-9250', 'mayorista', 'A', 1000000, 800000, null, 0.05, 'pendiente'),
  (9205082, 'DTM-9250', 'mayorista', 'A', 1000000, 800000, null, 0.03, 'pendiente');
insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values
  (9205082, current_date - 30, 10000, 'mayorista'), (9205082, current_date - 20, 14000, 'mayorista');
-- Otra segunda fila histórica con abonos de id conocido, para los UPDATE.
insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, base_explicita, pct_comision, estado) values
  (9205084, 'DTM-9250', 'mayorista', 'A', 1000000, 800000, null, 0.03, 'pendiente');
insert into public.comision_b2b_pagos (id, aliado_b2b_id, fecha, valor, tenant) values
  (9205901, 9205084, current_date - 30, 10000, 'mayorista'), (9205902, 9205084, current_date - 20, 14000, 'mayorista');
set local session_replication_role = origin;
select pg_temp.chk('NN1 B2B: administración NO abona la segunda fila de un contrato NETO (sin abonos)',
  pg_temp.como('00000000-0000-0000-0000-000000205002', $q$insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9205081, current_date, 1000, 'mayorista')$q$),
  'error: %contrato vendido en modo neta%');
select pg_temp.chk('NN2 B2B: superadmin tampoco, ni a la histórica con abonos',
  pg_temp.como('00000000-0000-0000-0000-000000205001', $q$insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9205082, current_date, 1000, 'mayorista')$q$),
  'error: %contrato vendido en modo neta%');
select pg_temp.chk('NN3 B2B: service_role tampoco',
  (select pg_temp.como(null, $q$set local role service_role; insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9205082, current_date, 1000, 'mayorista')$q$)),
  'error: %contrato vendido en modo neta%');
select pg_temp.chk('NN4 ABONOS HISTÓRICOS: los dos abonos de la segunda fila siguen intactos',
  (select count(*)::text || '/' || sum(valor)::text from public.comision_b2b_pagos where aliado_b2b_id = 9205082), '2/24000.00');
select pg_temp.chk('NN5 ABONOS HISTÓRICOS: la fila conserva su total (no se recalcula) y su lectura legado',
  (select round(public.comision_b2b_total(a))::text || '/' || coalesce(base_explicita::text, 'NULL') from public.aliados_b2b a where id = 9205082), '24000/NULL');
select pg_temp.chk('NN6 control: en un contrato comisionable el abono B2B sí entra',
  pg_temp.como('00000000-0000-0000-0000-000000205002', $q$insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9205083, current_date, 1000, 'mayorista')$q$),
  'filas=1');
select pg_temp.chk('NN7 no se crea una SEGUNDA comisión B2B en un contrato NETO (API de gestión ni service_role)',
  pg_temp.como('00000000-0000-0000-0000-000000205002', $q$insert into public.aliados_b2b (numero_contrato, tenant, aliado, precio_venta, base_comision, pct_comision) values ('DTM-9250', 'mayorista', 'Otra', 1000000, 800000, 0.05)$q$) || ' | ' ||
  (select pg_temp.como(null, $q$set local role service_role; insert into public.aliados_b2b (numero_contrato, tenant, aliado, precio_venta, base_comision, pct_comision) values ('DTM-9250', 'mayorista', 'Otra', 1000000, 800000, 0.05)$q$)),
  'error: %no corresponde otra comisión B2B% | error: %no corresponde otra comisión B2B%');
select pg_temp.chk('NN8 ni moviendo una comisión de otro contrato a uno NETO',
  pg_temp.como('00000000-0000-0000-0000-000000205002', $q$update public.aliados_b2b set numero_contrato = 'DTM-9250' where id = 9205083$q$),
  'error: %no corresponde otra comisión B2B%');
select pg_temp.chk('NN9 la NETO descontada con firma legado (código viejo durante el despliegue) sí se crea',
  pg_temp.como('00000000-0000-0000-0000-000000205002', $q$insert into public.aliados_b2b (numero_contrato, tenant, aliado, precio_venta, base_comision, pct_comision, estado) values ('DTM-9252', 'mayorista', 'A', 1000000, 800000, 0.10, 'pagada')$q$),
  'filas=1');
select pg_temp.chk('NN10 revisión manual: la segunda fila SIN abonos se puede retirar a mano (administración); la que tiene abonos, no',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'delete from public.aliados_b2b where id = 9205081') || ' | ' ||
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'delete from public.aliados_b2b where id = 9205082'),
  'filas=1 | error: %tiene abonos%');
-- UPDATE de abonos (la policy de la 131 es FOR ALL para gestión y
-- authenticated tiene UPDATE): aumentar un abono es pagar algo nuevo.
select pg_temp.chk('NN12 UPDATE valor: administración NO aumenta un abono histórico de una segunda fila NETO',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'update public.comision_b2b_pagos set valor = valor + 50000 where id = 9205901'),
  'error: %contrato vendido en modo neta%');
select pg_temp.chk('NN13 UPDATE valor: superadmin y service_role tampoco',
  pg_temp.como('00000000-0000-0000-0000-000000205001', 'update public.comision_b2b_pagos set valor = valor + 1 where id = 9205901') || ' | ' ||
  (select pg_temp.como(null, 'set local role service_role; update public.comision_b2b_pagos set valor = valor + 1 where id = 9205902')),
  'error: %contrato vendido en modo neta% | error: %contrato vendido en modo neta%');
select pg_temp.chk('NN14 tras los intentos, los abonos históricos siguen intactos',
  (select string_agg(id::text || '=' || valor::text, ',' order by id) from public.comision_b2b_pagos where aliado_b2b_id = 9205084),
  '9205901=10000.00,9205902=14000.00');
select pg_temp.chk('NN15 cambio de aliado_b2b_id: no se mueve un abono a una segunda fila NETO ni a la descontada',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'update public.comision_b2b_pagos set aliado_b2b_id = 9205084 where aliado_b2b_id = 9205083') || ' | ' ||
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'update public.comision_b2b_pagos set aliado_b2b_id = 9205080 where aliado_b2b_id = 9205083'),
  'error: %contrato vendido en modo neta% | error: %descontó del precio%');
select pg_temp.chk('NN16 corrección sin importe (solo la fecha) de un abono histórico NETO: se permite',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'update public.comision_b2b_pagos set fecha = fecha + 1 where id = 9205902'), 'filas=1');
select pg_temp.chk('NN17 corrección a la BAJA de un abono histórico NETO: se permite (no paga nada nuevo)',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'update public.comision_b2b_pagos set valor = 12000 where id = 9205902') || ' | ' ||
  (select valor::text from public.comision_b2b_pagos where id = 9205902), 'filas=1 | %');
select pg_temp.chk('NN17b ... y queda en el valor corregido',
  (select valor::text from public.comision_b2b_pagos where id = 9205902), '12000.00');
select pg_temp.chk('NN18 control: en una comisión comisionable el abono SÍ se puede aumentar',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'update public.comision_b2b_pagos set valor = valor + 1000 where aliado_b2b_id = 9205083'), 'filas=1');
select pg_temp.chk('NN19 deshacer (borrar) el último abono histórico NETO sigue siendo una acción manual de administración',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'delete from public.comision_b2b_pagos where id = 9205902'), 'filas=1');
select pg_temp.chk('NN11 ASESOR: nada de esto toca su venta (la que usa la liquidación): precio, impuesto, asesor y estado intactos',
  (select precio_venta::text || '/' || impuesto::text || '/' || asesor_firma_nombre || '/' || estado from public.ventas where numero_contrato = 'DTM-9250'),
  '920000.00/200000/T205 VentaMay/confirmado');

-- ── 5. Permisos efectivos (RLS) ──────────────────────────────────────────
select pg_temp.chk('R1 operaciones lee comisiones de su agencia',
  pg_temp.como('00000000-0000-0000-0000-000000205005', $q$select 1 from public.aliados_b2b where numero_contrato = 'DTM-9201'$q$), 'filas=6');
select pg_temp.chk('R2 operaciones crea comisiones (pestaña del contrato)',
  pg_temp.como('00000000-0000-0000-0000-000000205005', $q$insert into public.aliados_b2b (numero_contrato, tenant, aliado, precio_venta, base_comision, pct_comision) values ('DTM-9201', 'mayorista', 'Ops', 1000000, 800000, 0.1)$q$), 'filas=1');
select pg_temp.chk('R3 operaciones NO edita',
  pg_temp.como('00000000-0000-0000-0000-000000205005', 'update public.aliados_b2b set pct_comision = 0.5 where id = 9205001'), 'filas=0');
select pg_temp.chk('R4 operaciones NO borra',
  pg_temp.como('00000000-0000-0000-0000-000000205005', 'delete from public.aliados_b2b where id = 9205001'), 'filas=0');
select pg_temp.chk('R5 operaciones NO registra abonos',
  pg_temp.como('00000000-0000-0000-0000-000000205005', $q$insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9205001, current_date, 1, 'mayorista')$q$), 'error: %row-level security%');
select pg_temp.chk('R6 administración de mayorista NO edita una comisión de minorista',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'update public.aliados_b2b set pct_comision = 0.5 where id = 9205009'), 'filas=0');
select pg_temp.chk('R7 administración de minorista edita la suya',
  pg_temp.como('00000000-0000-0000-0000-000000205003', 'update public.aliados_b2b set pct_comision = 0.12 where id = 9205009'), 'filas=1');
select pg_temp.chk('R8 administración de minorista NO borra una de mayorista',
  pg_temp.como('00000000-0000-0000-0000-000000205003', 'delete from public.aliados_b2b where id = 9205001'), 'filas=0');
select pg_temp.chk('R9 gerencia edita en las dos agencias (puede_ver_tenant)',
  pg_temp.como('00000000-0000-0000-0000-000000205004', 'update public.aliados_b2b set pct_comision = 0.11 where id = 9205001'), 'filas=1');
select pg_temp.chk('R10a venta LEE las comisiones de su agencia (decisión del dueño)',
  pg_temp.como('00000000-0000-0000-0000-000000205006', $q$select 1 from public.aliados_b2b where numero_contrato = 'DTM-9201'$q$), 'filas=7');
select pg_temp.chk('R10b venta NO lee las de la otra agencia',
  pg_temp.como('00000000-0000-0000-0000-000000205006', 'select 1 from public.aliados_b2b where id = 9205009'), 'filas=0');
select pg_temp.chk('R10c control_vuelo no ve ninguna comisión',
  pg_temp.como('00000000-0000-0000-0000-000000205010', 'select 1 from public.aliados_b2b'), 'filas=0');
select pg_temp.chk('R10d control_vuelo tampoco ve abonos de comisión',
  pg_temp.como('00000000-0000-0000-0000-000000205010', 'select 1 from public.comision_b2b_pagos'), 'filas=0');
select pg_temp.chk('R10e gerencia (otra agencia) ve las de ambas; operaciones solo la suya',
  pg_temp.como('00000000-0000-0000-0000-000000205004', 'select 1 from public.aliados_b2b where id in (9205001, 9205009)') || ' / ' ||
  pg_temp.como('00000000-0000-0000-0000-000000205005', 'select 1 from public.aliados_b2b where id in (9205001, 9205009)'),
  'filas=2 / filas=1');
select pg_temp.chk('R11 administración inactiva no edita',
  pg_temp.como('00000000-0000-0000-0000-000000205007', 'update public.aliados_b2b set pct_comision = 0.5 where id = 9205002'), 'filas=0');
select pg_temp.chk('R12 venta no crea comisiones (reservar con rol venta/agencia no deja fila)',
  pg_temp.como('00000000-0000-0000-0000-000000205006', $q$insert into public.aliados_b2b (numero_contrato, tenant, aliado, precio_venta, base_comision, pct_comision) values ('DTM-9201', 'mayorista', 'V', 1000000, 800000, 0.1)$q$), 'error: %row-level security%');
select pg_temp.chk('R13 administración edita dentro de su agencia (control positivo)',
  pg_temp.como('00000000-0000-0000-0000-000000205002', 'update public.aliados_b2b set recobro_total = 0 where id = 9205002'), 'filas=1');

-- ── 6. Comisión de una reserva (registrar_comision_b2b_reserva) ─────────
insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion) values
  (9205, 'T205 Agencia Uno', '901', 'agencia',   0.10, false, 0),
  (9206, 'T205 Freelance',   '902', 'freelance', null, true,  0.11),
  (9207, 'T205 Agencia Dos', '903', 'agencia',   0.10, false, 0);
update public.usuarios set aliado_id = 9205 where id = '00000000-0000-0000-0000-000000205008';
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, financiero_estado) values
  ('DTM-9211', 'C', 'mayorista', 1000000, 200000, 'agencia', 9205, 'comisionable', 80000, 'pendiente',  'pendiente'),
  ('DTM-9212', 'C', 'mayorista',  920000, 200000, 'agencia', 9205, 'neta',         80000, 'descontada', 'pendiente'),
  ('DTM-9213', 'C', 'mayorista', 1000000, 200000, 'agencia', 9205, 'comisionable', 99999, 'pendiente',  'pendiente'),
  ('DTM-9214', 'C', 'mayorista', 1000000, 200000, 'agencia', 9205, 'comisionable', 80000, 'pendiente',  'completo'),
  ('DTM-9215', 'C', 'mayorista', 1000000, 200000, 'interno', null, null,           null,  null,         'pendiente'),
  ('MIN-00-9216', 'C', 'minorista', 1000000, 200000, 'agencia', 9205, 'comisionable', 80000, 'pendiente', 'pendiente'),
  ('DTM-9218', 'C', 'mayorista', 1000000, 200000, 'agencia', 9205, 'comisionable', 80000, 'pendiente',  'pendiente'),
  ('DTM-9219', 'C', 'mayorista', 1000000, 200000, 'agencia', 9207, 'comisionable', 80000, 'pendiente',  'pendiente'),
  ('DTM-9220', 'C', 'mayorista', 1000000, 1000000, 'agencia', 9205, 'comisionable', 0,    'pendiente',  'pendiente');
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, financiero_estado)
select 'DTM-9217', 'C', 'mayorista', 1000000, 200000, 'freelance', 9206, 'comisionable',
       round(800000 * coalesce((select valor from public.parametros_tributarios where parametro = 'COMISION_FREELANCE'), 0.11)), 'pendiente', 'pendiente';

create function pg_temp.reg(p_uid uuid, p_num text, p_aliado bigint) returns text language sql as $f$
  select pg_temp.como(p_uid, format('select public.registrar_comision_b2b_reserva(%L, %s)', p_num, p_aliado));
$f$;

select pg_temp.chk('RES1 venta (antes rechazado por RLS) registra la comisión de una reserva comisionable',
  pg_temp.reg('00000000-0000-0000-0000-000000205006', 'DTM-9211', 9205), 'filas=1');
select pg_temp.chk('RES2 fila nacida: bruto, base PVP−impuesto explícita, % del aliado, aliado enlazado, total 80.000',
  (select precio_venta::text || '/' || base_comision::text || '/' || base_explicita::text || '/' || pct_comision::text || '/' ||
          aliado_id::text || '/' || tipo_aliado || '/' || estado || '/' || descontada_en_precio::text || '/' || round(public.comision_b2b_total(a))::text
     from public.aliados_b2b a where numero_contrato = 'DTM-9211'),
  '1000000.00/800000.00/true/0.1000/9205/agencia/pendiente/false/80000');
select pg_temp.chk('RES3 sin duplicados: una segunda llamada se niega y sigue habiendo una fila',
  pg_temp.reg('00000000-0000-0000-0000-000000205006', 'DTM-9211', 9205) || ' / ' ||
  (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9211'), 'error: %ya tiene comisión% / 1');
select pg_temp.chk('RES4a NETO: venta registra la comisión de una reserva neta',
  pg_temp.reg('00000000-0000-0000-0000-000000205006', 'DTM-9212', 9205), 'filas=1');
select pg_temp.chk('RES4b nace descontada, con el PVP bruto (920.000 + 80.000) y base 800.000',
  (select precio_venta::text || '/' || base_comision::text || '/' || estado || '/' || descontada_en_precio::text
     from public.aliados_b2b where numero_contrato = 'DTM-9212'), '1000000.00/800000.00/pagada/true');
select pg_temp.chk('RES5 NETO: no admite abonos',
  pg_temp.como('00000000-0000-0000-0000-000000205002', $q$insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) select id, current_date, 1, 'mayorista' from public.aliados_b2b where numero_contrato = 'DTM-9212'$q$),
  'error: %descontó del precio%');
select pg_temp.chk('RES6 comisión de la venta que no cuadra con la recalculada → se niega',
  pg_temp.reg('00000000-0000-0000-0000-000000205006', 'DTM-9213', 9205), 'error: %no coincide%');
select pg_temp.chk('RES7 contrato ya completo (no es una reserva en curso) → se niega',
  pg_temp.reg('00000000-0000-0000-0000-000000205002', 'DTM-9214', 9205), 'error: %solo se registra mientras se crea%');
select pg_temp.chk('RES8 venta interna → se niega',
  pg_temp.reg('00000000-0000-0000-0000-000000205006', 'DTM-9215', 9205), 'error: %no es una venta B2B%');
select pg_temp.chk('RES9 venta de mayorista sobre un contrato de minorista → se niega',
  pg_temp.reg('00000000-0000-0000-0000-000000205006', 'MIN-00-9216', 9205), 'error: %No autorizado%');
select pg_temp.chk('RES10 venta de minorista sí en su agencia',
  pg_temp.reg('00000000-0000-0000-0000-000000205009', 'MIN-00-9216', 9205), 'filas=1');
select pg_temp.chk('RES11 la agencia registra la suya',
  pg_temp.reg('00000000-0000-0000-0000-000000205008', 'DTM-9218', 9205), 'filas=1');
select pg_temp.chk('RES12 la agencia NO registra la de otro aliado',
  pg_temp.reg('00000000-0000-0000-0000-000000205008', 'DTM-9219', 9207), 'error: %solo registra su propia%');
select pg_temp.chk('RES13 aliado distinto al de la venta → se niega',
  pg_temp.reg('00000000-0000-0000-0000-000000205002', 'DTM-9219', 9205), 'error: %no coincide con el de la venta%');
select pg_temp.chk('RES14a operaciones registra la de un freelance sin % propio',
  pg_temp.reg('00000000-0000-0000-0000-000000205005', 'DTM-9217', 9206), 'filas=1');
select pg_temp.chk('RES14b usa el % general y la retención del aliado (11 %)',
  (select (round(public.comision_b2b_total(a)) = round(v.comision_b2b * (1 - 0.11)))::text
     from public.aliados_b2b a join public.ventas v using (numero_contrato) where a.numero_contrato = 'DTM-9217'),
  'true');
select pg_temp.chk('RES15a reserva con impuesto = PVP (base 0)',
  pg_temp.reg('00000000-0000-0000-0000-000000205002', 'DTM-9220', 9205), 'filas=1');
select pg_temp.chk('RES15b base 0 creada por el código nuevo = comisión 0',
  (select base_comision::text || '/' || base_explicita::text || '/' || public.comision_b2b_total(a)::text from public.aliados_b2b a where numero_contrato = 'DTM-9220'),
  '0.00/true/0.0%');
select pg_temp.chk('RES16 usuario inactivo y sin sesión → se niega',
  pg_temp.reg('00000000-0000-0000-0000-000000205007', 'DTM-9213', 9205) || ' | ' ||
  pg_temp.como(null, $q$set local role anon; select public.registrar_comision_b2b_reserva('DTM-9213', 9205)$q$),
  'error: %No autorizado% | error: %permission denied%');
select pg_temp.chk('RES17a la reserva se revierte (la del fallo y una con comisión ya creada)',
  pg_temp.como(null, $q$set local role service_role; select public.revertir_contrato_incompleto('DTM-9213', 'mayorista'); select public.revertir_contrato_incompleto('DTM-9211', 'mayorista')$q$),
  'filas=%');
select pg_temp.chk('RES17b cero restos: ni venta ni comisión',
  (select count(*)::text from public.ventas where numero_contrato in ('DTM-9211','DTM-9213')) || '/' ||
  (select count(*)::text from public.aliados_b2b where numero_contrato in ('DTM-9211','DTM-9213')),
  '0/0');
-- Un contrato HISTÓRICO sin fila no recibe comisión por esta RPC: ni uno
-- completo (RES7) ni uno que quedó atascado en financiero_estado='pendiente'
-- (su escritura financiera falló hace tiempo). La ventana es la misma frontera
-- de la reconciliación (172): pendiente con más de 5 minutos = abandonado.
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, financiero_estado, financiero_actualizado_en) values
  ('DTM-9221', 'C', 'mayorista', 1000000, 200000, 'agencia', 9205, 'comisionable', 80000, 'pendiente', 'pendiente', now() - interval '2 hours'),
  ('DTM-9222', 'C', 'mayorista', 1000000, 200000, 'agencia', 9205, 'comisionable', 80000, 'pendiente', 'pendiente', now() - interval '4 minutes');
select pg_temp.chk('RES18a contrato atascado en pendiente hace 2 horas, sin fila: venta NO le añade comisión',
  pg_temp.reg('00000000-0000-0000-0000-000000205006', 'DTM-9221', 9205), 'error: %mientras se crea el contrato%');
select pg_temp.chk('RES18b tampoco operaciones (rol de gestión) por esta vía',
  pg_temp.reg('00000000-0000-0000-0000-000000205005', 'DTM-9221', 9205), 'error: %mientras se crea el contrato%');
select pg_temp.chk('RES18c y sigue sin fila (sin backfill)',
  (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9221'), '0');
select pg_temp.chk('RES18d venta no puede reabrir la ventana tocando la marca de tiempo',
  pg_temp.como('00000000-0000-0000-0000-000000205006', $q$update public.ventas set financiero_actualizado_en = now() where numero_contrato = 'DTM-9221'$q$),
  'filas=0');
select pg_temp.chk('RES18e dentro de la ventana (pendiente hace 4 minutos) sí registra',
  pg_temp.reg('00000000-0000-0000-0000-000000205006', 'DTM-9222', 9205), 'filas=1');

select pg_temp.chk('RES17c una reserva NETO también se revierte entera (su comisión descontada incluida)',
  pg_temp.como(null, $q$set local role service_role; select public.revertir_contrato_incompleto('DTM-9212', 'mayorista')$q$),
  'filas=%');
select pg_temp.chk('RES17d cero restos de la reserva NETO',
  (select count(*)::text from public.ventas where numero_contrato = 'DTM-9212') || '/' ||
  (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9212'),
  '0/0');

-- ── 7. Alta manual desde la pestaña (registrar_comision_b2b_manual) ─────
-- Contratos manuales B2B: nacen SIN comisión ("Por definir").
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, tipo_asesor, aliado_id, asesor, comision_estado) values
  ('DTM-9231', 'C', 'mayorista', 1000000, 200000, 'agencia', 9205, 'T205 VentaMay', null),          -- propio
  ('DTM-9232', 'C', 'mayorista', 1000000, 200000, 'agencia', 9205, 'Otro Asesor',   null),          -- de un colega
  ('DTM-9233', 'C', 'mayorista', 1000000, 200000, 'interno', null, 'T205 VentaMay', null),          -- propio, interno
  ('DTM-9234', 'C', 'mayorista',  920000, 200000, 'agencia', 9205, 'T205 VentaMay', 'descontada'),  -- propio, NETO
  ('MIN-00-9235', 'C', 'minorista', 1000000, 0,   'agencia', 9205, 'T205 VentaMay', null);          -- otra agencia

create function pg_temp.man(p_uid uuid, p_num text, p_aliado_id bigint, p_pct numeric default 0.1) returns text language sql as $f$
  select pg_temp.como(p_uid, format(
    'select public.registrar_comision_b2b_manual(%L, %L, %L, %L, %s, %s, 0, 0.5, true, 0.5)',
    p_num, 'Nombre tecleado', 'NIT tecleado', 'freelance', coalesce(p_aliado_id::text, 'null'), p_pct));
$f$;

select pg_temp.chk('MAN1 venta registra la comisión de SU contrato manual B2B',
  pg_temp.man('00000000-0000-0000-0000-000000205006', 'DTM-9231', 9205), 'filas=1');
select pg_temp.chk('MAN2 nace con base PVP−impuesto explícita, aliado y retención del CATÁLOGO (no del formulario)',
  (select aliado || '/' || nit || '/' || tipo_aliado || '/' || base_comision::text || '/' || base_explicita::text || '/' ||
          aplica_retencion::text || '/' || pct_retencion::text || '/' || tenant || '/' || round(public.comision_b2b_total(a))::text
     from public.aliados_b2b a where numero_contrato = 'DTM-9231'),
  'T205 Agencia Uno/901/agencia/800000.00/true/false/0.0000/mayorista/80000');
select pg_temp.chk('MAN3 venta: una sola vez (el cambio lo hace administración)',
  pg_temp.man('00000000-0000-0000-0000-000000205006', 'DTM-9231', 9205), 'error: %ya tiene comisión%');
select pg_temp.chk('MAN4 venta NO registra en el contrato de un colega',
  pg_temp.man('00000000-0000-0000-0000-000000205006', 'DTM-9232', 9205), 'error: %tus propios contratos%');
select pg_temp.chk('MAN5 venta: contrato interno → no',
  pg_temp.man('00000000-0000-0000-0000-000000205006', 'DTM-9233', 9205), 'error: %no es una venta B2B%');
select pg_temp.chk('MAN6 venta: otro aliado distinto al del contrato → no',
  pg_temp.man('00000000-0000-0000-0000-000000205006', 'DTM-9232', 9207), 'error: %tus propios contratos%');
select pg_temp.chk('MAN7 NETO → no (para nadie)',
  pg_temp.man('00000000-0000-0000-0000-000000205006', 'DTM-9234', 9205) || ' | ' ||
  pg_temp.man('00000000-0000-0000-0000-000000205002', 'DTM-9234', 9205), 'error: %modo neta% | error: %modo neta%');
select pg_temp.chk('MAN8 venta de mayorista sobre un contrato de minorista → no',
  pg_temp.man('00000000-0000-0000-0000-000000205006', 'MIN-00-9235', 9205), 'error: %No autorizado%');
select pg_temp.chk('MAN9 venta NO borra su comisión y NO abona (la corrige: sección 8)',
  pg_temp.como('00000000-0000-0000-0000-000000205006', $q$delete from public.aliados_b2b where numero_contrato = 'DTM-9231'$q$) || ' | ' ||
  pg_temp.como('00000000-0000-0000-0000-000000205006', $q$insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) select id, current_date, 1, 'mayorista' from public.aliados_b2b where numero_contrato = 'DTM-9231'$q$),
  'filas=0 | error: %row-level security%');
select pg_temp.chk('MAN10 control_vuelo no registra comisiones',
  pg_temp.man('00000000-0000-0000-0000-000000205010', 'DTM-9232', 9205), 'error: %No autorizado%');
select pg_temp.chk('MAN11 operaciones registra en cualquier contrato de su agencia (también un 2.º aliado)',
  pg_temp.man('00000000-0000-0000-0000-000000205005', 'DTM-9232', 9205) || ' | ' ||
  pg_temp.man('00000000-0000-0000-0000-000000205005', 'DTM-9232', 9207), 'filas=1 | filas=1');
select pg_temp.chk('MAN12 administración de mayorista NO registra en minorista',
  pg_temp.man('00000000-0000-0000-0000-000000205002', 'MIN-00-9235', 9205), 'error: %No autorizado%');
select pg_temp.chk('MAN13 % inválido → no; inactivo → no; sin sesión → no',
  pg_temp.man('00000000-0000-0000-0000-000000205002', 'DTM-9232', 9205, 1.5) || ' | ' ||
  pg_temp.man('00000000-0000-0000-0000-000000205007', 'DTM-9232', 9205) || ' | ' ||
  pg_temp.como(null, $q$set local role anon; select public.registrar_comision_b2b_manual('DTM-9232', 'x', '', '', 9205, 0.1, 0, 0.5, false, 0)$q$),
  'error: %inválidos% | error: %No autorizado% | error: %permission denied%');
select pg_temp.chk('MAN14 el % 0 es legítimo (comisión solo de recobro)',
  pg_temp.man('00000000-0000-0000-0000-000000205002', 'DTM-9232', 9205, 0), 'filas=1');
select pg_temp.chk('MAN15a contrato migrado de minorista (sin impuesto): administración de minorista registra',
  pg_temp.man('00000000-0000-0000-0000-000000205003', 'MIN-00-9235', 9205), 'filas=1');
select pg_temp.chk('MAN15b su base es el PVP completo (impuesto 0), explícita, en su tenant',
  (select base_comision::text || '/' || base_explicita::text || '/' || tenant from public.aliados_b2b where numero_contrato = 'MIN-00-9235'),
  '1000000.00/true/minorista');
select pg_temp.chk('MAN16 gestión enlazada al catálogo: el tipo es el del catálogo, no el del formulario (pide freelance para una agencia)',
  (select string_agg(a.aliado_id::text || '/' || a.tipo_aliado, ' ' order by a.id)
     from public.aliados_b2b a where numero_contrato = 'DTM-9232' and aliado_id in (9205, 9207)),
  '9205/agencia 9207/agencia 9205/agencia');
select pg_temp.chk('MAN17a gestión registra sin aliado del catálogo',
  pg_temp.como('00000000-0000-0000-0000-000000205002',
    $q$select public.registrar_comision_b2b_manual('DTM-9232', 'Freelance suelto', '', 'freelance', null, 0.1, 0, 0.5, false, 0)$q$),
  'filas=1');
select pg_temp.chk('MAN17b sin aliado del catálogo conserva el tipo escrito',
  (select tipo_aliado from public.aliados_b2b where numero_contrato = 'DTM-9232' and aliado = 'Freelance suelto'),
  'freelance');

-- ── 8. El asesor corrige SU comisión antes de abonos (policy "edicion asesor") ─
create function pg_temp.ase(p_uid uuid, p_num text, p_set text) returns text language sql as $f$
  select pg_temp.como(p_uid, format('update public.aliados_b2b set %s where numero_contrato = %L', p_set, p_num));
$f$;
select pg_temp.chk('ASE1 venta corrige el % de SU comisión',
  pg_temp.ase('00000000-0000-0000-0000-000000205006', 'DTM-9231', 'pct_comision = 0.15'), 'filas=1');
select pg_temp.chk('ASE2 queda 800.000 × 15 % = 120.000',
  (select round(public.comision_b2b_total(a))::text from public.aliados_b2b a where numero_contrato = 'DTM-9231'), '120000');
select pg_temp.chk('ASE3 venta corrige la base y fija un valor exacto',
  pg_temp.ase('00000000-0000-0000-0000-000000205006', 'DTM-9231', 'base_comision = 500000, base_explicita = true, comision_valor = 37000, pct_comision = 0.074'), 'filas=1');
select pg_temp.chk('ASE4 se cobra el valor exacto, al peso',
  (select round(public.comision_b2b_total(a))::text from public.aliados_b2b a where numero_contrato = 'DTM-9231'), '37000');
select pg_temp.chk('ASE5 venta NO cambia el aliado ni la retención (solo campos del cálculo)',
  pg_temp.ase('00000000-0000-0000-0000-000000205006', 'DTM-9231', $q$aliado = 'Otro'$q$) || ' | ' ||
  pg_temp.ase('00000000-0000-0000-0000-000000205006', 'DTM-9231', 'aplica_retencion = true, pct_retencion = 0.5') || ' | ' ||
  pg_temp.ase('00000000-0000-0000-0000-000000205006', 'DTM-9231', $q$estado = 'pagada'$q$),
  'error: %solo puede corregir% | error: %solo puede corregir% | error: %solo puede corregir%');
select pg_temp.chk('ASE6 venta NO edita la comisión del contrato de un colega',
  pg_temp.ase('00000000-0000-0000-0000-000000205006', 'DTM-9232', 'pct_comision = 0.5'), 'filas=0');
select pg_temp.chk('ASE7 control_vuelo y venta de otra agencia no editan',
  pg_temp.ase('00000000-0000-0000-0000-000000205010', 'DTM-9231', 'pct_comision = 0.5') || ' | ' ||
  pg_temp.ase('00000000-0000-0000-0000-000000205009', 'DTM-9231', 'pct_comision = 0.5'), 'filas=0 | filas=0');
-- NETO descontada en un contrato propio (como la deja reservar).
set local session_replication_role = replica;
insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, base_explicita, pct_comision, estado, descontada_en_precio)
values (9205031, 'DTM-9234', 'mayorista', 'A', 1000000, 800000, true, 0.10, 'pagada', true);
set local session_replication_role = origin;
select pg_temp.chk('ASE8 venta NO edita una NETO descontada de su contrato',
  pg_temp.ase('00000000-0000-0000-0000-000000205006', 'DTM-9234', 'pct_comision = 0.2'), 'error: %descontó del precio%');
-- Administración registra un abono: desde ahí, solo administración la cambia.
select pg_temp.chk('ASE9 administración abona la comisión del asesor',
  pg_temp.como('00000000-0000-0000-0000-000000205002', $q$insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) select id, current_date, 10000, 'mayorista' from public.aliados_b2b where numero_contrato = 'DTM-9231'$q$),
  'filas=1');
select pg_temp.chk('ASE10 con abonos, venta ya NO la corrige (ni conservando el total)',
  pg_temp.ase('00000000-0000-0000-0000-000000205006', 'DTM-9231', 'pct_comision = 0.2') || ' | ' ||
  pg_temp.ase('00000000-0000-0000-0000-000000205006', 'DTM-9231', 'recobro_total = 0'),
  'error: %ya tiene abonos% | error: %ya tiene abonos%');
select pg_temp.chk('ASE11 administración sí puede hacer un cambio que conserve el total abonado',
  pg_temp.ase('00000000-0000-0000-0000-000000205002', 'DTM-9231', 'recobro_total = 0'), 'filas=1');

-- Regla aprobada por el dueño: `venta` corrige A MANO comisiones ANTERIORES a
-- la 205 (base_explicita NULL) solo en SUS contratos, sin abonos y no NETO.
-- Nada se recalcula solo: la fila conserva la lectura legado salvo lo que se
-- escribió, y las demás no cambian.
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, tipo_asesor, aliado_id, asesor, comision_estado) values
  ('DTM-9237', 'C', 'mayorista', 1000000, 200000, 'agencia', 9205, 'T205 VentaMay', null),          -- propio
  ('DTM-9238', 'C', 'mayorista', 1000000, 200000, 'agencia', 9205, 'Otro Asesor',   null),          -- de un colega
  ('DTM-9239', 'C', 'mayorista',  920000, 200000, 'agencia', 9205, 'T205 VentaMay', 'descontada'),  -- propio, NETO legado
  ('DTM-9240', 'C', 'mayorista', 1000000, 200000, 'agencia', 9205, 'T205 VentaMay', null);          -- propio, con abonos
insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, base_explicita, pct_comision, estado) values
  (9205070, 'DTM-9237', 'mayorista', 'L', 1000000, 0, null, 0.10, 'pendiente'),
  (9205071, 'DTM-9238', 'mayorista', 'L', 1000000, 0, null, 0.10, 'pendiente'),
  (9205072, 'DTM-9239', 'mayorista', 'L', 1000000, 800000, null, 0.10, 'pagada'),
  (9205073, 'DTM-9240', 'mayorista', 'L', 1000000, 0, null, 0.10, 'pendiente');
insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9205073, current_date, 10000, 'mayorista');
select pg_temp.chk('ASE12 venta corrige el % de una comisión ANTERIOR a la 205 de SU contrato',
  pg_temp.ase('00000000-0000-0000-0000-000000205006', 'DTM-9237', 'pct_comision = 0.12'), 'filas=1');
select pg_temp.chk('ASE13 sin recálculo: sigue en lectura legado (base 0 → PVP) con solo el % escrito: 1.000.000 × 12 %',
  (select coalesce(base_explicita::text, 'NULL') || ' / ' || round(public.comision_b2b_total(a))::text from public.aliados_b2b a where id = 9205070),
  'NULL / 120000');
select pg_temp.chk('ASE14 la de un colega, no',
  pg_temp.ase('00000000-0000-0000-0000-000000205006', 'DTM-9238', 'pct_comision = 0.12'), 'filas=0');
select pg_temp.chk('ASE15 una NETO legado de su contrato, no',
  pg_temp.ase('00000000-0000-0000-0000-000000205006', 'DTM-9239', 'pct_comision = 0.12'), 'error: %descontó del precio%');
select pg_temp.chk('ASE16 una anterior con abonos de su contrato, no',
  pg_temp.ase('00000000-0000-0000-0000-000000205006', 'DTM-9240', 'pct_comision = 0.12'), 'error: %ya tiene abonos%');
select pg_temp.chk('ASE17 las demás anteriores de este bloque no cambiaron (colega, NETO, con abonos)',
  (select string_agg(id::text || '=' || round(public.comision_b2b_total(a))::text || '/' || coalesce(base_explicita::text, 'NULL'), ',' order by id)
     from public.aliados_b2b a where id in (9205071, 9205072, 9205073)),
  '9205071=100000/NULL,9205072=80000/NULL,9205073=100000/NULL');

-- ── Resultado ────────────────────────────────────────────────────────────
select n, caso, resultado from _r order by n;
select case when count(*) filter (where resultado <> 'OK') = 0
            then 'TODO OK (' || count(*) || ' casos)'
            else 'FALLAS: ' || count(*) filter (where resultado <> 'OK') || ' de ' || count(*) end as resumen
  from _r;

rollback;
