-- SOLO base local/desechable con las migraciones hasta 201. Siempre termina en ROLLBACK.
-- Reserva desde tarifario frente a sillas vacías, precargadas (pasajero sin
-- contrato) y con contrato: selección, conteo y copia usan `_silla_libre`;
-- la copia es todo o nada y nunca sobrescribe. Concurrencia real (dos
-- sesiones): supabase/scripts/test_201_reserva_concurrencia.sh.
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
    if position(p_patron in sqlerrm) > 0 then raise notice 'OK % -> «%»', p_msg, sqlerrm; return; end if;
    raise exception 'FALLO: % (error inesperado: %)', p_msg, sqlerrm;
  end;
  raise exception 'FALLO: % (no fallo)', p_msg;
end $$;
create function pg_temp.como(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
create temp table fx (clave text primary key, id bigint);
grant select on fx to public;
create function pg_temp.id(p text) returns bigint language sql stable as $$ select id from fx where clave = p $$;
-- Silla por record y número histórico (el dueño de la prueba no pasa por RLS).
create function pg_temp.s(p_rec text, p_n int) returns bigint language sql stable as $$
  select s.id from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record = p_rec and s.numero_silla = p_n
$$;
-- Fotografía de una silla (todo menos updated_at).
create function pg_temp.foto(p_id bigint) returns text language sql stable as $$
  select (to_jsonb(s) - 'updated_at')::text from public.sillas s where s.id = p_id
$$;
create function pg_temp.libres(p_rec text) returns bigint language sql stable as $$
  select count(*) from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id
   where b.record = p_rec and public._silla_libre(s)
$$;
create function pg_temp.vista(p_rec text) returns bigint language sql stable as $$
  select c.cupos_disponibles from public.cupos_por_bloqueo c where c.record = p_rec
$$;
create function pg_temp.pax(p_nombre text, p_doc text) returns jsonb language sql immutable as $$
  select jsonb_build_object('nombre', p_nombre, 'tipoId', 'CC', 'identificacion', p_doc, 'fechaNacimiento', '1990-01-01')
$$;

-- ── Usuarios y catálogo ─────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d2011', 'cv-r201@local.test'),
  ('00000000-0000-0000-0000-0000000d2012', 'op-r201@local.test');
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'CV r201'
 where id = '00000000-0000-0000-0000-0000000d2011';
update public.usuarios set rol = 'operaciones', tenant = 'mayorista', activo = true, nombre = 'Op r201'
 where id = '00000000-0000-0000-0000-0000000d2012';
insert into public.destinos (nombre) values ('DESTINO R201');
insert into fx select 'destino', id from public.destinos where nombre = 'DESTINO R201';
insert into public.proveedores (nombre) values ('PROVEEDOR R201');
insert into fx select 'proveedor', id from public.proveedores where nombre = 'PROVEEDOR R201';
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total, modalidad_emision)
values ('PR201R', pg_temp.id('destino'), pg_temp.id('proveedor'), current_date + 30, 400000, 10, 'serie'),
       ('PR201D', pg_temp.id('destino'), pg_temp.id('proveedor'), current_date + 30, 400000, 2, 'serie'),
       ('PR201M', pg_temp.id('destino'), pg_temp.id('proveedor'), current_date + 30, 400000, 2, 'serie'),
       ('PR201X', pg_temp.id('destino'), pg_temp.id('proveedor'), current_date + 30, 400000, 2, 'serie'),
       ('PR201Y', pg_temp.id('destino'), pg_temp.id('proveedor'), current_date + 120, 400000, 2, 'serie');
insert into fx select record, id from public.bloqueos_vuelo where record in ('PR201R', 'PR201D', 'PR201M', 'PR201X', 'PR201Y');
insert into public.sillas (bloqueo_id, numero_silla, estado) select pg_temp.id('PR201R'), g, 'disponible' from generate_series(1, 10) g;
insert into public.sillas (bloqueo_id, numero_silla, estado)
select b, g, 'disponible' from unnest(array[pg_temp.id('PR201D'), pg_temp.id('PR201M'), pg_temp.id('PR201X'), pg_temp.id('PR201Y')]) b, generate_series(1, 2) g;

