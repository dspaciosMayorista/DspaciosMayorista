-- SOLO base local/desechable con las migraciones hasta 244 (esquema real: RLS, grants,
-- triggers de auditoría, FK con cascade y funciones del contrato verdaderos). Siempre
-- termina en ROLLBACK.
-- #88: catálogo de hoteles/vigencias/noches adicionales de un programa por hotel y la
-- foto congelada del contrato. Comprueba: el guardado atómico (crear, conservar ids,
-- reemplazar tarifas, borrar hoteles que ya no vienen), el rechazo de vigencias solapadas
-- (y que no deja nada a medias), la unidad de cobro obligatoria y los valores inválidos,
-- los permisos por rol (anon, agencia, venta, operaciones, superadmin), que los netos no
-- se leen sin rol interno, que la foto del contrato solo la escribe service_role y la ve
-- quien ve el contrato (sin costo para `venta`), el cascade al eliminar el contrato, la
-- renumeración del contrato y la auditoría.
--   psql -h 127.0.0.1 -U supabase_admin -d <base> -v ON_ERROR_STOP=1 -f test_244_programa_hotel_vigencia_noches.sql
\set ON_ERROR_STOP 1
begin;

create function pg_temp.ok(p boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p, false) then raise exception 'FALLO: %', p_msg; end if;
  raise notice 'OK  %', p_msg;
end $$;
-- Ejecuta una consulta como `p_rol` (claims de `p_uid`) y devuelve el texto de la primera
-- columna; un error se devuelve como 'ERROR: <mensaje>' para poder afirmarlo.
create function pg_temp.como(p_rol text, p_uid text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_rol)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
  perform set_config('role', p_rol, true);
  begin
    execute p_sql into v;
  exception when others then
    v := 'ERROR: ' || sqlerrm;
  end;
  perform set_config('role', 'supabase_admin', true);
  return v;
end $$;
grant execute on function pg_temp.como(text, text, text) to public;
-- SQL de guardado: el JSON va como literal (lo arma el administrador, no el rol que prueba).
create function pg_temp.sg(p_pid bigint, p_json text) returns text language sql as $$
  select format('select count(*)::text from (select public.guardar_programa_hoteles(%s, %L::jsonb)) q', p_pid, p_json)
$$;

-- ── Usuarios y fixtures ────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d2441', 'op-r244@local.test'),
  ('00000000-0000-0000-0000-0000000d2442', 've-r244@local.test'),
  ('00000000-0000-0000-0000-0000000d2443', 'ag-r244@local.test'),
  ('00000000-0000-0000-0000-0000000d2444', 'su-r244@local.test');
update public.usuarios set rol = 'operaciones', tenant = 'mayorista', activo = true, nombre = 'Op r244' where id = '00000000-0000-0000-0000-0000000d2441';
update public.usuarios set rol = 'venta',       tenant = 'mayorista', activo = true, nombre = 'Ve r244' where id = '00000000-0000-0000-0000-0000000d2442';
update public.usuarios set rol = 'agencia',     tenant = 'mayorista', activo = true, nombre = 'Ag r244' where id = '00000000-0000-0000-0000-0000000d2443';
update public.usuarios set rol = 'superadmin',  tenant = 'mayorista', activo = true, nombre = 'Su r244' where id = '00000000-0000-0000-0000-0000000d2444';

insert into public.proveedores (nombre) values ('PROV PROGRAMA R244'), ('PROV HOTEL R244');
insert into public.programas (nombre, dias, noches, moneda, proveedor_id, modo_precio)
  select '__t244__', 4, 3, 'USD', id, 'hotel' from public.proveedores where nombre = 'PROV PROGRAMA R244';
insert into public.programas (nombre, dias, noches, moneda, proveedor_id)
  select '__t244_otro__', 4, 3, 'USD', id from public.proveedores where nombre = 'PROV PROGRAMA R244';

create temp table ctx as select
  (select id from public.programas where nombre = '__t244__') as pid,
  (select id from public.programas where nombre = '__t244_otro__') as pid2,
  (select id from public.proveedores where nombre = 'PROV HOTEL R244') as prov_hotel;
grant select on ctx to public;

\set op '00000000-0000-0000-0000-0000000d2441'
\set ve '00000000-0000-0000-0000-0000000d2442'
\set ag '00000000-0000-0000-0000-0000000d2443'
\set su '00000000-0000-0000-0000-0000000d2444'

