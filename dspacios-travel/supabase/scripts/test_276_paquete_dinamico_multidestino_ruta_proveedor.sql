-- Prueba de la 276 (#82, feedback de Preview) contra un Postgres LOCAL desechable con 001-275 (+276).
-- Una transacción que termina en ROLLBACK. Cada control imprime: n | control | esperado | observado | veredicto.
-- Contra la 275 sola debe FALLAR (evidencia); con la 276 debe dar TODO OK.
-- Uso: psql -X -q -t -A -F' | ' -d <base> -f supabase/scripts/test_276_paquete_dinamico_multidestino_ruta_proveedor.sql
begin;
create temp table res (n serial, control text, esperado text, observado text, ok boolean);
create function pg_temp.reg(c text, e text, o text) returns void language sql as $$
  insert into res(control, esperado, observado, ok) values (c, e, o, e is not distinct from o) $$;
-- Ejecuta q como dueño y devuelve 'ok:<valor>' o 'ERR:<código>' (código = texto antes de los dos puntos del mensaje).
create function pg_temp.rpc(q text) returns text language plpgsql as $$
declare r text;
begin
  begin execute q; return 'ok:'; exception when others then return 'ERR:' || split_part(sqlerrm, ':', 1); end;
end $$;
-- Igual, pero deja la transacción intacta ante el error (savepoint implícito del bloque) y devuelve el valor tal cual.
create function pg_temp.val(q text) returns text language plpgsql as $$
declare r text;
begin
  begin execute q into r; exception when others then r := 'ERR:' || split_part(sqlerrm, ':', 1); end;
  return coalesce(r, '');
end $$;
-- Mensaje COMPLETO del error de q (o 'ok').
create function pg_temp.msg(q text) returns text language plpgsql as $$
begin
  begin execute q; return 'ok'; exception when others then return sqlerrm; end;
end $$;
-- Con identidad JWT de uid (administración de Mayorista) como PostgREST.
create function pg_temp.como(uid uuid, q text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'session_id', uid)::text, true);
  set local role authenticated;
  begin execute q into r; exception when others then r := 'ERR:' || left(sqlerrm, 160); end;
  reset role;
  return r;
end $$;

-- ═══ Fixtures ═══
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000276002', 'u2@t276.test') on conflict do nothing;
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-000000276002', '00000000-0000-0000-0000-000000276002') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-0000-0000-000000276002', 'u2@t276.test', 'AdminM', 'administracion', true, 'mayorista')
  on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
insert into public.destinos (id, nombre, codigo_iata, pais) values
  (276001, 'T276 A', 'CTG', 'Colombia'), (276002, 'T276 B', 'SMR', ' COLOMBIA '), (276003, 'T276 C', 'CUN', 'México'), (276004, 'T276 SIN PAIS', null, null);
insert into public.hoteles (id, destino_id, nombre, activo, moneda) values (276001, 276001, 'H USD', true, 'USD'), (276002, 276001, 'H COP', true, 'COP');
insert into public.proveedores (id, nombre) values (276001, 'Proveedor T276');
insert into public.servicios_adicionales (id, nombre, moneda, proveedor_id, destino_id) values
  (276001, 'Tour con proveedor', 'COP', 276001, 276001), (276002, 'Tour sin proveedor', 'COP', null, 276001), (276003, 'Tour en USD', 'USD', 276001, 276001);
insert into public.empaquetados (id, aerolinea, destino_id, ruta, origen, fecha_ida, fecha_regreso) values
  (276001, 'Avianca', 276001, 'MDE - CTG - MDE', 'MDE', public.fecha_negocio() + 30, public.fecha_negocio() + 33),
  (276002, 'Avianca', 276001, null, 'MDE', public.fecha_negocio() + 30, public.fecha_negocio() + 33);

-- Fichas de OTRO destino (276002, adicional del paquete) y un servicio nacional (sin destino).
insert into public.empaquetados (id, aerolinea, destino_id, ruta, origen, fecha_ida, fecha_regreso) values
  (276003, 'Avianca', 276002, 'MDE - SMR - MDE', 'MDE', public.fecha_negocio() + 30, public.fecha_negocio() + 33);
