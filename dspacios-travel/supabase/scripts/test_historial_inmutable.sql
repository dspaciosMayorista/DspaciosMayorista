-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBAS · migración 200 (fase E: historial de vuelos inmutable). SOLO base
-- LOCAL o DESECHABLE, con 192, 194–197 y 200 aplicadas (con o sin la 199).
-- Crea usuarios, records y contratos sintéticos y termina en ROLLBACK.
--
-- `movimientos_silla` y `operaciones_vuelo` se prueban POR SEPARADO, y cada
-- comando también (UPDATE, DELETE con WHERE, DELETE SIN WHERE, TRUNCATE,
-- INSERT), para authenticated (varios roles), anon y service_role:
--   1. capa de privilegio: revocado → "permission denied";
--   2. capa de trigger: con privilegios y policies abiertas CONCEDIDOS dentro de
--      la transacción, el trigger rechaza igual ('HISTORIAL_INMUTABLE'), aunque
--      el rol active la bandera de mantenimiento;
--   3. el dueño (postgres) tampoco edita ni borra;
--   4. salida de mantenimiento (solo dueño + bandera) y su auditoría;
--   5. excepción acotada de mover_pasajero (tramos_contrato_actualizados);
--   6. las funciones siguen insertando historial y operando (trasladar, mover
--      en los dos modos con D3-c, retirar, reintento idempotente, crear y
--      eliminar record), y un fallo a mitad no deja historial suelto.
-- Uso: psql -v ON_ERROR_STOP=1 -f test_historial_inmutable.sql
-- ───────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP 1
begin;

create function pg_temp.ok(p boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p, false) then raise exception 'FALLO: %', p_msg; end if;
  raise notice 'OK   %', p_msg;