-- 1. Guardado atómico como operaciones -----------------------------------------
select pg_temp.ok(
  pg_temp.como('authenticated', :'op', pg_temp.sg((select pid from ctx), jsonb_build_array(
    jsonb_build_object('nombre', 'Hotel Centro', 'zona', 'Centro', 'tipo_habitacion', 'Estándar', 'max_pax_habitacion', 4, 'max_menores_habitacion', 2,
      'base', jsonb_build_array(
        jsonb_build_object('desde', '2027-03-01', 'hasta', '2027-03-31', 'modalidad_servicios', 'privado', 'bajo_solicitud', false, 'neto_sencilla', 800, 'neto_doble', 600, 'neto_triple', 520, 'neto_nino', 400),
        jsonb_build_object('desde', '2027-03-01', 'hasta', '2027-03-31', 'modalidad_servicios', 'regular', 'bajo_solicitud', false, 'neto_doble', 450)),
      'noches', jsonb_build_array(
        jsonb_build_object('desde', '2027-03-01', 'hasta', '2027-03-04', 'unidad_cobro', 'persona', 'neto_doble', 100, 'neto_nino', 60),
        jsonb_build_object('desde', '2027-03-05', 'hasta', '2027-03-31', 'unidad_cobro', 'habitacion', 'neto_doble', 220))),
    jsonb_build_object('nombre', 'Hotel Playa', 'zona', 'Playa', 'tipo_habitacion', 'Vista mar', 'proveedor_id', (select prov_hotel from ctx),
      'base', jsonb_build_array(jsonb_build_object('desde', '2027-03-01', 'hasta', '2027-03-31', 'modalidad_servicios', 'privado', 'neto_doble', 700)),
      'noches', jsonb_build_array(jsonb_build_object('desde', '2027-03-01', 'hasta', '2027-03-31', 'unidad_cobro', 'persona', 'neto_doble', 90))))::text)) = '1',
  'operaciones ejecuta guardar_programa_hoteles');
select pg_temp.ok((select count(*) from public.programa_hoteles where programa_id = (select pid from ctx)) = 2, 'se crearon los 2 hoteles');
select pg_temp.ok((select count(*) from public.programa_hotel_precios p join public.programa_hoteles h on h.id = p.hotel_id where h.programa_id = (select pid from ctx)) = 3,
  'se crearon las 3 vigencias base (privado y regular pueden compartir fechas)');
select pg_temp.ok((select count(*) from public.programa_hotel_noches n join public.programa_hoteles h on h.id = n.hotel_id where h.programa_id = (select pid from ctx)) = 3,
  'se crearon las 3 vigencias de noche adicional');
select pg_temp.ok((select n.unidad_cobro from public.programa_hotel_noches n join public.programa_hoteles h on h.id = n.hotel_id
                    where h.nombre = 'Hotel Centro' and n.desde = date '2027-03-05') = 'habitacion', 'la unidad de cobro quedó como se declaró (habitación)');
select pg_temp.ok((select proveedor_id from public.programa_hoteles where nombre = 'Hotel Playa' and programa_id = (select pid from ctx)) = (select prov_hotel from ctx),
  'el proveedor propio del hotel quedó guardado');

-- 2. Reemplazo: conserva ids, cambia tarifas, borra el hotel que ya no viene -----------
create temp table ids_antes as select id, nombre from public.programa_hoteles where programa_id = (select pid from ctx);
grant select on ids_antes to public;
select pg_temp.ok(
  pg_temp.como('authenticated', :'op', pg_temp.sg((select pid from ctx), jsonb_build_array(
    jsonb_build_object('id', (select id from ids_antes where nombre = 'Hotel Centro'), 'nombre', 'Hotel Centro', 'zona', 'Centro 2',
      'base', jsonb_build_array(jsonb_build_object('desde', '2027-04-01', 'hasta', '2027-04-30', 'modalidad_servicios', 'regular', 'neto_doble', 999)),
      'noches', jsonb_build_array(jsonb_build_object('desde', '2027-04-01', 'hasta', '2027-04-30', 'unidad_cobro', 'habitacion', 'neto_doble', 111))))::text)) = '1',
  'el reemplazo se ejecuta');
select pg_temp.ok((select count(*) from public.programa_hoteles where programa_id = (select pid from ctx)) = 1, 'el hotel que ya no viene se borró');
select pg_temp.ok((select id from public.programa_hoteles where programa_id = (select pid from ctx)) = (select id from ids_antes where nombre = 'Hotel Centro'),
  'el hotel que se conserva mantiene su id');