-- Contrato orgánico ajeno en la #4 y los contratos de prueba (todos mayorista).
insert into public.ventas (numero_contrato, cliente, tenant, bloqueo_ref_id) values
  ('DTM-8201', 'ajeno', 'mayorista', pg_temp.id('PR201R')),
  ('DTM-8202', 'reserva b', 'mayorista', pg_temp.id('PR201R')),
  ('DTM-8203', 'reserva c', 'mayorista', pg_temp.id('PR201R')),
  ('DTM-8204', 'reserva d', 'mayorista', pg_temp.id('PR201D')),
  ('DTM-8205', 'contrato manual', 'mayorista', pg_temp.id('PR201M'));
-- Carrito con dos records (B19): la venta sale con el vuelo más temprano.
insert into public.ventas (numero_contrato, cliente, tenant, fecha_salida) values ('DTM-8206', 'carrito', 'mayorista', current_date + 30);
update public.sillas set numero_contrato = 'DTM-8201', estado = 'confirmada', pasajero_nombres = 'AJENO ORG'
 where id = pg_temp.s('PR201R', 4);
update public.sillas set estado = 'cambio_entrante' where id = pg_temp.s('PR201R', 9);

-- Estado operativo armado con las funciones de vuelos (como control_vuelo).
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000d2011');
-- Precargas = retenciones en plazo (pasajero + fecha de plazo, sin contrato).
select public.editar_pasajero_silla(pg_temp.s('PR201R', 2), '{"pasajero_nombres":"PRECARGA","pasajero_apellidos":"COMPLETA","tipo_doc":"CC","numero_doc":"222","nacimiento":"1980-05-05","plazo":"2099-12-31"}'::jsonb);
select public.editar_pasajero_silla(pg_temp.s('PR201R', 3), '{"pasajero_apellidos":"SOLO APELLIDO","tipo_doc":"PA","plazo":"2099-12-31"}'::jsonb);
select public.editar_pasajero_silla(pg_temp.s('PR201R', 5), json_build_object('pasajero_nombres', 'VENCIDA', 'hotel', 'HOTEL PRECARGA',
  'plazo', public.fecha_negocio(now())::text)::jsonb);
select public.asignar_contrato_manual(pg_temp.s('PR201R', 6), 'EXT-201R');
reset role;
-- Pasa el tiempo: la retención de la #5 vence (plazo de ayer en Bogotá). El dueño
-- simula el paso de los días; la app no deja fijar un plazo ya vencido.
update public.sillas set plazo = public.fecha_negocio(now()) - 1 where id = pg_temp.s('PR201R', 5);
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000d2011');
select public.retirar_cupo(pg_temp.s('PR201R', 7), 'hueco', '20120120-0000-0000-0000-0000000000a7');
select public.cambiar_estado_silla(pg_temp.s('PR201R', 8), 'no_vendida', 'cierre', false);
reset role;

create temp table identidad as
  select s.id, s.bloqueo_id, s.numero_silla from public.sillas s where s.bloqueo_id in (pg_temp.id('PR201R'), pg_temp.id('PR201D'));
create temp table ajeno_antes as
  select 'venta' k, (to_jsonb(v) - 'updated_at')::text f from public.ventas v where v.numero_contrato = 'DTM-8201'
  union all select 's' || n, pg_temp.foto(pg_temp.s('PR201R', n)) from unnest(array[2, 3, 4, 5, 6, 7, 8]) n
  union all select 'movimientos', md5(coalesce(string_agg(m::text, '|' order by m.id), '')) from public.movimientos_silla m;

-- ═══ 1. Conteo: la vista cuenta lo mismo que toma el núcleo ════════════════
select pg_temp.ok(pg_temp.libres('PR201R') = 3, 'libres de verdad en PR201R: #1, #9 (cambio_entrante) y #10');
select pg_temp.ok(pg_temp.vista('PR201R') = 3, 'cupos_por_bloqueo cuenta 3 (no las precargadas #2/#3/#5, ni contrato, ni retirada/no_vendida)');
select pg_temp.ok(not exists (
  select 1 from public.cupos_por_bloqueo c
   where c.cupos_disponibles <> (select count(*) from public.sillas s where s.bloqueo_id = c.id and public._silla_libre(s))),
  'en TODOS los records la vista coincide con _silla_libre');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000d2011');
select pg_temp.ok((select disponibles >= 0 from public.fn_dashboard_cupos_resumen()), 'el dashboard (INVOKER, authenticated) sigue leyendo la vista');
reset role;
set local role anon;
select pg_temp.falla('select public._silla_libre(s) from public.sillas s limit 1', 'permission denied', 'anon no ejecuta el predicado');
reset role;