end $$;
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
create temp table usr (k text primary key, id uuid);
create temp table fx (k text primary key, id bigint);
create temp table ops (k text primary key, id uuid);
create temp table res (k text primary key, r jsonb);
grant select on usr, fx, ops to public;
grant select, insert on res to public;
create function pg_temp.fx(p text) returns bigint language sql stable as $$ select id from fx where k = p $$;
create function pg_temp.op(p text) returns uuid language sql stable as $$ select id from ops where k = p $$;
create function pg_temp.ser(p text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.correccion_historial', '', true);
  if p = 'anon' then
    set local role anon;
  elsif p = 'service_role' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role;
  elsif p <> 'postgres' then
    perform pg_temp.como((select id from usr where k = p));
    set local role authenticated;
  end if;
end $$;
create function pg_temp.n_mov() returns bigint language sql stable as $$ select count(*) from public.movimientos_silla $$;
create function pg_temp.n_ops() returns bigint language sql stable as $$ select count(*) from public.operaciones_vuelo $$;

-- ── Precondición y catálogo ────────────────────────────────────────────────
select pg_temp.ok(to_regprocedure('public._historial_vuelos_inmutable()') is not null, 'la 200 está aplicada');
select pg_temp.ok((select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                    where not t.tgisinternal and t.tgenabled = 'O' and not p.prosecdef
                      and t.tgname in ('movimientos_historial_inmutable', 'operaciones_historial_inmutable',
                                       'movimientos_historial_sin_truncate', 'operaciones_historial_sin_truncate')) = 4,
  'catálogo: 4 triggers habilitados (INVOKER)');
select pg_temp.ok((select bool_and((t.tgtype & 3) = 3 and (t.tgtype & 28) = 28) from pg_trigger t
                    where t.tgname in ('movimientos_historial_inmutable', 'operaciones_historial_inmutable'))
  and (select bool_and((t.tgtype & 2) = 2 and (t.tgtype & 32) = 32 and (t.tgtype & 1) = 0) from pg_trigger t
        where t.tgname in ('movimientos_historial_sin_truncate', 'operaciones_historial_sin_truncate')),
  'catálogo: BEFORE por fila en INSERT/UPDATE/DELETE y BEFORE TRUNCATE por sentencia');
select pg_temp.ok(not exists (
    select 1 from unnest(array['authenticated', 'anon', 'service_role']) r, unnest(array['public.movimientos_silla', 'public.operaciones_vuelo']) t,
                  unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
     where has_table_privilege(r, t, p)),
  'privilegios: authenticated, anon y service_role sin INSERT/UPDATE/DELETE/TRUNCATE en las dos tablas');
select pg_temp.ok((select count(*) from pg_policies where schemaname = 'public' and tablename in ('movimientos_silla', 'operaciones_vuelo') and cmd <> 'SELECT') = 0
  and exists (select 1 from pg_policies where tablename = 'movimientos_silla' and policyname = 'movimientos: lectura vuelos' and cmd = 'SELECT'),
  'policies: solo lectura en las dos tablas');

-- ── Usuarios, records, contrato ────────────────────────────────────────────
insert into usr values
  ('sup',   '00000000-0000-0000-0000-000000e20001'),
  ('cv',    '00000000-0000-0000-0000-000000e20002'),
  ('venta', '00000000-0000-0000-0000-000000e20003'),
  ('opmin', '00000000-0000-0000-0000-000000e20004');
insert into auth.users (id, email) select id, 'e200-' || k || '@local.test' from usr;
update public.usuarios u set rol = v.rol::public.rol_usuario, tenant = v.tenant, activo = true, nombre = 'E200 ' || v.k
  from (values ('sup', 'superadmin', 'mayorista'), ('cv', 'control_vuelo', 'mayorista'),
               ('venta', 'venta', 'mayorista'), ('opmin', 'operaciones', 'minorista')) v(k, rol, tenant)
 where u.id = (select id from usr where usr.k = v.k);
insert into public.destinos (nombre) values ('E200 DESTINO');
insert into public.proveedores (nombre) values ('E200 PROVEEDOR');
insert into fx select 'd', id from public.destinos where nombre = 'E200 DESTINO';
insert into fx select 'p', id from public.proveedores where nombre = 'E200 PROVEEDOR';
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total, modalidad_emision,
                                   vuelo_ida, hora_salida_ida, hora_llegada_ida) values
  ('EHY001', pg_temp.fx('d'), pg_temp.fx('p'), current_date + 50, 250000, 6, 'serie', 'EH100', '07:00', '09:00'),
  ('EHX001', pg_temp.fx('d'), pg_temp.fx('p'), current_date + 50, 250000, 4, 'serie', 'EH200', '13:00', '15:00');
insert into fx select 'Y', id from public.bloqueos_vuelo where record = 'EHY001';
insert into fx select 'X', id from public.bloqueos_vuelo where record = 'EHX001';
insert into public.sillas (bloqueo_id, numero_silla, estado)
  select pg_temp.fx('Y'), g, 'disponible'::public.estado_silla from generate_series(1, 6) g
  union all select pg_temp.fx('X'), g, 'disponible'::public.estado_silla from generate_series(1, 4) g;
insert into public.ventas (numero_contrato, cliente, tenant, estado, financiero_estado, bloqueo_ref_id) values
  ('DTM-9701', 'e200', 'mayorista', 'confirmado', 'completo', pg_temp.fx('Y'));
update public.sillas set estado = 'confirmada', numero_contrato = 'DTM-9701', pasajero_nombres = 'HUGO', numero_doc = '701'
 where bloqueo_id = pg_temp.fx('Y') and numero_silla = 1;
insert into public.contrato_vuelos (numero_contrato, record, direccion, numero_vuelo, hora_salida, hora_llegada)
  values ('DTM-9701', 'EHY001', 'ida', 'EH100', '07:00', '09:00');
create temp table sid as select b.record as rec, s.numero_silla as n, s.id
  from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record in ('EHY001', 'EHX001');
grant select on sid to public;
create function pg_temp.silla(p_rec text, p_n integer) returns bigint language sql stable as $$
  select id from sid where rec = p_rec and n = p_n $$;

