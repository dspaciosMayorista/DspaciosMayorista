-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBAS · migración 195 (crear_bloqueo / eliminar_bloqueo atómicos).
-- SOLO base LOCAL o DESECHABLE (con 192, 194 y 195 aplicadas). Crea sus
-- propios datos y termina en ROLLBACK. Se detiene en el primer fallo.
-- Uso: psql -v ON_ERROR_STOP=1 -f test_crear_eliminar_bloqueo.sql
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
create temp table res (k text primary key, r jsonb);
grant select on fx to public;
grant select, insert on res to public;
create function pg_temp.fx(p text) returns bigint language sql stable as $$ select id from fx where k = p $$;
create function pg_temp.bq(p text) returns bigint language sql stable as $$ select id from public.bloqueos_vuelo where record = p $$;
create function pg_temp.n_sillas(p text) returns integer language sql stable as $$
  select count(*)::integer from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record = p $$;
-- Datos mínimos de un record (los campos van como en la acción crearBloqueo).
create function pg_temp.datos(p_record text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('record', p_record, 'modalidad_emision', 'serie') || p_extra $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e001', 'cb-super@local.test'),
  ('00000000-0000-0000-0000-00000000e002', 'cb-cv@local.test'),
  ('00000000-0000-0000-0000-00000000e003', 'cb-op-min@local.test'),
  ('00000000-0000-0000-0000-00000000e004', 'cb-venta@local.test'),
  ('00000000-0000-0000-0000-00000000e005', 'cb-inactivo@local.test');
update public.usuarios set rol = 'superadmin',    tenant = 'mayorista', activo = true  where id = '00000000-0000-0000-0000-00000000e001';
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true  where id = '00000000-0000-0000-0000-00000000e002';
update public.usuarios set rol = 'operaciones',   tenant = 'minorista', activo = true  where id = '00000000-0000-0000-0000-00000000e003';
update public.usuarios set rol = 'venta',         tenant = 'mayorista', activo = true  where id = '00000000-0000-0000-0000-00000000e004';
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = false where id = '00000000-0000-0000-0000-00000000e005';
insert into public.destinos (nombre) values ('CB DESTINO');
insert into public.proveedores (nombre) values ('CB PROVEEDOR');
insert into fx select 'dest', id from public.destinos where nombre = 'CB DESTINO';
insert into fx select 'prov', id from public.proveedores where nombre = 'CB PROVEEDOR';
insert into fx select 'rango', min(id) from public.rangos_edad;

-- ═══ Permisos: nadie fuera de AUT-1 crea ni elimina ════════════════════════
set local role authenticated;
select pg_temp.falla($q$select public.crear_bloqueo(pg_temp.datos('CBNOJWT'), 2)$q$, 'Sesión requerida', 'crear sin sesión');
select pg_temp.como('00000000-0000-0000-0000-00000000e004');
select pg_temp.falla($q$select public.crear_bloqueo(pg_temp.datos('CBVENTA'), 2)$q$, 'Sin permiso para operar vuelos', 'crear con rol venta');
select pg_temp.como('00000000-0000-0000-0000-00000000e003');
select pg_temp.falla($q$select public.crear_bloqueo(pg_temp.datos('CBMIN'), 2)$q$, 'Sin permiso para operar vuelos', 'crear con operaciones de MINORISTA (AUT-1)');
select pg_temp.como('00000000-0000-0000-0000-00000000e005');
select pg_temp.falla($q$select public.crear_bloqueo(pg_temp.datos('CBINAC'), 2)$q$, 'Sin permiso para operar vuelos', 'crear con usuario inactivo');
reset role;
set local role anon;
select pg_temp.falla($q$select public.crear_bloqueo(pg_temp.datos('CBANON'), 2)$q$, 'permission denied for function', 'anon no ejecuta crear_bloqueo');
select pg_temp.falla($q$select public.eliminar_bloqueo(1)$q$, 'permission denied for function', 'anon no ejecuta eliminar_bloqueo');
reset role;
select pg_temp.ok(not exists (select 1 from public.bloqueos_vuelo where record like 'CB%'), 'ningún intento sin permiso creó un record');

-- ═══ Creación individual ═══════════════════════════════════════════════════
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000e002');
insert into res select 'c1', public.crear_bloqueo(pg_temp.datos('  cbok01 ', jsonb_build_object(
  'aerolinea', 'AVIANCA', 'ruta', 'BOG-ADZ', 'origen', 'BOG', 'proveedor_id', pg_temp.fx('prov'), 'destino_id', pg_temp.fx('dest'),
  'tarifa_neta', 400000, 'tarifa_para_empaquetar', 480000, 'vuelo_ida', 'AV10', 'fecha_ida', '2026-12-01',
  'hora_salida_ida', '06:00', 'hora_llegada_ida', '07:55', 'vuelo_regreso', 'AV11', 'fecha_regreso', '2026-12-05',
  'hora_salida_reg', '18:00', 'hora_llegada_reg', '19:55', 'fecha_devolucion', '2026-11-01', 'notas', '  nota  ',
  'rangos_edad', jsonb_build_array(pg_temp.fx('rango')))), 5);
insert into res select 'c0', public.crear_bloqueo(pg_temp.datos('CBCERO'), 0);
reset role;
select pg_temp.ok((select (r ->> 'ok')::boolean and r ->> 'record' = 'CBOK01' and (r ->> 'cupos')::int = 5 from res where k = 'c1'),
  'crear: devuelve ok, record normalizado (mayúsculas, sin espacios) y cupos');
select pg_temp.ok((select cupos_total = 5 and aerolinea = 'AVIANCA' and ruta = 'BOG-ADZ' and destino_id = pg_temp.fx('dest') and proveedor_id = pg_temp.fx('prov')
                     and tarifa_neta = 400000 and tarifa_para_empaquetar = 480000 and fecha_ida = date '2026-12-01' and hora_salida_ida = time '06:00'
                     and hora_llegada_reg = time '19:55' and notas = 'nota' and rangos_edad = array[pg_temp.fx('rango')]
                     and modalidad_emision = 'serie' and estado_emision = 'pendiente' and estado_pago = 'pendiente'
                     from public.bloqueos_vuelo where record = 'CBOK01'),
  'crear: todos los campos guardados; estados de emisión y pago nacen en pendiente');
select pg_temp.ok(pg_temp.n_sillas('CBOK01') = 5
  and (select array_agg(numero_silla order by numero_silla) from public.sillas where bloqueo_id = pg_temp.bq('CBOK01')) = array[1,2,3,4,5]
  and not exists (select 1 from public.sillas where bloqueo_id = pg_temp.bq('CBOK01') and estado::text <> 'disponible'),
  'crear: 5 sillas 1..5 disponibles = cupos_total');
select pg_temp.ok((select cupos_total from public.bloqueos_vuelo where record = 'CBCERO') = 0 and pg_temp.n_sillas('CBCERO') = 0,
  'crear con 0 cupos: record sin sillas, coherente');

-- ═══ Validaciones (nada se crea) ═══════════════════════════════════════════
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000e002');
select pg_temp.falla($q$select public.crear_bloqueo(jsonb_build_object('modalidad_emision', 'serie'), 1)$q$, 'Falta el record', 'sin record');
select pg_temp.falla($q$select public.crear_bloqueo(jsonb_build_object('record', 'CBV1'), 1)$q$, 'modalidad de emisión', 'sin modalidad');
select pg_temp.falla($q$select public.crear_bloqueo(pg_temp.datos('CBV2', '{"estado_pago":"debe"}'), 1)$q$, 'estado de pago', 'estado de pago inválido');
select pg_temp.falla($q$select public.crear_bloqueo(pg_temp.datos('CBV3'), -1)$q$, 'entre 0 y 1000', 'cupos negativos');
select pg_temp.falla($q$select public.crear_bloqueo(pg_temp.datos('CBV4'), 1001)$q$, 'entre 0 y 1000', 'cupos excesivos');
select pg_temp.falla($q$select public.crear_bloqueo(pg_temp.datos('cbok01'), 3)$q$, 'Ya existe un bloqueo con el record CBOK01', 'record duplicado');
select pg_temp.falla($q$select public.crear_bloqueo(pg_temp.datos('CBV5', '{"fecha_ida":"2026-13-40"}'), 3)$q$, 'fecha u hora inválida', 'fecha inválida');
select pg_temp.falla($q$select public.crear_bloqueo(pg_temp.datos('CBV6', '{"tarifa_neta":"mucho"}'), 3)$q$, 'número inválido', 'número inválido');
reset role;
select pg_temp.ok(not exists (select 1 from public.bloqueos_vuelo where record like 'CBV%')
  and (select cupos_total from public.bloqueos_vuelo where record = 'CBOK01') = 5 and pg_temp.n_sillas('CBOK01') = 5,
  'validaciones: no se creó ningún record y el duplicado no tocó al existente');

-- ═══ Fallo a mitad de la creación: no queda record sin sillas ═════════════
create function pg_temp.romper_sillas() returns trigger language plpgsql as $$
begin if new.numero_silla = 3 then raise exception 'FALLO_FORZADO_SILLAS'; end if; return new; end $$;
create trigger cb_romper_sillas before insert on public.sillas for each row execute function pg_temp.romper_sillas();
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000e002');
select pg_temp.falla($q$select public.crear_bloqueo(pg_temp.datos('CBFALLA'), 5)$q$, 'FALLO_FORZADO_SILLAS', 'falla al crear la 3ª silla (ya insertado el record)');
reset role;
drop trigger cb_romper_sillas on public.sillas;
select pg_temp.ok(pg_temp.bq('CBFALLA') is null
  and not exists (select 1 from public.sillas s left join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.id is null),
  'rollback: ni el record ni las 2 sillas ya insertadas quedaron');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000e002');
insert into res select 'c_retry', public.crear_bloqueo(pg_temp.datos('CBFALLA'), 5);
reset role;
select pg_temp.ok(pg_temp.n_sillas('CBFALLA') = 5 and (select cupos_total from public.bloqueos_vuelo where record = 'CBFALLA') = 5,
  'reintento tras el fallo: record completo con sus 5 sillas');

-- ═══ Eliminación permitida ═════════════════════════════════════════════════
insert into public.bloqueo_cambios (bloqueo_id, detalle) values (pg_temp.bq('CBCERO'), 'cambio de prueba');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000e002');
insert into res select 'd_ok', public.eliminar_bloqueo(pg_temp.bq('CBFALLA'));
insert into res select 'd_cero', public.eliminar_bloqueo(pg_temp.bq('CBCERO'));
reset role;
select pg_temp.ok((select (r ->> 'sillas_borradas')::int from res where k = 'd_ok') = 5
  and pg_temp.bq('CBFALLA') is null
  and not exists (select 1 from public.sillas s left join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.id is null),
  'eliminar record limpio: record y sus 5 sillas libres borrados');
select pg_temp.ok(pg_temp.bq('CBCERO') is null and not exists (select 1 from public.bloqueo_cambios where detalle = 'cambio de prueba'),
  'eliminar record sin sillas: su historial operativo (bloqueo_cambios) cae en cascada');

-- ═══ Eliminación rechazada (nada se borra) ═════════════════════════════════
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000e002');
select public.crear_bloqueo(pg_temp.datos(r), 2) from unnest(array['CBHIST','CBCONT','CBMAN','CBPAX','CBINF','CBREF','CBPNR','CBPAQ','CBITI','CBMULTI']) r;
reset role;
insert into public.ventas (numero_contrato, cliente, tenant) values ('DTM-9930', 'cb', 'mayorista'), ('DTM-9931', 'cb', 'mayorista');
insert into public.movimientos_silla (silla_id, bloqueo_origen_id, bloqueo_destino_id, motivo)
  select min(id), pg_temp.bq('CBHIST'), null, 'legado de prueba' from public.sillas where bloqueo_id = pg_temp.bq('CBHIST');
update public.sillas set numero_contrato = 'DTM-9930', estado = 'confirmada' where bloqueo_id = pg_temp.bq('CBCONT') and numero_silla = 1;
update public.sillas set contrato_manual = 'EXT-CB', estado = 'confirmada' where bloqueo_id = pg_temp.bq('CBMAN') and numero_silla = 1;
update public.sillas set pasajero_nombres = 'ANA' where bloqueo_id = pg_temp.bq('CBPAX') and numero_silla = 2;   -- "disponible" con datos (carga masiva)
update public.sillas set inf_nombres = 'BEBE' where bloqueo_id = pg_temp.bq('CBINF') and numero_silla = 1;
update public.ventas set bloqueo_ref_id = pg_temp.bq('CBREF') where numero_contrato = 'DTM-9931';
insert into public.contrato_vuelos (numero_contrato, record, direccion) values ('DTM-9931', ' cbpnr ', 'ida');
insert into public.paquetes (nombre, categoria, bloqueo_id) values ('CB PAQUETE', 'bloqueo', pg_temp.bq('CBPAQ'));
insert into public.itinerarios (destino_id, bloqueo_id) values (pg_temp.fx('dest'), pg_temp.bq('CBITI'));
update public.sillas set numero_contrato = 'DTM-9930', pasajero_nombres = 'LUIS', estado = 'confirmada' where bloqueo_id = pg_temp.bq('CBMULTI') and numero_silla = 2;
create temp table rech_antes as select
  (select count(*) from public.bloqueos_vuelo where record like 'CB%') as bq,
  (select count(*) from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record like 'CB%') as si;
grant select on rech_antes to public;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000e002');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq('CBHIST')), 'movimiento(s) en su historial', 'rechazo: record con historial');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq('CBCONT')), 'silla(s) con contrato', 'rechazo: silla con contrato');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq('CBMAN')), 'contrato manual', 'rechazo: silla con contrato manual');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq('CBPAX')), 'datos de pasajero', 'rechazo: silla disponible con datos de pasajero');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq('CBINF')), 'datos de pasajero', 'rechazo: silla con datos de infante');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq('CBREF')), 'contrato(s) vinculado(s)', 'rechazo: venta vinculada (bloqueo_ref_id)');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq('CBPNR')), 'con este PNR en su vuelo', 'rechazo: contrato con este PNR en su vuelo');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq('CBPAQ')), 'paquete(s)', 'rechazo: paquete que lo usa');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq('CBITI')), 'itinerario(s)', 'rechazo: itinerario que lo usa');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq('CBMULTI')), 'silla(s) con contrato; 1 silla(s) con datos de pasajero', 'rechazo con varios motivos: se informan todos');
select pg_temp.falla('select public.eliminar_bloqueo(-77)', 'El bloqueo no existe', 'bloqueo inexistente');
select pg_temp.como('00000000-0000-0000-0000-00000000e003');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq('CBOK01')), 'Sin permiso para operar vuelos', 'eliminar con operaciones de MINORISTA (AUT-1)');
select pg_temp.como('00000000-0000-0000-0000-00000000e004');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq('CBOK01')), 'Sin permiso para operar vuelos', 'eliminar con rol venta');
reset role;
select pg_temp.ok((select bq from rech_antes) = (select count(*) from public.bloqueos_vuelo where record like 'CB%')
  and (select si from rech_antes) = (select count(*) from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record like 'CB%'),
  'rechazos: ningún record ni silla se borró');


