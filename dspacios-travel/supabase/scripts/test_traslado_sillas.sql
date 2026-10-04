-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBAS · migración 194 (traslado de cupos / mover pasajero / retiro /
-- estados manuales / contrato manual). SOLO base LOCAL o DESECHABLE.
-- Crea sus propios records, contratos y usuarios sintéticos y termina en
-- ROLLBACK: no deja nada. Se detiene en el primer fallo (ON_ERROR_STOP).
-- Uso: psql -v ON_ERROR_STOP=1 -f test_traslado_sillas.sql
-- Concurrencia (dos sesiones): supabase/scripts/test_traslado_concurrencia.sh
-- ───────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP 1
begin;

-- ── Ayudas de prueba (temporales) ──────────────────────────────────────────
create function pg_temp.ok(p boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p, false) then raise exception 'FALLO: %', p_msg; end if;
  raise notice 'OK   %', p_msg;
end $$;
-- Ejecuta p_sql y exige que falle con un mensaje que contenga p_patron.
create function pg_temp.falla(p_sql text, p_patron text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_patron in sqlerrm) > 0 then raise notice 'OK   % → «%»', p_msg, sqlerrm; return; end if;
    raise exception 'FALLO: % → error inesperado «%» (se esperaba «%»)', p_msg, sqlerrm, p_patron;
  end;
  raise exception 'FALLO: % → no falló (se esperaba «%»)', p_msg, p_patron;
end $$;
create function pg_temp.como(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true)
$$;
create temp table fx (k text primary key, id bigint);
create temp table res (k text primary key, r jsonb);
grant select, insert on res to public;
grant select on fx to public;
-- La 201 deja la matriz manual (DIR-1) a toda silla SIN contrato, tenga o no datos
-- de pasajero. Las aserciones de estados manuales se adaptan para que esta suite
-- siga valiendo antes y después de la 201.
create temp table v201 as select coalesce((select position('public._silla_con_datos(v_s)' in prosrc) = 0
  from pg_proc where oid = to_regprocedure('public.cambiar_estado_silla(bigint,text,text,boolean)')), false) as aplicada;
grant select on v201 to public;
create function pg_temp.fx(p text) returns bigint language sql stable as $$ select id from fx where k = p $$;
create function pg_temp.activas(p bigint) returns integer language sql stable as $$
  select count(*)::integer from public.sillas where bloqueo_id = p and estado::text not in ('cambio', 'retirada') $$;
create function pg_temp.cupos(p bigint) returns integer language sql stable as $$ select cupos_total from public.bloqueos_vuelo where id = p $$;
create function pg_temp.libres(p bigint) returns integer language sql stable as $$
  select count(*)::integer from public.sillas s where s.bloqueo_id = p and public._silla_libre(s) $$;

-- ── Usuarios sintéticos ────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'pf-super@local.test'),
  ('00000000-0000-0000-0000-00000000a002', 'pf-cv@local.test'),
  ('00000000-0000-0000-0000-00000000a003', 'pf-op-min@local.test'),
  ('00000000-0000-0000-0000-00000000a004', 'pf-venta@local.test'),
  ('00000000-0000-0000-0000-00000000a005', 'pf-cv-inactivo@local.test');
update public.usuarios set rol = 'superadmin',    tenant = 'mayorista', activo = true,  nombre = 'PF Super'    where id = '00000000-0000-0000-0000-00000000a001';
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true,  nombre = 'PF Control'  where id = '00000000-0000-0000-0000-00000000a002';
update public.usuarios set rol = 'operaciones',   tenant = 'minorista', activo = true,  nombre = 'PF Op Min'   where id = '00000000-0000-0000-0000-00000000a003';
update public.usuarios set rol = 'venta',         tenant = 'mayorista', activo = true,  nombre = 'PF Venta'    where id = '00000000-0000-0000-0000-00000000a004';
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = false, nombre = 'PF Inactivo' where id = '00000000-0000-0000-0000-00000000a005';

-- ── Records: Y y X (mismo destino/proveedor/tarifa, futuros) + variantes ───
insert into public.destinos (nombre) values ('PF DESTINO A'), ('PF DESTINO B');
insert into public.proveedores (nombre) values ('PF PROVEEDOR 1'), ('PF PROVEEDOR 2');
insert into fx select 'dA', id from public.destinos where nombre = 'PF DESTINO A';
insert into fx select 'dB', id from public.destinos where nombre = 'PF DESTINO B';
insert into fx select 'p1', id from public.proveedores where nombre = 'PF PROVEEDOR 1';
insert into fx select 'p2', id from public.proveedores where nombre = 'PF PROVEEDOR 2';

insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total, modalidad_emision) values
  ('PFY001', pg_temp.fx('dA'), pg_temp.fx('p1'), current_date + 30, 400000, 8, 'serie'),
  ('PFX001', pg_temp.fx('dA'), pg_temp.fx('p1'), current_date + 30, 400000, 8, 'serie'),
  ('PFZ001', pg_temp.fx('dA'), pg_temp.fx('p1'), current_date + 30, 400000, 2, 'serie'),
  ('PFOTRODEST', pg_temp.fx('dB'), pg_temp.fx('p1'), current_date + 30, 400000, 2, 'serie'),
  ('PFSALIDO', pg_temp.fx('dA'), pg_temp.fx('p1'), (now() at time zone 'America/Bogota')::date - 1, 400000, 2, 'serie'),
  ('PFOTROPROV', pg_temp.fx('dA'), pg_temp.fx('p2'), current_date + 30, 400000, 2, 'serie'),
  ('PFTARIFA', pg_temp.fx('dA'), pg_temp.fx('p1'), current_date + 30, 450000, 2, 'serie');
insert into fx select lower(substr(record, 3)), id from public.bloqueos_vuelo where record like 'PF%' and record not like 'PF_001'
  union all select 'Y', id from public.bloqueos_vuelo where record = 'PFY001'
  union all select 'X', id from public.bloqueos_vuelo where record = 'PFX001'
  union all select 'Z', id from public.bloqueos_vuelo where record = 'PFZ001';
-- Datos de vuelo de ida completos (D3-c exige número de vuelo y horas para reescribir un tramo de ida).
update public.bloqueos_vuelo set vuelo_ida = 'PF100', hora_salida_ida = '08:00', hora_llegada_ida = '10:00' where record like 'PF%';
-- sillas 1..cupos libres en cada record
insert into public.sillas (bloqueo_id, numero_silla, estado)
  select b.id, g, 'disponible' from public.bloqueos_vuelo b, generate_series(1, b.cupos_total) g where b.record like 'PF%';

-- Ventas: mayorista (DTM-9901, 1 silla en Y; DTM-9902, 2 sillas en Y; DTM-9903 repartido Y+Z),
-- minorista (MIN-00-0541 por manual "00-0541"; MIN-00-0777 orgánico), ambigua DTM-9904 / MIN-DTM-9904.
insert into public.ventas (numero_contrato, cliente, tenant, bloqueo_ref_id, costo_aereo) values
  ('DTM-9901', 'pf', 'mayorista', pg_temp.fx('Y'), 400000), ('DTM-9902', 'pf', 'mayorista', pg_temp.fx('Y'), 800000),
  ('DTM-9903', 'pf', 'mayorista', pg_temp.fx('Y'), 800000), ('MIN-00-0541', 'pf', 'minorista', null, 0),
  ('MIN-00-0777', 'pf', 'minorista', pg_temp.fx('Y'), 400000),
  ('DTM-9904', 'pf', 'mayorista', null, 0), ('MIN-DTM-9904', 'pf', 'minorista', null, 0);
insert into public.contrato_vuelos (numero_contrato, record, direccion) values ('DTM-9901', 'PFY001', 'ida');
-- Y: silla 1 confirmada DTM-9901; 2-3 DTM-9902; 4 DTM-9903 (+1 en Z); 5 manual externo; 6 manual "\t00-0541\n" (minorista);
--    7 MIN-00-0777; 8 manual ambiguo. Todas con pasajero.
update public.sillas set estado = 'confirmada', numero_contrato = 'DTM-9901', pasajero_nombres = 'ANA', numero_doc = '1' where bloqueo_id = pg_temp.fx('Y') and numero_silla = 1;
update public.sillas set estado = 'en_plazo', numero_contrato = 'DTM-9902', pasajero_nombres = 'BEA', numero_doc = '2', plazo = current_date + 5 where bloqueo_id = pg_temp.fx('Y') and numero_silla in (2, 3);
update public.sillas set estado = 'confirmada', numero_contrato = 'DTM-9903', pasajero_nombres = 'CAR', numero_doc = '3' where bloqueo_id = pg_temp.fx('Y') and numero_silla = 4;
update public.sillas set estado = 'confirmada', numero_contrato = 'DTM-9903', pasajero_nombres = 'CAR2', numero_doc = '33' where bloqueo_id = pg_temp.fx('Z') and numero_silla = 1;
update public.sillas set estado = 'confirmada', contrato_manual = 'EXT-777', pasajero_nombres = 'DAN', numero_doc = '4' where bloqueo_id = pg_temp.fx('Y') and numero_silla = 5;
update public.sillas set estado = 'confirmada', contrato_manual = chr(9) || '00-0541' || chr(10), pasajero_nombres = 'EVA', numero_doc = '5' where bloqueo_id = pg_temp.fx('Y') and numero_silla = 6;
update public.sillas set estado = 'confirmada', numero_contrato = 'MIN-00-0777', pasajero_nombres = 'FER', numero_doc = '6' where bloqueo_id = pg_temp.fx('Y') and numero_silla = 7;
update public.sillas set estado = 'confirmada', contrato_manual = 'DTM-9904', pasajero_nombres = 'GUS', numero_doc = '7' where bloqueo_id = pg_temp.fx('Y') and numero_silla = 8;
-- X: 3 ocupadas (contrato DTM-9902? no: pasajeros sueltos de carga masiva) + 5 libres.
update public.sillas set pasajero_nombres = 'X-PAX', numero_doc = '9' || numero_silla where bloqueo_id = pg_temp.fx('X') and numero_silla in (1, 2, 3);
-- Para el traslado: Y necesita cupos libres → se añaden 2 libres a Y (Y=10 cupos, 2 libres).
update public.bloqueos_vuelo set cupos_total = 10 where id = pg_temp.fx('Y');
insert into public.sillas (bloqueo_id, numero_silla, estado) values (pg_temp.fx('Y'), 9, 'disponible'), (pg_temp.fx('Y'), 10, 'disponible');
create temp table suma0 as select (select sum(cupos_total) from public.bloqueos_vuelo where record like 'PF%') as cupos,
  (select count(*) from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record like 'PF%' and s.estado::text not in ('cambio', 'retirada')) as activas;

