-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBAS · modo aviso C0 (c0_aviso_guarda_escritura.sql). SOLO base LOCAL o
-- DESECHABLE con 194–197 aplicadas, C0 instalado y la 199 SIN aplicar:
--   psql -f c0_aviso_guarda_escritura.sql -f test_c0_aviso.sql
-- Comprueba que (a) las escrituras directas del código anterior a B siguen
-- funcionando pero quedan registradas, una fila por caso; (b) lo legítimo
-- (grupo D sin contrato, resto del record, funciones, service_role) no deja
-- avisos; (c) nadie puede inyectar avisos por RPC. Termina en ROLLBACK.
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
create temp table fx (k text primary key, id bigint);
grant select on fx to public;
create function pg_temp.fx(p text) returns bigint language sql stable as $$ select id from fx where k = p $$;
create function pg_temp.avisos() returns bigint language sql stable as $$ select count(*) from public.vuelos_guarda_avisos where actor_id = '00000000-0000-0000-0000-000000c00001' or rol_bd = 'service_role' $$;

select pg_temp.ok(to_regprocedure('public._c0_sillas_aviso_escritura()') is not null
  and to_regprocedure('public._sillas_guarda_escritura()') is null, 'C0 instalado y la 199 sin aplicar');

-- service_role: en Supabase tiene todos los privilegios de tabla; la copia local no los trae.
grant select, insert, update, delete on public.sillas, public.bloqueos_vuelo to service_role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000c00001', 'c0@local.test');
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'C0 CV' where id = '00000000-0000-0000-0000-000000c00001';
insert into public.destinos (nombre) values ('C0 DESTINO');
insert into public.proveedores (nombre) values ('C0 PROVEEDOR');
insert into public.bloqueos_vuelo (record, cupos_total, modalidad_emision, fecha_ida, tarifa_neta, destino_id, proveedor_id)
  select r, c, 'serie', current_date + 30, 200000, (select id from public.destinos where nombre = 'C0 DESTINO'), (select id from public.proveedores where nombre = 'C0 PROVEEDOR')
    from (values ('C0Y001', 3), ('C0X001', 2)) v(r, c);
insert into fx select 'Y', id from public.bloqueos_vuelo where record = 'C0Y001';
insert into fx select 'X', id from public.bloqueos_vuelo where record = 'C0X001';
insert into public.sillas (bloqueo_id, numero_silla, estado)
  select pg_temp.fx('Y'), g, 'disponible'::public.estado_silla from generate_series(1, 3) g
  union all select pg_temp.fx('X'), g, 'disponible'::public.estado_silla from generate_series(1, 2) g;
insert into public.ventas (numero_contrato, cliente, tenant) values ('DTM-9601', 'c0', 'mayorista');
update public.sillas set estado = 'confirmada', numero_contrato = 'DTM-9601', pasajero_nombres = 'C0' where bloqueo_id = pg_temp.fx('Y') and numero_silla = 3;
insert into fx select 's1', id from public.sillas where bloqueo_id = pg_temp.fx('Y') and numero_silla = 1;
insert into fx select 's2', id from public.sillas where bloqueo_id = pg_temp.fx('Y') and numero_silla = 2;
insert into fx select 's3', id from public.sillas where bloqueo_id = pg_temp.fx('Y') and numero_silla = 3;
select pg_temp.ok(pg_temp.avisos() = 0, 'el fixture (como dueño) no deja avisos');

-- (b) Legítimo: sin avisos
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-000000c00001');
update public.sillas set pasajero_nombres = 'LIBRE', updated_at = now() where id = pg_temp.fx('s1');
update public.bloqueos_vuelo set notas = 'c0', cupos_total = cupos_total where id = pg_temp.fx('Y');
select public.trasladar_cupos(pg_temp.fx('X'), pg_temp.fx('Y'), 1, 'c0', gen_random_uuid());
reset role;
set local role service_role;
update public.sillas set pasajero_apellidos = 'W8' where id = pg_temp.fx('s3');
reset role;
select pg_temp.ok(pg_temp.avisos() = 0, 'legítimo (datos sin contrato, record, función, service_role): 0 avisos');

-- (a) Código anterior a B: funciona y queda registrado
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-000000c00001');
insert into public.sillas (bloqueo_id, numero_silla, estado) values (pg_temp.fx('Y'), 9, 'disponible');
update public.sillas set estado = 'no_vendida' where id = pg_temp.fx('s2');
update public.sillas set pasajero_nombres = 'OTRO' where id = pg_temp.fx('s3');
update public.bloqueos_vuelo set cupos_total = cupos_total + 1 where id = pg_temp.fx('Y');
delete from public.sillas where bloqueo_id = pg_temp.fx('Y') and numero_silla = 9;
reset role;
select pg_temp.ok(pg_temp.avisos() = 5, 'código viejo: 5 escrituras directas, 5 avisos');
select pg_temp.ok((select string_agg(detalle, ' | ' order by id) from public.vuelos_guarda_avisos where actor_id = '00000000-0000-0000-0000-000000c00001')
  like 'INSERT directo de una silla | cambio directo en estado | datos de una silla con contrato: pasajero_nombres | cambio directo de cupos_total%| DELETE directo de una silla',
  'cada aviso dice qué se escribió');
select pg_temp.ok((select estado::text from public.sillas where id = pg_temp.fx('s2')) = 'no_vendida', 'en modo aviso la escritura NO se rechaza');

-- (c) Nadie inyecta avisos por RPC
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-000000c00001');
select pg_temp.falla($q$select public._c0_registrar_aviso('sillas', 'UPDATE', 'authenticated', 1, 'falso')$q$, 'Solo lo invocan los triggers', 'el registrador no se puede llamar por RPC');
reset role;
select pg_temp.ok(not has_table_privilege('authenticated', 'public.vuelos_guarda_avisos', 'SELECT')
  and not has_table_privilege('authenticated', 'public.vuelos_guarda_avisos', 'INSERT'), 'la tabla de avisos no es legible ni escribible por la API');

rollback;
\echo 'TODAS LAS PRUEBAS PASARON (y se revirtieron)'