-- ═══ Información residual: un solo dato en CUALQUIER columna, o estado ════
-- (antes solo se miraban nombre, apellido, documento, nacimiento e infante).
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000e002');
select public.crear_bloqueo(pg_temp.datos(r), 2)
  from unnest(array['CBRASE','CBRPLA','CBRAGE','CBRITD','CBRRES','CBRHOT','CBRDEV','CBRNOV']) r;
reset role;
update public.sillas set asesor = 'ASESOR' where bloqueo_id = pg_temp.bq('CBRASE') and numero_silla = 1;
update public.sillas set plazo = date '2026-11-01' where bloqueo_id = pg_temp.bq('CBRPLA') and numero_silla = 1;
update public.sillas set agencia = 'AGENCIA' where bloqueo_id = pg_temp.bq('CBRAGE') and numero_silla = 1;
update public.sillas set inf_tipo_doc = 'RC' where bloqueo_id = pg_temp.bq('CBRITD') and numero_silla = 2;
update public.sillas set responsable_menor = 'ANA' where bloqueo_id = pg_temp.bq('CBRRES') and numero_silla = 1;
update public.sillas set hotel = 'HOTEL', acomodacion = 'DOBLE' where bloqueo_id = pg_temp.bq('CBRHOT') and numero_silla = 1;
update public.sillas set estado = 'devuelta' where bloqueo_id = pg_temp.bq('CBRDEV') and numero_silla = 1;      -- sin datos, sin contrato
update public.sillas set estado = 'no_vendida' where bloqueo_id = pg_temp.bq('CBRNOV') and numero_silla = 2;    -- sin datos, sin contrato
create temp table resid_antes as select
  (select count(*) from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record in ('CBRASE','CBRPLA','CBRAGE','CBRITD','CBRRES','CBRHOT','CBRDEV','CBRNOV')) as si;