insert into public.servicios_adicionales (id, nombre, moneda, proveedor_id, destino_id) values
  (276004, 'Tour Santa Marta', 'COP', 276001, 276002), (276005, 'Tour nacional', 'COP', 276001, null);

-- Paquete base: multidestino NO activado.
insert into public.paquete_din (id, tenant, nombre, destino_id, moneda, esquema, pvp_modo, usa_vuelo, usa_hotel, usa_servicios, noches)
values (276001, 'mayorista', 'P276', 276001, 'COP', 'solo_pvp', 'por_componente', true, true, true, 3);

-- ═══ 1. Multidestino explícito y país ═══
select pg_temp.reg('multidestino apagado + destinos adicionales (insert directo)', 'ERR:DIN_82_MULTIDESTINO',
  pg_temp.rpc($q$insert into public.paquete_din (id, tenant, nombre, destino_id, destinos_extra, moneda, esquema, pvp_modo, usa_hotel, noches) values (276010, 'mayorista', 'X', 276001, '{276002}', 'COP', 'solo_pvp', 'general', true, 3)$q$));
select pg_temp.reg('multidestino apagado + destinos adicionales (update directo)', 'ERR:DIN_82_MULTIDESTINO',
  pg_temp.rpc($q$update public.paquete_din set destinos_extra = '{276002}' where id = 276001$q$));
select pg_temp.reg('multidestino activado + otro destino del MISMO país (aun con tildes/mayúsculas/espacios distintos)', 'ok:',
  pg_temp.rpc($q$update public.paquete_din set multidestino = true, destinos_extra = '{276002}' where id = 276001$q$));
select pg_temp.reg('multidestino activado + destino de OTRO país', 'ERR:DIN_82_PAIS',
  pg_temp.rpc($q$update public.paquete_din set destinos_extra = '{276002,276003}' where id = 276001$q$));
select pg_temp.reg('el principal sin país no admite adicionales', 'ERR:DIN_82_PAIS',
  pg_temp.rpc($q$update public.paquete_din set destino_id = 276004 where id = 276001$q$));
select pg_temp.reg('el principal no puede repetirse como adicional', 'ERR:DIN_82_MULTIDESTINO',
  pg_temp.rpc($q$update public.paquete_din set destinos_extra = '{276001}' where id = 276001$q$));
select pg_temp.reg('apagar multidestino con adicionales cargados', 'ERR:DIN_82_MULTIDESTINO',
  pg_temp.rpc($q$update public.paquete_din set multidestino = false where id = 276001$q$));
select pg_temp.reg('adicional inexistente sigue rechazado (275)', 'ERR:DIN_82_DESTINO',
  pg_temp.rpc($q$update public.paquete_din set destinos_extra = '{276002,999999}' where id = 276001$q$));
select pg_temp.reg('cambiar el principal a otro país con adicionales cargados', 'ERR:DIN_82_PAIS',
  pg_temp.rpc($q$update public.paquete_din set destino_id = 276003 where id = 276001$q$));
select pg_temp.reg('multidestino activado sin adicionales es válido', 'ok:',
  pg_temp.rpc($q$update public.paquete_din set destinos_extra = '{}' where id = 276001$q$));
update public.paquete_din set destinos_extra = '{276002}' where id = 276001;

-- ═══ 2. Vuelos: destino del paquete y ruta derivada ═══
select pg_temp.reg('vuelo de un destino que NO está en el paquete', 'ERR:DIN_82_DESTINO',
  pg_temp.rpc($q$insert into public.paquete_din_vuelos (paquete_id, destino_id, origen_iata, destino_iata, fecha_ida, fecha_regreso) values (276001, 276003, 'BOG', 'CUN', public.fecha_negocio() + 30, public.fecha_negocio() + 33)$q$));
select pg_temp.reg('vuelo manual sin origen/destino', 'ERR:DIN_82_RUTA',
  pg_temp.rpc($q$insert into public.paquete_din_vuelos (paquete_id, ruta) values (276001, 'BOG-CTG libre')$q$));
select pg_temp.reg('vuelo manual con IATA inválido', 'ERR:DIN_82_RUTA',
  pg_temp.rpc($q$insert into public.paquete_din_vuelos (paquete_id, origen_iata, destino_iata) values (276001, 'BOGOTA', 'CTG')$q$));
