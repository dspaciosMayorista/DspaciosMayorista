-- Prueba de la 275 (#82, cuatro bloqueos de auditoría) contra un Postgres LOCAL desechable con 001-274 (+275).
-- Una transacción que termina en ROLLBACK. Cada control imprime: control | esperado | observado | veredicto.
-- Contra la 274 sola debe FALLAR (evidencia); con la 275 debe dar TODO OK.
-- Uso: psql -X -q -t -A -F' | ' -d <base> -f supabase/scripts/test_275_paquete_dinamico_auditoria.sql
begin;
create temp table res (n serial, control text, esperado text, observado text, ok boolean);
create function pg_temp.reg(c text, e text, o text) returns void language sql as $$
  insert into res(control, esperado, observado, ok) values (c, e, o, e is not distinct from o) $$;
-- Ejecuta q con la identidad JWT de uid y el rol authenticated (como PostgREST). Devuelve el 1.er valor o ERR:<código>.
create function pg_temp.como(uid uuid, q text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'session_id', uid)::text, true);
  set local role authenticated;
  begin execute q into r; exception when others then r := 'ERR:' || split_part(sqlerrm, ':', 1); end;
  reset role;
  return r;
end $$;
-- Ejecuta q como dueño (RPC de service_role) y devuelve 'ok:<valor>' o 'ERR:<código>'.
-- Igual que como(), pero devuelve el mensaje COMPLETO del error (para comprobar QUÉ lo originó).
create function pg_temp.como_msg(uid uuid, q text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'session_id', uid)::text, true);
  set local role authenticated;
  begin execute q into r; exception when others then r := 'ERR:' || left(sqlerrm, 120); end;
  reset role;
  return r;
end $$;
create function pg_temp.rpc(q text) returns text language plpgsql as $$
declare r text;
begin
  begin execute q into r; return 'ok:' || coalesce(r, ''); exception when others then return 'ERR:' || split_part(sqlerrm, ':', 1); end;
end $$;

-- ═══ Fixtures ═══
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000002750' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@t275.test' from generate_series(1, 9) n on conflict do nothing;
insert into auth.sessions (id, user_id) select ('00000000-0000-0000-0000-0000002750' || lpad(n::text, 2, '0'))::uuid, ('00000000-0000-0000-0000-0000002750' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 9) n on conflict do nothing;
insert into public.aliados (id, nombre) values (275001, 'Agencia T275');
insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
  ('00000000-0000-0000-0000-000000275001', 'u1@t275.test', 'Super', 'superadmin', true, 'mayorista', null),
  ('00000000-0000-0000-0000-000000275002', 'u2@t275.test', 'AdminM', 'administracion', true, 'mayorista', null),
  ('00000000-0000-0000-0000-000000275003', 'u3@t275.test', 'AdminN', 'administracion', true, 'minorista', null),
  ('00000000-0000-0000-0000-000000275004', 'u4@t275.test', 'GerM', 'gerencia', true, 'mayorista', null),
  ('00000000-0000-0000-0000-000000275005', 'u5@t275.test', 'GerN', 'gerencia', true, 'minorista', null),
  ('00000000-0000-0000-0000-000000275006', 'u6@t275.test', 'VentaM', 'venta', true, 'mayorista', null),
  ('00000000-0000-0000-0000-000000275007', 'u7@t275.test', 'AgenciaM', 'agencia', true, 'mayorista', 275001),
  ('00000000-0000-0000-0000-000000275008', 'u8@t275.test', 'AgenciaN', 'agencia', true, 'minorista', null),
  ('00000000-0000-0000-0000-000000275009', 'u9@t275.test', 'FreelanceOff', 'freelance', false, 'mayorista', null)
  on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id;

insert into public.destinos (id, nombre) values (275001, 'T275 DESTINO');
insert into public.hoteles (id, destino_id, nombre, activo) values
  (275001, 275001, 'H libre', true), (275002, 275001, 'H con temporada', true), (275003, 275001, 'H inactivo', false),
  (275004, 275001, 'H con tarifa', true), (275005, 275001, 'H con calculadora', true);
insert into public.hotel_temporadas (hotel_id, nombre) values (275002, 'ALTA');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, temporada) values (275004, 'STD', 'ALTA');
insert into public.hotel_calculadora (hotel_id, tipo, params) values (275005, 'dubai', '{}'::jsonb);