grant select on resid_antes to public;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000e002');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq(r)), m, 'residuo: ' || d)
  from (values
    ('CBRASE', 'datos de pasajero u operativos', 'solo el asesor'),
    ('CBRPLA', 'datos de pasajero u operativos', 'solo el plazo'),
    ('CBRAGE', 'datos de pasajero u operativos', 'solo la agencia'),
    ('CBRITD', 'datos de pasajero u operativos', 'solo el tipo de documento del infante'),
    ('CBRRES', 'datos de pasajero u operativos', 'solo el responsable del menor'),
    ('CBRHOT', 'datos de pasajero u operativos', 'hotel y acomodación'),
    ('CBRDEV', 'devuelta(s), no vendida(s), retirada(s) o en cambio', 'silla devuelta sin datos'),
    ('CBRNOV', 'devuelta(s), no vendida(s), retirada(s) o en cambio', 'silla no vendida sin datos')
  ) v(r, m, d);
reset role;
select pg_temp.ok((select count(*) from public.bloqueos_vuelo where record in ('CBRASE','CBRPLA','CBRAGE','CBRITD','CBRRES','CBRHOT','CBRDEV','CBRNOV')) = 8
  and (select si from resid_antes) = (select count(*) from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record in ('CBRASE','CBRPLA','CBRAGE','CBRITD','CBRRES','CBRHOT','CBRDEV','CBRNOV')),
  'ningún record con información residual se borró (8 records, sus sillas intactas)');