select pg_temp.ok(pg_temp.cupos(pg_temp.fx('Y')) = 10 and pg_temp.activas(pg_temp.fx('Y')) = 10 and pg_temp.libres(pg_temp.fx('Y')) = 2, 'fixture Y: 10 cupos, 2 libres');
select pg_temp.ok(pg_temp.cupos(pg_temp.fx('X')) = 8 and pg_temp.libres(pg_temp.fx('X')) = 5, 'fixture X: 8 cupos, 5 libres');

-- ═══ Permisos (AUT-1) ═════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 1, null, gen_random_uuid())', pg_temp.fx('Y'), pg_temp.fx('X')), 'Sesión requerida', 'sin usuario (sin JWT) no opera');
select pg_temp.como('00000000-0000-0000-0000-00000000a004');
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 1, null, gen_random_uuid())', pg_temp.fx('Y'), pg_temp.fx('X')), 'Sin permiso para operar vuelos', 'rol venta no opera');
select pg_temp.como('00000000-0000-0000-0000-00000000a003');
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 1, null, gen_random_uuid())', pg_temp.fx('Y'), pg_temp.fx('X')), 'Sin permiso para operar vuelos', 'operaciones de MINORISTA no opera (AUT-1)');
select pg_temp.como('00000000-0000-0000-0000-00000000a005');
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 1, null, gen_random_uuid())', pg_temp.fx('Y'), pg_temp.fx('X')), 'Sin permiso para operar vuelos', 'usuario inactivo no opera');
reset role;
set local role anon;
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 1, null, gen_random_uuid())', pg_temp.fx('Y'), pg_temp.fx('X')), 'permission denied for function', 'anon no puede ejecutar la función');
reset role;

-- ═══ Tarea 2 · trasladar cupos libres ════════════════════════════════════
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 3, null, gen_random_uuid())', pg_temp.fx('Y'), pg_temp.fx('X')), 'solo tiene 2 cupo(s) libre(s)', 'pedir más cupos libres de los que hay');
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 1, null, gen_random_uuid())', pg_temp.fx('Y'), pg_temp.fx('otrodest')), 'tiene otro destino', 'destino distinto (D4)');
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 1, null, gen_random_uuid())', pg_temp.fx('Y'), pg_temp.fx('salido')), 'ya salió', 'record destino salido (D4)');
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 1, null, gen_random_uuid())', pg_temp.fx('Y'), pg_temp.fx('otroprov')), 'otro proveedor', 'proveedor distinto (D4b)');
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 1, null, gen_random_uuid())', pg_temp.fx('Y'), pg_temp.fx('Y')), 'distinto al de origen', 'origen = destino');
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 1, null, null)', pg_temp.fx('Y'), pg_temp.fx('X')), 'Falta el identificador', 'sin operacion_id');
select set_config('pf.op1', '11111111-1111-1111-1111-111111111111', true);
insert into res select 'r_tras', public.trasladar_cupos(pg_temp.fx('Y'), pg_temp.fx('X'), 2, 'prueba', '11111111-1111-1111-1111-111111111111') as r;
reset role;
select pg_temp.ok((select (r ->> 'movidas')::int = 2 and not (r ->> 'repetida')::boolean from res where k = 'r_tras'), 'traslado de 2 cupos libres Y→X');
select pg_temp.ok(pg_temp.cupos(pg_temp.fx('Y')) = 8 and pg_temp.cupos(pg_temp.fx('X')) = 10, 'cupos: Y 10→8, X 8→10');
select pg_temp.ok(pg_temp.activas(pg_temp.fx('Y')) = 8 and pg_temp.activas(pg_temp.fx('X')) = 10, 'sillas activas: Y 8, X 10 (se movieron, no se clonaron)');
select pg_temp.ok((select count(*) from public.sillas where bloqueo_id = pg_temp.fx('Y') and estado::text = 'cambio') = 0, 'sin filas fantasma cambio en Y');
select pg_temp.ok((select count(*) from public.movimientos_silla where operacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'traslado_cupo'
   and bloqueo_origen_id = pg_temp.fx('Y') and bloqueo_destino_id = pg_temp.fx('X') and registrado_por = 'PF Control'
   and registrado_por_id = '00000000-0000-0000-0000-00000000a002' and cupos_origen_antes = 10 and cupos_origen_despues = 8) = 2,
  'historial: 2 filas traslado_cupo con quién, origen, destino y cupos antes/después');
select pg_temp.ok((select array_agg(numero_silla order by numero_silla) from public.sillas where bloqueo_id = pg_temp.fx('X') and numero_silla > 8) = array[9, 10], 'numeración en X: 9 y 10');
select pg_temp.ok((select estado::text from public.sillas where bloqueo_id = pg_temp.fx('Y') and numero_silla = 1) = 'confirmada', 'la silla confirmada de Y no se tocó');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
insert into res select 'r_rep', public.trasladar_cupos(pg_temp.fx('Y'), pg_temp.fx('X'), 2, 'prueba', '11111111-1111-1111-1111-111111111111') as r;
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 1, null, %L)', pg_temp.fx('Y'), pg_temp.fx('X'), '11111111-1111-1111-1111-111111111111'), 'Operación inválida', 'mismo operacion_id con otros parámetros');
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 2, %L, %L)', pg_temp.fx('Y'), pg_temp.fx('X'), 'prueba', '11111111-1111-1111-1111-111111111111'), 'Operación inválida', 'mismo operacion_id con otro usuario');
reset role;
select pg_temp.ok((select (r ->> 'repetida')::boolean from res where k = 'r_rep') and pg_temp.cupos(pg_temp.fx('Y')) = 8 and pg_temp.cupos(pg_temp.fx('X')) = 10, 'reintento con el mismo operacion_id: repetida, no aplica dos veces');

-- ═══ Error a mitad de operación: todo se revierte ═════════════════════════
create function pg_temp.romper() returns trigger language plpgsql as $$ begin raise exception 'FALLO_FORZADO'; end $$;
create trigger pf_romper before insert on public.movimientos_silla for each row execute function pg_temp.romper();
insert into public.sillas (bloqueo_id, numero_silla, estado) values (pg_temp.fx('Y'), 11, 'disponible');
update public.bloqueos_vuelo set cupos_total = cupos_total + 1 where id = pg_temp.fx('Y');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 1, null, %L)', pg_temp.fx('Y'), pg_temp.fx('X'), '22222222-2222-2222-2222-222222222222'), 'FALLO_FORZADO', 'falla el insert del historial a mitad de operación');
reset role;
select pg_temp.ok(pg_temp.cupos(pg_temp.fx('Y')) = 9 and pg_temp.cupos(pg_temp.fx('X')) = 10 and pg_temp.libres(pg_temp.fx('Y')) = 1, 'tras el fallo: cupos y sillas intactos');
select pg_temp.ok(not exists (select 1 from public.operaciones_vuelo where operacion_id = '22222222-2222-2222-2222-222222222222'), 'tras el fallo: la operación tampoco quedó reservada');
drop trigger pf_romper on public.movimientos_silla;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
insert into res select 'r_retry', public.trasladar_cupos(pg_temp.fx('Y'), pg_temp.fx('X'), 1, null, '22222222-2222-2222-2222-222222222222') as r;
reset role;
select pg_temp.ok((select not (r ->> 'repetida')::boolean from res where k = 'r_retry') and pg_temp.cupos(pg_temp.fx('Y')) = 8 and pg_temp.cupos(pg_temp.fx('X')) = 11, 'reintento tras el fallo: se aplica una vez');

-- ═══ Tarea 3 · mover pasajero ════════════════════════════════════════════
create temp table s as select numero_silla as n, id from public.sillas where bloqueo_id = pg_temp.fx('Y');
grant select on s to public;
insert into fx select 'libreX', x.id from public.sillas x where x.bloqueo_id = pg_temp.fx('X') and public._silla_libre(x) limit 1;
create function pg_temp.sy(p int) returns bigint language sql stable as $$ select id from s where n = p $$;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, null, false, null, gen_random_uuid())', pg_temp.sy(1), pg_temp.fx('X')), 'Elige cómo recibirá', 'sin modo explícito no mueve');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.sy(1), pg_temp.fx('X'), 'auto'), 'Elige cómo recibirá', 'modo inválido no mueve');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.sy(1), pg_temp.fx('tarifa'), 'con_cupo'), 'TARIFA_DISTINTA', 'tarifa distinta sin aceptación (D4b)');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.sy(1), pg_temp.fx('otroprov'), 'con_cupo'), 'otro proveedor', 'proveedor distinto bloquea (D4b)');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('libreX'), pg_temp.fx('Y'), 'con_cupo'), 'La silla está libre', 'una silla libre (llamada directa) no se mueve');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.sy(4), pg_temp.fx('X'), 'con_cupo'), 'sillas en otro record', 'contrato ya repartido con un tercer record (D1)');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.sy(7), pg_temp.fx('X'), 'con_cupo'), 'Sin permiso sobre el contrato', 'control_vuelo de mayorista no mueve un contrato MINORISTA orgánico (AUT-1b)');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.sy(6), pg_temp.fx('X'), 'con_cupo'), 'Sin permiso sobre el contrato', 'ni uno MINORISTA escrito como manual "\t00-0541\n" (AUT-2 + trim)');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.sy(8), pg_temp.fx('X'), 'con_cupo'), 'más de un contrato', 'manual ambiguo falla cerrado');