select pg_temp.reg('vuelo manual con origen = destino', 'ERR:DIN_82_RUTA',
  pg_temp.rpc($q$insert into public.paquete_din_vuelos (paquete_id, origen_iata, destino_iata) values (276001, 'CTG', 'ctg')$q$));
select pg_temp.reg('vuelo manual ida y vuelta: ruta derivada (el texto libre enviado se ignora)', 'BOG - CTG - BOG',
  pg_temp.val($q$with i as (insert into public.paquete_din_vuelos (paquete_id, ruta, origen_iata, destino_iata, fecha_ida, fecha_regreso) values (276001, 'LO QUE SEA', ' bog', 'ctg ', public.fecha_negocio() + 30, public.fecha_negocio() + 33) returning ruta) select ruta from i$q$));
select pg_temp.reg('vuelo manual solo ida: ruta de un tramo', 'BOG - SMR',
  pg_temp.val($q$with i as (insert into public.paquete_din_vuelos (paquete_id, destino_id, origen_iata, destino_iata, fecha_ida) values (276001, 276002, 'BOG', 'SMR', public.fecha_negocio() + 30) returning ruta) select ruta from i$q$));
select pg_temp.reg('vuelo vinculado: la ruta sale del empaquetado (se ignora la enviada)', 'MDE - CTG - MDE',
  pg_temp.val($q$with i as (insert into public.paquete_din_vuelos (paquete_id, empaquetado_id, ruta, origen_iata, destino_iata) values (276001, 276001, 'OTRA', 'ZZZ', 'YYY') returning ruta) select ruta from i$q$));
select pg_temp.reg('vuelo vinculado: origen/destino IATA salen del empaquetado y su destino', 'MDE>CTG',
  pg_temp.val($q$select origen_iata || '>' || destino_iata from public.paquete_din_vuelos where paquete_id = 276001 and empaquetado_id = 276001$q$));
select pg_temp.reg('vuelo vinculado a un empaquetado sin ruta', 'ERR:DIN_82_RUTA',
  pg_temp.rpc($q$insert into public.paquete_din_vuelos (paquete_id, empaquetado_id) values (276001, 276002)$q$));
select pg_temp.reg('NEGATIVO vuelo vinculado a un empaquetado de OTRO destino presentado como destino principal (destino_id vacío)', 'ERR:DIN_82_DESTINO',
  pg_temp.rpc($q$insert into public.paquete_din_vuelos (paquete_id, empaquetado_id) values (276001, 276003)$q$));
select pg_temp.reg('NEGATIVO ... aunque el destino_id enviado sea válido (el principal, 276001)', 'ERR:DIN_82_DESTINO',
  pg_temp.rpc($q$insert into public.paquete_din_vuelos (paquete_id, empaquetado_id, destino_id) values (276001, 276003, 276001)$q$));
select pg_temp.reg('multidestino permitido: el mismo empaquetado declarando su destino real (adicional 276002)', 'MDE - SMR - MDE',
  pg_temp.val($q$with i as (insert into public.paquete_din_vuelos (paquete_id, empaquetado_id, destino_id) values (276001, 276003, 276002) returning ruta) select ruta from i$q$));
select pg_temp.reg('vuelo manual: no se compara contra ninguna ficha (destino declarado cualquiera del paquete)', 'ok:',
  pg_temp.rpc($q$insert into public.paquete_din_vuelos (paquete_id, destino_id, origen_iata, destino_iata) values (276001, 276002, 'BOG', 'SMR')$q$));

select pg_temp.reg('editar un vuelo manual recalcula la ruta (no queda texto libre)', 'LIM - CTG - LIM',
  pg_temp.val($q$with u as (update public.paquete_din_vuelos set origen_iata = 'LIM', ruta = 'x' where paquete_id = 276001 and origen_iata = 'BOG' and fecha_regreso is not null returning ruta) select ruta from u$q$));

-- ═══ 3. Servicios: proveedor de la ficha, moneda, destino ═══
select pg_temp.reg('servicio vinculado toma el proveedor de la ficha (se ignora el escrito)', 'Proveedor T276|276001',
  pg_temp.val($q$with i as (insert into public.paquete_din_servicios (paquete_id, servicio_id, nombre, proveedor, pvp) values (276001, 276001, 'Tour con proveedor', 'ESCRITO A MANO', 10) returning proveedor || '|' || proveedor_id) select * from i$q$));
