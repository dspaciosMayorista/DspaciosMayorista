-- Prueba de la 280 (#82, ficha de hotel sin exigir ausencia de tarifario; categoría y plan propios) contra un Postgres LOCAL desechable con 001-279 + 280.
-- Una transacción que termina en ROLLBACK. Cada control imprime: n | control | esperado | observado | veredicto.
-- Uso: psql -X -q -t -A -F' | ' -d <base> -f - < supabase/scripts/test_280_paquete_dinamico_ficha_sin_tarifario.sql
begin;
create temp table res (n serial, control text, esperado text, observado text, ok boolean);
create function pg_temp.reg(c text, e text, o text) returns void language sql as $$
  insert into res(control, esperado, observado, ok) values (c, e, o, e is not distinct from o) $$;
create function pg_temp.msg(q text) returns text language plpgsql as $$
begin
  begin execute q; return 'ok'; exception when others then return sqlerrm; end;
end $$;
create function pg_temp.val(q text) returns text language plpgsql as $$
declare r text;
begin
  begin execute q into r; exception when others then r := 'ERR:' || left(sqlerrm, 90); end;
  return coalesce(r, '');
end $$;
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000280002', 'u2@t280.test'), ('00000000-0000-0000-0000-000000280003', 'v@t280.test') on conflict do nothing;
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-000000280002', '00000000-0000-0000-0000-000000280002'), ('00000000-0000-0000-0000-000000280003', '00000000-0000-0000-0000-000000280003') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000280002', 'u2@t280.test', 'AdminM', 'administracion', true, 'mayorista')
  on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000280003', 'v@t280.test', 'Vend', 'venta', true, 'mayorista')
  on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
insert into public.destinos (id, nombre, pais) values (280001, 'T280 A', 'Colombia');
insert into public.hoteles (id, destino_id, nombre, activo, moneda) values (280001, 280001, 'H ficha', true, 'COP');


-- Fichas de prueba: 280001 con TODO tipo de tarifario (temporada, tarifa por persona, calculadora) en COP; 280003 en USD con temporada (la tarifa por unidad exige un payload completo; su exclusión por la guarda vieja se cubre en la prueba de la 275) 280002 INACTIVA.
insert into public.hoteles (id, destino_id, nombre, activo, moneda) values (280002, 280001, 'H inactivo', false, 'COP'), (280003, 280001, 'H usd', true, 'USD');
insert into public.hotel_temporadas (hotel_id, nombre) values (280001, 'ALTA'), (280003, 'ALTA');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble) values (280001, 'Estandar', 'PC', 'ALTA', 999999);
insert into public.hotel_calculadora (hotel_id, tipo, params) values (280001, 'dubai', '{}'::jsonb);
select count(*) as cat_antes from public.categorias_habitacion \gset

-- ═══ Esquema ═══
select pg_temp.reg('el trigger de moneda de la ficha ya no existe; el de vinculación sigue', '0|1',
  pg_temp.val($q$select (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_din_hotel_moneda')::text || '|' || (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_din_hotel_vinculable')$q$));
select pg_temp.reg('restricción de longitud de categoría/plan existe', '1',
  pg_temp.val($q$select count(*)::text from pg_constraint where conname = 'paquete_din_hoteles_texto_check'$q$));

-- ═══ Vinculable = ficha activa (el tarifario y la moneda no la excluyen) ═══
select pg_temp.reg('ficha con temporada + tarifa por persona + calculadora ES vinculable', 'true',
  pg_temp.como('00000000-0000-0000-0000-000000280002', $q$select public.hotel_vinculable_din(280001)::text$q$));
select pg_temp.reg('ficha en USD con temporada ES vinculable', 'true',
  pg_temp.como('00000000-0000-0000-0000-000000280002', $q$select public.hotel_vinculable_din(280003)::text$q$));
select pg_temp.reg('ficha inactiva NO es vinculable', 'false', pg_temp.como('00000000-0000-0000-0000-000000280002', $q$select public.hotel_vinculable_din(280002)::text$q$));
select pg_temp.reg('ficha inexistente NO es vinculable', 'false', pg_temp.como('00000000-0000-0000-0000-000000280002', $q$select public.hotel_vinculable_din(2800999)::text$q$));
select pg_temp.reg('el selector ofrece todas las activas del destino (con tarifario y de otra moneda) y no la inactiva', '280001,280003',
  pg_temp.como('00000000-0000-0000-0000-000000280002', $q$select string_agg(id::text, ',' order by id) from public.hoteles_vinculables_din() where id between 280000 and 280999$q$));
select pg_temp.reg('un rol venta no ve el selector', '', pg_temp.como('00000000-0000-0000-0000-000000280003', $q$select coalesce(string_agg(id::text, ','), '') from public.hoteles_vinculables_din() where id between 280000 and 280999$q$));