-- Modo A · solo datos: DTM-9901 (1 silla) a una silla libre real de X.
insert into res select 'r_a', public.mover_pasajero(pg_temp.sy(1), pg_temp.fx('X'), 'solo_datos', false, 'cambio de fecha', '33333333-3333-3333-3333-333333333333') as r;
reset role;
select pg_temp.ok((select (r ->> 'movidas')::int = 1 and not (r ->> 'aviso_record_contrato')::boolean and (r ->> 'tramos_actualizados')::int = 1 from res where k = 'r_a'), 'modo A: 1 silla; D3-c actualizó el tramo del contrato (sin aviso pendiente)');
select pg_temp.ok(pg_temp.cupos(pg_temp.fx('Y')) = 8 and pg_temp.cupos(pg_temp.fx('X')) = 11, 'modo A: ningún cupo cambia');
select pg_temp.ok(pg_temp.activas(pg_temp.fx('Y')) = 8 and pg_temp.activas(pg_temp.fx('X')) = 11, 'modo A: ninguna silla se crea');
select pg_temp.ok((select count(*) from public.sillas where bloqueo_id = pg_temp.fx('X') and numero_contrato = 'DTM-9901' and pasajero_nombres = 'ANA' and estado::text = 'confirmada') = 1, 'modo A: el pasajero ocupa una silla libre de X con su contrato y estado');
select pg_temp.ok((select public._silla_libre(x) from public.sillas x where x.id = pg_temp.sy(1)), 'modo A: la silla de Y queda libre');
select pg_temp.ok((select bloqueo_ref_id from public.ventas where numero_contrato = 'DTM-9901') = pg_temp.fx('X'), 'modo A: ventas.bloqueo_ref_id pasa a X');
select pg_temp.ok((select record from public.contrato_vuelos where numero_contrato = 'DTM-9901') = 'PFX001', 'modo A: D3-c (orgánico, mismas fechas) pasa el PNR del contrato a X');
select pg_temp.ok((select count(*) from public.movimientos_silla where operacion_id = '33333333-3333-3333-3333-333333333333' and tipo = 'mover_datos'
   and silla_id = pg_temp.sy(1) and silla_destino_id is not null and numero_contrato = 'DTM-9901' and estado_silla = 'confirmada') = 1, 'modo A: historial mover_datos con silla destino y contrato');
select pg_temp.ok((select costo_aereo from public.ventas where numero_contrato = 'DTM-9901') = 400000, 'modo A: costo del contrato sin cambios');

-- Modo B · con cupo: DTM-9902 (2 sillas en Y) — viajan juntas (D1).
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
insert into res select 'r_b', public.mover_pasajero(pg_temp.sy(2), pg_temp.fx('X'), 'con_cupo', false, null, '44444444-4444-4444-4444-444444444444') as r;
reset role;
select pg_temp.ok((select (r ->> 'movidas')::int from res where k = 'r_b') = 2, 'modo B: las 2 sillas del contrato viajan juntas (D1)');
select pg_temp.ok(pg_temp.cupos(pg_temp.fx('Y')) = 6 and pg_temp.cupos(pg_temp.fx('X')) = 13, 'modo B: Y 8→6, X 11→13');
select pg_temp.ok(pg_temp.activas(pg_temp.fx('Y')) = 6 and pg_temp.activas(pg_temp.fx('X')) = 13, 'modo B: las filas se movieron (no se clonaron)');
select pg_temp.ok((select count(*) from public.sillas where id in (pg_temp.sy(2), pg_temp.sy(3)) and bloqueo_id = pg_temp.fx('X') and numero_contrato = 'DTM-9902' and estado::text = 'en_plazo' and plazo is not null) = 2, 'modo B: misma fila con contrato, estado y plazo');
select pg_temp.ok((select count(*) from public.movimientos_silla where operacion_id = '44444444-4444-4444-4444-444444444444' and tipo = 'mover_con_cupo' and cupos_origen_antes = 8 and cupos_origen_despues = 6 and cupos_destino_antes = 11 and cupos_destino_despues = 13) = 2, 'modo B: 2 filas de historial con cupos antes/después');

-- ═══ Reintento con el MISMO operacion_id tras una ejecución CONFIRMADA ═════
-- Simula la respuesta perdida: el cliente no supo que la primera llamada se
-- aplicó y la repite igual. Debe responder repetida = true y no mover nada.
-- (En dos sesiones con COMMIT real: test_traslado_concurrencia.sh, caso 5.)
create temp table antes_rep as select
  pg_temp.cupos(pg_temp.fx('Y')) as cy, pg_temp.cupos(pg_temp.fx('X')) as cx,
  pg_temp.activas(pg_temp.fx('Y')) as ay, pg_temp.activas(pg_temp.fx('X')) as ax,
  (select count(*) from public.movimientos_silla) as hist,
  (select count(*) from public.sillas) as filas,
  (select bloqueo_id || '|' || numero_silla from public.sillas where id = pg_temp.sy(2)) as pos2,
  (select bloqueo_id || '|' || numero_silla from public.sillas where id = pg_temp.sy(3)) as pos3,
  (select id from public.sillas where numero_contrato = 'DTM-9901' and pasajero_nombres = 'ANA') as destino_a;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
-- modo B: la silla YA está en X; antes de la corrección esto fallaba con "destino distinto al actual".
insert into res select 'r_b_rep', public.mover_pasajero(pg_temp.sy(2), pg_temp.fx('X'), 'con_cupo', false, null, '44444444-4444-4444-4444-444444444444');
insert into res select 'r_b_rep2', public.mover_pasajero(pg_temp.sy(2), pg_temp.fx('X'), 'con_cupo', false, null, '44444444-4444-4444-4444-444444444444');
-- modo A: el reintento puede traer otro motivo (no forma parte de la huella, IDEM-2).
insert into res select 'r_a_rep', public.mover_pasajero(pg_temp.sy(1), pg_temp.fx('X'), 'solo_datos', false, 'otro texto de motivo', '33333333-3333-3333-3333-333333333333');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, %L)', pg_temp.sy(2), pg_temp.fx('X'), 'solo_datos', '44444444-4444-4444-4444-444444444444'),
  'Operación inválida', 'mismo operacion_id con OTRO modo: se rechaza, no se aplica');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, true, null, %L)', pg_temp.sy(2), pg_temp.fx('X'), 'con_cupo', '44444444-4444-4444-4444-444444444444'),
  'Operación inválida', 'mismo operacion_id con otra aceptación de tarifa: se rechaza');
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, %L)', pg_temp.sy(2), pg_temp.fx('X'), 'con_cupo', '44444444-4444-4444-4444-444444444444'),
  'Operación inválida', 'mismo operacion_id desde OTRO usuario: se rechaza');
reset role;
select pg_temp.ok((select (r ->> 'repetida')::boolean and (r ->> 'movidas')::int = 2 from res where k = 'r_b_rep')
  and (select (r ->> 'repetida')::boolean from res where k = 'r_b_rep2'),
  'modo B: reintentos tras la ejecución confirmada → repetida = true (movidas informa las 2 originales)');
select pg_temp.ok((select (r ->> 'repetida')::boolean and (r ->> 'movidas')::int = 1 from res where k = 'r_a_rep'),
  'modo A: reintento tras la ejecución confirmada → repetida = true');
select pg_temp.ok(
  (select cy from antes_rep) = pg_temp.cupos(pg_temp.fx('Y')) and (select cx from antes_rep) = pg_temp.cupos(pg_temp.fx('X'))
  and (select ay from antes_rep) = pg_temp.activas(pg_temp.fx('Y')) and (select ax from antes_rep) = pg_temp.activas(pg_temp.fx('X')),
  'reintentos: ningún cupo ni silla activa cambió');
select pg_temp.ok((select hist from antes_rep) = (select count(*) from public.movimientos_silla)
  and (select filas from antes_rep) = (select count(*) from public.sillas),
  'reintentos: ni historial nuevo ni filas nuevas');
select pg_temp.ok((select pos2 from antes_rep) = (select bloqueo_id || '|' || numero_silla from public.sillas where id = pg_temp.sy(2))
  and (select pos3 from antes_rep) = (select bloqueo_id || '|' || numero_silla from public.sillas where id = pg_temp.sy(3)),
  'reintentos: las sillas del modo B no se renumeraron ni se movieron otra vez');
select pg_temp.ok((select count(*) from public.sillas where numero_contrato = 'DTM-9901' and pasajero_nombres = 'ANA') = 1
  and (select id from public.sillas where numero_contrato = 'DTM-9901' and pasajero_nombres = 'ANA') = (select destino_a from antes_rep)
  and (select public._silla_libre(x) from public.sillas x where x.id = pg_temp.sy(1)),
  'reintentos: el pasajero del modo A sigue en la misma silla de X, sin duplicarse, y la de Y sigue libre');

-- Modo B con contrato manual externo: conserva contrato_manual.
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
insert into res select 'r_m', public.mover_pasajero(pg_temp.sy(5), pg_temp.fx('X'), 'con_cupo', false, null, gen_random_uuid()) as r;
reset role;
select pg_temp.ok((select contrato_manual from public.sillas where id = pg_temp.sy(5)) = 'EXT-777' and (select bloqueo_id from public.sillas where id = pg_temp.sy(5)) = pg_temp.fx('X'), 'manual externo: viaja con su contrato_manual');
select pg_temp.ok((select contrato_manual_clase from public.movimientos_silla where silla_id = pg_temp.sy(5) and tipo = 'mover_con_cupo') = 'externo', 'manual externo: historial guarda la clase');

-- Superadmin sí mueve los contratos minoristas (AUT-1b), incluido el manual con tab/salto.
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
insert into res select 'r_min', public.mover_pasajero(pg_temp.sy(6), pg_temp.fx('X'), 'con_cupo', false, null, gen_random_uuid()) as r;
reset role;
select pg_temp.ok((select contrato_manual_clase || '|' || contrato_manual_resuelto from public.movimientos_silla where silla_id = pg_temp.sy(6) and tipo = 'mover_con_cupo') = 'interno|MIN-00-0541', 'superadmin mueve el manual minorista; historial: interno MIN-00-0541');

-- Tarifa distinta aceptada: se mueve, avisa, no recalcula.
update public.bloqueos_vuelo set tarifa_neta = 450000 where id = pg_temp.fx('Z');
update public.sillas set estado = 'disponible', numero_contrato = null, pasajero_nombres = null, numero_doc = null where bloqueo_id = pg_temp.fx('Z') and numero_contrato = 'DTM-9903';
update public.sillas set numero_contrato = null, pasajero_nombres = 'CAR', contrato_manual = null where id = pg_temp.sy(4);
update public.sillas set numero_contrato = 'DTM-9903' where id = pg_temp.sy(4);
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
insert into res select 'r_t', public.mover_pasajero(pg_temp.sy(4), pg_temp.fx('Z'), 'solo_datos', true, null, gen_random_uuid()) as r;
reset role;
select pg_temp.ok((select (r ->> 'aviso_tarifa_distinta')::boolean from res where k = 'r_t') and (select costo_aereo from public.ventas where numero_contrato = 'DTM-9903') = 800000, 'tarifa distinta aceptada: mueve, avisa y no recalcula importes');

