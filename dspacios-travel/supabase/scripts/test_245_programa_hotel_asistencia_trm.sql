-- SOLO base local/desechable con las migraciones hasta 245 (esquema real). Siempre termina en ROLLBACK.
-- #88 (correcciones): la 245 agrega el proveedor de la asistencia al programa, y al registro de costo de la
-- estancia la asistencia total, su proveedor y la TRM de costos congelada; retira los vínculos a CxP; y deja
-- la base defendiendo que un programa por hotel y vigencia sea solo terrestre. Comprueba cada restricción
-- (aceptar lo válido, rechazar lo inválido), la FK ON DELETE SET NULL, que el registro de costo lo escribe
-- service_role y no lo lee `venta`, y que borrar el contrato borra su registro de costo.
--   psql -h 127.0.0.1 -U supabase_admin -d <base> -v ON_ERROR_STOP=1 -f test_245_programa_hotel_asistencia_trm.sql
\set ON_ERROR_STOP 1
begin;

create function pg_temp.ok(p boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p, false) then raise exception 'FALLO: %', p_msg; end if;
  raise notice 'OK  %', p_msg;
end $$;
-- Ejecuta una sentencia y devuelve 'OK' o 'ERROR: <mensaje>' (no aborta la transacción).
create function pg_temp.intenta(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return 'ERROR: ' || sqlerrm;
end $$;
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

-- ── Fixtures ───────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d2451', 've-r245@local.test'),
  ('00000000-0000-0000-0000-0000000d2452', 'op-r245@local.test');
update public.usuarios set rol = 'venta', tenant = 'mayorista', activo = true, nombre = 'Ve r245' where id = '00000000-0000-0000-0000-0000000d2451';
update public.usuarios set rol = 'operaciones', tenant = 'mayorista', activo = true, nombre = 'Op r245' where id = '00000000-0000-0000-0000-0000000d2452';
select '00000000-0000-0000-0000-0000000d2451' as ve, '00000000-0000-0000-0000-0000000d2452' as op \gset

insert into public.proveedores (nombre) values ('PROV ASISTENCIA R245');
insert into public.programas (nombre, dias, noches, moneda, modo_precio, tipo_transporte, incluye_aereo, proveedor_asistencia_id)
  select '__t245_terrestre__', 4, 3, 'USD', 'hotel', 'terrestre', false, id from public.proveedores where nombre = 'PROV ASISTENCIA R245';

-- ── Columnas de la 245 ────────────────────────────────────────────────────
select pg_temp.ok((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contrato_programa_estancia_costo'
                    and column_name in ('asistencia_total', 'proveedor_asistencia_id', 'trm_costo')) = 3, 'el registro de costo tiene asistencia_total, proveedor_asistencia_id y trm_costo');
select pg_temp.ok((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contrato_programa_estancia_costo'
                    and column_name in ('cxp_programa_id', 'cxp_noches_id')) = 0, 'los vínculos a CxP se retiraron del registro de costo');

-- ── Modo hotel solo terrestre ─────────────────────────────────────────────
select pg_temp.ok(pg_temp.intenta($q$insert into public.programas (nombre, dias, noches, moneda, modo_precio, tipo_transporte) values ('__t245_aereo__', 4, 3, 'USD', 'hotel', 'aereo')$q$) like 'ERROR:%programas_modo_hotel_terrestre_chk%',
  'la base rechaza un programa por hotel con transporte aéreo');
select pg_temp.ok(pg_temp.intenta($q$insert into public.programas (nombre, dias, noches, moneda, modo_precio, incluye_aereo) values ('__t245_aereo2__', 4, 3, 'USD', 'hotel', true)$q$) like 'ERROR:%programas_modo_hotel_terrestre_chk%',
  'la base rechaza un programa por hotel con la bandera heredada incluye_aereo');
select pg_temp.ok(pg_temp.intenta($q$insert into public.programas (nombre, dias, noches, moneda, modo_precio, tipo_transporte) values ('__t245_ninguno__', 4, 3, 'USD', 'hotel', 'ninguno')$q$) = 'OK',
  'acepta un programa por hotel sin traslado');
select pg_temp.ok(pg_temp.intenta($q$insert into public.programas (nombre, dias, noches, moneda, modo_precio, tipo_transporte) values ('__t245_aereo_cat__', 4, 3, 'USD', 'categoria', 'aereo')$q$) = 'OK',
  'los modos de siempre (categoría) siguen pudiendo llevar aéreo');
select pg_temp.ok(pg_temp.intenta($q$update public.programas set tipo_transporte = 'aereo' where nombre = '__t245_terrestre__'$q$) like 'ERROR:%programas_modo_hotel_terrestre_chk%',
  'tampoco se puede pasar a aéreo un programa que ya es por hotel');
select pg_temp.ok(pg_temp.intenta($q$update public.programas set modo_precio = 'categoria', tipo_transporte = 'aereo' where nombre = '__t245_terrestre__'$q$) = 'OK',
  'salir del modo hotel y poner aéreo en el mismo cambio sí se permite');

-- ── Contrato con foto y registro de costo ─────────────────────────────────
insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant)
values ('DTM-9245', 'Cliente', date '2027-03-01', 2, 100, 'pendiente', 'mayorista');
select set_config('role', 'service_role', true);
insert into public.contrato_programa_estancia (numero_contrato, hotel_nombre, modalidad_servicios, moneda, fecha_entrada, noches_incluidas, noches_adicionales, fecha_regreso, base_vigencia_desde, base_vigencia_hasta, precio_base)
values ('DTM-9245', 'H', 'privado', 'USD', '2027-03-01', 3, 1, '2027-03-05', '2027-03-01', '2027-03-31', 100);
insert into public.contrato_programa_estancia_costo (numero_contrato, moneda, neto_base, neto_noches, asistencia_noches, asistencia_total, proveedor_asistencia_id, trm_costo, detalle_noches)
values ('DTM-9245', 'USD', 1200, 200, 8, 56, (select id from public.proveedores where nombre = 'PROV ASISTENCIA R245'), 4000.5, '[]'::jsonb);
select set_config('role', 'supabase_admin', true);
select pg_temp.ok((select count(*) from public.contrato_programa_estancia_costo where numero_contrato = 'DTM-9245' and trm_costo = 4000.5 and asistencia_total = 56) = 1,
  'service_role escribe el registro de costo con asistencia total, proveedor y TRM congelada');