select pg_temp.ok((select zona from public.programa_hoteles where programa_id = (select pid from ctx)) = 'Centro 2', 'sus datos se actualizaron');
select pg_temp.ok((select count(*) from public.programa_hotel_precios where hotel_id = (select id from ids_antes where nombre = 'Hotel Centro')) = 1
              and (select neto_doble from public.programa_hotel_precios where hotel_id = (select id from ids_antes where nombre = 'Hotel Centro')) = 999,
  'sus tarifas base se reemplazaron (no se acumulan)');
select pg_temp.ok((select count(*) from public.programa_hotel_noches where hotel_id = (select id from ids_antes where nombre = 'Hotel Centro')) = 1, 'sus tarifas de noche se reemplazaron');
select pg_temp.ok((select count(*) from public.programa_hotel_precios p where not exists (select 1 from public.programa_hoteles h where h.id = p.hotel_id)) = 0,
  'no quedan tarifas huérfanas del hotel borrado (cascade)');

-- 3. Vigencias solapadas: se rechazan y NO dejan nada a medias ------------------------
create temp table estado_antes as
  select (select count(*) from public.programa_hoteles) as h, (select count(*) from public.programa_hotel_precios) as p, (select count(*) from public.programa_hotel_noches) as n;
select pg_temp.ok(
  pg_temp.como('authenticated', :'op', pg_temp.sg((select pid from ctx), jsonb_build_array(jsonb_build_object('nombre', 'Hotel Solape',
      'base', jsonb_build_array(
        jsonb_build_object('desde', '2027-03-01', 'hasta', '2027-03-20', 'modalidad_servicios', 'privado', 'neto_doble', 1),
        jsonb_build_object('desde', '2027-03-20', 'hasta', '2027-03-31', 'modalidad_servicios', 'privado', 'neto_doble', 2))))::text))
  like 'ERROR:%solapadas%', 'vigencias base solapadas del mismo hotel y modalidad: rechazadas');
select pg_temp.ok(
  pg_temp.como('authenticated', :'op', pg_temp.sg((select pid from ctx), jsonb_build_array(jsonb_build_object('nombre', 'Hotel Solape',
      'noches', jsonb_build_array(
        jsonb_build_object('desde', '2027-03-01', 'hasta', '2027-03-20', 'unidad_cobro', 'persona', 'neto_doble', 1),
        jsonb_build_object('desde', '2027-03-10', 'hasta', '2027-03-31', 'unidad_cobro', 'persona', 'neto_doble', 2))))::text))
  like 'ERROR:%solapadas%', 'vigencias de noche solapadas del mismo hotel: rechazadas');
select pg_temp.ok(
  (select h = (select count(*) from public.programa_hoteles) and p = (select count(*) from public.programa_hotel_precios) and n = (select count(*) from public.programa_hotel_noches) from estado_antes),
  'tras los rechazos el catálogo quedó EXACTAMENTE como estaba (todo o nada)');

-- 4. Unidad de cobro obligatoria, valores inválidos, hotel duplicado, programa ajeno ------
select pg_temp.ok(pg_temp.como('authenticated', :'op', pg_temp.sg((select pid from ctx), jsonb_build_array(jsonb_build_object('nombre', 'X',
      'noches', jsonb_build_array(jsonb_build_object('desde', '2027-03-01', 'hasta', '2027-03-04', 'neto_doble', 5))))::text))
  like 'ERROR:%unidad_cobro%', 'una tarifa de noche SIN unidad de cobro se rechaza (no hay valor por defecto)');
select pg_temp.ok(pg_temp.como('authenticated', :'op', pg_temp.sg((select pid from ctx), jsonb_build_array(jsonb_build_object('nombre', 'X',
      'noches', jsonb_build_array(jsonb_build_object('desde', '2027-03-01', 'hasta', '2027-03-04', 'unidad_cobro', 'noche', 'neto_doble', 5))))::text))
  like 'ERROR:%', 'una unidad de cobro desconocida se rechaza');
select pg_temp.ok(pg_temp.como('authenticated', :'op', pg_temp.sg((select pid from ctx), jsonb_build_array(jsonb_build_object('nombre', 'X',
      'base', jsonb_build_array(jsonb_build_object('desde', '2027-03-01', 'hasta', '2027-03-04', 'modalidad_servicios', 'privado', 'neto_doble', -1))))::text))
  like 'ERROR:%', 'un neto negativo se rechaza');