-- Modo A sin cupo libre en destino: rechaza y no pasa a modo B.
update public.sillas set pasajero_nombres = 'LLENO' where bloqueo_id = pg_temp.fx('Z') and public._silla_libre(sillas);
insert into public.sillas (bloqueo_id, numero_silla, estado, numero_contrato, pasajero_nombres) values (pg_temp.fx('Y'), 12, 'confirmada', 'DTM-9901', 'ANA2');
update public.bloqueos_vuelo set cupos_total = cupos_total + 1 where id = pg_temp.fx('Y');
update public.ventas set bloqueo_ref_id = pg_temp.fx('Y') where numero_contrato = 'DTM-9901';
update public.contrato_vuelos set record = 'PFY001' where numero_contrato = 'DTM-9901';  -- el contrato vuelve a estar en Y
update public.sillas set numero_contrato = null, estado = 'disponible', pasajero_nombres = null, numero_doc = null where numero_contrato = 'DTM-9901' and bloqueo_id = pg_temp.fx('X');
create temp table antes_z as select pg_temp.cupos(pg_temp.fx('Y')) as y, pg_temp.cupos(pg_temp.fx('Z')) as z;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, true, null, gen_random_uuid())', (select id from public.sillas where bloqueo_id = pg_temp.fx('Y') and numero_silla = 12), pg_temp.fx('Z'), 'solo_datos'), 'no tiene cupo libre suficiente', 'modo A sin cupo libre en destino');
reset role;
select pg_temp.ok((select y from antes_z) = pg_temp.cupos(pg_temp.fx('Y')) and (select z from antes_z) = pg_temp.cupos(pg_temp.fx('Z')), 'modo A rechazado: no cambió a modo B por su cuenta');

-- ═══ Retiro de cupo (D8) ════════════════════════════════════════════════
create temp table libre_y as select id from public.sillas s where s.bloqueo_id = pg_temp.fx('Y') and public._silla_libre(s) order by numero_silla limit 1;
grant select on libre_y to public;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.falla(format('select public.retirar_cupo(%s, null, gen_random_uuid())', (select id from public.sillas where bloqueo_id = pg_temp.fx('Y') and numero_silla = 12)), 'Solo se puede retirar un cupo libre', 'no se retira una silla ocupada');
insert into res select 'r_ret', public.retirar_cupo((select id from libre_y), 'devolución de bloque', '55555555-5555-5555-5555-555555555555') as r;
insert into res select 'r_ret2', public.retirar_cupo((select id from libre_y), 'devolución de bloque', '55555555-5555-5555-5555-555555555555') as r;
reset role;
select pg_temp.ok((select estado::text from public.sillas where id = (select id from libre_y)) = 'retirada', 'retiro: la fila queda retirada (no se borra)');
select pg_temp.ok((select (r ->> 'cupos_despues')::int from res where k = 'r_ret') = (select (r ->> 'cupos_antes')::int from res where k = 'r_ret') - 1 and pg_temp.cupos(pg_temp.fx('Y')) = (select (r ->> 'cupos_despues')::int from res where k = 'r_ret'), 'retiro: cupos_total − 1');
select pg_temp.ok((select (r ->> 'repetida')::boolean from res where k = 'r_ret2'), 'retiro: reintento con el mismo operacion_id → repetida');
select pg_temp.ok((select count(*) from public.movimientos_silla where silla_id = (select id from libre_y) and tipo = 'retiro_cupo' and bloqueo_destino_id is null) = 1, 'retiro: una fila de historial');
select pg_temp.ok(pg_temp.activas(pg_temp.fx('Y')) = pg_temp.cupos(pg_temp.fx('Y')), 'retiro: la retirada no cuenta como activa (activas = cupos_total)');

-- ═══ Estados manuales (DIR-1) ═══════════════════════════════════════════
create temp table e as select id from public.sillas s where s.bloqueo_id = pg_temp.fx('X') and public._silla_libre(s) order by numero_silla limit 2;
grant select on e to public;
create function pg_temp.e(p int) returns bigint language sql stable as $$ select id from e order by id offset p - 1 limit 1 $$;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.falla(format('select public.cambiar_estado_silla(%s, %L, %L, false)', pg_temp.e(1), 'no_vendida', ' '), 'motivo', 'sin motivo no cambia');
select public.cambiar_estado_silla(pg_temp.e(1), 'no_vendida', 'cierre de vuelo', false);
select pg_temp.falla(format('select public.cambiar_estado_silla(%s, %L, %L, false)', pg_temp.e(1), 'devuelta', 'x'), 'devolución real', 'no vendida → devuelta exige confirmar devolución real');
select public.cambiar_estado_silla(pg_temp.e(1), 'devuelta', 'devuelta a la aerolínea', true);
select pg_temp.falla(format('select public.cambiar_estado_silla(%s, %L, %L, false)', pg_temp.e(1), 'disponible', 'x'), 'definitiva', 'devuelta → disponible prohibido');
select pg_temp.falla(format('select public.cambiar_estado_silla(%s, %L, %L, false)', pg_temp.e(1), 'no_vendida', 'x'), 'definitiva', 'devuelta → no vendida prohibido');
select pg_temp.falla(format('select public.cambiar_estado_silla(%s, %L, %L, false)', pg_temp.e(2), 'confirmada', 'x'), 'no se hace a mano', 'disponible → confirmada no es manual');
select pg_temp.falla(format('select public.cambiar_estado_silla(%s, %L, %L, false)', pg_temp.sy(2), 'disponible', 'x'), 'tiene contrato', 'silla con contrato: no hay cambio manual');
select pg_temp.falla(format('select public.liberar_silla(%s)', pg_temp.e(1)), 'no se puede liberar', 'liberar no revive una devuelta');
reset role;
insert into fx select 'parcial', x.id from public.sillas x where x.bloqueo_id = pg_temp.fx('X') and public._silla_libre(x) and x.id not in (select id from e) order by x.numero_silla limit 1;
update public.sillas set tipo_doc = 'CC' where id = pg_temp.fx('parcial');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select case when (select aplicada from v201)
  then pg_temp.ok((public.cambiar_estado_silla(pg_temp.fx('parcial'), 'no_vendida', 'x', false) ->> 'hacia') = 'no_vendida', '201: silla sin contrato con solo tipo de documento recibe la matriz manual')
  else pg_temp.falla(format('select public.cambiar_estado_silla(%s, %L, %L, false)', pg_temp.fx('parcial'), 'no_vendida', 'x'), 'tiene contrato o pasajero', 'silla con solo tipo de documento: tampoco es libre para el cambio manual') end;
select case when (select aplicada from v201)
  then pg_temp.ok((public.cambiar_estado_silla(pg_temp.fx('parcial'), 'disponible', 'correccion', false) ->> 'hacia') = 'disponible'
                  and (select tipo_doc from public.sillas where id = pg_temp.fx('parcial')) = 'CC', '201: y vuelve a disponible conservando el dato') end;
reset role;
update public.sillas set tipo_doc = null where id = pg_temp.fx('parcial');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select public.cambiar_estado_silla(pg_temp.e(2), 'no_vendida', 'cierre', false);
select public.cambiar_estado_silla(pg_temp.e(2), 'disponible', 'error de marcado', false);
reset role;
select pg_temp.ok((select estado::text from public.sillas where id = pg_temp.e(1)) = 'devuelta' and (select estado::text from public.sillas where id = pg_temp.e(2)) = 'disponible', 'DIR-1: devuelta definitiva; no vendida → disponible permitido');
select pg_temp.ok((select count(*) from public.bloqueo_cambios where bloqueo_id = pg_temp.fx('X') and nota is not null and detalle like 'Silla %') = 4 + case when (select aplicada from v201) then 2 else 0 end, 'DIR-1: cada cambio deja motivo en bloqueo_cambios');

-- ═══ Contrato manual / liberar / editar (AUT-2, DIR-2) ═══════════════════
create temp table m as select id from public.sillas s where s.bloqueo_id = pg_temp.fx('X') and public._silla_libre(s) order by numero_silla limit 3;
grant select on m to public;
create function pg_temp.m(p int) returns bigint language sql stable as $$ select id from m order by id offset p - 1 limit 1 $$;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.falla(format('select public.asignar_contrato_manual(%s, %L)', pg_temp.m(1), chr(9) || '00-0541' || chr(10)), 'Sin permiso sobre el contrato', 'asignar un manual que resuelve a MINORISTA: denegado a control_vuelo');
select pg_temp.falla(format('select public.asignar_contrato_manual(%s, %L)', pg_temp.m(1), '00-' || chr(9) || '0541'), 'no admitidos', 'tab interno: no admitida');
select public.asignar_contrato_manual(pg_temp.m(1), '  EXT-900  ');
select pg_temp.falla(format('select public.editar_pasajero_silla(%s, %L::jsonb)', pg_temp.sy(7), '{"pasajero_nombres":"X"}'), 'Sin permiso sobre el contrato', 'editar datos de un contrato MINORISTA: denegado (DIR-2)');
select pg_temp.falla(format('select public.liberar_silla(%s)', pg_temp.sy(7)), 'Sin permiso sobre el contrato', 'liberar una silla de contrato MINORISTA: denegado (DIR-2)');
-- 201: sin contrato, el pasajero queda como retención en plazo y exige la fecha de plazo.
select public.editar_pasajero_silla(pg_temp.m(2), (case when (select aplicada from v201)
  then '{"pasajero_nombres":"NUEVO","nacimiento":"1990-02-03","plazo":"2099-12-31"}'
  else '{"pasajero_nombres":"NUEVO","nacimiento":"1990-02-03"}' end)::jsonb);
select pg_temp.falla(format('select public.editar_pasajero_silla(%s, %L::jsonb)', pg_temp.m(2), '{"nacimiento":"03/02/1990"}'), 'Fecha de nacimiento inválida', 'fecha inválida');
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select public.asignar_contrato_manual(pg_temp.m(3), chr(9) || '00-0541' || chr(10));
reset role;
select pg_temp.ok((select contrato_manual from public.sillas where id = pg_temp.m(1)) = 'EXT-900' and (select estado::text from public.sillas where id = pg_temp.m(1)) = 'confirmada', 'manual externo asignado recortado y confirmado');
select pg_temp.ok((select contrato_manual from public.sillas where id = pg_temp.m(3)) = '00-0541', 'superadmin asigna el manual minorista, guardado sin tab ni salto');
select pg_temp.ok((select pasajero_nombres || '|' || nacimiento from public.sillas where id = pg_temp.m(2)) = 'NUEVO|1990-02-03', 'editar datos de una silla sin contrato');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select public.liberar_silla(pg_temp.m(1));
reset role;
select pg_temp.ok((select public._silla_libre(x) from public.sillas x where x.id = pg_temp.m(1)), 'liberar silla con manual: queda libre y sin contrato_manual');