select pg_temp.reg('servicio vinculado cuya ficha no tiene proveedor queda SIN proveedor (no se inventa)', '|',
  pg_temp.val($q$with i as (insert into public.paquete_din_servicios (paquete_id, servicio_id, nombre, proveedor, pvp) values (276001, 276002, 'Tour sin proveedor', 'ESCRITO A MANO', 10) returning coalesce(proveedor, '') || '|' || coalesce(proveedor_id::text, '')) select * from i$q$));
select pg_temp.reg('servicio en otra moneda que el paquete', 'ERR:DIN_82_MONEDA',
  pg_temp.rpc($q$insert into public.paquete_din_servicios (paquete_id, servicio_id, nombre, pvp) values (276001, 276003, 'Tour en USD', 10)$q$));
select pg_temp.reg('servicio de un destino que no está en el paquete', 'ERR:DIN_82_DESTINO',
  pg_temp.rpc($q$insert into public.paquete_din_servicios (paquete_id, destino_id, nombre, pvp) values (276001, 276003, 'Manual en otro país', 10)$q$));
select pg_temp.reg('servicio manual conserva el proveedor escrito', 'Mi proveedor',
  pg_temp.val($q$with i as (insert into public.paquete_din_servicios (paquete_id, nombre, proveedor, pvp) values (276001, 'Manual', 'Mi proveedor', 10) returning proveedor) select * from i$q$));
select pg_temp.reg('NEGATIVO servicio vinculado de OTRO destino presentado como destino principal (destino_id vacío)', 'ERR:DIN_82_DESTINO',
  pg_temp.rpc($q$insert into public.paquete_din_servicios (paquete_id, servicio_id, nombre, pvp) values (276001, 276004, 'Tour Santa Marta', 10)$q$));
select pg_temp.reg('NEGATIVO ... aunque el destino_id enviado sea válido (el principal, 276001)', 'ERR:DIN_82_DESTINO',
  pg_temp.rpc($q$insert into public.paquete_din_servicios (paquete_id, servicio_id, destino_id, nombre, pvp) values (276001, 276004, 276001, 'Tour Santa Marta', 10)$q$));
select pg_temp.reg('multidestino permitido: el servicio declarando su destino real (adicional 276002)', 'Proveedor T276',
  pg_temp.val($q$with i as (insert into public.paquete_din_servicios (paquete_id, servicio_id, destino_id, nombre, pvp) values (276001, 276004, 276002, 'Tour Santa Marta', 10) returning proveedor) select * from i$q$));
select pg_temp.reg('servicio nacional (ficha sin destino) se admite con cualquier destino del paquete', 'ok:',
  pg_temp.rpc($q$insert into public.paquete_din_servicios (paquete_id, servicio_id, destino_id, nombre, pvp) values (276001, 276005, 276002, 'Tour nacional', 10)$q$));
select pg_temp.reg('NEGATIVO cambiar el principal a un destino distinto del de las fichas vinculadas que lo declaraban', 'ERR:DIN_82_DESTINO',
  pg_temp.rpc($q$update public.paquete_din set destino_id = 276002, destinos_extra = '{}' where id = 276001$q$));

select pg_temp.reg('hotel ficha en otra moneda que el paquete', 'ERR:DIN_82_MONEDA',
  pg_temp.rpc($q$insert into public.paquete_din_hoteles (paquete_id, hotel_id, nombre) values (276001, 276001, 'H USD')$q$));
select pg_temp.reg('hotel ficha en la moneda del paquete', 'ok:',
  pg_temp.rpc($q$insert into public.paquete_din_hoteles (paquete_id, hotel_id, nombre) values (276001, 276002, 'H COP')$q$));
select pg_temp.reg('cambiar la moneda del paquete con vinculados en la anterior', 'ERR:DIN_82_MONEDA',
  pg_temp.rpc($q$update public.paquete_din set moneda = 'USD' where id = 276001$q$));