-- ═══ 2. Reserva (envoltura de la app): solo sillas libres y copia en la MISMA transacción ═
set local role service_role;
select count(*) from public.crear_pasajeros_contrato_con_sillas('DTM-8202',
  jsonb_build_array(pg_temp.pax('RESERVA UNO', '101'), pg_temp.pax('RESERVA DOS', '102')), 2,
  '00000000-0000-0000-0000-0000000d2012',
  '{"asesor":"ASESOR B","hotel":"HOTEL B","acomodacion":"DOBLE","plazo":"2026-12-01"}'::jsonb,
  '[{"pasajero_nombres":"RESERVA","pasajero_apellidos":"UNO","tipo_doc":"CC","numero_doc":"101","nacimiento":"1990-01-01"},
    {"pasajero_nombres":"RESERVA","pasajero_apellidos":"DOS","tipo_doc":"CC","numero_doc":"102","nacimiento":"1990-01-01"}]'::jsonb);
reset role;
select pg_temp.ok((select array_agg(numero_silla order by numero_silla) from public.sillas where numero_contrato = 'DTM-8202') = array[1, 9],
                  'DTM-8202 tomo #1 y #9 (libres), salto las precargadas #2/#3/#5');
select pg_temp.ok((select string_agg(numero_silla || ':' || estado || '/' || pasajero_apellidos || '/' || numero_doc || '/' || hotel || '/' || plazo, ' ' order by numero_silla)
                     from public.sillas where numero_contrato = 'DTM-8202') = '1:en_plazo/UNO/101/HOTEL B/2026-12-01 9:en_plazo/DOS/102/HOTEL B/2026-12-01',
                  'en la misma transaccion: en_plazo y el pasajero i en la silla i por numero_silla, con los datos comunes');
select pg_temp.ok(not exists (select 1 from ajeno_antes a where a.k like 's%' and a.f is distinct from pg_temp.foto(pg_temp.s('PR201R', substr(a.k, 2)::int))),
                  'precargadas, contrato ajeno, manual, retirada y no_vendida: identicas');
select pg_temp.ok(pg_temp.vista('PR201R') = 1, 'la vista baja a 1 (#10)');

-- ═══ 3. Una segunda copia no sobrescribe (función privada, como dueño) ════
create temp table b_antes as select id, pg_temp.foto(id) f from public.sillas where numero_contrato = 'DTM-8202';
select pg_temp.falla($q$select public._copiar_datos_sillas_contrato('DTM-8202', pg_temp.id('PR201R'), '{}'::jsonb, '[{"pasajero_nombres":"PISA"}]'::jsonb)$q$,
  'ya tienen datos', 'una segunda copia no sobrescribe');
select pg_temp.ok(not exists (select 1 from b_antes where f is distinct from pg_temp.foto(id)), 'tras el rechazo las sillas de DTM-8202 no cambiaron');

-- ═══ 4. Falta de cupo: falla sin cambios parciales ════════════════════════
set local role service_role;
select pg_temp.falla($q$select count(*) from public.crear_pasajeros_contrato_con_sillas('DTM-8203',
  jsonb_build_array(pg_temp.pax('C UNO', '301'), pg_temp.pax('C DOS', '302')), 2, '00000000-0000-0000-0000-0000000d2012',
  '{}'::jsonb, '[{"pasajero_nombres":"C UNO"},{"pasajero_nombres":"C DOS"}]'::jsonb)$q$,
  'No hay suficientes sillas disponibles en el bloqueo (1 disponibles, 2 requeridas)', 'pedir 2 con 1 libre falla (las precargadas no cuentan)');
reset role;
select pg_temp.ok((select count(*) from public.contrato_pasajeros where numero_contrato = 'DTM-8203') = 0
                  and (select count(*) from public.sillas where numero_contrato = 'DTM-8203') = 0
                  and pg_temp.vista('PR201R') = 1,
                  'sin cambios parciales: ni pasajeros, ni sillas, la #10 sigue libre');
select pg_temp.ok(not exists (select 1 from ajeno_antes a where a.k like 's%' and a.f is distinct from pg_temp.foto(pg_temp.s('PR201R', substr(a.k, 2)::int))),
                  'precargadas intactas tras el fallo');
