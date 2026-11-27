-- SQL battery for migrations 334 (#29) and 335 (#37). DISPOSABLE databases only. One transaction, ends in ROLLBACK.
-- Usage: psql -X -q -v ON_ERROR_STOP=1 -f test_334_335_vuelos_destinos.sql   (database with migrations 001-335)
-- Expected last line: "TEST 334/335 SQL: ALL OK".
--   D  #29 destination merge/delete with alternative air destinations (re-point, redundant rows, commercial collision,
--      country mismatch fails closed, direct delete guarded, replay is a no-op, historical sales untouched)
--   L  #37 ventas_vuelo_sistema: land-only dynamic contracts excluded; air evidence (legs / airline / air cost / air payable) and
--      Promoción-linked contracts stay; source columns preserved
begin;

create schema t334;
create table t334.res (nombre text, ok boolean, detalle text);
create function t334.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void language plpgsql as $$
begin
  insert into t334.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre; else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;
create function t334.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000334' || case p_k when 'admin' then '002' when 'venta' then '005' else '999' end)::uuid $$;
create function t334.s(p_k text) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-000000334' || case p_k when 'admin' then '102' when 'venta' then '105' else '199' end)::uuid $$;
-- Runs SQL as the given session user; returns 'ok' or 'SQLSTATE: message' (subtransaction, constraints forced immediate).
create function t334.intenta(p_sql text, p_k text default 'admin') returns text language plpgsql as $$
declare v text := 'ok';
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', t334.u(p_k), 'role', 'authenticated', 'session_id', t334.s(p_k))::text, true);
    perform set_config('request.jwt.claim.sub', t334.u(p_k)::text, true);
    execute p_sql;
    set constraints all immediate;
    set constraints all deferred;
  exception when others then v := sqlstate || ': ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

insert into auth.users (id, email) select t334.u(k), 'c334-' || k || '@x.test' from unnest(array['admin','venta']) k on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t334.u(k), 'c334-' || k || '@x.test', 'C334 ' || k, r::rol_usuario, true, 'mayorista'
from (values ('admin','administracion'), ('venta','venta')) v(k, r)
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;

insert into auth.sessions (id, user_id) select t334.s(k), t334.u(k) from unnest(array['admin','venta']) k on conflict do nothing;

-- ── D · fixtures ────────────────────────────────────────────────────────
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values
  (93010, 'T334 COMERCIAL RD', null,  'República Dominicana', true),
  (93020, 'T334 ORIGEN RD',    'SDQ', 'República Dominicana', true),
  (93030, 'T334 LLEGADA RD',   'PUJ', 'República Dominicana', true),
  (93040, 'T334 OTRO PAIS',    'CTG', 'Colombia', true),
  (93050, 'T334 LIBRE',        'XXX', 'Colombia', true);
select setval(pg_get_serial_sequence('public.destinos', 'id'), greatest((select max(id) from public.destinos), 93050));
insert into public.bloqueos_vuelo (id, record, ruta, fecha_ida, fecha_regreso, cupos_total, destino_id) values
  (93101, 'T334B1', 'BOG - SDQ - BOG', current_date + 40, current_date + 44, 10, 93020);
select setval(pg_get_serial_sequence('public.bloqueos_vuelo', 'id'), greatest((select max(id) from public.bloqueos_vuelo), 93101));
insert into public.armado_paquetes (id, nombre, destino_id) values
  (93301, 'T334 P1 alt origen',          93010),
  (93302, 'T334 P2 alt origen y llegada', 93010),
  (93303, 'T334 P3 comercial = llegada', 93030),
  (93304, 'T334 P4 comercial = origen',  93020),
  (93305, 'T334 P5 desajuste de país',   93010);
select setval(pg_get_serial_sequence('public.armado_paquetes', 'id'), greatest((select max(id) from public.armado_paquetes), 93305));
-- P1: alternativa = origen, con un vuelo del origen vinculado (check encendido).
insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id) values (93301, 93020);
update public.armado_paquetes set destinos_aereos_alternativos = true where id = 93301;
insert into public.armado_vuelos (paquete_id, bloqueo_id) values (93301, 93101);
-- P2: origen y llegada ya son alternativas.
insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id) values (93302, 93020), (93302, 93030);
-- P3: comercial = llegada, alternativa = origen (check apagado).
insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id) values (93303, 93020);
-- P4: comercial = origen, alternativa = llegada (check apagado).
insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id) values (93304, 93030);
set constraints all immediate; set constraints all deferred;