-- Paquetes (solo_pvp por componente, hotel + vuelo, 3 noches). A mayorista publicado; B minorista; C sin publicar; D inactivo; E compra vencida; F compra futura.
insert into public.paquete_din (id, tenant, nombre, destino_id, moneda, esquema, pvp_modo, usa_vuelo, usa_hotel, noches, compra_inicio, compra_fin, viaje_inicio, viaje_fin, activo, publicado)
select v.id, v.tenant, 'P' || v.id, 275001, 'COP', 'solo_pvp', 'por_componente', true, true, 3, v.ci, v.cf, public.fecha_negocio() + 20, public.fecha_negocio() + 200, v.act, v.pub
from (values
  (275001, 'mayorista', public.fecha_negocio() - 5, public.fecha_negocio() + 100, true, true),
  (275002, 'minorista', public.fecha_negocio() - 5, public.fecha_negocio() + 100, true, true),
  (275003, 'mayorista', public.fecha_negocio() - 5, public.fecha_negocio() + 100, true, false),
  (275004, 'mayorista', public.fecha_negocio() - 5, public.fecha_negocio() + 100, false, true),
  (275005, 'mayorista', public.fecha_negocio() - 50, public.fecha_negocio() - 1, true, true),
  (275006, 'mayorista', public.fecha_negocio() + 1, public.fecha_negocio() + 100, true, true)
) as v(id, tenant, ci, cf, act, pub);
insert into public.paquete_din_hoteles (id, paquete_id, nombre, pvp) select p, p, 'Hotel manual ' || p, '{"doble":1}'::jsonb from generate_series(275001, 275006) p;
insert into public.paquete_din_vuelos (id, paquete_id, ruta, fecha_ida, fecha_regreso, pvp) select p, p, 'BOG-CTG', public.fecha_negocio() + 30, public.fecha_negocio() + 33, '{"adulto":1}'::jsonb from generate_series(275001, 275006) p;

-- ═══ 1. Aislamiento por agencia (PostgREST directo: rol authenticated + JWT) ═══
select pg_temp.reg('RLS: adminM lee su paquete', '1', pg_temp.como('00000000-0000-0000-0000-000000275002', 'select count(*)::text from public.paquete_din where id = 275001'));
select pg_temp.reg('RLS: adminN NO lee paquete de la otra agencia', '0', pg_temp.como('00000000-0000-0000-0000-000000275003', 'select count(*)::text from public.paquete_din where id = 275001'));
select pg_temp.reg('RLS: adminN NO lee hoteles (netas) de la otra agencia', '0', pg_temp.como('00000000-0000-0000-0000-000000275003', 'select count(*)::text from public.paquete_din_hoteles where paquete_id = 275001'));
select pg_temp.reg('RLS: adminN NO lee vuelos (netas) de la otra agencia', '0', pg_temp.como('00000000-0000-0000-0000-000000275003', 'select count(*)::text from public.paquete_din_vuelos where paquete_id = 275001'));
select pg_temp.reg('RLS: adminN NO lee servicios de la otra agencia', '0', pg_temp.como('00000000-0000-0000-0000-000000275003', 'select count(*)::text from public.paquete_din_servicios where paquete_id = 275001'));
select pg_temp.reg('RLS: gerencia de minorista NO lee mayorista', '0', pg_temp.como('00000000-0000-0000-0000-000000275005', 'select count(*)::text from public.paquete_din where id = 275001'));
select pg_temp.reg('RLS: gerencia de mayorista NO lee minorista', '0', pg_temp.como('00000000-0000-0000-0000-000000275004', 'select count(*)::text from public.paquete_din where id = 275002'));
select pg_temp.reg('RLS: gerencia de mayorista sí lee el suyo', '1', pg_temp.como('00000000-0000-0000-0000-000000275004', 'select count(*)::text from public.paquete_din where id = 275001'));
select pg_temp.reg('RLS: superadmin lee ambas agencias', '2', pg_temp.como('00000000-0000-0000-0000-000000275001', 'select count(*)::text from public.paquete_din where id in (275001, 275002)'));
select pg_temp.reg('RLS: adminN NO modifica paquete ajeno', '0', pg_temp.como('00000000-0000-0000-0000-000000275003', 'with u as (update public.paquete_din set nombre = ''HACK'' where id = 275001 returning 1) select count(*)::text from u'));
select pg_temp.reg('RLS: adminN NO modifica hijos (netas) ajenos', '0', pg_temp.como('00000000-0000-0000-0000-000000275003', 'with u as (update public.paquete_din_hoteles set nombre = ''HACK'' where paquete_id = 275001 returning 1) select count(*)::text from u'));
select pg_temp.reg('RLS: adminN NO borra paquete ajeno', '0', pg_temp.como('00000000-0000-0000-0000-000000275003', 'with d as (delete from public.paquete_din where id = 275001 returning 1) select count(*)::text from d'));
select pg_temp.reg('RLS: adminN NO crea paquete en la otra agencia', 'ERR:new row violates row-level security policy for table "paquete_din"',
  pg_temp.como('00000000-0000-0000-0000-000000275003', $q$with i as (insert into public.paquete_din (tenant, nombre, esquema, pvp_modo, usa_hotel, moneda) values ('mayorista', 'X', 'solo_pvp', 'general', true, 'COP') returning 1) select count(*)::text from i$q$));