select pg_temp.ok(pg_temp.como('authenticated', :'op', pg_temp.sg((select pid from ctx), jsonb_build_array(jsonb_build_object('nombre', 'X',
      'base', jsonb_build_array(jsonb_build_object('desde', '2027-03-01', 'hasta', '2027-03-04', 'modalidad_servicios', 'privado', 'neto_doble', 'NaN'))))::text))
  like 'ERROR:%', 'un neto NaN se rechaza');
select pg_temp.ok(pg_temp.como('authenticated', :'op', pg_temp.sg((select pid from ctx), jsonb_build_array(jsonb_build_object('nombre', 'X',
      'base', jsonb_build_array(jsonb_build_object('desde', '2027-03-10', 'hasta', '2027-03-04', 'modalidad_servicios', 'privado', 'neto_doble', 5))))::text))
  like 'ERROR:%', 'una vigencia que termina antes de empezar se rechaza');
select pg_temp.ok(pg_temp.como('authenticated', :'op', pg_temp.sg((select pid from ctx), jsonb_build_array(jsonb_build_object('nombre', 'X',
      'noches', jsonb_build_array(jsonb_build_object('desde', '2027-03-01', 'hasta', '2027-03-04', 'unidad_cobro', 'persona'))))::text))
  like 'ERROR:%', 'una tarifa de noche sin ningún valor se rechaza');
select pg_temp.ok(pg_temp.como('authenticated', :'op', pg_temp.sg((select pid from ctx), jsonb_build_array(jsonb_build_object('nombre', 'Dup'), jsonb_build_object('nombre', ' dup '))::text))
  like 'ERROR:%', 'dos hoteles con el mismo nombre en el mismo programa se rechazan');
select pg_temp.ok(pg_temp.como('authenticated', :'op', pg_temp.sg((select pid2 from ctx), jsonb_build_array(jsonb_build_object('id', (select id from ids_antes where nombre = 'Hotel Centro'), 'nombre', 'Robado'))::text))
  like 'ERROR:%no pertenece%', 'no se puede tomar un hotel de OTRO programa por su id');
select pg_temp.ok(pg_temp.como('authenticated', :'op', pg_temp.sg(99999999, '[]')) like 'ERROR:%no existe%', 'un programa inexistente se rechaza');
select pg_temp.ok(pg_temp.como('authenticated', :'op', pg_temp.sg((select pid from ctx), '{}')) like 'ERROR:%arreglo%', 'la lista de hoteles debe ser un arreglo');

-- 5. Permisos del catálogo (los netos no los lee quien no es interno) ---------------------
select pg_temp.ok(pg_temp.como('authenticated', :'op', 'select count(*)::text from public.programa_hotel_precios') = '1', 'operaciones lee los precios base');
select pg_temp.ok(pg_temp.como('authenticated', :'su', 'select count(*)::text from public.programa_hotel_noches') = '1', 'superadmin lee las noches');
select pg_temp.ok(pg_temp.como('authenticated', :'ve', 'select count(*)::text from public.programa_hotel_precios') = '0', 'venta NO ve ningún neto base (0 filas)');
select pg_temp.ok(pg_temp.como('authenticated', :'ve', 'select count(*)::text from public.programa_hotel_noches') = '0', 'venta NO ve ningún neto de noche (0 filas)');
select pg_temp.ok(pg_temp.como('authenticated', :'ag', 'select count(*)::text from public.programa_hotel_precios') = '0', 'agencia NO ve ningún neto (0 filas)');
select pg_temp.ok(pg_temp.como('authenticated', :'ve', 'select count(*)::text from public.programa_hoteles') = '0', 'venta NO lee el catálogo directo (lo recibe como PVP desde el servidor)');
select pg_temp.ok(pg_temp.como('anon', null, 'select count(*)::text from public.programa_hotel_precios') like 'ERROR:%permission denied%', 'anon sin privilegios sobre los precios base');
select pg_temp.ok(pg_temp.como('anon', null, 'select count(*)::text from public.programa_hoteles') like 'ERROR:%permission denied%', 'anon sin privilegios sobre los hoteles');
select pg_temp.ok(pg_temp.como('anon', null, pg_temp.sg((select pid from ctx), '[]')) like 'ERROR:%permission denied%', 'anon no ejecuta la función');
select pg_temp.ok(pg_temp.como('authenticated', :'ve', pg_temp.sg((select pid from ctx), jsonb_build_array(jsonb_build_object('nombre', 'Venta'))::text)) like 'ERROR:%',
  'venta no puede escribir el catálogo (RLS)');