set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.falla(format('select public.quitar_contrato_manual(%s)', pg_temp.m(3)), 'Sin permiso sobre el contrato', 'quitar un manual que resuelve a MINORISTA: denegado a control_vuelo');
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select public.quitar_contrato_manual(pg_temp.m(3));
reset role;
select pg_temp.ok((select contrato_manual is null and estado::text = 'disponible' from public.sillas where id = pg_temp.m(3)), 'superadmin quita el manual minorista: silla disponible');


-- ═══ D3-c (aprobada 2026-10-01) ═══════════════════════════════════════════
-- Camino ORGÁNICO (silla con numero_contrato): mismas fechas de ida y regreso
-- obligatorias; los tramos del contrato que apuntan a Y pasan a X en la misma
-- transacción; se bloquea si no quedan coherentes.
-- Camino MANUAL (contrato_manual, aunque resuelva a una venta): sin exigir
-- fechas, sin tocar ventas ni contrato_vuelos; autorización de siempre.
-- Records PD*: fuera del conteo PF* del invariante final.
insert into public.bloqueos_vuelo (record, aerolinea, ruta, destino_id, proveedor_id, fecha_ida, fecha_regreso,
  vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg, tarifa_neta, cupos_total)
select v.r, v.aero, v.ruta, pg_temp.fx('dA'), pg_temp.fx('p1'), (now() at time zone 'America/Bogota')::date + v.di,
       (now() at time zone 'America/Bogota')::date + v.dr, v.vi, v.vr, v.hsi::time, v.hli::time, v.hsr::time, v.hlr::time, 400000, 8
  from (values
    ('PDY1', 'AVIANCA', 'BOG-ADZ', 60, 64, 'AV101', 'AV102', '06:00', '07:55', '18:10', '20:05'),
    ('PDX1', 'AVIANCA', 'BOG-ADZ', 60, 64, 'AV301', 'AV302', '10:30', '12:25', '14:40', '16:35'),  -- mismas fechas
    ('PDF1', 'AVIANCA', 'BOG-ADZ', 67, 71, 'AV501', 'AV502', '09:00', '10:55', '12:00', '13:55'),  -- OTRAS fechas
    ('PDR1', 'AVIANCA', 'MDE-ADZ', 60, 64, 'AV701', 'AV702', '08:00', '09:30', '15:00', '16:30'),  -- otra ruta
    ('PDA1', 'LATAM',   'BOG-ADZ', 60, 64, 'LA901', 'LA902', '07:00', '08:55', '19:00', '20:55')   -- otra aerolínea
  ) v(r, aero, ruta, di, dr, vi, vr, hsi, hli, hsr, hlr);
insert into fx select lower(record), id from public.bloqueos_vuelo where record like 'PD_1';
insert into public.sillas (bloqueo_id, numero_silla, estado)
  select b.id, g, 'disponible' from public.bloqueos_vuelo b, generate_series(1, 8) g where b.record like 'PD_1';

-- Contratos orgánicos (mayorista). bloqueo_ref_id = PDY1 salvo DTM-9986.
insert into public.ventas (numero_contrato, cliente, tenant, bloqueo_ref_id, costo_aereo, fecha_salida, fecha_regreso)
select n, 'pf', 'mayorista', case when n = 'DTM-9986' then pg_temp.fx('pda1') else pg_temp.fx('pdy1') end, 800000,
       (now() at time zone 'America/Bogota')::date + 60, (now() at time zone 'America/Bogota')::date + 64
  from unnest(array['DTM-9981','DTM-9982','DTM-9983','DTM-9984','DTM-9985','DTM-9986','DTM-9987','DTM-9988','DTM-9989']) n;
-- Venta minorista que una referencia MANUAL resuelve (00-0900 → MIN-00-0900).
insert into public.ventas (numero_contrato, cliente, tenant, bloqueo_ref_id, costo_aereo)
values ('MIN-00-0900', 'pf', 'minorista', pg_temp.fx('pdy1'), 400000), ('MIN-00-0901', 'pf', 'minorista', pg_temp.fx('pdy1'), 400000);
-- Tramos: 9981 ida+regreso de PDY1 + un tramo de OTRO record (no se toca);
-- 9982 fila heredada ida+regreso en una sola fila; 9983 solo tramos de otro
-- record; 9984 tramo de PDY1 sin dirección; 9985/9986 ida+regreso de PDY1;
-- 9987 sin tramos; 9988/9989 y MIN-00-0900/0901 (solo los usan sillas
-- MANUALES, que están en PDX1: sus tramos apuntan a PDX1).
insert into public.contrato_vuelos (numero_contrato, aerolinea, record, direccion, numero_vuelo, hora_salida, hora_llegada, fecha_salida, orden)
select c, 'AVIANCA', case when c in ('DTM-9988', 'DTM-9989') or c like 'MIN-%' then 'PDX1' else 'PDY1' end, d, case d when 'ida' then 'AV101' else 'AV102' end, case d when 'ida' then '06:00:00' else '18:10:00' end,
       case d when 'ida' then '07:55:00' else '20:05:00' end,
       (now() at time zone 'America/Bogota')::date + case d when 'ida' then 60 else 64 end, case d when 'ida' then 0 else 1 end
  from unnest(array['DTM-9981','DTM-9985','DTM-9986','DTM-9988','DTM-9989','MIN-00-0900','MIN-00-0901']) c, unnest(array['ida','regreso']) d;
insert into public.contrato_vuelos (numero_contrato, aerolinea, record, direccion, numero_vuelo, orden)
values ('DTM-9981', 'AVIANCA', 'CONEX9', 'ida', 'AV999', 2),
       ('DTM-9983', 'AVIANCA', 'ZZZ999', 'ida', 'AV111', 0),
       ('DTM-9984', 'AVIANCA', 'PDY1', null, 'AV101', 0);
insert into public.contrato_vuelos (numero_contrato, aerolinea, record, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida,
  hora_salida_reg, hora_llegada_reg, fecha_salida, fecha_regreso, orden)
values ('DTM-9982', 'AVIANCA', 'PDY1', 'AV101', 'AV102', '06:00:00', '07:55:00', '18:10:00', '20:05:00',
        (now() at time zone 'America/Bogota')::date + 60, (now() at time zone 'America/Bogota')::date + 64, 0);
-- Sillas en PDY1: 1-2 DTM-9981, 3 DTM-9982, 4 DTM-9983, 5 DTM-9984, 6 DTM-9985, 7 DTM-9986, 8 DTM-9987.
update public.sillas s set estado = 'confirmada', pasajero_nombres = 'P' || s.numero_silla, numero_doc = 'D' || s.numero_silla,
  numero_contrato = (array['DTM-9981','DTM-9981','DTM-9982','DTM-9983','DTM-9984','DTM-9985','DTM-9986','DTM-9987'])[s.numero_silla]
 where s.bloqueo_id = pg_temp.fx('pdy1');
-- Sillas MANUALES en PDX1 (mismas fechas que PDY1), cada una con su propia
-- venta (D1 movería juntas las que comparten referencia): 1 externo, 2-3
-- resuelven a minoristas (MIN-00-0900/0901), 4-5 a mayoristas (DTM-9988/9989).
update public.sillas s set estado = 'confirmada', pasajero_nombres = 'M' || s.numero_silla, numero_doc = 'MD' || s.numero_silla,
  contrato_manual = (array['EXT-D3C', '00-0900', '00-0901', 'DTM-9988', 'DTM-9989'])[s.numero_silla]
 where s.bloqueo_id = pg_temp.fx('pdx1') and s.numero_silla <= 5;
insert into fx select 'c' || substr(numero_contrato, 5), min(id) from public.sillas where numero_contrato like 'DTM-998%' and numero_contrato <> 'DTM-9989' group by numero_contrato;
insert into fx select 'm' || numero_silla, id from public.sillas where bloqueo_id = pg_temp.fx('pdx1') and numero_silla <= 5;
create temp table d3c_antes as select
  (select md5(string_agg(cv::text, '|' order by cv.id)) from public.contrato_vuelos cv where cv.numero_contrato in ('MIN-00-0900', 'MIN-00-0901', 'DTM-9988', 'DTM-9989')) as cv_manual,
  (select md5(string_agg(v::text, '|' order by v.numero_contrato)) from public.ventas v where v.numero_contrato in ('MIN-00-0900', 'MIN-00-0901', 'DTM-9988', 'DTM-9989')) as v_manual,
  (select string_agg(b.record || '=' || b.cupos_total, ',' order by b.record) from public.bloqueos_vuelo b where b.record like 'PD_1') as cupos0;
grant select on d3c_antes to public;
create function pg_temp.cupos_pd() returns text language sql stable as $$
  select string_agg(b.record || '=' || b.cupos_total, ',' order by b.record) from public.bloqueos_vuelo b where b.record like 'PD_1' $$;
create function pg_temp.tramos(p text) returns text language sql stable as $$
  select string_agg(coalesce(direccion, '-') || ':' || record || ':' || coalesce(numero_vuelo, vuelo_ida || '/' || vuelo_regreso, '')
                    || ':' || coalesce(hora_salida, hora_salida_ida || '/' || hora_salida_reg, ''), ' ' order by orden, id)
    from public.contrato_vuelos where numero_contrato = p $$;

-- ── Camino ORGÁNICO: fechas distintas se rechazan en AMBOS modos ──────────
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('c9981'), pg_temp.fx('pdf1'), 'con_cupo'),
  'mismas fechas de ida y regreso', 'D3-c orgánico + con_cupo a otras fechas: rechazado');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('c9982'), pg_temp.fx('pdf1'), 'solo_datos'),
  'mismas fechas de ida y regreso', 'D3-c orgánico + solo_datos a otras fechas: rechazado');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('c9983'), pg_temp.fx('pdx1'), 'con_cupo'),
  'Ningún tramo del vuelo del contrato', 'D3-c: tramos solo de otro record → no se sabe qué actualizar, se bloquea');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('c9984'), pg_temp.fx('pdx1'), 'solo_datos'),
  'sin dirección de ida o regreso', 'D3-c: tramo de Y sin dirección → ambiguo, se bloquea');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('c9985'), pg_temp.fx('pdr1'), 'con_cupo'),
  'otra ruta', 'D3-c: X con otra ruta → el vuelo no quedaría coherente, se bloquea');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('c9985'), pg_temp.fx('pda1'), 'solo_datos'),
  'otra aerolínea', 'D3-c: X con otra aerolínea → se bloquea');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('c9986'), pg_temp.fx('pdx1'), 'con_cupo'),
  'vinculado a otro record', 'D3-c: venta vinculada a un tercer record → se bloquea');