set local role service_role;
select count(*) from public.crear_pasajeros_contrato_con_sillas('DTM-8203', jsonb_build_array(pg_temp.pax('C UNO', '301')), 1,
  '00000000-0000-0000-0000-0000000d2012', '{}'::jsonb, '[{"pasajero_nombres":"C UNO"}]'::jsonb);
reset role;
select pg_temp.ok((select array_agg(numero_silla || ':' || pasajero_nombres) from public.sillas where numero_contrato = 'DTM-8203') = array['10:C UNO'], 'con 1 pax toma la #10 y la copia');
select pg_temp.ok(pg_temp.vista('PR201R') = 0 and pg_temp.libres('PR201R') = 0, 'sin cupos libres aunque haya 3 sillas disponibles con precarga');

-- ═══ 5. Copia rechazada sin escribir nada (función privada; record PR201D) ═
set local role service_role;
select count(*) from public.crear_pasajeros_contrato('DTM-8204', jsonb_build_array(pg_temp.pax('D UNO', '401'), pg_temp.pax('D DOS', '402')), 2, '00000000-0000-0000-0000-0000000d2012');
reset role;
select pg_temp.falla($q$select public._copiar_datos_sillas_contrato('DTM-8204', pg_temp.id('PR201D'), '{}'::jsonb,
  '[{"pasajero_nombres":"D UNO","nacimiento":"1990-01-01"},{"pasajero_nombres":"D DOS","nacimiento":"2026-02-30"}]'::jsonb)$q$,
  'out of range', 'fecha imposible en el 2.º pasajero');
select pg_temp.falla($q$select public._copiar_datos_sillas_contrato('DTM-8204', pg_temp.id('PR201D'), '{}'::jsonb,
  '[{"pasajero_nombres":"A"},{"pasajero_nombres":"B"},{"pasajero_nombres":"C"}]'::jsonb)$q$,
  'no se copió nada', 'mas pasajeros que sillas');
select pg_temp.falla($q$select public._copiar_datos_sillas_contrato('DTM-8204', pg_temp.id('PR201D'), '{"numero_contrato":"X"}'::jsonb, '[]'::jsonb)$q$,
  'Campo no reconocido', 'clave desconocida en datos comunes');
select pg_temp.falla($q$select public._copiar_datos_sillas_contrato('DTM-8204', pg_temp.id('PR201D'), '{}'::jsonb, '[{"estado":"confirmada"}]'::jsonb)$q$,
  'Campo no reconocido', 'un pasajero no puede tocar estado');
select pg_temp.falla($q$select public._copiar_datos_sillas_contrato('DTM-NOEXISTE', pg_temp.id('PR201D'), '{}'::jsonb, '[]'::jsonb)$q$,
  'no existe', 'contrato inexistente');
select pg_temp.ok((select bool_and(not public._silla_con_datos(s)) from public.sillas s where numero_contrato = 'DTM-8204'),
                  'ninguna copia rechazada dejo datos (todo o nada)');
update public.sillas set responsable_menor = 'CARGADO ENTRETANTO' where id = pg_temp.s('PR201D', 2);
select pg_temp.falla($q$select public._copiar_datos_sillas_contrato('DTM-8204', pg_temp.id('PR201D'), '{"hotel":"H"}'::jsonb, '[{"pasajero_nombres":"D UNO"}]'::jsonb)$q$,
  'La(s) silla(s) 2 del contrato DTM-8204 ya tienen datos', 'silla con dato ajeno: no se pisa');
select pg_temp.ok(not public._silla_con_datos((select s from public.sillas s where s.id = pg_temp.s('PR201D', 1)))
                  and (select responsable_menor from public.sillas where id = pg_temp.s('PR201D', 2)) = 'CARGADO ENTRETANTO',
                  'la otra silla tampoco se escribio y el dato ajeno sigue');
update public.sillas set responsable_menor = null where id = pg_temp.s('PR201D', 2);
select pg_temp.ok(public._copiar_datos_sillas_contrato('DTM-8204', pg_temp.id('PR201D'), '{"hotel":"H"}'::jsonb, '[{"pasajero_nombres":"D UNO"}]'::jsonb) = 2,
                  'menos pasajeros que sillas (piso de habitaciones): escribe las 2');
select pg_temp.ok((select string_agg(numero_silla || ':' || coalesce(pasajero_nombres, '-') || '/' || hotel, ' ' order by numero_silla)
                     from public.sillas where numero_contrato = 'DTM-8204') = '1:D UNO/H 2:-/H',
                  'la silla sin pasajero nombrado queda solo con los datos comunes');