select pg_temp.reg('RLS: adminN NO cuelga hijos de un paquete ajeno', 'ERR',
  left(pg_temp.como('00000000-0000-0000-0000-000000275003', $q$with i as (insert into public.paquete_din_hoteles (paquete_id, nombre) values (275001, 'X') returning 1) select count(*)::text from i$q$), 3));
select pg_temp.reg('RLS: venta NO lee paquetes', '0', pg_temp.como('00000000-0000-0000-0000-000000275006', 'select count(*)::text from public.paquete_din'));
select pg_temp.reg('RLS: venta NO lee netas de hoteles', '0', pg_temp.como('00000000-0000-0000-0000-000000275006', 'select count(*)::text from public.paquete_din_hoteles'));
select pg_temp.reg('RLS: agencia B2B NO lee paquetes', '0', pg_temp.como('00000000-0000-0000-0000-000000275007', 'select count(*)::text from public.paquete_din'));
select pg_temp.reg('RLS: adminM sí crea en su agencia (control positivo)', '1',
  pg_temp.como('00000000-0000-0000-0000-000000275002', $q$with i as (insert into public.paquete_din (id, tenant, nombre, esquema, pvp_modo, usa_hotel, moneda) values (275100, 'mayorista', 'Nuevo', 'solo_pvp', 'general', true, 'COP') returning 1) select count(*)::text from i$q$));

-- ═══ 4. Hoteles vinculables ═══
select pg_temp.reg('hotel libre es vinculable', 'true', pg_temp.como('00000000-0000-0000-0000-000000275002', 'select public.hotel_vinculable_din(275001)::text'));
select pg_temp.reg('hotel con temporada NO es vinculable', 'false', pg_temp.como('00000000-0000-0000-0000-000000275002', 'select public.hotel_vinculable_din(275002)::text'));
select pg_temp.reg('hotel inactivo NO es vinculable', 'false', pg_temp.como('00000000-0000-0000-0000-000000275002', 'select public.hotel_vinculable_din(275003)::text'));
select pg_temp.reg('hotel con tarifa NO es vinculable', 'false', pg_temp.como('00000000-0000-0000-0000-000000275002', 'select public.hotel_vinculable_din(275004)::text'));
select pg_temp.reg('hotel con calculadora NO es vinculable', 'false', pg_temp.como('00000000-0000-0000-0000-000000275002', 'select public.hotel_vinculable_din(275005)::text'));
select pg_temp.reg('hotel inexistente NO es vinculable', 'false', pg_temp.como('00000000-0000-0000-0000-000000275002', 'select public.hotel_vinculable_din(999999)::text'));
select pg_temp.reg('selector ofrece solo fichas vinculables', '275001', pg_temp.como('00000000-0000-0000-0000-000000275002', 'select string_agg(id::text, '','' order by id) from public.hoteles_vinculables_din() where id between 275001 and 275005'));
select pg_temp.reg('guardar: hotel con tarifas se rechaza en la base', 'ERR:DIN_82_HOTEL',
  pg_temp.como('00000000-0000-0000-0000-000000275002', $q$with i as (insert into public.paquete_din_hoteles (paquete_id, hotel_id, nombre) values (275100, 275002, 'X') returning 1) select count(*)::text from i$q$));
select pg_temp.reg('guardar: hotel inactivo se rechaza en la base', 'ERR:DIN_82_HOTEL',
  pg_temp.como('00000000-0000-0000-0000-000000275002', $q$with i as (insert into public.paquete_din_hoteles (paquete_id, hotel_id, nombre) values (275100, 275003, 'X') returning 1) select count(*)::text from i$q$));
select pg_temp.reg('guardar: ficha libre sí se vincula', '1',
  pg_temp.como('00000000-0000-0000-0000-000000275002', $q$with i as (insert into public.paquete_din_hoteles (paquete_id, hotel_id, nombre) values (275100, 275001, 'Ficha') returning 1) select count(*)::text from i$q$));
select pg_temp.reg('hotel manual sigue disponible', '1',
  pg_temp.como('00000000-0000-0000-0000-000000275002', $q$with i as (insert into public.paquete_din_hoteles (paquete_id, hotel_id, nombre) values (275100, null, 'Manual') returning 1) select count(*)::text from i$q$));