-- ═══ Fallo a mitad de la eliminación: las sillas vuelven ═══════════════════
create function pg_temp.romper_borrado() returns trigger language plpgsql as $$
begin if old.record = 'CBOK01' then raise exception 'FALLO_FORZADO_BORRADO'; end if; return old; end $$;
create trigger cb_romper_borrado before delete on public.bloqueos_vuelo for each row execute function pg_temp.romper_borrado();
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000e002');
select pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq('CBOK01')), 'FALLO_FORZADO_BORRADO', 'falla al borrar el record (ya borradas las sillas)');
reset role;
drop trigger cb_romper_borrado on public.bloqueos_vuelo;
select pg_temp.ok(pg_temp.bq('CBOK01') is not null and pg_temp.n_sillas('CBOK01') = 5,
  'rollback: el record y sus 5 sillas siguen ahí');

-- ═══ Compatibilidad según la fase ═════════════════════════════════════════
-- Sin la 199 (fase C), la 195 es aditiva: el código ANTERIOR (insert/delete
-- directo de record y sillas) sigue funcionando mientras se despliega el nuevo.
-- Con la 199 aplicada, ese mismo camino queda rechazado (la 199 tiene su propia
-- batería: test_cierre_escritura_directa.sql).
create temp table fase_c as select to_regprocedure('public._sillas_guarda_escritura()') is not null as activa;
grant select on fase_c to public;
create function pg_temp.viejo_crear() returns void language plpgsql as $f$
begin
  insert into public.bloqueos_vuelo (record, cupos_total, modalidad_emision, estado_emision, estado_pago) values ('CBVIEJO', 2, 'grupo', 'pendiente', 'pendiente');
  insert into public.sillas (bloqueo_id, numero_silla, estado) select id, g, 'disponible' from public.bloqueos_vuelo, generate_series(1, 2) g where record = 'CBVIEJO';