-- Un destino que es alternativa NO se borra directo (23503) y la fila sigue ahí.
select t334.afirma('D1 borrado directo de una alternativa se rechaza',
  t334.intenta('delete from public.destinos where id = 93020') like '23503:%DESTINO_AEREO_ALTERNATIVO_EN_USO%');
select t334.afirma('D1b el destino sigue existiendo', exists (select 1 from public.destinos where id = 93020));
-- Un destino sin ninguna referencia sí se borra (la guarda no estorba).
select t334.afirma('D2 borrado directo de un destino sin uso: ok', t334.intenta('delete from public.destinos where id = 93050') = 'ok');select t334.afirma('D2b el destino sin uso ya no existe', not exists (select 1 from public.destinos where id = 93050));

-- Fusión 93020 -> 93030.
select t334.afirma('D3 fusión ok', t334.intenta('select public.fn_fusionar_destino(93020, 93030)') = 'ok');
select t334.afirma('D3b origen eliminado', not exists (select 1 from public.destinos where id = 93020));
select t334.afirma('D3c P1: (P1,origen) pasó a (P1,llegada)',
  (select array_agg(destino_id order by destino_id) from public.armado_paquete_destinos_aereos where paquete_id = 93301) = array[93030::bigint]);
select t334.afirma('D3d P1: el vuelo del origen (re-apuntado por FK) sigue siendo elegible',
  (select b.destino_id = any (public.destinos_aereos_efectivos_67(p.destino_id, p.destinos_aereos_alternativos,
        (select coalesce(array_agg(destino_id), '{}') from public.armado_paquete_destinos_aereos where paquete_id = p.id)))
     from public.armado_paquetes p, public.bloqueos_vuelo b where p.id = 93301 and b.id = 93101));
select t334.afirma('D3e P2: sin duplicados, solo (P2,llegada)',
  (select array_agg(destino_id order by destino_id) from public.armado_paquete_destinos_aereos where paquete_id = 93302) = array[93030::bigint]);
select t334.afirma('D3f P3: el comercial ya es la llegada, la alternativa redundante se elimina',
  not exists (select 1 from public.armado_paquete_destinos_aereos where paquete_id = 93303));
select t334.afirma('D3g ninguna fila huérfana en toda la tabla',
  not exists (select 1 from public.armado_paquete_destinos_aereos a where not exists (select 1 from public.destinos d where d.id = a.destino_id)));

-- Reintento (replay) de la misma fusión: el origen ya no existe, no hace nada y no falla.
select t334.afirma('D4 reintento de la fusión es un no-op', t334.intenta('select public.fn_fusionar_destino(93020, 93030)') = 'ok');

-- P4: el comercial era el origen: tras la fusión (otro origen) la alternativa que igualaría al comercial se elimina.
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (93060, 'T334 ORIGEN P4', 'ZZZ', 'República Dominicana', true);
update public.armado_paquetes set destino_id = 93060 where id = 93304;
select t334.afirma('D5 P4 fusión ok', t334.intenta('select public.fn_fusionar_destino(93060, 93030)') = 'ok');select t334.afirma('D5b P4: el comercial pasa a la llegada', (select destino_id from public.armado_paquetes where id = 93304) = 93030);select t334.afirma('D5c P4: la alternativa igual al comercial se elimina', not exists (select 1 from public.armado_paquete_destinos_aereos where paquete_id = 93304));

-- P5: país distinto => la validación diferida aborta TODA la fusión (nada queda a medias).
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (93070, 'T334 ORIGEN P5', 'YYY', 'República Dominicana', true);
insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id) values (93305, 93070);
select t334.afirma('D6 país distinto: la fusión falla cerrada (destino_aereo_config)',
  t334.intenta('select public.fn_fusionar_destino(93070, 93040)') like '%destino_aereo_config%');
select t334.afirma('D6b nada cambió: el origen y su alternativa siguen',
  exists (select 1 from public.destinos where id = 93070) and exists (select 1 from public.armado_paquete_destinos_aereos where paquete_id = 93305 and destino_id = 93070));