reset role;
select pg_temp.ok(pg_temp.cupos_pd() = (select cupos0 from d3c_antes)
  and (select count(*) from public.sillas where bloqueo_id = pg_temp.fx('pdy1') and numero_contrato like 'DTM-998%') = 8
  and pg_temp.tramos('DTM-9981') = 'ida:PDY1:AV101:06:00:00 regreso:PDY1:AV102:18:10:00 ida:CONEX9:AV999:'
  and not exists (select 1 from public.movimientos_silla m where m.numero_contrato like 'DTM-998%'),
  'D3-c: los rechazos no cambiaron cupos, sillas, tramos ni historial');

-- ── Camino ORGÁNICO, modo con_cupo, mismas fechas: tramos actualizados ────
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
insert into res select 'd3c_b', public.mover_pasajero(pg_temp.fx('c9981'), pg_temp.fx('pdx1'), 'con_cupo', false, null, 'd3c00000-0000-0000-0000-000000000001');
insert into res select 'd3c_b_rep', public.mover_pasajero(pg_temp.fx('c9981'), pg_temp.fx('pdx1'), 'con_cupo', false, null, 'd3c00000-0000-0000-0000-000000000001');
reset role;
select pg_temp.ok((select (r ->> 'movidas')::int = 2 and (r ->> 'tramos_actualizados')::int = 2 and not (r ->> 'aviso_record_contrato')::boolean
                     and not (r ->> 'contrato_manual')::boolean from res where k = 'd3c_b'),
  'D3-c orgánico + con_cupo: 2 sillas, 2 tramos actualizados, sin aviso pendiente');
select pg_temp.ok(pg_temp.tramos('DTM-9981') = 'ida:PDX1:AV301:10:30:00 regreso:PDX1:AV302:14:40:00 ida:CONEX9:AV999:',
  'D3-c orgánico + con_cupo: ida y regreso con PNR, vuelo y hora de X; el tramo de OTRO record intacto');
select pg_temp.ok((select bloqueo_ref_id from public.ventas where numero_contrato = 'DTM-9981') = pg_temp.fx('pdx1')
  and (select fecha_salida from public.ventas where numero_contrato = 'DTM-9981') = (select fecha_ida from public.bloqueos_vuelo where id = pg_temp.fx('pdx1'))
  and (select costo_aereo from public.ventas where numero_contrato = 'DTM-9981') = 800000
  and (select count(*) from public.sillas where numero_contrato = 'DTM-9981' and bloqueo_id = pg_temp.fx('pdx1')) = 2,
  'D3-c orgánico + con_cupo: sillas y vínculo en X; fechas coherentes; importes sin cambios');
select pg_temp.ok((select count(*) from public.movimientos_silla where operacion_id = 'd3c00000-0000-0000-0000-000000000001' and tramos_contrato_actualizados = 2) = 2,
  'D3-c: el historial registra cuántos tramos se actualizaron');
select pg_temp.ok((select (r ->> 'repetida')::boolean from res where k = 'd3c_b_rep')
  and pg_temp.tramos('DTM-9981') = 'ida:PDX1:AV301:10:30:00 regreso:PDX1:AV302:14:40:00 ida:CONEX9:AV999:',
  'D3-c: reintento con el mismo operacion_id → repetida, tramos sin tocar otra vez');

-- ── Camino ORGÁNICO, modo solo_datos, mismas fechas: fila heredada ida+regreso ──
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
insert into res select 'd3c_a', public.mover_pasajero(pg_temp.fx('c9982'), pg_temp.fx('pdx1'), 'solo_datos', false, null, gen_random_uuid());
insert into res select 'd3c_a0', public.mover_pasajero(pg_temp.fx('c9987'), pg_temp.fx('pdx1'), 'solo_datos', false, null, gen_random_uuid());
reset role;
select pg_temp.ok((select (r ->> 'tramos_actualizados')::int = 1 and not (r ->> 'aviso_record_contrato')::boolean from res where k = 'd3c_a')
  and pg_temp.tramos('DTM-9982') = '-:PDX1:AV301/AV302:10:30:00/14:40:00',
  'D3-c orgánico + solo_datos: la fila heredada ida+regreso pasa a X (PNR, vuelos y horas)');
select pg_temp.ok((select count(*) from public.sillas where numero_contrato = 'DTM-9982' and bloqueo_id = pg_temp.fx('pdx1')) = 1
  and (select bloqueo_ref_id from public.ventas where numero_contrato = 'DTM-9982') = pg_temp.fx('pdx1')
  and pg_temp.cupos_pd() like 'PDA1=8,PDF1=8,PDR1=8,PDX1=10,PDY1=6',
  'D3-c orgánico + solo_datos: ocupa un libre de X, vínculo en X, cupos sin cambio en este modo');
select pg_temp.ok((select (r ->> 'tramos_actualizados')::int = 0 and not (r ->> 'aviso_record_contrato')::boolean from res where k = 'd3c_a0')
  and pg_temp.tramos('DTM-9987') is null,
  'D3-c orgánico sin tramos: se mueve y no hay nada que reescribir');

-- ── Camino MANUAL: sin exigir fechas, sin tocar ventas ni contrato_vuelos ──
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
-- Autorización de siempre: control_vuelo no toca un manual que resuelve a MINORISTA, ni a otras fechas.
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('m2'), pg_temp.fx('pdf1'), 'con_cupo'),
  'Sin permiso sobre el contrato', 'manual que resuelve a minorista: la autorización sigue aplicando (control_vuelo denegado)');
insert into res select 'man_ext_b', public.mover_pasajero(pg_temp.fx('m1'), pg_temp.fx('pdf1'), 'con_cupo', false, null, gen_random_uuid());
insert into res select 'man_may_a', public.mover_pasajero(pg_temp.fx('m4'), pg_temp.fx('pdf1'), 'solo_datos', false, null, gen_random_uuid());
insert into res select 'man_may_b', public.mover_pasajero(pg_temp.fx('m5'), pg_temp.fx('pdf1'), 'con_cupo', false, null, gen_random_uuid());
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
insert into res select 'man_min_b', public.mover_pasajero(pg_temp.fx('m2'), pg_temp.fx('pdf1'), 'con_cupo', false, null, gen_random_uuid());
insert into res select 'man_min_a', public.mover_pasajero(pg_temp.fx('m3'), pg_temp.fx('pdf1'), 'solo_datos', false, null, gen_random_uuid());
reset role;
select pg_temp.ok((select bool_and((r ->> 'ok')::boolean and (r ->> 'contrato_manual')::boolean and (r ->> 'tramos_actualizados')::int = 0)
                     from res where k in ('man_ext_b', 'man_may_a', 'man_may_b', 'man_min_b', 'man_min_a')),
  'manual (externo, resuelto a mayorista y a minorista) en ambos modos: se mueve a OTRAS fechas sin reescribir tramos');
select pg_temp.ok((select count(*) from public.sillas where bloqueo_id = pg_temp.fx('pdf1') and contrato_manual in ('EXT-D3C', '00-0900', '00-0901', 'DTM-9988', 'DTM-9989')) = 5
  and not exists (select 1 from public.sillas where bloqueo_id = pg_temp.fx('pdx1') and contrato_manual in ('EXT-D3C', '00-0900', '00-0901', 'DTM-9988', 'DTM-9989')),
  'manual: las 5 sillas llegaron a PDF1 conservando su referencia manual tal cual');
select pg_temp.ok((select md5(string_agg(cv::text, '|' order by cv.id)) from public.contrato_vuelos cv where cv.numero_contrato in ('MIN-00-0900', 'MIN-00-0901', 'DTM-9988', 'DTM-9989')) = (select cv_manual from d3c_antes)
  and (select md5(string_agg(v::text, '|' order by v.numero_contrato)) from public.ventas v where v.numero_contrato in ('MIN-00-0900', 'MIN-00-0901', 'DTM-9988', 'DTM-9989')) = (select v_manual from d3c_antes),
  'manual: ventas y contrato_vuelos de las ventas resueltas quedaron EXACTAMENTE iguales');
select pg_temp.ok((select (r ->> 'aviso_record_contrato')::boolean from res where k = 'man_may_b')
  and (select (r ->> 'aviso_record_contrato')::boolean from res where k = 'man_min_b')
  and not (select (r ->> 'aviso_record_contrato')::boolean from res where k = 'man_ext_b'),
  'manual resuelto a una venta: solo se avisa (sus tramos siguen en el record anterior); externo: sin aviso');
select pg_temp.ok((select count(*) from public.movimientos_silla m where m.contrato_manual in ('EXT-D3C', '00-0900', '00-0901', 'DTM-9988', 'DTM-9989')
                    and m.tramos_contrato_actualizados is null and m.numero_contrato is null) = 5,
  'manual: historial con la referencia manual y sin tramos actualizados');
select pg_temp.ok(not exists (select 1 from public.bloqueos_vuelo b where b.record like 'PD_1' and b.cupos_total <> pg_temp.activas(b.id))
  and (select sum(cupos_total) from public.bloqueos_vuelo where record like 'PD_1') = 40,
  'D3-c: en los records PD*, cupos_total = sillas activas y la suma no cambió (5 × 8)');


-- ═══ Bordes de D3-c ════════════════════════════════════════════════════════
-- (1) Venta orgánica con bloqueo_ref_id NULL: se vincula a X (compatible con
--     ventas_origen_excluyente_check); si tiene empaquetado_ref_id, se rechaza
--     ANTES de mover. Nunca termina con éxito dejando el vínculo nulo, y el
--     UPDATE de ventas se comprueba.
-- (2) Antes de reescribir un tramo, X debe tener número de vuelo y horas de
--     esa dirección; si falta algo, falla cerrado sin borrar datos.
-- Records PD_2: fuera del conteo PF* y del conteo PD_1 anteriores.
insert into public.bloqueos_vuelo (record, aerolinea, ruta, destino_id, proveedor_id, fecha_ida, fecha_regreso,
  vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg, tarifa_neta, cupos_total)
select v.r, 'AVIANCA', 'BOG-ADZ', pg_temp.fx('dA'), pg_temp.fx('p1'), (now() at time zone 'America/Bogota')::date + 60,
       (now() at time zone 'America/Bogota')::date + 64, v.vi, v.vr, v.hsi::time, v.hli::time, v.hsr::time, v.hlr::time, 400000, v.n
  from (values
    ('PDY2', 'AV121', 'AV122', '06:00', '07:55', '18:10', '20:05', 12),
    ('PDX2', 'AV321', 'AV322', '10:30', '12:25', '14:40', '16:35', 8),
    ('PDN2', 'AV421', null,    '09:00', '10:55', null,    null,    8),   -- sin vuelo de regreso
    ('PDH2', 'AV521', 'AV522', '07:30', null,    '15:00', '16:55', 8)    -- ida sin hora de llegada
  ) v(r, vi, vr, hsi, hli, hsr, hlr, n);