-- ═══ 3. Publicación y fechas (rechazos sin cotizaciones parciales) ═══
create function pg_temp.cab(ida date, reg date, hotel bigint, vuelo bigint, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'payload', jsonb_build_object('cliente', jsonb_build_object('nombres', 'Ana', 'apellidos', 'P', 'email', coalesce(extra->>'email', 'ana@x.co'), 'telefono', coalesce(extra->>'tel', '3001234567')),
      'ninos', 0, 'tarifaNino', 0, 'recobro', 0, 'tipoAsesor', coalesce(extra->>'tipo', 'interno'), 'pax', 2,
      'dinamico', jsonb_build_object('hotelId', hotel, 'vueloId', vuelo)),
    'detalle', jsonb_build_object('venta', jsonb_build_object('precio_venta', 100), 'items', jsonb_build_array(jsonb_build_object('descripcion', 'PAQ', 'cantidad', 1, 'tarifa_unit', 100, 'valor', 100, 'orden', 0))),
    'cliente', 'Ana P', 'destino', 'T275', 'plan_nombre', 'P', 'pax', 2, 'precio_venta', 100, 'moneda', 'COP',
    'fecha_salida', ida::text, 'fecha_regreso', reg::text, 'vigencia_hasta', (public.fecha_negocio() + 10)::text, 'asesor', 'X') $$;
create function pg_temp.srv() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('tipo_servicio', 'aereo', 'nombre_servicio', 'Vuelo', 'costo_neto', 0, 'modo', 'mk', 'pct_markup', 0, 'ta', 0, 'valor', 40, 'componente', 'vuelo', 'exige_costo', true),
    jsonb_build_object('tipo_servicio', 'hotel', 'nombre_servicio', 'Hotel', 'costo_neto', 0, 'modo', 'mk', 'pct_markup', 0, 'ta', 0, 'valor', 60, 'componente', 'hotel', 'exige_costo', true)) $$;
create function pg_temp.cuantas() returns bigint language sql as $$ select count(*) from public.cotizaciones where paquete_din_id is not null $$;
create temp table base(n bigint);
insert into base select pg_temp.cuantas();

create function pg_temp.interno(paq bigint, ida date, reg date, hotel bigint, vuelo bigint) returns text language sql as $$
  select pg_temp.rpc(format($f$select public.crear_cotizacion_din('00000000-0000-0000-0000-000000275001'::uuid, 'mayorista', %s, %L::jsonb, %L::jsonb)::text$f$, paq, pg_temp.cab(ida, reg, hotel, vuelo), pg_temp.srv())) $$;
create function pg_temp.ok_ida() returns date language sql as $$ select public.fecha_negocio() + 30 $$;

select pg_temp.reg('válida: cotización creada', 'ok', left(pg_temp.interno(275001, pg_temp.ok_ida(), pg_temp.ok_ida() + 3, 275001, 275001), 2));
select pg_temp.reg('paquete SIN publicar se rechaza', 'ERR:DIN_82_NO_PUBLICADO', pg_temp.interno(275003, pg_temp.ok_ida(), pg_temp.ok_ida() + 3, 275003, 275003));
select pg_temp.reg('paquete INACTIVO se rechaza', 'ERR:DIN_82_NO_PUBLICADO', pg_temp.interno(275004, pg_temp.ok_ida(), pg_temp.ok_ida() + 3, 275004, 275004));
select pg_temp.reg('compra vencida se rechaza', 'ERR:DIN_82_COMPRA', pg_temp.interno(275005, pg_temp.ok_ida(), pg_temp.ok_ida() + 3, 275005, 275005));
select pg_temp.reg('compra aún no abierta se rechaza', 'ERR:DIN_82_COMPRA', pg_temp.interno(275006, pg_temp.ok_ida(), pg_temp.ok_ida() + 3, 275006, 275006));
select pg_temp.reg('noches distintas a las del paquete se rechazan', 'ERR:DIN_82_FECHAS', pg_temp.interno(275001, pg_temp.ok_ida(), pg_temp.ok_ida() + 5, 275001, 275001));
select pg_temp.reg('salida antes de la ventana de viaje se rechaza', 'ERR:DIN_82_FECHAS', pg_temp.interno(275001, public.fecha_negocio() + 10, public.fecha_negocio() + 13, 275001, 275001));
select pg_temp.reg('regreso después de la ventana de viaje se rechaza', 'ERR:DIN_82_FECHAS', pg_temp.interno(275001, public.fecha_negocio() + 199, public.fecha_negocio() + 202, 275001, 275001));
select pg_temp.reg('fechas del vuelo distintas a las pedidas se rechazan', 'ERR:DIN_82_VUELO', pg_temp.interno(275001, pg_temp.ok_ida() + 1, pg_temp.ok_ida() + 4, 275001, 275001));
select pg_temp.reg('vuelo de otro paquete se rechaza', 'ERR:DIN_82_VUELO', pg_temp.interno(275001, pg_temp.ok_ida(), pg_temp.ok_ida() + 3, 275001, 275003));
select pg_temp.reg('hotel de otro paquete se rechaza', 'ERR:DIN_82_HOTEL', pg_temp.interno(275001, pg_temp.ok_ida(), pg_temp.ok_ida() + 3, 275003, 275001));
select pg_temp.reg('falta el vuelo exigido por el paquete', 'ERR:DIN_82_VUELO', pg_temp.interno(275001, pg_temp.ok_ida(), pg_temp.ok_ida() + 3, 275001, null));
select pg_temp.reg('los 11 rechazos no dejaron cotizaciones (solo la válida)', '1', (pg_temp.cuantas() - (select n from base))::text);