select pg_temp.reg('NO se puede publicar con un servicio vinculado sin proveedor en su ficha', 'ERR:DIN_82_PROVEEDOR',
  pg_temp.rpc($q$update public.paquete_din set publicado = true where id = 276001$q$));
select pg_temp.reg('el mensaje de publicación dice QUÉ servicio falta', 'DIN_82_PROVEEDOR: no se puede publicar: la ficha de Tour sin proveedor no tiene proveedor (Producto > Servicios).',
  pg_temp.msg($q$update public.paquete_din set publicado = true where id = 276001$q$));
update public.servicios_adicionales set proveedor_id = 276001 where id = 276002;
select pg_temp.reg('al cargar el proveedor en la ficha, publicar vuelve a leerla y deja publicar', 'ok:',
  pg_temp.rpc($q$update public.paquete_din set publicado = true where id = 276001$q$));
select pg_temp.reg('tras publicar, el servicio ya trae el proveedor de la ficha', 'Proveedor T276',
  pg_temp.val($q$select proveedor from public.paquete_din_servicios where paquete_id = 276001 and servicio_id = 276002$q$));

select pg_temp.reg('el selector de fichas vinculables ofrece la moneda de cada hotel', 'USD|COP',
  pg_temp.como('00000000-0000-0000-0000-000000276002', $q$select (select moneda from public.hoteles_vinculables_din() where id = 276001) || '|' || (select moneda from public.hoteles_vinculables_din() where id = 276002)$q$));