-- ═══ 6a. Las funciones insertan historial (sesión de control_vuelo) ════════
insert into ops values ('t1', gen_random_uuid()), ('r1', gen_random_uuid()), ('m1', gen_random_uuid()), ('m2', gen_random_uuid());
select pg_temp.ser('cv');
insert into res select 't1', public.trasladar_cupos(pg_temp.fx('Y'), pg_temp.fx('X'), 2, 'e200 traslado', pg_temp.op('t1'));
insert into res select 't1bis', public.trasladar_cupos(pg_temp.fx('Y'), pg_temp.fx('X'), 2, 'e200 traslado', pg_temp.op('t1'));
insert into res select 'r1', public.retirar_cupo(pg_temp.silla('EHY001', 6), 'e200 retiro', pg_temp.op('r1'));
select pg_temp.ser('postgres');
select pg_temp.ok((select count(*) from public.movimientos_silla where operacion_id = pg_temp.op('t1') and tipo = 'traslado_cupo') = 2
  and (select count(*) from public.movimientos_silla where operacion_id = pg_temp.op('r1') and tipo = 'retiro_cupo') = 1
  and (select count(*) from public.operaciones_vuelo where operacion_id in (pg_temp.op('t1'), pg_temp.op('r1'))) = 2,
  'trasladar_cupos y retirar_cupo insertan historial y operación con la 200 activa');
select pg_temp.ok((select (r->>'repetida')::boolean from res where k = 't1bis')
  and (select count(*) from public.movimientos_silla where operacion_id = pg_temp.op('t1')) = 2,
  'reintento con el mismo operacion_id: "repetida", sin historial duplicado');
-- mover en los dos modos; el contrato DTM-9701 tiene su tramo en Y → D3-c
-- reescribe el tramo y completa tramos_contrato_actualizados (excepción acotada).
update public.bloqueos_vuelo x set (vuelo_ida, hora_salida_ida, hora_llegada_ida) = ('EH200', '13:00', '15:00') where x.id = pg_temp.fx('X');
select pg_temp.ser('cv');
insert into res select 'm1', public.mover_pasajero(pg_temp.silla('EHY001', 1), pg_temp.fx('X'), 'con_cupo', false, 'e200 mover', pg_temp.op('m1'));
select pg_temp.ser('postgres');
select pg_temp.ok((select tramos_contrato_actualizados from public.movimientos_silla where operacion_id = pg_temp.op('m1')) = 1
  and (select record from public.contrato_vuelos where numero_contrato = 'DTM-9701') = 'EHX001',
  'mover_pasajero con_cupo + D3-c: tramo del contrato reescrito y tramos_contrato_actualizados = 1');
select pg_temp.ser('cv');
insert into res select 'm2', public.mover_pasajero(
  (select id from public.sillas where numero_contrato = 'DTM-9701'), pg_temp.fx('Y'), 'solo_datos', false, 'e200 vuelve', pg_temp.op('m2'));
select pg_temp.ser('postgres');
select pg_temp.ok((select tramos_contrato_actualizados from public.movimientos_silla where operacion_id = pg_temp.op('m2')) = 1
  and (select bloqueo_id from public.sillas where numero_contrato = 'DTM-9701') = pg_temp.fx('Y'),
  'mover_pasajero solo_datos + D3-c: vuelve a Y con la excepción acotada');
-- Record con historial: eliminar_bloqueo lo rechaza con su propio mensaje
select pg_temp.ser('cv');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.fx('X')), 'historial', 'eliminar_bloqueo: un record con historial no se elimina');
insert into res select 'crear', public.crear_bloqueo(jsonb_build_object('record', 'EHNUEVO', 'modalidad_emision', 'serie'), 2);
insert into res select 'eliminar', public.eliminar_bloqueo((select id from public.bloqueos_vuelo where record = 'EHNUEVO'));
select pg_temp.ser('postgres');
select pg_temp.ok(not exists (select 1 from public.bloqueos_vuelo where record = 'EHNUEVO'), 'crear y eliminar un record sin historial');