-- ═══ 5-bis. Contrato manual: si la copia falla, NO queda contrato a medias ═
-- La envoltura revierte pasajeros, vínculos y sillas; la app (crearContratoInterno
-- y la reserva) revierte la venta con revertir_contrato_incompleto.
set local role service_role;
select pg_temp.falla($q$select count(*) from public.crear_pasajeros_contrato_con_sillas('DTM-8205', jsonb_build_array(pg_temp.pax('M UNO', '501')), 1,
  '00000000-0000-0000-0000-0000000d2012', '{}'::jsonb, '[{"pasajero_nombres":"M UNO","nacimiento":"2026-02-30"}]'::jsonb)$q$,
  'out of range', 'la copia falla dentro de la envoltura');
select pg_temp.falla($q$select count(*) from public.crear_pasajeros_contrato_con_sillas('DTM-8205', jsonb_build_array(pg_temp.pax('M UNO', '501')), 1,
  '00000000-0000-0000-0000-0000000d2012', '{}'::jsonb, '[]'::jsonb)$q$,
  'no corresponden a los pasajeros', 'datos de silla que no cuadran con los pasajeros');
reset role;
select pg_temp.ok((select count(*) from public.contrato_pasajeros where numero_contrato = 'DTM-8205') = 0
                  and (select count(*) from public.sillas where numero_contrato = 'DTM-8205') = 0
                  and pg_temp.libres('PR201M') = 2,
                  'la reserva fallida no dejo pasajeros ni sillas tomadas');
set local role service_role;
select public.revertir_contrato_incompleto('DTM-8205', 'mayorista');
reset role;
select pg_temp.ok(not exists (select 1 from public.ventas where numero_contrato = 'DTM-8205'), 'la venta del contrato manual se revirtio: no queda contrato a medias');

-- ═══ 5-ter. Carrito con dos records (B19): una copia por record ═══════════
-- El 2.º pasajero es infante en el vuelo de +30 días y ya tiene 2 años en el de +120.
set local role service_role;
select count(*) from public.crear_pasajeros_contrato_multi_con_sillas('DTM-8206',
  jsonb_build_array(pg_temp.pax('ADULTO X', '601'),
    jsonb_build_object('nombre', 'BEBE X', 'tipoId', 'RC', 'identificacion', '602',
                       'fechaNacimiento', to_char(current_date + 60 - interval '2 years', 'YYYY-MM-DD'), 'responsableOrden', 1)),
  jsonb_build_array(jsonb_build_object('bloqueoId', pg_temp.id('PR201X'), 'posiciones', jsonb_build_array(1, 2)),
                    jsonb_build_object('bloqueoId', pg_temp.id('PR201Y'), 'posiciones', jsonb_build_array(1, 2))),
  '00000000-0000-0000-0000-0000000d2012',
  jsonb_build_array(jsonb_build_object('bloqueoId', pg_temp.id('PR201X'), 'comun', '{"hotel":"HX"}'::jsonb),
                    jsonb_build_object('bloqueoId', pg_temp.id('PR201Y'), 'comun', '{"hotel":"HY"}'::jsonb)),
  '[{"pasajero_nombres":"ADULTO","numero_doc":"601"},{"pasajero_nombres":"BEBE","numero_doc":"602"}]'::jsonb);
reset role;
select pg_temp.ok((select string_agg(numero_silla || ':' || pasajero_nombres || '/' || hotel, ' ' order by numero_silla)
                     from public.sillas where numero_contrato = 'DTM-8206' and bloqueo_id = pg_temp.id('PR201X')) = '1:ADULTO/HX',
                  'vuelo temprano: solo el adulto ocupa silla y lleva sus datos');
select pg_temp.ok((select string_agg(numero_silla || ':' || pasajero_nombres || '/' || hotel, ' ' order by numero_silla)
                     from public.sillas where numero_contrato = 'DTM-8206' and bloqueo_id = pg_temp.id('PR201Y')) = '1:ADULTO/HY 2:BEBE/HY',
                  'vuelo tardio: el nino ya ocupa silla y la copia le pone SUS datos (misma regla que la reserva)');