insert into fx select lower(record), id from public.bloqueos_vuelo where record like 'PD_2';
insert into public.sillas (bloqueo_id, numero_silla, estado)
  select b.id, g, 'disponible' from public.bloqueos_vuelo b, generate_series(1, b.cupos_total) g where b.record like 'PD_2';
insert into public.empaquetados (fecha_ida) values ((now() at time zone 'America/Bogota')::date + 60);
insert into fx select 'emp', max(id) from public.empaquetados;

-- Ventas orgánicas (mayorista). Vínculo: NULL en 9991/9992/9993/9998/9999; PDY2 en el resto.
insert into public.ventas (numero_contrato, cliente, tenant, bloqueo_ref_id, empaquetado_ref_id, costo_aereo)
select n, 'pf', 'mayorista',
       case when n in ('DTM-9991','DTM-9992','DTM-9993','DTM-9998','DTM-9999') then null else pg_temp.fx('pdy2') end,
       case when n = 'DTM-9993' then pg_temp.fx('emp') end, 800000
  from unnest(array['DTM-9991','DTM-9992','DTM-9993','DTM-9994','DTM-9995','DTM-9996','DTM-9997','DTM-9998','DTM-9999']) n;
-- Ventas a las que apuntan sillas MANUALES (vínculo NULL, tramos de PDY2): no deben recibir estas reglas.
insert into public.ventas (numero_contrato, cliente, tenant, bloqueo_ref_id, costo_aereo)
values ('DTM-9979', 'pf', 'mayorista', null, 400000), ('DTM-9980', 'pf', 'mayorista', null, 400000);
-- Tramos (filas nuevas): ida+regreso de PDY2 para 9991, 9993, 9994, 9998, 9999, 9979, 9980; solo ida para 9995.
insert into public.contrato_vuelos (numero_contrato, aerolinea, record, direccion, numero_vuelo, hora_salida, hora_llegada, fecha_salida, orden)
select c, 'AVIANCA', 'PDY2', d, case d when 'ida' then 'AV121' else 'AV122' end,
       case d when 'ida' then '06:00:00' else '18:10:00' end, case d when 'ida' then '07:55:00' else '20:05:00' end,
       (now() at time zone 'America/Bogota')::date + case d when 'ida' then 60 else 64 end, case d when 'ida' then 0 else 1 end
  from unnest(array['DTM-9991','DTM-9993','DTM-9994','DTM-9998','DTM-9999','DTM-9979','DTM-9980']) c, unnest(array['ida','regreso']) d
union all
select 'DTM-9995', 'AVIANCA', 'PDY2', 'ida', 'AV121', '06:00:00', '07:55:00', (now() at time zone 'America/Bogota')::date + 60, 0;
-- Filas heredadas ida+regreso en una sola fila: 9996 solo con ida, 9997 con ida y regreso.
insert into public.contrato_vuelos (numero_contrato, aerolinea, record, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida,
  hora_salida_reg, hora_llegada_reg, fecha_salida, fecha_regreso, orden)
values ('DTM-9996', 'AVIANCA', 'PDY2', 'AV121', null, '06:00:00', '07:55:00', null, null, (now() at time zone 'America/Bogota')::date + 60, null, 0),
       ('DTM-9997', 'AVIANCA', 'PDY2', 'AV121', 'AV122', '06:00:00', '07:55:00', '18:10:00', '20:05:00',
        (now() at time zone 'America/Bogota')::date + 60, (now() at time zone 'America/Bogota')::date + 64, 0);
-- Sillas en PDY2: 1..9 orgánicas DTM-9991..9999; 10 y 11 manuales (DTM-9980, DTM-9979); 12 libre.
update public.sillas s set estado = 'confirmada', pasajero_nombres = 'B' || s.numero_silla, numero_doc = 'BD' || s.numero_silla,
  numero_contrato = case when s.numero_silla <= 9 then 'DTM-999' || s.numero_silla end,
  contrato_manual = case s.numero_silla when 10 then 'DTM-9980' when 11 then 'DTM-9979' end
 where s.bloqueo_id = pg_temp.fx('pdy2') and s.numero_silla <= 11;
insert into fx select 'b' || numero_silla, id from public.sillas where bloqueo_id = pg_temp.fx('pdy2') and numero_silla <= 11;
create temp table bordes_antes as select
  (select string_agg(b.record || '=' || b.cupos_total, ',' order by b.record) from public.bloqueos_vuelo b where b.record like 'PD_2') as cupos,
  (select md5(string_agg(cv::text, '|' order by cv.id)) from public.contrato_vuelos cv where cv.numero_contrato in ('DTM-9993','DTM-9994','DTM-9997')) as cv_rech,
  (select md5(string_agg(v::text, '|' order by v.numero_contrato)) from public.ventas v where v.numero_contrato in ('DTM-9993','DTM-9994','DTM-9997')) as v_rech,
  (select md5(string_agg(cv::text, '|' order by cv.id)) from public.contrato_vuelos cv where cv.numero_contrato in ('DTM-9979','DTM-9980')) as cv_man,
  (select md5(string_agg(v::text, '|' order by v.numero_contrato)) from public.ventas v where v.numero_contrato in ('DTM-9979','DTM-9980')) as v_man;
grant select on bordes_antes to public;
create function pg_temp.cupos_pd2() returns text language sql stable as $$
  select string_agg(b.record || '=' || b.cupos_total, ',' order by b.record) from public.bloqueos_vuelo b where b.record like 'PD_2' $$;

-- ── (1) Vínculo NULL ─────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('b3'), pg_temp.fx('pdx2'), 'con_cupo'),
  'ligado a un empaquetado', 'vínculo NULL + empaquetado_ref_id, con_cupo: rechazado antes de mover');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('b3'), pg_temp.fx('pdx2'), 'solo_datos'),
  'ligado a un empaquetado', 'vínculo NULL + empaquetado_ref_id, solo_datos: rechazado antes de mover');
insert into res select 'nul_b', public.mover_pasajero(pg_temp.fx('b1'), pg_temp.fx('pdx2'), 'con_cupo', false, null, gen_random_uuid());
insert into res select 'nul_a', public.mover_pasajero(pg_temp.fx('b2'), pg_temp.fx('pdx2'), 'solo_datos', false, null, gen_random_uuid());
reset role;
select pg_temp.ok((select bloqueo_ref_id from public.ventas where numero_contrato = 'DTM-9991') = pg_temp.fx('pdx2')
  and (select (r ->> 'vinculo_anterior') is null and (r ->> 'tramos_actualizados')::int = 2 from res where k = 'nul_b'),
  'vínculo NULL + con_cupo: la venta queda vinculada a X (no nula) y sus tramos pasan a X');
select pg_temp.ok((select bloqueo_ref_id from public.ventas where numero_contrato = 'DTM-9992') = pg_temp.fx('pdx2')
  and (select (r ->> 'vinculo_anterior') is null and (r ->> 'tramos_actualizados')::int = 0 from res where k = 'nul_a'),
  'vínculo NULL + solo_datos (sin tramos): la venta queda vinculada a X');
select pg_temp.ok((select bloqueo_ref_id is null and empaquetado_ref_id = pg_temp.fx('emp') from public.ventas where numero_contrato = 'DTM-9993')
  and (select bloqueo_id from public.sillas where id = pg_temp.fx('b3')) = pg_temp.fx('pdy2'),
  'empaquetado: venta, silla y vínculo intactos tras el rechazo');

-- ── (2) X sin número de vuelo u horas de la dirección a reescribir ────────
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('b4'), pg_temp.fx('pdn2'), 'con_cupo'),
  'no tiene completo el vuelo de regreso', 'tramo de regreso + X sin vuelo de regreso, con_cupo: falla cerrado');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('b4'), pg_temp.fx('pdh2'), 'solo_datos'),
  'no tiene completo el vuelo de ida', 'tramo de ida + X sin hora de llegada de ida, solo_datos: falla cerrado');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('b7'), pg_temp.fx('pdn2'), 'solo_datos'),
  'no tiene completo el vuelo de regreso', 'fila heredada con regreso + X sin vuelo de regreso: falla cerrado');
reset role;
select pg_temp.ok(
  (select md5(string_agg(cv::text, '|' order by cv.id)) from public.contrato_vuelos cv where cv.numero_contrato in ('DTM-9993','DTM-9994','DTM-9997')) = (select cv_rech from bordes_antes)
  and (select md5(string_agg(v::text, '|' order by v.numero_contrato)) from public.ventas v where v.numero_contrato in ('DTM-9993','DTM-9994','DTM-9997')) = (select v_rech from bordes_antes)
  and (select count(*) from public.sillas where bloqueo_id = pg_temp.fx('pdy2') and numero_contrato in ('DTM-9993','DTM-9994','DTM-9997')) = 3
  and not exists (select 1 from public.movimientos_silla where numero_contrato in ('DTM-9993','DTM-9994','DTM-9997')),
  'rechazos por datos incompletos: tramos y ventas idénticos (nada borrado), sillas en Y, sin historial');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
insert into res select 'solo_ida', public.mover_pasajero(pg_temp.fx('b5'), pg_temp.fx('pdn2'), 'con_cupo', false, null, gen_random_uuid());
insert into res select 'leg_ida', public.mover_pasajero(pg_temp.fx('b6'), pg_temp.fx('pdn2'), 'solo_datos', false, null, gen_random_uuid());
reset role;
select pg_temp.ok((select (r ->> 'tramos_actualizados')::int from res where k = 'solo_ida') = 1
  and (select record || '|' || numero_vuelo || '|' || hora_salida || '|' || hora_llegada from public.contrato_vuelos where numero_contrato = 'DTM-9995') = 'PDN2|AV421|09:00:00|10:55:00',
  'solo tramo de ida: X sin regreso basta; la ida pasa a X (con_cupo)');
select pg_temp.ok((select (r ->> 'tramos_actualizados')::int from res where k = 'leg_ida') = 1
  and (select record || '|' || vuelo_ida || '|' || hora_salida_ida || '|' || hora_llegada_ida || '|' || coalesce(vuelo_regreso, '∅') || '|' || coalesce(hora_salida_reg, '∅')
         from public.contrato_vuelos where numero_contrato = 'DTM-9996') = 'PDN2|AV421|09:00:00|10:55:00|∅|∅',
  'fila heredada solo de ida (solo_datos): se reescribe la ida; el regreso no se toca');