-- Un rol sin permiso no puede fusionar.
select t334.afirma('D7 rol venta no fusiona', t334.intenta('select public.fn_fusionar_destino(93070, 93030)', 'venta') like '%No autorizado%');

-- ── L · #37 ─────────────────────────────────────────────────────────────
insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete, aerolinea, costo_aereo) values
  ('DTM-9301', 'Solo tierra',          'mayorista', 'dinamico', null,       0),
  ('DTM-9302', 'Aerolinea en venta',   'mayorista', 'dinamico', 'Avianca',  0),
  ('DTM-9303', 'Costo aereo',          'mayorista', 'dinamico', null,       500000),
  ('DTM-9304', 'Con tramo',            'mayorista', 'dinamico', null,       0),
  ('DTM-9305', 'Con CxP aerea',        'mayorista', 'dinamico', null,       0),
  ('DTM-9306', 'Aerolinea en blanco',  'mayorista', 'dinamico', '   ',      0),
  ('DTM-9307', 'Porcion terrestre',    'mayorista', 'porcion_terrestre', null, 0);
insert into public.empaquetados (id, record, ruta, fecha_ida, fecha_regreso, destino_id, activo) values
  (93201, null, 'BOG - CTG - BOG', current_date + 40, current_date + 44, 93040, true);
select setval(pg_get_serial_sequence('public.empaquetados', 'id'), greatest((select max(id) from public.empaquetados), 93201));
insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete, empaquetado_ref_id) values
  ('DTM-9308', 'Promoción sin record', 'mayorista', 'empaquetado', 93201);
insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion, origen_codigo, destino_codigo, fecha_salida, orden)
  values ('DTM-9304', null, 'ida', 'BOG', 'CTG', current_date + 10, 0);
insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, tenant)
  values ('DTM-9305', 'Plataforma', 'aereo', 'Tiquete', 100000, 'mayorista');

create function t334.en_lista(p text) returns boolean language sql as $$
  select exists (select 1 from public.ventas_vuelo_sistema where numero_contrato = p) $$;
select t334.afirma('L1 dinámico solo tierra NO está en la lista (como superadmin/administración)',
  (select not t334.en_lista('DTM-9301')));
-- La vista exige acceso (acceso_ventas_vuelo_sistema): se prueba con la sesión de administración.
create function t334.vista_como_admin(p text) returns boolean language plpgsql as $$
declare r boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t334.u('admin'), 'role', 'authenticated', 'session_id', t334.s('admin'))::text, true);
  perform set_config('request.jwt.claim.sub', t334.u('admin')::text, true);
  select exists (select 1 from public.ventas_vuelo_sistema where numero_contrato = p) into r;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $$;
create function t334.origen_como_admin(p text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t334.u('admin'), 'role', 'authenticated', 'session_id', t334.s('admin'))::text, true);
  perform set_config('request.jwt.claim.sub', t334.u('admin')::text, true);
  select origen into r from public.ventas_vuelo_sistema where numero_contrato = p;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $$;
select t334.afirma('L2 solo tierra excluido para administración', not t334.vista_como_admin('DTM-9301'));
select t334.afirma('L3 aerolínea en ventas: incluido', t334.vista_como_admin('DTM-9302'));
select t334.afirma('L4 costo aéreo > 0: incluido', t334.vista_como_admin('DTM-9303'));
select t334.afirma('L5 con tramo en contrato_vuelos: incluido', t334.vista_como_admin('DTM-9304'));
select t334.afirma('L6 con CxP aérea: incluido', t334.vista_como_admin('DTM-9305'));
select t334.afirma('L7 aerolínea en blanco no cuenta como evidencia', not t334.vista_como_admin('DTM-9306'));
select t334.afirma('L8 porción terrestre nunca entra', not t334.vista_como_admin('DTM-9307'));
select t334.afirma('L9 contrato ligado a una Promoción (sin record) siempre entra y conserva su origen',
  t334.vista_como_admin('DTM-9308') and t334.origen_como_admin('DTM-9308') = 'empaquetado');
select t334.afirma('L10 las columnas fuente de la venta no se tocaron',
  (select tipo_paquete from public.ventas where numero_contrato = 'DTM-9301') = 'dinamico'
  and (select empaquetado_ref_id from public.ventas where numero_contrato = 'DTM-9308') = 93201);