-- ═══ 2. Canales: visitante sin sesión y B2B ═══
create function pg_temp.ext(canal text, actor text, paq bigint, extra jsonb default '{}') returns text language sql as $$
  select pg_temp.rpc(format($f$select public.crear_cotizacion_din_externa(%L, %s, %s, %L::jsonb, %L::jsonb)::text$f$, canal, coalesce(quote_literal(actor) || '::uuid', 'null::uuid'), paq,
    pg_temp.cab(pg_temp.ok_ida(), pg_temp.ok_ida() + 3, 275001, 275001, extra), pg_temp.srv())) $$;
select pg_temp.reg('visitante: cotización creada', 'ok', left(pg_temp.ext('publico', null, 275001, '{"email":"vis@x.co"}'), 2));
select pg_temp.reg('visitante: sin autor ni propietario ni aliado', '0|0|0',
  (select count(creado_por_id)::text || '|' || count(propietario_id) || '|' || count(aliado_id) from public.cotizaciones where cliente_documento is null and payload->'cliente'->>'email' = 'vis@x.co'));
select pg_temp.reg('visitante: enlace público (share_token) y agencia mayorista', 'true|mayorista|abierta',
  (select (share_token is not null)::text || '|' || tenant || '|' || estado from public.cotizaciones where payload->'cliente'->>'email' = 'vis@x.co'));
select pg_temp.reg('visitante: versión 1 sin costos', '1|false',
  (select count(*)::text || '|' || bool_or(v.lineas::text like '%costo%')::text from public.cotizacion_versiones v join public.cotizaciones c on c.id = v.cotizacion_id where c.payload->'cliente'->>'email' = 'vis@x.co'));
select pg_temp.reg('visitante: sin email ni teléfono se rechaza', 'ERR:DIN_82_CONTACTO', pg_temp.ext('publico', null, 275001, '{"email":"","tel":""}'));
select pg_temp.reg('visitante: paquete de minorista se rechaza', 'ERR:DIN_82_PAQUETE', pg_temp.ext('publico', null, 275002, '{"email":"v2@x.co"}'));
select pg_temp.reg('visitante: paquete sin publicar se rechaza', 'ERR:DIN_82_NO_PUBLICADO', pg_temp.ext('publico', null, 275003, '{"email":"v3@x.co"}'));
do $$ begin for i in 1..5 loop perform pg_temp.ext('publico', null, 275001, '{"email":"rep@x.co"}'); end loop; end $$;
select pg_temp.reg('visitante: 5 cotizaciones del mismo contacto pasan', '5', (select count(*)::text from public.cotizaciones where payload->'cliente'->>'email' = 'rep@x.co'));
select pg_temp.reg('visitante: la 6.a en una hora se rechaza (tope por contacto)', 'ERR:DIN_82_LIMITE', pg_temp.ext('publico', null, 275001, '{"email":"rep@x.co"}'));
select pg_temp.reg('B2B: cotización creada', 'ok', left(pg_temp.ext('b2b', '00000000-0000-0000-0000-000000275007', 275001, '{"email":"b2b@x.co","tipo":"agencia"}'), 2));
select pg_temp.reg('B2B: autor, propietario y aliado del usuario', 'true|true|275001',
  (select (creado_por_id = '00000000-0000-0000-0000-000000275007')::text || '|' || (propietario_id = '00000000-0000-0000-0000-000000275007')::text || '|' || aliado_id from public.cotizaciones where payload->'cliente'->>'email' = 'b2b@x.co'));