end $f$;
create function pg_temp.viejo_borrar_sillas() returns void language plpgsql as $f$
begin delete from public.sillas where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'CBVIEJO'); end $f$;
create function pg_temp.viejo_borrar_record() returns void language plpgsql as $f$
begin delete from public.bloqueos_vuelo where record = 'CBVIEJO'; end $f$;
select pg_temp.ok(case when (select activa from fase_c) then
      (select count(*) from pg_policies where tablename in ('bloqueos_vuelo', 'sillas') and cmd = 'ALL') = 0
  and not has_table_privilege('authenticated', 'public.sillas', 'INSERT') and not has_table_privilege('authenticated', 'public.sillas', 'DELETE')
  and not has_table_privilege('authenticated', 'public.bloqueos_vuelo', 'INSERT') and not has_table_privilege('authenticated', 'public.bloqueos_vuelo', 'DELETE')
  else
      (select count(*) from pg_policies where tablename in ('bloqueos_vuelo', 'sillas') and cmd = 'ALL') = 2
  and has_table_privilege('authenticated', 'public.sillas', 'INSERT') and has_table_privilege('authenticated', 'public.sillas', 'DELETE')
  and has_table_privilege('authenticated', 'public.bloqueos_vuelo', 'INSERT') and has_table_privilege('authenticated', 'public.bloqueos_vuelo', 'DELETE') end,
  'compatibilidad: policies y privilegios coherentes con la fase (sin 199: los de la 137; con 199: sin FOR ALL ni INSERT/DELETE)');
