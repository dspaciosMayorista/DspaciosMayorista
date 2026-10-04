-- SOLO base local/desechable con las migraciones hasta 201. Siempre termina en ROLLBACK.
\set ON_ERROR_STOP 1
begin;

create function pg_temp.ok(p boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p, false) then raise exception 'FALLO: %', p_msg; end if;
  raise notice 'OK %', p_msg;
end $$;
create function pg_temp.falla(p_sql text, p_patron text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_patron in sqlerrm) > 0 then raise notice 'OK %', p_msg; return; end if;
    raise exception 'FALLO: % (error inesperado: %)', p_msg, sqlerrm;
  end;
  raise exception 'FALLO: % (no fallo)', p_msg;
end $$;
create temp table fx (clave text primary key, id bigint);
grant select on fx to public;
create function pg_temp.id(p text) returns bigint language sql stable as $$ select id from fx where clave = p $$;

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-00000000c201', 'flujo-201@local.test');
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'Control prueba'
 where id = '00000000-0000-0000-0000-00000000c201';
insert into public.destinos (nombre) values ('DESTINO PRUEBA 201');
insert into fx select 'destino', id from public.destinos where nombre = 'DESTINO PRUEBA 201';
insert into public.proveedores (nombre) values ('PROVEEDOR PRUEBA 201');
insert into fx select 'proveedor', id from public.proveedores where nombre = 'PROVEEDOR PRUEBA 201';
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total, modalidad_emision)
values ('PF201A', pg_temp.id('destino'), pg_temp.id('proveedor'), current_date + 30, 400000, 3, 'serie');
insert into fx select 'bloqueo', id from public.bloqueos_vuelo where record = 'PF201A';
insert into public.sillas (bloqueo_id, numero_silla, estado)
select pg_temp.id('bloqueo'), g, 'disponible' from generate_series(1, 3) g;
insert into fx select 's' || numero_silla, id from public.sillas where bloqueo_id = pg_temp.id('bloqueo');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c201","role":"authenticated"}', true);

-- Retención: el pasajero sin contrato exige fecha de plazo (si falta, no se guarda nada).
select pg_temp.falla(format('select public.editar_pasajero_silla(%s, %L::jsonb)', pg_temp.id('s1'),
  '{"pasajero_nombres":"PRUEBA","pasajero_apellidos":"UNO","tipo_doc":"CC","numero_doc":"201"}'),
  'indica el pasajero (nombre o apellido) y la fecha de plazo', 'pasajero sin plazo: validacion, no se guarda');
select pg_temp.falla(format('select public.editar_pasajero_silla(%s, %L::jsonb)', pg_temp.id('s1'),
  json_build_object('tipo_doc', 'CC', 'plazo', (current_date + 5)::text)::text),
  'indica el pasajero (nombre o apellido) y la fecha de plazo', 'plazo sin pasajero: validacion');
select pg_temp.ok((select estado::text = 'disponible' and not public._silla_con_datos(s) from public.sillas s where id = pg_temp.id('s1')),
  'tras los rechazos la silla sigue vacia y disponible');

-- Pasajero primero (retención en plazo): asignar, quitar y volver a asignar sin perder sus datos.
select public.editar_pasajero_silla(pg_temp.id('s1'), json_build_object('pasajero_nombres', 'PRUEBA', 'pasajero_apellidos', 'UNO',
  'tipo_doc', 'CC', 'numero_doc', '201', 'plazo', (public.fecha_negocio(now()) + 5)::text)::jsonb);
select pg_temp.ok((select pasajero_nombres = 'PRUEBA' and contrato_manual is null and estado::text = 'en_plazo'
  from public.sillas where id = pg_temp.id('s1')), 'pasajero antes del contrato: queda retenido en_plazo');
select pg_temp.ok((select not public._silla_libre(s) from public.sillas s where id = pg_temp.id('s1')), 'la retencion no es vendible');
select public.asignar_contrato_manual(pg_temp.id('s1'), 'EXT-201-A');
select pg_temp.ok((select pasajero_nombres = 'PRUEBA' and contrato_manual = 'EXT-201-A' and estado::text = 'confirmada'
  from public.sillas where id = pg_temp.id('s1')), 'asignar a la retencion la confirma y conserva pasajero');
select pg_temp.falla(format('select public.cambiar_estado_silla(%s, %L, %L, false)',
  pg_temp.id('s1'), 'no_vendida', 'prueba'), 'tiene contrato', 'estado manual cerrado con contrato');
select public.quitar_contrato_manual(pg_temp.id('s1'));
select pg_temp.ok((select pasajero_nombres = 'PRUEBA' and contrato_manual is null and estado::text = 'en_plazo' and plazo is not null
  from public.sillas where id = pg_temp.id('s1')), 'quitar contrato conserva pasajero y plazo: vuelve a retencion en_plazo');
select pg_temp.falla(format('select public.cambiar_estado_silla(%s, %L, %L, false)', pg_temp.id('s1'), 'no_vendida', 'x'),
  'Cambio no permitido de en_plazo', 'una retencion no entra a la matriz manual');
select public.asignar_contrato_manual(pg_temp.id('s1'), 'EXT-201-B');
select pg_temp.ok((select contrato_manual = 'EXT-201-B' and estado::text = 'confirmada'
  from public.sillas where id = pg_temp.id('s1')), 'reaplicar contrato tras quitarlo');

-- Contrato primero sigue funcionando (con contrato el plazo no se exige); sin contrato no se confirma a mano.
select public.asignar_contrato_manual(pg_temp.id('s2'), 'EXT-201-C');
select public.editar_pasajero_silla(pg_temp.id('s2'), '{"pasajero_nombres":"PRUEBA DOS"}'::jsonb);
select pg_temp.ok((select pasajero_nombres = 'PRUEBA DOS' and contrato_manual = 'EXT-201-C' and estado::text = 'confirmada'
  from public.sillas where id = pg_temp.id('s2')), 'contrato antes del pasajero');
select pg_temp.falla(format('select public.cambiar_estado_silla(%s, %L, %L, false)',
  pg_temp.id('s3'), 'confirmada', 'prueba'), 'no se hace a mano', 'confirmada exige contrato');
-- Quitar el contrato a un pasajero SIN plazo lo dejaría "aparentemente disponible": se rechaza.
select pg_temp.falla(format('select public.quitar_contrato_manual(%s)', pg_temp.id('s2')),
  'no tiene fecha de plazo', 'quitar contrato (firma vieja) a pasajero sin plazo: validacion, no cambia nada');
select pg_temp.ok((select contrato_manual = 'EXT-201-C' and estado::text = 'confirmada' and pasajero_nombres = 'PRUEBA DOS'
  from public.sillas where id = pg_temp.id('s2')), 'tras el rechazo la silla sigue con su contrato y su pasajero');

-- La matriz manual sigue para la silla vacía sin contrato.
select public.cambiar_estado_silla(pg_temp.id('s3'), 'no_vendida', 'prueba operativa', false);
select pg_temp.falla(format('select public.asignar_contrato_manual(%s, %L)',
  pg_temp.id('s3'), 'EXT-201-D'), 'cupo disponible', 'no asignar sobre no vendida');
select public.cambiar_estado_silla(pg_temp.id('s3'), 'disponible', 'correccion', false);
select public.asignar_contrato_manual(pg_temp.id('s3'), 'EXT-201-D');
select pg_temp.ok((select estado::text = 'confirmada' and contrato_manual = 'EXT-201-D'
  from public.sillas where id = pg_temp.id('s3')), 'volver a disponible y asignar');

reset role;
rollback;