-- Una fila de historial ANTIGUA (operación de otra transacción ya confirmada)
-- y una fila legado sin operación, insertadas como dueño.
insert into ops values ('vieja', gen_random_uuid());
insert into public.operaciones_vuelo (operacion_id, tipo, huella, actor_id, created_at)
  values (pg_temp.op('vieja'), 'mover_pasajero', 'h', (select id from usr where k = 'cv'), now() - interval '2 days');
insert into public.movimientos_silla (silla_id, bloqueo_origen_id, bloqueo_destino_id, tipo, operacion_id, motivo, fecha_movimiento)
  values (pg_temp.silla('EHY001', 2), pg_temp.fx('Y'), pg_temp.fx('X'), 'mover_datos', pg_temp.op('vieja'), 'vieja', now() - interval '2 days');
insert into public.movimientos_silla (silla_id, bloqueo_origen_id, bloqueo_destino_id, tipo, motivo)
  values (pg_temp.silla('EHY001', 3), pg_temp.fx('Y'), pg_temp.fx('X'), 'legado', 'legado');
create temp table base as select pg_temp.n_mov() as m, pg_temp.n_ops() as o;
grant select on base to public;
create function pg_temp.intacto() returns boolean language sql stable as $$
  select pg_temp.n_mov() = (select m from base) and pg_temp.n_ops() = (select o from base) $$;

-- ═══ 1. Capa de PRIVILEGIO ═════════════════════════════════════════════════
do $$
declare r text; t text;
begin
  foreach r in array array['sup', 'cv', 'venta', 'opmin', 'anon', 'service_role'] loop
    foreach t in array array['movimientos_silla', 'operaciones_vuelo'] loop
      perform pg_temp.ser(r);
      perform pg_temp.falla(format('update public.%I set %s', t, case t when 'movimientos_silla' then $q$motivo = 'x'$q$ else $q$huella = 'x'$q$ end),
        'permission denied for table ' || t, format('%s: UPDATE de %s (privilegio)', r, t));
      perform pg_temp.falla(format('delete from public.%I where %s', t, case t when 'movimientos_silla' then $q$motivo = 'vieja'$q$ else format('operacion_id = %L', pg_temp.op('vieja')) end),
        'permission denied for table ' || t, format('%s: DELETE con WHERE de %s (privilegio)', r, t));
      perform pg_temp.falla(format('delete from public.%I', t), 'permission denied for table ' || t, format('%s: DELETE sin WHERE de %s (privilegio)', r, t));
      perform pg_temp.falla(format('truncate public.%I', t), 'permission denied for table ' || t, format('%s: TRUNCATE de %s (privilegio)', r, t));
      perform pg_temp.falla(case t when 'movimientos_silla'
          then format($q$insert into public.movimientos_silla (silla_id, tipo, motivo) values (%s, 'legado', 'falso')$q$, pg_temp.silla('EHY001', 2))
          else format($q$insert into public.operaciones_vuelo (operacion_id, tipo, huella, actor_id) values (gen_random_uuid(), 'retiro_cupo', 'h', %L)$q$, (select id from usr where k = 'cv')) end,
        'permission denied for table ' || t, format('%s: INSERT en %s (privilegio)', r, t));
    end loop;
  end loop;
  perform pg_temp.ser('postgres');
end $$;
select pg_temp.ok(pg_temp.intacto(), 'privilegio: el historial quedó intacto');