select pg_temp.ok((select count(*) from public.programa_hoteles where nombre = 'Venta') = 0, 'y no dejó ninguna fila');
select pg_temp.ok(pg_temp.como('authenticated', :'ag', pg_temp.sg((select pid from ctx), jsonb_build_array(jsonb_build_object('nombre', 'Agencia'))::text)) like 'ERROR:%',
  'agencia no puede escribir el catálogo (RLS)');

-- 6. Contrato: foto congelada y costo --------------------------------------------------
insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant)
values ('DTM-9244', 'Cliente r244', date '2027-03-01', 2, 1750, 'pendiente', 'mayorista');
insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, moneda, tenant)
values ('DTM-9244', 'PROV', 'programa', 'Programa', 1400, 'USD', 'mayorista');

select pg_temp.ok(
  pg_temp.como('authenticated', :'op',
    $q$insert into public.contrato_programa_estancia (numero_contrato, hotel_nombre, modalidad_servicios, moneda, fecha_entrada, noches_incluidas, noches_adicionales, fecha_regreso, base_vigencia_desde, base_vigencia_hasta, precio_base)
       values ('DTM-9244', 'H', 'privado', 'USD', '2027-03-01', 3, 1, '2027-03-05', '2027-03-01', '2027-03-31', 1496)$q$) like 'ERROR:%permission denied%',
  'ni siquiera operaciones escribe la foto desde el navegador (solo service_role)');
select pg_temp.ok(
  pg_temp.como('authenticated', :'su', $q$update public.contrato_programa_estancia set precio_base = 0$q$) like 'ERROR:%permission denied%',
  'superadmin tampoco actualiza la foto desde el navegador');

-- service_role (la Server Action) sí escribe.
select set_config('role', 'service_role', true);
insert into public.contrato_programa_estancia (numero_contrato, programa_id, hotel_id, hotel_nombre, zona, modalidad_servicios, moneda, fecha_entrada, noches_incluidas, noches_adicionales,
  fecha_regreso, base_vigencia_desde, base_vigencia_hasta, habitaciones, precio_base, precio_noches, noches, itinerario)
values ('DTM-9244', (select pid from ctx), (select id from ids_antes where nombre = 'Hotel Centro'), 'Hotel Centro', 'Centro', 'privado', 'USD', date '2027-03-01', 3, 1,
  date '2027-03-05', date '2027-03-01', date '2027-03-31', '{"doble":1}'::jsonb, 1496, 254,
  '[{"fecha":"2027-03-04","vigencia_desde":"2027-03-01","vigencia_hasta":"2027-03-04","unidad":"persona","pvp_total":254,"lineas":[]}]'::jsonb, '[{"dia":4,"titulo":"Día libre","libre":true}]'::jsonb);
insert into public.contrato_programa_estancia_costo (numero_contrato, moneda, neto_base, neto_noches, asistencia_noches, detalle_noches, cxp_programa_id)
values ('DTM-9244', 'USD', 1200, 200, 8, '[]'::jsonb, (select id from public.cuentas_por_pagar where numero_contrato = 'DTM-9244'));
select set_config('role', 'supabase_admin', true);
select pg_temp.ok((select count(*) from public.contrato_programa_estancia where numero_contrato = 'DTM-9244') = 1, 'service_role escribe la foto del contrato');
select pg_temp.ok((select count(*) from public.contrato_programa_estancia_costo where numero_contrato = 'DTM-9244') = 1, 'service_role escribe el costo del contrato');