select pg_temp.reg('B2B: usuario interno NO puede usar el canal', 'ERR:DIN_82_CANAL', pg_temp.ext('b2b', '00000000-0000-0000-0000-000000275006', 275001, '{"email":"x1@x.co"}'));
select pg_temp.reg('B2B: usuario inactivo se rechaza', 'ERR:DIN_82_CANAL', pg_temp.ext('b2b', '00000000-0000-0000-0000-000000275009', 275001, '{"email":"x2@x.co"}'));
select pg_temp.reg('B2B: agencia de OTRA agencia no cotiza paquete ajeno', 'ERR:DIN_82_PAQUETE', pg_temp.ext('b2b', '00000000-0000-0000-0000-000000275008', 275001, '{"email":"x3@x.co"}'));
select pg_temp.reg('canal desconocido se rechaza', 'ERR:DIN_82_CANAL', pg_temp.ext('interno', '00000000-0000-0000-0000-000000275001', 275001, '{"email":"x4@x.co"}'));
select pg_temp.reg('total que no cuadra con los componentes se rechaza', 'ERR:EDICION_39_INCOHERENTE',
  pg_temp.rpc(format($f$select public.crear_cotizacion_din_externa('publico', null::uuid, 275001, %L::jsonb, %L::jsonb)::text$f$, jsonb_set(pg_temp.cab(pg_temp.ok_ida(), pg_temp.ok_ida() + 3, 275001, 275001, '{"email":"y@x.co"}'), '{precio_venta}', '999'), pg_temp.srv())));
select pg_temp.reg('B2B: la cotización queda a nombre del correo del usuario (lo que lista el portal)', 'u7@t275.test', (select creado_por from public.cotizaciones where payload->'cliente'->>'email' = 'b2b@x.co'));