-- ═══ 2. Capa de TRIGGER con privilegios y policies CONCEDIDOS ══════════════
savepoint capa_trigger;
grant select, insert, update, delete, truncate on public.movimientos_silla, public.operaciones_vuelo to authenticated, anon, service_role;
create policy zz_e200_m on public.movimientos_silla for all to authenticated, anon using (true) with check (true);
create policy zz_e200_o on public.operaciones_vuelo for all to authenticated, anon using (true) with check (true);
-- La FK movimientos → operaciones haría fallar el TRUNCATE de operaciones antes
-- de llegar al trigger: se quita solo dentro del savepoint.
alter table public.movimientos_silla drop constraint movimientos_silla_operacion_id_fkey;
do $$
declare r text; t text; bandera boolean;
begin
  foreach r in array array['cv', 'venta', 'opmin', 'anon', 'service_role'] loop
    foreach bandera in array array[false, true] loop
      foreach t in array array['movimientos_silla', 'operaciones_vuelo'] loop
        perform pg_temp.ser(r);
        -- El propio rol intenta activar la salida de mantenimiento: no le sirve.
        if bandera then perform set_config('app.correccion_historial', 'on', true); end if;
        perform pg_temp.falla(format('update public.%I set %s', t, case t when 'movimientos_silla' then $q$motivo = 'x'$q$ else $q$huella = 'x'$q$ end),
          'HISTORIAL_INMUTABLE', format('%s%s: UPDATE de %s (trigger)', r, case when bandera then ' + bandera' else '' end, t));
        perform pg_temp.falla(format('delete from public.%I where %s', t, case t when 'movimientos_silla' then $q$motivo = 'vieja'$q$ else format('operacion_id = %L', pg_temp.op('vieja')) end),
          'HISTORIAL_INMUTABLE', format('%s%s: DELETE con WHERE de %s (trigger)', r, case when bandera then ' + bandera' else '' end, t));
        perform pg_temp.falla(format('delete from public.%I', t), 'HISTORIAL_INMUTABLE',
          format('%s%s: DELETE sin WHERE de %s (trigger)', r, case when bandera then ' + bandera' else '' end, t));
        perform pg_temp.falla(format('truncate public.%I', t), 'HISTORIAL_INMUTABLE',
          format('%s%s: TRUNCATE de %s (trigger)', r, case when bandera then ' + bandera' else '' end, t));
        perform pg_temp.falla(case t when 'movimientos_silla'
            then format($q$insert into public.movimientos_silla (silla_id, tipo, motivo) values (%s, 'legado', 'falso')$q$, pg_temp.silla('EHY001', 2))
            else format($q$insert into public.operaciones_vuelo (operacion_id, tipo, huella, actor_id) values (gen_random_uuid(), 'retiro_cupo', 'h', %L)$q$, (select id from usr where k = 'cv')) end,
          'HISTORIAL_INMUTABLE', format('%s%s: INSERT en %s (trigger)', r, case when bandera then ' + bandera' else '' end, t));
      end loop;
    end loop;
    -- La excepción de tramos tampoco vale para un rol de la API, ni sobre una fila de esta transacción.
    perform pg_temp.ser(r);
    perform pg_temp.falla(format('update public.movimientos_silla set tramos_contrato_actualizados = 9 where operacion_id = %L', pg_temp.op('t1')),
      'HISTORIAL_INMUTABLE', r || ': excepción de tramos no aplica a roles de la API');
  end loop;
  perform pg_temp.ser('postgres');
end $$;
select pg_temp.ok(pg_temp.intacto(), 'capa trigger: el historial quedó intacto');
reset role;
rollback to savepoint capa_trigger;
select pg_temp.ok(not has_table_privilege('authenticated', 'public.movimientos_silla', 'DELETE')
  and not exists (select 1 from pg_policies where policyname like 'zz_e200%')
  and exists (select 1 from pg_constraint where conname = 'movimientos_silla_operacion_id_fkey'),
  'capa trigger: privilegios, policies y FK de prueba revertidos');