-- ═══ 6. Permisos de la copia y de las envolturas ══════════════════════════
set local role service_role;
select pg_temp.falla($q$select public._copiar_datos_sillas_contrato('DTM-8204', 1, '{}'::jsonb, '[]'::jsonb)$q$, 'permission denied', 'service_role no ejecuta la copia suelta');
reset role;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000d2011');
select pg_temp.falla($q$select public._copiar_datos_sillas_contrato('DTM-8204', 1, '{}'::jsonb, '[]'::jsonb)$q$, 'permission denied', 'authenticated no ejecuta la copia');
select pg_temp.falla($q$select count(*) from public.crear_pasajeros_contrato_con_sillas('DTM-8204', '[]'::jsonb, 0, '00000000-0000-0000-0000-0000000d2011', '{}'::jsonb, '[]'::jsonb)$q$, 'permission denied', 'authenticated no ejecuta la envoltura');
select pg_temp.falla($q$select count(*) from public.crear_pasajeros_contrato_multi_con_sillas('DTM-8204', '[]'::jsonb, '[]'::jsonb, '00000000-0000-0000-0000-0000000d2011', '[]'::jsonb, '[]'::jsonb)$q$, 'permission denied', 'authenticated no ejecuta la envoltura multi');
reset role;
set local role anon;
select pg_temp.falla($q$select public._copiar_datos_sillas_contrato('DTM-8204', 1, '{}'::jsonb, '[]'::jsonb)$q$, 'permission denied', 'anon no ejecuta la copia');
select pg_temp.falla($q$select count(*) from public.crear_pasajeros_contrato_con_sillas('DTM-8204', '[]'::jsonb, 0, '00000000-0000-0000-0000-0000000d2011', '{}'::jsonb, '[]'::jsonb)$q$, 'permission denied', 'anon no ejecuta la envoltura');
reset role;

-- ═══ 7. Reversión de la reserva: libera solo SUS sillas ════════════════════
set local role service_role;
select public.revertir_contrato_incompleto('DTM-8202', 'mayorista');
reset role;
select pg_temp.ok((select bool_and(public._silla_libre(s)) from public.sillas s where s.id in (pg_temp.s('PR201R', 1), pg_temp.s('PR201R', 9))),
                  'revertir deja #1 y #9 libres y vacias');
select pg_temp.ok(pg_temp.vista('PR201R') = 2, 'la vista vuelve a 2');
select pg_temp.ok(not exists (select 1 from ajeno_antes a where a.k like 's%' and a.f is distinct from pg_temp.foto(pg_temp.s('PR201R', substr(a.k, 2)::int))),
                  'revertir no toca precargadas ni contratos ajenos');

-- ═══ 8. Crecer un contrato existente: hereda estado y salta precargadas ════
update public.sillas set estado = 'confirmada' where numero_contrato = 'DTM-8203';
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000d2012');   -- operaciones, como en la edición de pasajeros
select holders_total from public.ajustar_sillas_por_pasajeros('DTM-8203', 2);
reset role;
select pg_temp.ok((select array_agg(numero_silla || ':' || estado order by numero_silla) from public.sillas where numero_contrato = 'DTM-8203') = array['1:confirmada', '10:confirmada'],
                  'crece a 2: toma la #1 (no la #2 precargada) y hereda confirmada');

-- ═══ 9. Las reglas aprobadas de la 201 siguen ═════════════════════════════
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000d2011');
select public.asignar_contrato_manual(pg_temp.s('PR201R', 2), 'EXT-201P');
select pg_temp.falla(format('select public.cambiar_estado_silla(%s, %L, %L, false)', pg_temp.s('PR201R', 3), 'no_vendida', 'x'),
  'Cambio no permitido de en_plazo', 'una retencion no entra a la matriz manual');
reset role;
select pg_temp.ok((select contrato_manual = 'EXT-201P' and estado::text = 'confirmada' and pasajero_nombres = 'PRECARGA'
                     from public.sillas where id = pg_temp.s('PR201R', 2)),
                  'la precargada recibe su contrato manual y conserva el pasajero');
select pg_temp.ok((select estado::text = 'en_plazo' and pasajero_apellidos = 'SOLO APELLIDO' from public.sillas where id = pg_temp.s('PR201R', 3)),
                  'la retencion sigue intacta tras el rechazo');

-- ═══ 9-bis. Edición manual con el contrato que vio la pantalla ════════════
create temp table s10_antes as select pg_temp.foto(pg_temp.s('PR201R', 10)) f;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000d2011');
-- La vio libre y sigue libre: se guarda.
select public.editar_pasajero_silla(pg_temp.s('PR201M', 1),
  '{"pasajero_nombres":"PRE M","plazo":"2099-12-31","esperado":{"numero_contrato":null,"contrato_manual":null}}'::jsonb);