-- ═══ Guardado atómico del paquete ═══
select pg_temp.reg('guardar_paquete_din existe', 'true', (select (to_regprocedure('public.guardar_paquete_din(bigint,jsonb,jsonb,jsonb,jsonb)') is not null)::text));
create temp table pid(v text);
insert into pid select pg_temp.como('00000000-0000-0000-0000-000000275002', $q$select public.guardar_paquete_din(null,
  '{"nombre":"Atómico","destino_id":275001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_vuelo":true,"usa_hotel":true,"usa_servicios":false,"noches":3}'::jsonb,
  '[{"ruta":"BOG-CTG","pvp":{"adulto":1}}]'::jsonb, '[{"nombre":"H","pvp":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$);
-- Sin guardar_paquete_din (solo 274) el valor es un error: se neutraliza para que los demás controles reporten FALLA en vez de abortar.
update pid set v = '0' where v !~ '^[0-9]+$';
select pg_temp.reg('guardar: crea paquete con sus hijos', '1|1|1',
  (select (select count(*) from public.paquete_din where id = (select v from pid)::bigint)::text || '|' || (select count(*) from public.paquete_din_vuelos where paquete_id = (select v from pid)::bigint) || '|' || (select count(*) from public.paquete_din_hoteles where paquete_id = (select v from pid)::bigint)));
select pg_temp.reg('guardar: error en un hijo (hotel con tarifas) se rechaza', 'ERR:DIN_82_HOTEL',
  pg_temp.como('00000000-0000-0000-0000-000000275002', format($q$select public.guardar_paquete_din(%s,
    '{"nombre":"Atómico 2","destino_id":275001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_vuelo":true,"usa_hotel":true,"usa_servicios":false,"noches":3}'::jsonb,
    '[{"ruta":"NUEVA","pvp":{"adulto":2}}]'::jsonb, '[{"nombre":"H2","hotel_id":275002}]'::jsonb, '[]'::jsonb)::text$q$, (select v from pid))));
select pg_temp.reg('guardar: tras el error el paquete y TODOS sus hijos siguen intactos', 'Atómico|BOG-CTG|H',
  (select p.nombre || '|' || (select string_agg(ruta, ',') from public.paquete_din_vuelos where paquete_id = p.id) || '|' || (select string_agg(nombre, ',') from public.paquete_din_hoteles where paquete_id = p.id) from public.paquete_din p where p.id = (select v from pid)::bigint));
create temp table pid2(v text);
insert into pid2 select pg_temp.como('00000000-0000-0000-0000-000000275002', format($q$select public.guardar_paquete_din(%s,
  '{"nombre":"Atómico 3","destino_id":275001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_vuelo":true,"usa_hotel":true,"usa_servicios":false,"noches":3}'::jsonb,
  '[{"ruta":"NUEVA","pvp":{"adulto":2}}]'::jsonb, '[{"nombre":"H3","pvp":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$, (select v from pid)));
select pg_temp.reg('guardar: edición válida reemplaza hijos y deja el paquete sin publicar', 'Atómico 3|NUEVA|H3|false',
  (select p.nombre || '|' || (select string_agg(ruta, ',') from public.paquete_din_vuelos where paquete_id = p.id) || '|' || (select string_agg(nombre, ',') from public.paquete_din_hoteles where paquete_id = p.id) || '|' || p.publicado::text
     from public.paquete_din p where p.id = (select v from pid)::bigint));
select pg_temp.reg('guardar: adminN no edita paquete de la otra agencia', 'ERR:DIN_82_PAQUETE',
  pg_temp.como('00000000-0000-0000-0000-000000275003', format($q$select public.guardar_paquete_din(%s, '{"nombre":"HACK","destino_id":275001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"general","usa_hotel":true,"noches":3}'::jsonb, '[]'::jsonb, '[{"nombre":"Z"}]'::jsonb, '[]'::jsonb)::text$q$, (select v from pid))));
select pg_temp.reg('guardar: el paquete ajeno no cambió', 'Atómico 3', (select nombre from public.paquete_din where id = (select v from pid)::bigint));
select pg_temp.reg('conteo de uso del destino ve las DOS agencias (adminN)', (select count(*)::text from public.paquete_din where destino_id = 275001 or 275001 = any (destinos_extra)),
  pg_temp.como('00000000-0000-0000-0000-000000275003', $q$select n::text from public.uso_destino_din(275001) where tabla = 'paquete_din'$q$));

-- ═══ Canal B2B y agencia del paquete (Mayorista vs Minorista) ═══
create function pg_temp.ext2(canal text, actor text, paq bigint, hotel bigint, vuelo bigint, extra jsonb default '{}') returns text language sql as $$
  select pg_temp.rpc(format($f$select public.crear_cotizacion_din_externa(%L, %s, %s, %L::jsonb, %L::jsonb)::text$f$, canal, coalesce(quote_literal(actor) || '::uuid', 'null::uuid'), paq,
    pg_temp.cab(pg_temp.ok_ida(), pg_temp.ok_ida() + 3, hotel, vuelo, extra), pg_temp.srv())) $$;
select pg_temp.reg('B2B de Minorista cotiza SU paquete publicado', 'ok', left(pg_temp.ext2('b2b', '00000000-0000-0000-0000-000000275008', 275002, 275002, 275002, '{"email":"n@x.co","tipo":"agencia"}'), 2));
select pg_temp.reg('B2B de Minorista: la cotización queda en Minorista y a nombre de su correo', 'minorista|u8@t275.test',
  (select tenant || '|' || creado_por from public.cotizaciones where payload->'cliente'->>'email' = 'n@x.co'));
select pg_temp.reg('B2B de Mayorista NO cotiza un paquete de Minorista', 'ERR:DIN_82_PAQUETE', pg_temp.ext2('b2b', '00000000-0000-0000-0000-000000275007', 275002, 275002, 275002, '{"email":"m2@x.co"}'));
select pg_temp.reg('visitante NO cotiza un paquete de Minorista', 'ERR:DIN_82_PAQUETE', pg_temp.ext2('publico', null, 275002, 275002, 275002, '{"email":"v9@x.co"}'));
select pg_temp.reg('B2B de Minorista NO cotiza un paquete de Mayorista', 'ERR:DIN_82_PAQUETE', pg_temp.ext2('b2b', '00000000-0000-0000-0000-000000275008', 275001, 275001, 275001, '{"email":"n2@x.co"}'));

-- ═══ destinos_extra: cada id debe existir (crear, editar y escritura directa) ═══
select pg_temp.reg('guardar (crear): destino adicional inexistente se rechaza', 'ERR:DIN_82_DESTINO',
  pg_temp.como('00000000-0000-0000-0000-000000275002', $q$select public.guardar_paquete_din(null,
    '{"nombre":"Extra malo","destino_id":275001,"destinos_extra":[999991],"moneda":"COP","esquema":"solo_pvp","pvp_modo":"general","usa_hotel":true,"noches":3}'::jsonb,
    '[]'::jsonb, '[{"nombre":"H"}]'::jsonb, '[]'::jsonb)::text$q$));
select pg_temp.reg('guardar (crear): no deja paquete ni hijos a medias', '0', (select count(*)::text from public.paquete_din where nombre = 'Extra malo'));
select pg_temp.reg('guardar (editar): destino adicional inexistente se rechaza', 'ERR:DIN_82_DESTINO',
  pg_temp.como('00000000-0000-0000-0000-000000275002', format($q$select public.guardar_paquete_din(%s,
    '{"nombre":"Atómico 4","destino_id":275001,"destinos_extra":[275001,999992],"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_vuelo":true,"usa_hotel":true,"noches":3}'::jsonb,
    '[{"ruta":"X"}]'::jsonb, '[{"nombre":"H9"}]'::jsonb, '[]'::jsonb)::text$q$, (select v from pid))));
select pg_temp.reg('guardar (editar): nada cambió tras el rechazo', 'Atómico 3|NUEVA|H3',
  (select p.nombre || '|' || (select string_agg(ruta, ',') from public.paquete_din_vuelos where paquete_id = p.id) || '|' || (select string_agg(nombre, ',') from public.paquete_din_hoteles where paquete_id = p.id) from public.paquete_din p where p.id = (select v from pid)::bigint));
select pg_temp.reg('guardar: un destino adicional que existe se acepta', 'ok',
  case when pg_temp.como('00000000-0000-0000-0000-000000275002', format($q$select public.guardar_paquete_din(%s,
    '{"nombre":"Atómico 3","destino_id":275001,"destinos_extra":[275001],"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_vuelo":true,"usa_hotel":true,"noches":3}'::jsonb,
    '[{"ruta":"NUEVA","pvp":{"adulto":2}}]'::jsonb, '[{"nombre":"H3","pvp":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$, (select v from pid))) like 'ERR%' then 'ERR' else 'ok' end);
select pg_temp.reg('escritura directa (PostgREST): destinos_extra inexistente se rechaza', 'ERR:DIN_82_DESTINO',
  pg_temp.como('00000000-0000-0000-0000-000000275002', format($q$with u as (update public.paquete_din set destinos_extra = '{999993}' where id = %s returning 1) select count(*)::text from u$q$, (select v from pid))));
select pg_temp.reg('escritura directa: insertar con id inexistente lo rechaza el trigger DIN_82_DESTINO (no RLS ni otro CHECK)', 'ERR:DIN_82_DESTINO: los destinos adicionales {999994} no existen.',
  pg_temp.como_msg('00000000-0000-0000-0000-000000275002', $q$with i as (insert into public.paquete_din (tenant, nombre, esquema, pvp_modo, usa_hotel, moneda, destinos_extra) values ('mayorista', 'Dir', 'solo_pvp', 'general', true, 'COP', '{999994}') returning 1) select count(*)::text from i$q$));
select pg_temp.reg('escritura directa: el insert rechazado no dejó fila', '0', (select count(*)::text from public.paquete_din where nombre = 'Dir'));
select pg_temp.reg('destinos_extra con valor vacío se rechaza', 'ERR:DIN_82_DESTINO',
  pg_temp.rpc(format('with u as (update public.paquete_din set destinos_extra = array[1::bigint, null] where id = %s returning 1) select count(*)::text from u', (select v from pid))));
select pg_temp.reg('el rechazo no dejó ids inexistentes en ningún paquete', '0',
  (select count(*)::text from public.paquete_din p where exists (select 1 from unnest(p.destinos_extra) x where not exists (select 1 from public.destinos d where d.id = x))));

-- ═══ destinos_extra (arreglo sin FK) ═══
insert into public.destinos (id, nombre) values (275002, 'T275 SOLO EN EXTRA'), (275003, 'T275 LIBRE'), (275004, 'T275 OTRO');
update public.paquete_din set destinos_extra = '{275002,275004}' where id = 275001;
select pg_temp.reg('uso: un destino que SOLO está en destinos_extra cuenta (visto desde la otra agencia)', '1',
  pg_temp.como('00000000-0000-0000-0000-000000275003', $q$select n::text from public.uso_destino_din(275002) where tabla = 'paquete_din'$q$));
select pg_temp.reg('uso: un destino sin paquetes cuenta 0', '0',
  pg_temp.como('00000000-0000-0000-0000-000000275003', $q$select n::text from public.uso_destino_din(275003) where tabla = 'paquete_din'$q$));
select pg_temp.reg('borrar un destino que está en destinos_extra se rechaza', 'ERR:DIN_82_DESTINO_EN_USO',
  pg_temp.rpc('with d as (delete from public.destinos where id = 275002 returning 1) select count(*)::text from d'));
select pg_temp.reg('borrar un destino libre sigue permitido', 'ok:1',
  pg_temp.rpc('with d as (delete from public.destinos where id = 275003 returning 1) select count(*)::text from d'));
select pg_temp.reg('fusión: se ejecuta sin error (administración de Mayorista, contexto de sesión real)', '', pg_temp.como_msg('00000000-0000-0000-0000-000000275002', 'select public.fn_fusionar_destino(275002, 275001)::text'));
select pg_temp.reg('fusión: destinos_extra pasa del origen al destino sin repetir el principal ni perder los demás', '{275004}',
  (select destinos_extra::text from public.paquete_din where id = 275001));
select pg_temp.reg('fusión: el destino origen ya no existe', '0', (select count(*)::text from public.destinos where id = 275002));
select pg_temp.reg('fusión: el paquete conserva su destino principal', '275001', (select destino_id::text from public.paquete_din where id = 275001));

select control, esperado, observado, case when ok then 'OK' else 'FALLA' end as veredicto from res order by n;
select case when count(*) filter (where not ok) = 0 then 'TODO OK (' || count(*) || ' controles)' else 'HAY FALLAS: ' || count(*) filter (where not ok) || ' de ' || count(*) end as resumen from res;
rollback;