-- ── Rollback: falla a mitad, ya escrito el vínculo de ventas ─────────────
create function pg_temp.romper_tramos() returns trigger language plpgsql as $$
begin if new.numero_contrato = 'DTM-9998' then raise exception 'FALLO_FORZADO_TRAMOS'; end if; return new; end $$;
create trigger pf_romper_tramos before update on public.contrato_vuelos for each row execute function pg_temp.romper_tramos();
create temp table rb_antes as select pg_temp.cupos_pd2() as cupos,
  (select count(*) from public.movimientos_silla) as hist;
grant select on rb_antes to public;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, %L)', pg_temp.fx('b8'), pg_temp.fx('pdx2'), 'con_cupo', 'b0d0e000-0000-0000-0000-000000000008'),
  'FALLO_FORZADO_TRAMOS', 'falla al reescribir tramos (después de vincular ventas y mover sillas)');
reset role;
select pg_temp.ok((select bloqueo_ref_id from public.ventas where numero_contrato = 'DTM-9998') is null
  and (select bloqueo_id from public.sillas where id = pg_temp.fx('b8')) = pg_temp.fx('pdy2')
  and pg_temp.cupos_pd2() = (select cupos from rb_antes) and (select count(*) from public.movimientos_silla) = (select hist from rb_antes)
  and (select string_agg(record, ',' order by orden) from public.contrato_vuelos where numero_contrato = 'DTM-9998') = 'PDY2,PDY2'
  and not exists (select 1 from public.operaciones_vuelo where operacion_id = 'b0d0e000-0000-0000-0000-000000000008'),
  'rollback: vínculo vuelve a NULL, silla en Y, cupos, tramos, historial y operación sin cambios');
drop trigger pf_romper_tramos on public.contrato_vuelos;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
insert into res select 'rb_retry', public.mover_pasajero(pg_temp.fx('b8'), pg_temp.fx('pdx2'), 'con_cupo', false, null, 'b0d0e000-0000-0000-0000-000000000008');
reset role;
select pg_temp.ok((select not (r ->> 'repetida')::boolean from res where k = 'rb_retry')
  and (select bloqueo_ref_id from public.ventas where numero_contrato = 'DTM-9998') = pg_temp.fx('pdx2'),
  'rollback: el reintento con la misma operación se aplica una sola vez y vincula a X');

-- UPDATE de ventas que no afecta la fila (simulado con un trigger que la salta): falla cerrado.
create function pg_temp.saltar_venta() returns trigger language plpgsql as $$
begin if new.numero_contrato = 'DTM-9999' and new.bloqueo_ref_id is distinct from old.bloqueo_ref_id then return null; end if; return new; end $$;
create trigger pf_saltar_venta before update on public.ventas for each row execute function pg_temp.saltar_venta();
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('b9'), pg_temp.fx('pdx2'), 'solo_datos'),
  'No se pudo vincular el contrato DTM-9999', 'UPDATE de ventas sin efecto: se detecta y no se devuelve éxito');
reset role;
drop trigger pf_saltar_venta on public.ventas;
select pg_temp.ok((select bloqueo_ref_id from public.ventas where numero_contrato = 'DTM-9999') is null
  and (select bloqueo_id from public.sillas where id = pg_temp.fx('b9')) = pg_temp.fx('pdy2')
  and (select numero_contrato from public.sillas where id = pg_temp.fx('b9')) = 'DTM-9999'
  and (select string_agg(record, ',' order by orden) from public.contrato_vuelos where numero_contrato = 'DTM-9999') = 'PDY2,PDY2',
  'UPDATE de ventas sin efecto: todo revertido (silla con su pasajero en Y, tramos en Y)');

-- ── Contrato MANUAL: no recibe estas reglas ───────────────────────────────
-- Sus ventas tienen vínculo NULL y tramos de PDY2; los destinos tienen datos de vuelo incompletos.
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
insert into res select 'man_nb', public.mover_pasajero(pg_temp.fx('b10'), pg_temp.fx('pdn2'), 'con_cupo', false, null, gen_random_uuid());
insert into res select 'man_na', public.mover_pasajero(pg_temp.fx('b11'), pg_temp.fx('pdh2'), 'solo_datos', false, null, gen_random_uuid());
reset role;
select pg_temp.ok((select bool_and((r ->> 'ok')::boolean and (r ->> 'contrato_manual')::boolean and (r ->> 'tramos_actualizados')::int = 0
                                   and (r ->> 'vinculo_anterior') is null) from res where k in ('man_nb', 'man_na')),
  'manual (ambos modos) hacia X con vuelo incompleto: permitido, sin reescribir tramos ni vincular');
select pg_temp.ok(
  (select md5(string_agg(cv::text, '|' order by cv.id)) from public.contrato_vuelos cv where cv.numero_contrato in ('DTM-9979','DTM-9980')) = (select cv_man from bordes_antes)
  and (select md5(string_agg(v::text, '|' order by v.numero_contrato)) from public.ventas v where v.numero_contrato in ('DTM-9979','DTM-9980')) = (select v_man from bordes_antes)
  and (select contrato_manual from public.sillas where id = pg_temp.fx('b10')) = 'DTM-9980'
  and exists (select 1 from public.sillas where bloqueo_id = pg_temp.fx('pdh2') and contrato_manual = 'DTM-9979'),
  'manual: ventas (vínculo sigue NULL) y contrato_vuelos idénticos; referencia manual conservada');
select pg_temp.ok(not exists (select 1 from public.bloqueos_vuelo b where b.record like 'PD_2' and b.cupos_total <> pg_temp.activas(b.id))
  and (select sum(cupos_total) from public.bloqueos_vuelo where record like 'PD_2') = 36,
  'bordes: cupos_total = sillas activas en PD_2 y la suma no cambió (12 + 3 × 8)');


-- ═══ Destino por fecha (Bogotá): ayer se rechaza, hoy y mañana se aceptan ═
-- Llamando las RPC directamente (sin la interfaz). Records QD* fuera de los
-- conteos PF*/PD* de este archivo.
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total)
select v.r, pg_temp.fx('dA'), pg_temp.fx('p1'), (now() at time zone 'America/Bogota')::date + v.d, 400000, 4
  from (values ('QDY', 5), ('QDA', -1), ('QDH', 0), ('QDM', 1)) v(r, d);
insert into fx select lower(record), id from public.bloqueos_vuelo where record in ('QDY', 'QDA', 'QDH', 'QDM');
insert into public.sillas (bloqueo_id, numero_silla, estado)
  select b.id, g, 'disponible' from public.bloqueos_vuelo b, generate_series(1, 4) g where b.record in ('QDY', 'QDA', 'QDH', 'QDM');
update public.sillas set pasajero_nombres = 'CARGA', numero_doc = '777'
 where bloqueo_id = pg_temp.fx('qdy') and numero_silla in (3, 4);   -- pasajeros de carga masiva, sin contrato
insert into fx select 'qd3', id from public.sillas where bloqueo_id = pg_temp.fx('qdy') and numero_silla = 3;
insert into fx select 'qd4', id from public.sillas where bloqueo_id = pg_temp.fx('qdy') and numero_silla = 4;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.falla(format('select public.trasladar_cupos(%s, %s, 1, null, gen_random_uuid())', pg_temp.fx('qdy'), pg_temp.fx('qda')), 'ya salió',
  'trasladar a un record de AYER (Bogotá): rechazado');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('qd3'), pg_temp.fx('qda'), 'solo_datos'), 'ya salió',
  'mover (solo datos) a un record de AYER: rechazado');
select pg_temp.falla(format('select public.mover_pasajero(%s, %s, %L, false, null, gen_random_uuid())', pg_temp.fx('qd3'), pg_temp.fx('qda'), 'con_cupo'), 'ya salió',
  'mover (con cupo) a un record de AYER: rechazado');
insert into res select 'qd_t_hoy', public.trasladar_cupos(pg_temp.fx('qdy'), pg_temp.fx('qdh'), 1, null, gen_random_uuid());
insert into res select 'qd_t_man', public.trasladar_cupos(pg_temp.fx('qdy'), pg_temp.fx('qdm'), 1, null, gen_random_uuid());
insert into res select 'qd_m_hoy', public.mover_pasajero(pg_temp.fx('qd3'), pg_temp.fx('qdh'), 'solo_datos', false, null, gen_random_uuid());
insert into res select 'qd_m_man', public.mover_pasajero(pg_temp.fx('qd4'), pg_temp.fx('qdm'), 'con_cupo', false, null, gen_random_uuid());
reset role;
select pg_temp.ok((select bool_and((r ->> 'ok')::boolean) from res where k in ('qd_t_hoy', 'qd_t_man', 'qd_m_hoy', 'qd_m_man')),
  'trasladar y mover (ambos modos) a records de HOY y de MAÑANA: aceptados');
select pg_temp.ok(pg_temp.cupos(pg_temp.fx('qda')) = 4 and pg_temp.activas(pg_temp.fx('qda')) = 4
  and not exists (select 1 from public.movimientos_silla where pg_temp.fx('qda') in (bloqueo_origen_id, bloqueo_destino_id)),
  'el record de ayer quedó intacto: sin cupos nuevos ni historial');

-- ═══ Invariante global ═══════════════════════════════════════════════════
-- Ninguna operación aumentó la suma de cupos ni de sillas activas: solo el
-- retiro las bajó en 1, y los ajustes de fixture (+2 en total) están contados.
select pg_temp.ok(
  (select sum(cupos_total) from public.bloqueos_vuelo where record like 'PF%') = (select cupos from suma0) + 1 + 1 - 1,
  'suma de cupos: solo cambió por los ajustes de fixture (+2) y el retiro (−1)');
select pg_temp.ok(
  (select count(*) from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record like 'PF%' and s.estado::text not in ('cambio', 'retirada'))
  = (select activas from suma0) + 1 + 1 - 1,
  'suma de sillas activas: igual criterio; el historial no cuenta como silla');
select pg_temp.ok(not exists (select 1 from public.bloqueos_vuelo b where b.record like 'PF%' and b.cupos_total <> pg_temp.activas(b.id)),
  'en TODOS los records de prueba: cupos_total = sillas activas (sin sillas de más)');
select pg_temp.ok((select count(*) from public.movimientos_silla m where pg_temp.fx('Y') in (m.bloqueo_origen_id, m.bloqueo_destino_id)) >= 7
  and (select count(*) from public.movimientos_silla m where pg_temp.fx('X') in (m.bloqueo_origen_id, m.bloqueo_destino_id)) >= 6,
  'el historial es visible desde Y y desde X, y (prueba anterior) no se suma a los cupos activos');

rollback;
\echo 'TODAS LAS PRUEBAS PASARON (y se revirtieron)'