-- Lectura: la foto la ve quien ve el contrato; el costo solo roles contables.
select pg_temp.ok(pg_temp.como('authenticated', :'op', $q$select count(*)::text from public.contrato_programa_estancia$q$) = '1', 'operaciones ve la foto del contrato');
select pg_temp.ok(pg_temp.como('authenticated', :'ve', $q$select count(*)::text from public.contrato_programa_estancia$q$) = '1', 'venta (misma agencia) ve la foto del contrato');
select pg_temp.ok(pg_temp.como('authenticated', :'ag', $q$select count(*)::text from public.contrato_programa_estancia$q$) = '0', 'agencia no ve la foto de un contrato que no es suyo');
select pg_temp.ok(pg_temp.como('authenticated', :'op', $q$select count(*)::text from public.contrato_programa_estancia_costo$q$) = '1', 'operaciones ve el costo de la estancia');
select pg_temp.ok(pg_temp.como('authenticated', :'ve', $q$select count(*)::text from public.contrato_programa_estancia_costo$q$) = '0', 'venta NO ve el costo de la estancia');
select pg_temp.ok(pg_temp.como('authenticated', :'ag', $q$select count(*)::text from public.contrato_programa_estancia_costo$q$) = '0', 'agencia NO ve el costo de la estancia');
select pg_temp.ok(pg_temp.como('anon', null, $q$select count(*)::text from public.contrato_programa_estancia$q$) like 'ERROR:%permission denied%', 'anon sin privilegios sobre la foto del contrato');
select pg_temp.ok(pg_temp.como('anon', null, $q$select count(*)::text from public.contrato_programa_estancia_costo$q$) like 'ERROR:%permission denied%', 'anon sin privilegios sobre el costo');

-- Integridad de la foto.
select pg_temp.ok(
  pg_temp.como('supabase_admin', null, $q$insert into public.contrato_programa_estancia (numero_contrato, hotel_nombre, modalidad_servicios, moneda, fecha_entrada, noches_incluidas, noches_adicionales, fecha_regreso, base_vigencia_desde, base_vigencia_hasta, precio_base)
       values ('NO-EXISTE', 'H', 'privado', 'USD', '2027-03-01', 3, 0, '2027-03-04', '2027-03-01', '2027-03-31', 1)$q$) like 'ERROR:%',
  'no hay foto sin contrato (FK a ventas)');
select pg_temp.ok(
  pg_temp.como('supabase_admin', null, $q$update public.contrato_programa_estancia set fecha_regreso = date '2027-02-01' where numero_contrato = 'DTM-9244'$q$) like 'ERROR:%',
  'el regreso no puede ser anterior a la entrada');
select pg_temp.ok(
  pg_temp.como('supabase_admin', null, $q$update public.contrato_programa_estancia set modalidad_servicios = 'mixto' where numero_contrato = 'DTM-9244'$q$) like 'ERROR:%',
  'la modalidad de servicios solo admite privado | regular');

-- 7. Auditoría -------------------------------------------------------------------------
select pg_temp.ok((select count(*) from public.auditoria where tabla = 'programa_hoteles') >= 1, 'el catálogo de hoteles queda en la auditoría');
select pg_temp.ok((select count(*) from public.auditoria where tabla = 'contrato_programa_estancia') >= 1, 'la foto del contrato queda en la auditoría');

-- 8. Renumerar y eliminar el contrato arrastran la foto ---------------------------------------
select pg_temp.ok(
  pg_temp.como('authenticated', :'su', $t$select count(*)::text from (select public.fn_renumerar_contrato('DTM-9244', 'DTM-9245')) x$t$) = '1',
  'superadmin renumera el contrato');
select pg_temp.ok((select count(*) from public.contrato_programa_estancia where numero_contrato = 'DTM-9245') = 1
              and (select count(*) from public.contrato_programa_estancia where numero_contrato = 'DTM-9244') = 0, 'la foto del contrato siguió al nuevo número');
select pg_temp.ok((select count(*) from public.contrato_programa_estancia_costo where numero_contrato = 'DTM-9245') = 1, 'el costo del contrato siguió al nuevo número');
select pg_temp.ok(
  pg_temp.como('authenticated', :'su', $t$select count(*)::text from (select public.eliminar_contrato('DTM-9245', false)) x$t$) = '1',
  'superadmin elimina el contrato');
select pg_temp.ok((select count(*) from public.contrato_programa_estancia where numero_contrato = 'DTM-9245') = 0
              and (select count(*) from public.contrato_programa_estancia_costo where numero_contrato = 'DTM-9245') = 0, 'al eliminar el contrato se va su foto y su costo (cascade)');

-- 9. La foto no queda atada al catálogo ----------------------------------------------------------
select pg_temp.ok((select count(*) from pg_constraint c where c.conrelid = 'public.contrato_programa_estancia'::regclass and c.contype = 'f') = 1,
  'la foto solo referencia a ventas (no al catálogo, que puede editarse o borrarse)');

\echo '--- FIN test_244 (todo termina en ROLLBACK) ---'
rollback;