-- La vio libre pero ya es de un contrato: rechazo claro, nada escrito.
select pg_temp.falla(format('select public.editar_pasajero_silla(%s, %L::jsonb)', pg_temp.s('PR201R', 10),
  '{"pasajero_nombres":"PISA","esperado":{"numero_contrato":null,"contrato_manual":null}}'),
  'La silla cambió mientras la editabas: ahora es del contrato DTM-8203', 'vista libre, ahora con contrato: se rechaza');
-- La vio con otro contrato manual: rechazo.
select pg_temp.falla(format('select public.editar_pasajero_silla(%s, %L::jsonb)', pg_temp.s('PR201R', 6),
  '{"pasajero_nombres":"PISA","esperado":{"numero_contrato":null,"contrato_manual":"EXT-OTRO"}}'),
  'ahora tiene el contrato manual EXT-201R', 'contrato manual distinto: se rechaza');
-- Estado esperado malformado: rechazo de forma.
select pg_temp.falla(format('select public.editar_pasajero_silla(%s, %L::jsonb)', pg_temp.s('PR201M', 2),
  '{"pasajero_nombres":"X","esperado":{"numero_contrato":null}}'),
  'Estado esperado de la silla inválido', 'esperado incompleto');
-- La vio con SU contrato: edición legítima del pasajero del contrato.
select public.editar_pasajero_silla(pg_temp.s('PR201R', 10),
  '{"pasajero_nombres":"C UNO CORREGIDO","esperado":{"numero_contrato":"DTM-8203","contrato_manual":null}}'::jsonb);
-- Sin esperado: comportamiento de la 194 (compatibilidad).
select public.editar_pasajero_silla(pg_temp.s('PR201M', 2), '{"pasajero_nombres":"SIN ESPERADO","plazo":"2099-12-31"}'::jsonb);
reset role;
select pg_temp.ok((select pasajero_nombres from public.sillas where id = pg_temp.s('PR201M', 1)) = 'PRE M', 'edicion sobre silla que sigue libre: guardada');
select pg_temp.ok((select pasajero_nombres from public.sillas where id = pg_temp.s('PR201R', 10)) = 'C UNO CORREGIDO'
                  and (select numero_contrato from public.sillas where id = pg_temp.s('PR201R', 10)) = 'DTM-8203',
                  'edicion del pasajero del contrato que se veia: guardada, contrato intacto');
select pg_temp.ok((select contrato_manual = 'EXT-201R' and pasajero_nombres is distinct from 'PISA' from public.sillas where id = pg_temp.s('PR201R', 6)),
                  'la silla del contrato manual no cambio');
select pg_temp.ok((select pasajero_nombres from public.sillas where id = pg_temp.s('PR201M', 2)) = 'SIN ESPERADO', 'sin esperado sigue funcionando como en la 194');

-- ═══ 10. Identidad histórica y ajenos ═════════════════════════════════════
select pg_temp.ok(not exists (select 1 from identidad i join public.sillas s on s.id = i.id
                               where s.bloqueo_id <> i.bloqueo_id or s.numero_silla <> i.numero_silla)
                  and (select count(*) from identidad) = (select count(*) from public.sillas s where s.bloqueo_id in (pg_temp.id('PR201R'), pg_temp.id('PR201D'))),
                  'ninguna silla cambio de id, record ni numero_silla; no se crearon ni borraron sillas');
select pg_temp.ok((select estado::text from public.sillas where id = pg_temp.s('PR201R', 7)) = 'retirada', 'la retirada #7 sigue como historial');
select pg_temp.ok((select f from ajeno_antes where k = 'venta') = (select (to_jsonb(v) - 'updated_at')::text from public.ventas v where v.numero_contrato = 'DTM-8201')
                  and (select f from ajeno_antes where k = 's4') = pg_temp.foto(pg_temp.s('PR201R', 4))
                  and (select f from ajeno_antes where k = 's6') = pg_temp.foto(pg_temp.s('PR201R', 6)),
                  'contrato organico ajeno y contrato manual: identicos');
select pg_temp.ok((select f from ajeno_antes where k = 'movimientos') = (select md5(coalesce(string_agg(m::text, '|' order by m.id), '')) from public.movimientos_silla m),
                  'el historial de movimientos no cambio');

rollback;