-- ═══ 4. guardar_paquete_din (atómico) con las reglas nuevas, como administración de Mayorista ═══
select pg_temp.reg('guardar: multidestino apagado con adicionales → rechazado', 'DIN_82_MULTIDESTINO',
  split_part(pg_temp.como('00000000-0000-0000-0000-000000276002', $q$select public.guardar_paquete_din(null, '{"nombre":"G1","destino_id":276001,"multidestino":false,"destinos_extra":[276002],"moneda":"COP","esquema":"solo_pvp","pvp_modo":"general","usa_hotel":true,"noches":3}'::jsonb, '[]'::jsonb, '[{"nombre":"H","pvp_general":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$), ':', 2));
select pg_temp.reg('guardar: el rechazo no deja ni cabecera ni hijos a medias', '0|0', (select count(*)::text from public.paquete_din where nombre = 'G1') || '|' || (select count(*)::text from public.paquete_din_hoteles where nombre = 'H' and paquete_id not in (select id from public.paquete_din where nombre = 'G2')));
select pg_temp.reg('guardar: multidestino con adicionales del mismo país', 'num',
  case when pg_temp.como('00000000-0000-0000-0000-000000276002', $q$select public.guardar_paquete_din(null, '{"nombre":"G2","destino_id":276001,"multidestino":true,"destinos_extra":[276002],"moneda":"COP","esquema":"solo_pvp","pvp_modo":"general","usa_hotel":true,"noches":3}'::jsonb, '[]'::jsonb, '[{"nombre":"H","pvp_general":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$) ~ '^[0-9]+$' then 'num' else 'otro' end);
select pg_temp.reg('guardar: adicional de otro país', 'DIN_82_PAIS',
  split_part(pg_temp.como('00000000-0000-0000-0000-000000276002', $q$select public.guardar_paquete_din(null, '{"nombre":"G3","destino_id":276001,"multidestino":true,"destinos_extra":[276003],"moneda":"COP","esquema":"solo_pvp","pvp_modo":"general","usa_hotel":true,"noches":3}'::jsonb, '[]'::jsonb, '[{"nombre":"H","pvp_general":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$), ':', 2));
select pg_temp.como('00000000-0000-0000-0000-000000276002', format($q$select public.guardar_paquete_din(%s, '{"nombre":"G2","destino_id":276001,"multidestino":true,"destinos_extra":[276002],"moneda":"COP","esquema":"solo_pvp","pvp_modo":"general","usa_vuelo":true,"usa_hotel":true,"noches":3}'::jsonb, '[{"ruta":"TEXTO LIBRE","origen_iata":"bog","destino_iata":"ctg","fecha_ida":"2099-01-10","fecha_regreso":"2099-01-13","destino_id":276002}]'::jsonb, '[{"nombre":"H","pvp_general":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$, (select id from public.paquete_din where nombre = 'G2'))) as guardado;
select pg_temp.reg('guardar: vuelo manual con ruta libre enviada → ruta derivada', 'BOG - CTG - BOG',
  pg_temp.val($q$select ruta from public.paquete_din_vuelos where paquete_id = (select id from public.paquete_din where nombre = 'G2')$q$));
select pg_temp.reg('guardar (editar): quitar un destino adicional reemplaza antes sus hijos y NO falla', 'num',
  case when pg_temp.como('00000000-0000-0000-0000-000000276002', format($q$select public.guardar_paquete_din(%s, '{"nombre":"G2","destino_id":276001,"multidestino":false,"destinos_extra":[],"moneda":"COP","esquema":"solo_pvp","pvp_modo":"general","usa_hotel":true,"noches":3}'::jsonb, '[]'::jsonb, '[{"nombre":"H","pvp_general":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$, (select id from public.paquete_din where nombre = 'G2'))) ~ '^[0-9]+$' then 'num' else 'otro' end);

-- ═══ 5. La ficha fuente cambia de destino DESPUÉS de vincularse (paquete publicado y cotizable) ═══
create function pg_temp.cab(ida date, reg date, hotel bigint, vuelo bigint) returns jsonb language sql as $$
  select jsonb_build_object(
    'payload', jsonb_build_object('cliente', jsonb_build_object('nombres', 'Ana', 'apellidos', 'P', 'email', 'ana@x.co', 'telefono', '3001234567'),
      'ninos', 0, 'tarifaNino', 0, 'recobro', 0, 'tipoAsesor', 'interno', 'pax', 2,
      'dinamico', jsonb_build_object('hotelId', hotel, 'vueloId', vuelo)),
    'detalle', jsonb_build_object('venta', jsonb_build_object('precio_venta', 100), 'items', jsonb_build_array(jsonb_build_object('descripcion', 'PAQ', 'cantidad', 1, 'tarifa_unit', 100, 'valor', 100, 'orden', 0))),
    'cliente', 'Ana P', 'destino', 'T276', 'plan_nombre', 'P', 'pax', 2, 'precio_venta', 100, 'moneda', 'COP',
    'fecha_salida', ida::text, 'fecha_regreso', reg::text, 'vigencia_hasta', (public.fecha_negocio() + 10)::text, 'asesor', 'X') $$;
create function pg_temp.srv() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('tipo_servicio', 'aereo', 'nombre_servicio', 'Vuelo', 'costo_neto', 0, 'modo', 'mk', 'pct_markup', 0, 'ta', 0, 'valor', 40, 'componente', 'vuelo', 'exige_costo', true),
    jsonb_build_object('tipo_servicio', 'hotel', 'nombre_servicio', 'Hotel', 'costo_neto', 0, 'modo', 'mk', 'pct_markup', 0, 'ta', 0, 'valor', 60, 'componente', 'hotel', 'exige_costo', true)) $$;
create function pg_temp.cotizar() returns text language sql as $$
  select pg_temp.rpc(format($f$select public.crear_cotizacion_din('00000000-0000-0000-0000-000000276002'::uuid, 'mayorista', 276010, %L::jsonb, %L::jsonb)::text$f$,
    pg_temp.cab(public.fecha_negocio() + 30, public.fecha_negocio() + 33, 276010, 276010), pg_temp.srv())) $$;

insert into public.paquete_din (id, tenant, nombre, destino_id, moneda, esquema, pvp_modo, usa_vuelo, usa_hotel, usa_servicios, noches)
values (276010, 'mayorista', 'P276 publicable', 276001, 'COP', 'solo_pvp', 'por_componente', true, true, true, 3);
insert into public.paquete_din_hoteles (id, paquete_id, nombre, pvp) values (276010, 276010, 'Hotel manual', '{"doble":1}'::jsonb);
insert into public.paquete_din_vuelos (id, paquete_id, empaquetado_id, pvp) values (276010, 276010, 276001, '{"adulto":1}'::jsonb);
insert into public.paquete_din_servicios (id, paquete_id, servicio_id, nombre, pvp) values (276010, 276010, 276001, 'Tour con proveedor', 10);
update public.paquete_din set publicado = true where id = 276010;
create temp table filas0 as select (select count(*) from public.paquete_din_vuelos where paquete_id = 276010) v, (select count(*) from public.paquete_din_servicios where paquete_id = 276010) s,
  (select destino_id from public.paquete_din_vuelos where paquete_id = 276010) vd, (select destino_id from public.paquete_din_servicios where paquete_id = 276010) sd;

select pg_temp.reg('base: con vínculos alineados el paquete publicado SÍ se cotiza', 'ok:', left(pg_temp.cotizar(), 3));

-- Vuelo: el empaquetado cambia de destino después de vincularse.
update public.empaquetados set destino_id = 276002 where id = 276001;
select pg_temp.reg('empaquetado cambia de destino: el paquete publicado YA NO se cotiza', 'ERR:DIN_82_DESTINO', pg_temp.cotizar());
select pg_temp.reg('... y el mensaje nombra el vuelo desalineado', 'true',
  (pg_temp.msg(format($f$select public.crear_cotizacion_din('00000000-0000-0000-0000-000000276002'::uuid, 'mayorista', 276010, %L::jsonb, %L::jsonb)$f$,
    pg_temp.cab(public.fecha_negocio() + 30, public.fecha_negocio() + 33, 276010, 276010), pg_temp.srv())) like '%vuelo MDE - CTG - MDE%')::text);
update public.paquete_din set publicado = false where id = 276010;
select pg_temp.reg('empaquetado desalineado: no se puede volver a publicar', 'ERR:DIN_82_DESTINO', pg_temp.rpc($q$update public.paquete_din set publicado = true where id = 276010$q$));
update public.empaquetados set destino_id = 276001 where id = 276001;
select pg_temp.reg('al restaurar el destino de la ficha vuelve a poder publicarse', 'ok:', pg_temp.rpc($q$update public.paquete_din set publicado = true where id = 276010$q$));
select pg_temp.reg('... y a cotizarse', 'ok:', left(pg_temp.cotizar(), 3));

-- Servicio: la ficha cambia de destino después de vincularse.
update public.servicios_adicionales set destino_id = 276002 where id = 276001;
select pg_temp.reg('servicio cambia de destino: el paquete publicado YA NO se cotiza', 'ERR:DIN_82_DESTINO', pg_temp.cotizar());
select pg_temp.reg('... y el mensaje nombra el servicio desalineado', 'true',
  (pg_temp.msg(format($f$select public.crear_cotizacion_din('00000000-0000-0000-0000-000000276002'::uuid, 'mayorista', 276010, %L::jsonb, %L::jsonb)$f$,
    pg_temp.cab(public.fecha_negocio() + 30, public.fecha_negocio() + 33, 276010, 276010), pg_temp.srv())) like '%servicio Tour con proveedor%')::text);
update public.paquete_din set publicado = false where id = 276010;
select pg_temp.reg('servicio desalineado: no se puede volver a publicar', 'ERR:DIN_82_DESTINO', pg_temp.rpc($q$update public.paquete_din set publicado = true where id = 276010$q$));
update public.servicios_adicionales set destino_id = 276001 where id = 276001;
select pg_temp.reg('al restaurar el destino del servicio vuelve a publicarse y cotizarse', 'ok:ok:',
  pg_temp.rpc($q$update public.paquete_din set publicado = true where id = 276010$q$) || substr(pg_temp.cotizar(), 1, 3));
select pg_temp.reg('la guarda NO modifica ni borra los vínculos (mismas filas y destinos declarados)', 'true',
  (select (v = (select count(*) from public.paquete_din_vuelos where paquete_id = 276010) and s = (select count(*) from public.paquete_din_servicios where paquete_id = 276010)
     and vd is not distinct from (select destino_id from public.paquete_din_vuelos where paquete_id = 276010)
     and sd is not distinct from (select destino_id from public.paquete_din_servicios where paquete_id = 276010))::text from filas0));

select n, control, esperado, observado, case when ok then 'OK' else 'FALLA' end as veredicto from res order by n;
select 'TOTAL: ' || count(*) filter (where ok) || ' OK / ' || count(*) filter (where not ok) || ' FALLA' from res;
rollback;
