-- Prueba de la 279 (#82, estrellas y ubicación del hotel del paquete) contra un Postgres LOCAL desechable con 001-277 + 279.
-- Una transacción que termina en ROLLBACK. Cada control imprime: n | control | esperado | observado | veredicto.
-- El comportamiento heredado de la 277 se comprueba corriendo test_277_*.sql sobre la MISMA base (debe seguir dando 29 OK).
-- Uso: psql -X -q -t -A -F' | ' -d <base> -f supabase/scripts/test_279_paquete_dinamico_hotel_info.sql
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000279002', 'u2@t279.test'), ('00000000-0000-0000-0000-000000279003', 'v@t279.test') on conflict do nothing;
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-000000279002', '00000000-0000-0000-0000-000000279002'), ('00000000-0000-0000-0000-000000279003', '00000000-0000-0000-0000-000000279003') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000279002', 'u2@t279.test', 'AdminM', 'administracion', true, 'mayorista')
  on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000279003', 'v@t279.test', 'Vend', 'venta', true, 'mayorista')
  on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
insert into public.destinos (id, nombre, pais) values (279001, 'T279 A', 'Colombia');
insert into public.hoteles (id, destino_id, nombre, activo, moneda) values (279001, 279001, 'H ficha', true, 'COP');

-- ═══ Esquema ═══
select pg_temp.reg('columnas estrellas (smallint) y ubicacion (text) existen', 'estrellas:smallint,ubicacion:text',
  pg_temp.val($q$select string_agg(column_name || ':' || data_type, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'paquete_din_hoteles' and column_name in ('estrellas', 'ubicacion')$q$));
select pg_temp.reg('guardar_paquete_din sigue siendo SECURITY INVOKER', 'false',
  pg_temp.val($q$select prosecdef::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'guardar_paquete_din'$q$));

-- ═══ guardar_paquete_din guarda los dos campos nuevos ═══
select pg_temp.reg('hotel MANUAL: persiste estrellas y ubicación', 'num',
  case when pg_temp.como('00000000-0000-0000-0000-000000279002', $q$select public.guardar_paquete_din(null, '{"nombre":"G279","destino_id":279001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_hotel":true,"noches":3}'::jsonb, '[]'::jsonb,
    '[{"nombre":"Hotel M","capacidad_ninos":2,"edad_infante_max":1,"edad_nino_max":11,"estrellas":4,"ubicacion":"Bocagrande, Cartagena","descripcion":"Frente al mar","pvp":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$) ~ '^[0-9]+$' then 'num' else 'otro' end);
select pg_temp.reg('... y quedaron guardados (junto con descripción y capacidad de la 277)', '4|Bocagrande, Cartagena|Frente al mar|2',
  pg_temp.val($q$select h.estrellas || '|' || h.ubicacion || '|' || h.descripcion || '|' || h.capacidad_ninos from public.paquete_din_hoteles h join public.paquete_din p on p.id = h.paquete_id where p.nombre = 'G279'$q$));
select pg_temp.como('00000000-0000-0000-0000-000000279002', $q$select public.guardar_paquete_din(null, '{"nombre":"G279f","destino_id":279001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_hotel":true,"noches":3}'::jsonb, '[]'::jsonb,
    '[{"hotel_id":279001,"nombre":"H ficha","estrellas":5,"ubicacion":"Calle 1","capacidad_ninos":2,"edad_infante_max":1,"edad_nino_max":5,"pvp":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$);
select pg_temp.reg('hotel con FICHA: persiste estrellas y ubicación copiadas y NO guarda capacidad/edades (277)', '5|Calle 1|||',
  pg_temp.val($q$select coalesce(h.estrellas::text, '') || '|' || coalesce(h.ubicacion, '') || '|' || coalesce(h.capacidad_ninos::text, '') || '|' || coalesce(h.edad_infante_max::text, '') || '|' || coalesce(h.edad_nino_max::text, '')
    from public.paquete_din_hoteles h join public.paquete_din p on p.id = h.paquete_id where p.nombre = 'G279f'$q$));
select pg_temp.como('00000000-0000-0000-0000-000000279002', $q$select public.guardar_paquete_din(null, '{"nombre":"G279s","destino_id":279001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_hotel":true,"noches":3}'::jsonb, '[]'::jsonb,
    '[{"nombre":"Sin datos","capacidad_ninos":0,"edad_infante_max":2,"edad_nino_max":10,"pvp":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$);
select pg_temp.reg('SIN DATO: estrellas y ubicación quedan NULL (no se inventa ningún valor)', 'NULL|NULL',
  pg_temp.val($q$select coalesce(h.estrellas::text, 'NULL') || '|' || coalesce(h.ubicacion, 'NULL') from public.paquete_din_hoteles h join public.paquete_din p on p.id = h.paquete_id where p.nombre = 'G279s'$q$));

-- ═══ Restricción de rangos y atomicidad ═══
select pg_temp.reg('estrellas 0 se rechaza', 'true',
  (pg_temp.msg($q$insert into public.paquete_din_hoteles (paquete_id, nombre, capacidad_ninos, edad_infante_max, edad_nino_max, estrellas) values ((select id from public.paquete_din where nombre = 'G279'), 'e0', 1, 2, 10, 0)$q$) like '%paquete_din_hoteles_info_check%')::text);
select pg_temp.reg('estrellas 6 se rechaza', 'true',
  (pg_temp.msg($q$insert into public.paquete_din_hoteles (paquete_id, nombre, capacidad_ninos, edad_infante_max, edad_nino_max, estrellas) values ((select id from public.paquete_din where nombre = 'G279'), 'e6', 1, 2, 10, 6)$q$) like '%paquete_din_hoteles_info_check%')::text);
select pg_temp.reg('ubicación de 501 caracteres se rechaza', 'true',
  (pg_temp.msg($q$insert into public.paquete_din_hoteles (paquete_id, nombre, capacidad_ninos, edad_infante_max, edad_nino_max, ubicacion) values ((select id from public.paquete_din where nombre = 'G279'), 'u501', 1, 2, 10, repeat('x', 501))$q$) like '%paquete_din_hoteles_info_check%')::text);
select pg_temp.reg('ubicación de 500 caracteres se acepta', 'ok',
  pg_temp.msg($q$insert into public.paquete_din_hoteles (paquete_id, nombre, capacidad_ninos, edad_infante_max, edad_nino_max, ubicacion) values ((select id from public.paquete_din where nombre = 'G279'), 'u500', 1, 2, 10, repeat('x', 500))$q$));
select pg_temp.reg('guardar_paquete_din con estrellas inválidas rechaza todo (sin paquete a medias)', 'true|0',
  (pg_temp.como('00000000-0000-0000-0000-000000279002', $q$select public.guardar_paquete_din(null, '{"nombre":"G279bad","destino_id":279001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_hotel":true,"noches":3}'::jsonb, '[]'::jsonb,
    '[{"nombre":"Malo","capacidad_ninos":1,"edad_infante_max":2,"edad_nino_max":10,"estrellas":9}]'::jsonb, '[]'::jsonb)::text$q$) like '%paquete_din_hoteles_info_check%')::text || '|' || (select count(*)::text from public.paquete_din where nombre = 'G279bad'));

-- ═══ Edición: reemplaza los hoteles y deja el paquete sin publicar (comportamiento de la 277) ═══
update public.paquete_din set publicado = true where nombre = 'G279';
select pg_temp.como('00000000-0000-0000-0000-000000279002', $q$select public.guardar_paquete_din((select id from public.paquete_din where nombre = 'G279'), '{"nombre":"G279","destino_id":279001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_hotel":true,"noches":3}'::jsonb, '[]'::jsonb,
      '[{"nombre":"Hotel M","capacidad_ninos":2,"edad_infante_max":1,"edad_nino_max":11,"estrellas":2,"pvp":{"doble":1}}]'::jsonb, '[]'::jsonb)::text$q$);
select pg_temp.reg('editar (p_id) reemplaza los hoteles con las estrellas nuevas y deja el paquete sin publicar', '2|1|false',
  pg_temp.val($q$select (select string_agg(h.estrellas::text, ',') from public.paquete_din_hoteles h where h.paquete_id = p.id) || '|' || (select count(*) from public.paquete_din_hoteles h where h.paquete_id = p.id)::text || '|' || p.publicado::text from public.paquete_din p where p.nombre = 'G279'$q$));

-- ═══ Permisos y reglas heredadas de la 277 ═══
select pg_temp.reg('hotel manual sin capacidad/edades sigue rechazado (DIN_82_MENORES, 277)', 'true',
  (pg_temp.como('00000000-0000-0000-0000-000000279002', $q$select public.guardar_paquete_din(null, '{"nombre":"G279m","destino_id":279001,"moneda":"COP","esquema":"solo_pvp","pvp_modo":"por_componente","usa_hotel":true,"noches":3}'::jsonb, '[]'::jsonb, '[{"nombre":"Sin cap","estrellas":3}]'::jsonb, '[]'::jsonb)::text$q$) like '%DIN_82_MENORES%')::text);
select pg_temp.reg('un rol venta no puede guardar (DIN_82_NO_AUTORIZADO)', 'true',
  (pg_temp.como('00000000-0000-0000-0000-000000279003', $q$select public.guardar_paquete_din(null, '{"nombre":"G279v","destino_id":279001}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)::text$q$) like '%DIN_82_NO_AUTORIZADO%')::text);
select pg_temp.reg('anon no puede ejecutar guardar_paquete_din', 'false',
  pg_temp.val($q$select has_function_privilege('anon', 'public.guardar_paquete_din(bigint, jsonb, jsonb, jsonb, jsonb)', 'execute')::text$q$));
select pg_temp.reg('un rol venta no lee estrellas/ubicación (RLS de paquete_din_hoteles)', '0',
  pg_temp.como('00000000-0000-0000-0000-000000279003', $q$select count(*)::text from public.paquete_din_hoteles$q$));

select n, control, esperado, observado, case when ok then 'OK' else 'FALLA' end as veredicto from res order by n;
select 'TOTAL: ' || count(*) filter (where ok) || ' OK / ' || count(*) filter (where not ok) || ' FALLA' from res;
rollback;