-- ═══ 3. El DUEÑO tampoco edita ni borra ════════════════════════════════════
select pg_temp.ser('postgres');
select pg_temp.falla($q$update public.movimientos_silla set motivo = 'x' where motivo = 'vieja'$q$, 'HISTORIAL_INMUTABLE', 'dueño: UPDATE de movimientos_silla');
select pg_temp.falla($q$delete from public.movimientos_silla where motivo = 'vieja'$q$, 'HISTORIAL_INMUTABLE', 'dueño: DELETE de movimientos_silla');
select pg_temp.falla('delete from public.movimientos_silla', 'HISTORIAL_INMUTABLE', 'dueño: DELETE sin WHERE de movimientos_silla');
select pg_temp.falla('truncate public.movimientos_silla', 'HISTORIAL_INMUTABLE', 'dueño: TRUNCATE de movimientos_silla');
select pg_temp.falla($q$update public.operaciones_vuelo set huella = 'x'$q$, 'HISTORIAL_INMUTABLE', 'dueño: UPDATE de operaciones_vuelo');
select pg_temp.falla(format('delete from public.operaciones_vuelo where operacion_id = %L', pg_temp.op('vieja')), 'HISTORIAL_INMUTABLE', 'dueño: DELETE de operaciones_vuelo');
select pg_temp.falla('delete from public.operaciones_vuelo', 'HISTORIAL_INMUTABLE', 'dueño: DELETE sin WHERE de operaciones_vuelo');
savepoint trunc_ops;
alter table public.movimientos_silla drop constraint movimientos_silla_operacion_id_fkey;
select pg_temp.falla('truncate public.operaciones_vuelo', 'HISTORIAL_INMUTABLE', 'dueño: TRUNCATE de operaciones_vuelo (sin la FK, llega al trigger)');
rollback to savepoint trunc_ops;
-- Una función SECURITY DEFINER del dueño tampoco puede borrar (la vía de las funciones).
create function pg_temp.definer_borra() returns void language plpgsql security definer as $$
begin delete from public.movimientos_silla; end $$;
select pg_temp.ser('cv');
select pg_temp.falla('select pg_temp.definer_borra()', 'HISTORIAL_INMUTABLE', 'función SECURITY DEFINER del dueño llamada por control_vuelo: no borra');
select pg_temp.ser('postgres');
select pg_temp.ok(pg_temp.intacto(), 'dueño: el historial quedó intacto');

-- ═══ 4. Salida de MANTENIMIENTO (solo dueño + bandera) ═════════════════════
savepoint mant;
set local app.correccion_historial = 'on';
update public.movimientos_silla set motivo = 'vieja (corregida)' where motivo = 'vieja';
delete from public.movimientos_silla where motivo = 'legado';
select pg_temp.ok((select count(*) from public.movimientos_silla where motivo = 'vieja (corregida)') = 1
  and not exists (select 1 from public.movimientos_silla where motivo = 'legado'),
  'mantenimiento: el dueño con la bandera corrige y borra');
select pg_temp.ok(exists (select 1 from public.auditoria where tabla = 'movimientos_silla' and accion = 'DELETE' and antes->>'motivo' = 'legado')
  and exists (select 1 from public.auditoria where tabla = 'movimientos_silla' and accion = 'UPDATE' and despues->>'motivo' = 'vieja (corregida)'),
  'mantenimiento: la corrección queda en auditoria');
set local app.correccion_historial = 'off';
select pg_temp.falla($q$delete from public.movimientos_silla where motivo = 'vieja (corregida)'$q$, 'HISTORIAL_INMUTABLE', 'mantenimiento: con la bandera apagada vuelve a rechazar');
rollback to savepoint mant;
select pg_temp.ok(pg_temp.intacto() and current_setting('app.correccion_historial', true) is distinct from 'on', 'mantenimiento revertido; bandera apagada');

-- ═══ 5. Excepción acotada de tramos_contrato_actualizados ══════════════════
-- Fila de una operación creada en ESTA transacción, tramos NULL.
insert into ops values ('nueva', gen_random_uuid());
insert into public.operaciones_vuelo (operacion_id, tipo, huella, actor_id) values (pg_temp.op('nueva'), 'mover_pasajero', 'h', (select id from usr where k = 'cv'));
insert into public.movimientos_silla (silla_id, bloqueo_origen_id, bloqueo_destino_id, tipo, operacion_id, motivo)
  values (pg_temp.silla('EHY001', 4), pg_temp.fx('Y'), pg_temp.fx('X'), 'mover_datos', pg_temp.op('nueva'), 'nueva');