-- ═══ Guardar con ficha que tiene tarifario, en otra moneda, con categoría y plan NUEVOS ═══
select pg_temp.como('00000000-0000-0000-0000-000000280002', $q$select public.guardar_paquete_din(null, '{"nombre":"G280","destino_id":280001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_hotel":true,"noches":3}'::jsonb,
    '[]'::jsonb, '[{"hotel_id":280001,"nombre":"H ficha tarifa","categoria":"Suite Vista Jardín","regimen":"Todo incluido plus","pvp":{"sencilla":1,"doble":2,"triple":3,"multiple":4,"nino":5,"nino2":6,"infante":0}},
                   {"hotel_id":280003,"nombre":"H usd","categoria":"Estándar","regimen":"PC","pvp":{"sencilla":1,"doble":2,"triple":3,"multiple":4,"nino":5,"nino2":6,"infante":0}}]'::jsonb, '[]'::jsonb)::text$q$);
select pg_temp.reg('ficha con tarifario y ficha USD se guardan en un paquete COP', '2',
  pg_temp.val($q$select count(*)::text from public.paquete_din_hoteles h join public.paquete_din p on p.id = h.paquete_id where p.nombre = 'G280' and h.hotel_id in (280001, 280003)$q$));
select pg_temp.reg('categoría y plan NUEVOS persisten tal cual en el paquete', 'Suite Vista Jardín|Todo incluido plus',
  pg_temp.val($q$select h.categoria || '|' || h.regimen from public.paquete_din_hoteles h join public.paquete_din p on p.id = h.paquete_id where p.nombre = 'G280' and h.hotel_id = 280001$q$));
select pg_temp.reg('los precios guardados son los del paquete (no los 999999 de la ficha)', '2',
  pg_temp.val($q$select (h.pvp->>'doble') from public.paquete_din_hoteles h join public.paquete_din p on p.id = h.paquete_id where p.nombre = 'G280' and h.hotel_id = 280001$q$));
select count(*) as cat_despues from public.categorias_habitacion \gset
select pg_temp.reg('el catálogo global de categorías no cambió', :'cat_antes', :'cat_despues'::text);
select pg_temp.reg('la ficha original no cambió (nombre, moneda, tarifa)', 'H ficha|COP|999999.00',
  pg_temp.val($q$select h.nombre || '|' || h.moneda || '|' || (select neto_doble from public.tarifa_hotel where hotel_id = 280001 limit 1) from public.hoteles h where h.id = 280001$q$));
select pg_temp.reg('guardar con ficha inactiva se rechaza (DIN_82_HOTEL)', 'true',
  (pg_temp.como('00000000-0000-0000-0000-000000280002', $q$select public.guardar_paquete_din(null, '{"nombre":"G280i","destino_id":280001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_hotel":true,"noches":3}'::jsonb,
    '[]'::jsonb, '[{"hotel_id":280002,"nombre":"H inactivo","pvp":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$) like '%DIN_82_HOTEL%')::text);

-- ═══ Longitud de categoría y plan ═══
select pg_temp.reg('categoría de 80 caracteres se acepta', 'ok',
  pg_temp.msg($q$insert into public.paquete_din_hoteles (paquete_id, nombre, capacidad_ninos, edad_infante_max, edad_nino_max, categoria, regimen) values ((select id from public.paquete_din where nombre = 'G280'), 'c80', 1, 2, 10, repeat('x', 80), repeat('y', 80))$q$));
select pg_temp.reg('categoría de 81 caracteres se rechaza', 'true',
  (pg_temp.msg($q$insert into public.paquete_din_hoteles (paquete_id, nombre, capacidad_ninos, edad_infante_max, edad_nino_max, categoria) values ((select id from public.paquete_din where nombre = 'G280'), 'c81', 1, 2, 10, repeat('x', 81))$q$) like '%paquete_din_hoteles_texto_check%')::text);
select pg_temp.reg('plan de 81 caracteres se rechaza', 'true',
  (pg_temp.msg($q$insert into public.paquete_din_hoteles (paquete_id, nombre, capacidad_ninos, edad_infante_max, edad_nino_max, regimen) values ((select id from public.paquete_din where nombre = 'G280'), 'r81', 1, 2, 10, repeat('y', 81))$q$) like '%paquete_din_hoteles_texto_check%')::text);
select pg_temp.reg('un rol venta no puede guardar', 'true',
  (pg_temp.como('00000000-0000-0000-0000-000000280003', $q$select public.guardar_paquete_din(null, '{"nombre":"G280v","destino_id":280001}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)::text$q$) like '%DIN_82_NO_AUTORIZADO%')::text);
select pg_temp.reg('anon no ejecuta hotel_vinculable_din', 'false', pg_temp.val($q$select has_function_privilege('anon', 'public.hotel_vinculable_din(bigint)', 'execute')::text$q$));

select n, control, esperado, observado, case when ok then 'OK' else 'FALLA' end as veredicto from res order by n;
select 'TOTAL: ' || count(*) filter (where ok) || ' OK / ' || count(*) filter (where not ok) || ' FALLA' from res;
rollback;