do $d$ begin if not (select activa from fase_c) then
  set local role authenticated;
  perform pg_temp.como('00000000-0000-0000-0000-00000000e002');
  perform pg_temp.viejo_crear();
  reset role;
  perform pg_temp.ok(pg_temp.n_sillas('CBVIEJO') = 2, 'compatibilidad (sin 199): el camino anterior (insert directo de record y sillas) sigue funcionando');
  set local role authenticated;
  perform pg_temp.como('00000000-0000-0000-0000-00000000e002');
  perform pg_temp.viejo_borrar_sillas();
  perform pg_temp.viejo_borrar_record();
  reset role;
  perform pg_temp.ok(pg_temp.bq('CBVIEJO') is null, 'compatibilidad (sin 199): el borrado directo anterior sigue funcionando');
else
  set local role authenticated;
  perform pg_temp.como('00000000-0000-0000-0000-00000000e002');
  perform pg_temp.falla('select pg_temp.viejo_crear()', 'permission denied for table bloqueos_vuelo', 'con 199: el insert directo del código anterior queda rechazado');
  perform pg_temp.falla(format('select public.eliminar_bloqueo(%s)', pg_temp.bq('CBRDEV')), 'devuelta(s)', 'con 199: eliminar_bloqueo sigue validando');
  reset role;
  perform pg_temp.ok(pg_temp.bq('CBVIEJO') is null, 'con 199: no quedó ningún record del camino anterior');
end if; end $d$;

rollback;
\echo 'TODAS LAS PRUEBAS PASARON (y se revirtieron)'