select pg_temp.ok(pg_temp.intenta($q$update public.contrato_programa_estancia_costo set asistencia_total = 7 where numero_contrato = 'DTM-9245'$q$) like 'ERROR:%asistencia_check%',
  'la asistencia total no puede ser menor que la de las noches adicionales (7 < 8)');
select pg_temp.ok(pg_temp.intenta($q$update public.contrato_programa_estancia_costo set asistencia_total = -1, asistencia_noches = 0 where numero_contrato = 'DTM-9245'$q$) like 'ERROR:%asistencia_check%',
  'la asistencia total no puede ser negativa');
select pg_temp.ok(pg_temp.intenta($q$update public.contrato_programa_estancia_costo set trm_costo = 0 where numero_contrato = 'DTM-9245'$q$) like 'ERROR:%trm_check%',
  'la TRM de costos no puede ser 0');
select pg_temp.ok(pg_temp.intenta($q$update public.contrato_programa_estancia_costo set trm_costo = -5 where numero_contrato = 'DTM-9245'$q$) like 'ERROR:%trm_check%',
  'la TRM de costos no puede ser negativa');
select pg_temp.ok(pg_temp.intenta($q$update public.contrato_programa_estancia_costo set trm_costo = 1e11 where numero_contrato = 'DTM-9245'$q$) like 'ERROR:%trm_check%'
                  or pg_temp.intenta($q$update public.contrato_programa_estancia_costo set trm_costo = 1e11 where numero_contrato = 'DTM-9245'$q$) like 'ERROR:%numeric field overflow%',
  'la TRM de costos tiene tope (no cabe 1e11)');
select pg_temp.ok(pg_temp.intenta($q$update public.contrato_programa_estancia_costo set moneda = 'COP' where numero_contrato = 'DTM-9245'$q$) like 'ERROR:%trm_check%',
  'una TRM congelada solo existe en USD: pasar el registro a COP con TRM se rechaza');
select pg_temp.ok(pg_temp.intenta($q$update public.contrato_programa_estancia_costo set moneda = 'COP', trm_costo = null where numero_contrato = 'DTM-9245'$q$) = 'OK',
  'un registro en COP sin TRM es válido');

-- ── Permisos del registro de costo ────────────────────────────────────────
select pg_temp.ok(pg_temp.como('authenticated', :'op', $q$select count(*)::text from public.contrato_programa_estancia_costo$q$) = '1', 'operaciones lee el costo de la estancia');
select pg_temp.ok(pg_temp.como('authenticated', :'ve', $q$select count(*)::text from public.contrato_programa_estancia_costo$q$) = '0', 'venta NO lee el costo de la estancia (asistencia/TRM incluidas)');
select pg_temp.ok(pg_temp.como('authenticated', :'op', $q$update public.contrato_programa_estancia_costo set trm_costo = 1 where numero_contrato = 'DTM-9245' returning 'x'$q$) like 'ERROR:%permission denied%',
  'ni operaciones escribe el registro de costo desde el navegador');
select pg_temp.ok(pg_temp.como('anon', null, $q$select count(*)::text from public.contrato_programa_estancia_costo$q$) like 'ERROR:%permission denied%', 'anon sin privilegios sobre el registro de costo');

-- ── FK del proveedor de asistencia y cascada del contrato ─────────────────
select pg_temp.ok(pg_temp.intenta($q$update public.programas set proveedor_asistencia_id = 999999999 where nombre = '__t245_ninguno__'$q$) like 'ERROR:%foreign key%',
  'un proveedor de asistencia inexistente se rechaza');
delete from public.proveedores where nombre = 'PROV ASISTENCIA R245';
select pg_temp.ok((select proveedor_asistencia_id from public.programas where nombre = '__t245_terrestre__') is null
                  and (select count(*) from public.programas where nombre = '__t245_terrestre__') = 1,
  'borrar el proveedor deja el programa sin proveedor de asistencia (ON DELETE SET NULL)');
delete from public.ventas where numero_contrato = 'DTM-9245';
select pg_temp.ok((select count(*) from public.contrato_programa_estancia_costo where numero_contrato = 'DTM-9245') = 0
                  and (select count(*) from public.contrato_programa_estancia where numero_contrato = 'DTM-9245') = 0,
  'borrar el contrato borra su foto y su registro de costo (cascade)');

rollback;