select t334.afirma('L11 la vista sigue exponiendo contrato_uid y estado_pago (285/157 intactas)',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas_vuelo_sistema' and column_name in ('contrato_uid', 'estado_pago', 'estado_emision')) = 3);

-- ── R · #40: registrar el record DESPUÉS desde el contrato; reintentos y conversión doble ───────────
-- Dos contratos nacen de la MISMA Promoción (sin record). Se registra el record en UNO desde el editor del contrato.
insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete, empaquetado_ref_id) values ('DTM-9309', 'Segundo contrato de la Promoción', 'mayorista', 'empaquetado', 93201);
insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion, origen_codigo, destino_codigo, fecha_salida, orden)
  values ('DTM-9308', 'Aerolínea X', 'ida', 'BOG', 'CTG', current_date + 40, 0), ('DTM-9309', 'Aerolínea X', 'ida', 'BOG', 'CTG', current_date + 40, 0);
create temp table t334_antes as select
  (select count(*) from public.empaquetados) as n_empaquetados,
  (select count(*) from public.contrato_vuelos) as n_tramos,
  (select count(*) from public.ventas) as n_ventas;
create function t334.guardar_record(p_numero text, p_record text) returns text language plpgsql as $$
declare v_id bigint;
begin
  select id into v_id from public.contrato_vuelos where numero_contrato = p_numero order by orden, id limit 1;
  return t334.intenta(format('select * from public.guardar_tramos_contrato(%L, %L::jsonb)', p_numero,
    json_build_array(json_build_object('id', v_id, 'aerolinea', 'Aerolínea X', 'record', p_record, 'direccion', 'ida', 'origenCodigo', 'BOG', 'destinoCodigo', 'CTG',
      'fecha', to_char(current_date + 40, 'YYYY-MM-DD')))::text));
end $$;
select t334.afirma('R1 registrar el record después, desde el contrato', t334.guardar_record('DTM-9308', 'ABC123') = 'ok');
select t334.afirma('R2 el record quedó en el tramo de ESE contrato', (select record from public.contrato_vuelos where numero_contrato = 'DTM-9308') = 'ABC123');
select t334.afirma('R3 la Promoción reutilizable sigue SIN record', (select record from public.empaquetados where id = 93201) is null);
select t334.afirma('R4 el otro contrato de la misma Promoción no cambió', (select record from public.contrato_vuelos where numero_contrato = 'DTM-9309') is null);
select t334.afirma('R5 el reintento (mismo guardado) es ok', t334.guardar_record('DTM-9308', 'ABC123') = 'ok');
select t334.afirma('R6 el reintento no duplicó tramos, Promociones ni contratos',
  (select count(*) from public.contrato_vuelos) = (select n_tramos from t334_antes)
  and (select count(*) from public.empaquetados) = (select n_empaquetados from t334_antes)
  and (select count(*) from public.ventas) = (select n_ventas from t334_antes));
select t334.afirma('R7 sin record sigue siendo válido: el contrato ya existía y entró a la lista sin él', t334.vista_como_admin('DTM-9309'));
-- Conversión doble de la misma cotización: la llave única de `ventas.cotizacion_id` (164) impide el segundo contrato.
insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete, cotizacion_id) values ('DTM-9310', 'Conversión A', 'mayorista', 'dinamico', 930999);
select t334.afirma('R8 una segunda conversión de la misma cotización se rechaza (ventas_cotizacion_id_key)',
  t334.intenta($q$insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete, cotizacion_id) values ('DTM-9311', 'Conversión B', 'mayorista', 'dinamico', 930999)$q$) like '23505:%ventas_cotizacion_id_key%');
select t334.afirma('R9 queda UN solo contrato para esa cotización', (select count(*) from public.ventas where cotizacion_id = 930999) = 1);

do $$
declare n_mal int; r record;
begin
  select count(*) into n_mal from t334.res where not ok;
  for r in select nombre, detalle from t334.res where not ok loop raise notice 'FALLO: % -- %', r.nombre, r.detalle; end loop;
  if n_mal > 0 then raise exception 'TEST 334/335 SQL: % fallo(s)', n_mal; end if;
  raise notice 'TEST 334/335 SQL: ALL OK (% comprobaciones)', (select count(*) from t334.res);
end $$;
rollback;