select pg_temp.falla(format($q$update public.movimientos_silla set tramos_contrato_actualizados = 2, motivo = 'otro' where operacion_id = %L$q$, pg_temp.op('nueva')),
  'HISTORIAL_INMUTABLE', 'tramos + otra columna: rechazado');
update public.movimientos_silla set tramos_contrato_actualizados = 2 where operacion_id = pg_temp.op('nueva');
select pg_temp.ok((select tramos_contrato_actualizados from public.movimientos_silla where operacion_id = pg_temp.op('nueva')) = 2,
  'tramos NULL → 2 en una operación de esta transacción: permitido');
select pg_temp.falla(format('update public.movimientos_silla set tramos_contrato_actualizados = 3 where operacion_id = %L', pg_temp.op('nueva')),
  'HISTORIAL_INMUTABLE', 'tramos 2 → 3 (ya tenía valor): rechazado');
select pg_temp.falla(format('update public.movimientos_silla set tramos_contrato_actualizados = null where operacion_id = %L', pg_temp.op('nueva')),
  'HISTORIAL_INMUTABLE', 'tramos 2 → NULL: rechazado');
select pg_temp.falla(format('update public.movimientos_silla set tramos_contrato_actualizados = 1 where operacion_id = %L', pg_temp.op('vieja')),
  'HISTORIAL_INMUTABLE', 'tramos en una operación ya confirmada de otra transacción: rechazado');
select pg_temp.falla($q$update public.movimientos_silla set tramos_contrato_actualizados = 1 where motivo = 'legado'$q$,
  'HISTORIAL_INMUTABLE', 'tramos en una fila legado sin operación: rechazado');
select pg_temp.falla(format($q$update public.operaciones_vuelo set huella = 'h2' where operacion_id = %L$q$, pg_temp.op('nueva')),
  'HISTORIAL_INMUTABLE', 'operaciones_vuelo no tiene excepción, ni en esta transacción');

-- ═══ 6b. Fallo a mitad de una operación: sin historial suelto ══════════════
create function pg_temp.romper() returns trigger language plpgsql as $$
begin if new.cupos_total is distinct from old.cupos_total and old.record = 'EHX001' then raise exception 'FALLO_FORZADO_E200'; end if; return new; end $$;
create trigger e200_romper before update on public.bloqueos_vuelo for each row execute function pg_temp.romper();
insert into ops values ('falla', gen_random_uuid());
select pg_temp.ser('cv');
select pg_temp.falla(format($q$select public.trasladar_cupos(%s, %s, 1, 'e200 falla', %L)$q$, pg_temp.fx('Y'), pg_temp.fx('X'), pg_temp.op('falla')),
  'FALLO_FORZADO_E200', 'trasladar_cupos falla a mitad (al ajustar cupos del destino)');
select pg_temp.ser('postgres');
drop trigger e200_romper on public.bloqueos_vuelo;
select pg_temp.ok(not exists (select 1 from public.operaciones_vuelo where operacion_id = pg_temp.op('falla'))
  and not exists (select 1 from public.movimientos_silla where operacion_id = pg_temp.op('falla')),
  'rollback: ni operación ni movimientos de la operación fallida');
select pg_temp.ser('cv');
insert into res select 'reintento', public.trasladar_cupos(pg_temp.fx('Y'), pg_temp.fx('X'), 1, 'e200 falla', pg_temp.op('falla'));
select pg_temp.ser('postgres');
select pg_temp.ok((select not (r->>'repetida')::boolean from res where k = 'reintento')
  and (select count(*) from public.movimientos_silla where operacion_id = pg_temp.op('falla')) = 1,
  'reintento con el mismo operacion_id tras el fallo: se aplica una vez');

rollback;
\echo 'TODAS LAS PRUEBAS PASARON (y se revirtieron)'
