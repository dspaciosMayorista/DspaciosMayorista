-- SQL battery for migration 338 (ADL-041 + ADL-042): air vouchers per CONTRACTED SERVICE with a saved service identity (contrato_vuelos.servicio_aereo), reconciliation of changed / removed services,
-- and the internal «voucher updated / not current» signal of Gestión de contratos. DISPOSABLE databases only.
-- One transaction, ends in ROLLBACK. Usage: psql -X -q -v ON_ERROR_STOP=1 -f test_338_voucher_vuelo_servicios.sql   (database with migrations 001-338)
-- Expected last line: "TEST 338 SQL: ALL OK".
begin;

create schema t338;
create table t338.res (nombre text, ok boolean, detalle text);
create function t338.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void language plpgsql as $$
begin
  insert into t338.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre; else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;
create function t338.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000338' || case p_k when 'admin' then '002' when 'venta' then '005' when 'otro' then '006' when 'super' then '001' else '999' end)::uuid $$;
create function t338.s(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000338' || case p_k when 'admin' then '102' when 'venta' then '105' when 'otro' then '106' when 'super' then '101' else '999' end)::uuid $$;
-- service ids used by the tests (stable, readable)
create function t338.k(p_n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function t338.intenta(p_sql text, p_k text default 'admin', p_rol text default 'authenticated') returns text language plpgsql as $$
declare v text := 'ok';
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', t338.u(p_k), 'role', 'authenticated', 'session_id', t338.s(p_k))::text, true);
    perform set_config('request.jwt.claim.sub', t338.u(p_k)::text, true);
    execute format('set local role %I', p_rol);
    execute p_sql;
    reset role;
  exception when others then v := sqlstate || ': ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

insert into auth.users (id, email) select t338.u(k), 'c338-' || k || '@x.test' from unnest(array['super','admin','venta','otro']) k on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t338.u(k), 'c338-' || k || '@x.test', n, r::rol_usuario, true, 'mayorista'
from (values ('super','C338 super','superadmin'), ('admin','C338 admin','administracion'), ('venta','C338 venta dueno','venta'), ('otro','C338 venta otro','venta')) v(k, n, r)
on conflict (id) do update set rol = excluded.rol, nombre = excluded.nombre, activo = true, tenant = excluded.tenant;
insert into auth.sessions (id, user_id) select t338.s(k), t338.u(k) from unnest(array['super','admin','venta','otro']) k on conflict do nothing;

insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete, asesor, estado) values
  ('DTM-9381', 'Servicios y PNR', 'mayorista', 'dinamico', 'C338 venta dueno', 'confirmado'),
  ('DTM-9382', 'Contrato ajeno', 'mayorista', 'dinamico', 'C338 venta otro', 'confirmado'),
  ('DTM-9383', 'Legs sin asociar', 'mayorista', 'dinamico', 'C338 venta dueno', 'confirmado'),
  ('DTM-9384', 'Transiciones', 'mayorista', 'dinamico', 'C338 venta dueno', 'confirmado'),
  ('DTM-9385', 'Gestión', 'mayorista', 'dinamico', 'C338 venta dueno', 'confirmado'),
  ('DTM-9386', 'Gestión (otro)', 'mayorista', 'dinamico', 'C338 venta dueno', 'confirmado'),
  ('DTM-9388', 'Editor', 'mayorista', 'dinamico', 'C338 venta dueno', 'confirmado'),
  ('DTM-9389', 'Valor por defecto', 'mayorista', 'dinamico', 'C338 venta dueno', 'confirmado'),
  ('DTM-9391', 'Campos heredados', 'mayorista', 'dinamico', 'C338 venta dueno', 'confirmado'),
  ('DTM-9392', 'Orden de tramos', 'mayorista', 'dinamico', 'C338 venta dueno', 'confirmado');
grant all on schema t338 to public;
create table t338.g (clave text, id bigint, tok uuid, creado boolean, actualizado boolean, retirado boolean);
grant all on all tables in schema t338 to public;

-- one saved leg (explicit service); returns its id
create function t338.leg(p_num text, p_svc uuid, p_pnr text, p_dir text, p_vuelo text default 'AV1') returns bigint language sql as $$
  insert into public.contrato_vuelos (numero_contrato, aerolinea, record, direccion, origen_codigo, destino_codigo, numero_vuelo, servicio_aereo, orden)
  values (p_num, 'AV', p_pnr, p_dir, case when p_dir = 'regreso' then 'CTG' else 'BOG' end, case when p_dir = 'regreso' then 'BOG' else 'CTG' end, p_vuelo, p_svc, (select count(*)::int from public.contrato_vuelos x where x.numero_contrato = p_num)) returning id $$;
create function t338.v(p_n int, p_emision text default '2027-01-01', p_pnr text default null) returns jsonb language sql immutable as $$
  select jsonb_build_object('clase', 'vuelo', 'emision', p_emision, 'n', p_n) || case when p_pnr is null then '{}'::jsonb else jsonb_build_object('pnr', p_pnr) end $$;
-- fingerprint of a service as the application would read it (the read helper needs a session that can see the contract)
create function t338.hue(p_num text, p_svc uuid) returns text language plpgsql as $$
declare h text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t338.u('admin'), 'role', 'authenticated', 'session_id', t338.s('admin'))::text, true);
  perform set_config('request.jwt.claim.sub', t338.u('admin')::text, true);
  execute 'set local role authenticated';
  select x.huella into h from public.servicios_aereos_contrato(p_num) x where x.servicio = p_svc;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return h;
end $$;
-- payload element of one service: its CURRENT saved legs are read from the database
create function t338.sv(p_num text, p_svc uuid, p_n int, p_emision text default '2027-01-01', p_pnr text default null) returns jsonb language sql stable as $$
  select jsonb_build_object('clave', p_svc::text, 'tramos', coalesce((select jsonb_agg(c.id order by c.id) from public.contrato_vuelos c where c.numero_contrato = p_num and c.servicio_aereo = p_svc), '[]'::jsonb), 'huella', coalesce(t338.hue(p_num, p_svc), repeat('0', 32)), 'contenido', t338.v(p_n, p_emision, p_pnr)) $$;
create function t338.guardar(p_num text, p_servicios jsonb, p_k text default 'admin') returns text language plpgsql as $$
begin
  return t338.intenta(format('delete from t338.g; insert into t338.g select servicio_clave, id, share_token, creado, actualizado, retirado from public.guardar_vouchers_vuelo(%L, %L::jsonb)', p_num, p_servicios::text), p_k);
end $$;
create function t338.estado(p_num text, p_svc uuid) returns text language sql as $$
  select revision || '|' || id || '|' || share_token || '|' || coalesce(actualizado_en::text, '-') || '|' || md5(contenido::text) || '|' || estado from public.vouchers where numero_contrato = p_num and tipo = 'vuelo' and servicio_clave = p_svc::text $$;
create function t338.p(p_s text, p_i int) returns text language sql immutable as $$ select split_part(p_s, '|', p_i) $$;   -- 1 revision, 2 id, 3 token, 4 updated, 5 md5, 6 estado
create function t338.nv(p_num text) returns bigint language sql as $$ select count(*) from public.vouchers where numero_contrato = p_num and tipo = 'vuelo' $$;

-- ── A · identity is the SAVED service, not the PNR ───────────────────────
-- DTM-9381: service 1 = outbound PNR AAA111 + return PNR BBB222 (one service, two PNRs); services 2 and 3 share the SAME PNR; services 4 and 5 have NO PNR.
insert into public.vouchers (numero_contrato, tipo, proveedor, contenido) values ('DTM-9381', 'hotel', 'Hotel X', '{"clase":"hotel","x":1}'), ('DTM-9381', 'servicios', 'Prov Y', '{"clase":"servicios","y":2}');
create temp table t338_otros as select md5(string_agg(id || share_token::text || contenido::text || revision::text, '|' order by id)) h from public.vouchers where numero_contrato = 'DTM-9381' and tipo <> 'vuelo';
select t338.leg('DTM-9381', t338.k(1), 'AAA111', 'ida', 'AV10'), t338.leg('DTM-9381', t338.k(1), 'BBB222', 'regreso', 'AV11'),
       t338.leg('DTM-9381', t338.k(2), 'SAME00', 'ida', 'AV20'), t338.leg('DTM-9381', t338.k(3), 'SAME00', 'ida', 'AV30'),
       t338.leg('DTM-9381', t338.k(4), null, 'ida', 'AV40'), t338.leg('DTM-9381', t338.k(5), null, 'ida', 'AV50');
create temp table t338_a1 as select t338.guardar('DTM-9381', jsonb_build_array(t338.sv('DTM-9381', t338.k(1), 1), t338.sv('DTM-9381', t338.k(2), 2), t338.sv('DTM-9381', t338.k(3), 3), t338.sv('DTM-9381', t338.k(4), 4), t338.sv('DTM-9381', t338.k(5), 5))) r;
select t338.afirma('A1 round trip with DIFFERENT PNRs = ONE service = ONE voucher; services with the SAME PNR stay separate; services with NO PNR stay separate (5 services → 5 vouchers, 5 distinct links)',
  (select r from t338_a1) = 'ok' and (select count(*) from t338.g where creado and not actualizado and not retirado) = 5 and (select count(distinct tok) from t338.g) = 5 and t338.nv('DTM-9381') = 5
  and (select array_agg(servicio_clave order by servicio_clave) from public.vouchers where numero_contrato = 'DTM-9381' and tipo = 'vuelo') = (select array_agg(t338.k(n)::text order by t338.k(n)::text) from generate_series(1, 5) n));
create temp table t338_s1 as select t338.estado('DTM-9381', t338.k(1)) e;
create temp table t338_s2 as select t338.estado('DTM-9381', t338.k(2)) e;
select t338.afirma('A2 revision starts at 0, state «vigente», timestamp empty',
  t338.p((select e from t338_s1), 1) = '0' and t338.p((select e from t338_s1), 4) = '-' and t338.p((select e from t338_s1), 6) = 'vigente'
  and (select count(*) from public.vouchers where numero_contrato = 'DTM-9381' and tipo = 'vuelo' and estado = 'vigente' and revision = 0) = 5);
create temp table t338_a3 as select t338.guardar('DTM-9381', (select jsonb_agg(t338.sv('DTM-9381', t338.k(n), n)) from generate_series(1, 5) n)) r;
select t338.afirma('A3 an IDENTICAL replay changes nothing: same rows, tokens, revision 0; creado = actualizado = retirado = false',
  (select r from t338_a3) = 'ok' and (select count(*) from t338.g where creado or actualizado or retirado) = 0 and t338.estado('DTM-9381', t338.k(1)) = (select e from t338_s1) and t338.estado('DTM-9381', t338.k(2)) = (select e from t338_s2));
create temp table t338_a4 as select t338.guardar('DTM-9381', (select jsonb_agg(t338.sv('DTM-9381', t338.k(n), n, '2027-02-02')) from generate_series(1, 5) n)) r;
select t338.afirma('A4 a replay that differs ONLY in the issue date is also a no-op (stored issue date kept; revision stays 0)',
  (select r from t338_a4) = 'ok' and (select count(*) from t338.g where creado or actualizado) = 0 and t338.estado('DTM-9381', t338.k(1)) = (select e from t338_s1));
create temp table t338_a5 as select t338.guardar('DTM-9381', (select jsonb_agg(t338.sv('DTM-9381', t338.k(n), case when n = 2 then 22 else n end)) from generate_series(1, 5) n)) r;
select t338.afirma('A5 a real change in ONE service: that voucher keeps id and token, revision 1; the others are byte-identical',
  (select r from t338_a5) = 'ok' and (select actualizado and not creado from t338.g where clave = t338.k(2)::text) and (select count(*) from t338.g where actualizado) = 1
  and t338.p(t338.estado('DTM-9381', t338.k(2)), 1) = '1' and t338.p(t338.estado('DTM-9381', t338.k(2)), 2) = t338.p((select e from t338_s2), 2) and t338.p(t338.estado('DTM-9381', t338.k(2)), 3) = t338.p((select e from t338_s2), 3)
  and t338.estado('DTM-9381', t338.k(1)) = (select e from t338_s1));
select t338.afirma('A6 hotel and service vouchers are byte-identical after all of the above',
  (select md5(string_agg(id || share_token::text || contenido::text || revision::text, '|' order by id)) from public.vouchers where numero_contrato = 'DTM-9381' and tipo <> 'vuelo') = (select h from t338_otros));

-- ── B · reject BEFORE mutating ──────────────────────────────────────────
select t338.leg('DTM-9383', t338.k(11), 'P1', 'ida'), t338.leg('DTM-9383', t338.k(12), 'P2', 'ida');
insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion, servicio_aereo) values ('DTM-9383', 'AV', 'ida', null);   -- explicit NULL service (historical ambiguous leg)
select t338.afirma('B0 a BEFORE-INSERT default does not run when a service is explicit; a NULL explicit insert still gets the transaction default',
  (select count(*) from public.contrato_vuelos where numero_contrato = 'DTM-9383' and servicio_aereo is null) = 0);
update public.contrato_vuelos set servicio_aereo = null where numero_contrato = 'DTM-9383' and servicio_aereo not in (t338.k(11), t338.k(12));   -- simulate an unassociated historical leg
select t338.afirma('B1 contract with an unassociated leg: generation is REJECTED before any write (no voucher created for the associated services either)',
  (select count(*) from public.contrato_vuelos where numero_contrato = 'DTM-9383' and servicio_aereo is null) = 1
  and t338.guardar('DTM-9383', jsonb_build_array(t338.sv('DTM-9383', t338.k(11), 1), t338.sv('DTM-9383', t338.k(12), 1))) like '22023: SERVICIO_AEREO_SIN_ASOCIAR%' and t338.nv('DTM-9383') = 0);
delete from public.contrato_vuelos where numero_contrato = 'DTM-9383' and servicio_aereo is null;
select t338.afirma('B2 payload that omits a real service → SERVICIOS_CAMBIARON, nothing written',
  t338.guardar('DTM-9383', jsonb_build_array(t338.sv('DTM-9383', t338.k(11), 1))) like '22023: SERVICIOS_CAMBIARON%' and t338.nv('DTM-9383') = 0);
select t338.afirma('B3 payload with a service that has no legs here, or with the wrong leg set → rejected, nothing written',
  t338.guardar('DTM-9383', jsonb_build_array(t338.sv('DTM-9383', t338.k(11), 1), t338.sv('DTM-9383', t338.k(12), 1), t338.sv('DTM-9383', t338.k(13), 1))) like '22023:%'
  and t338.guardar('DTM-9383', jsonb_build_array(t338.sv('DTM-9383', t338.k(11), 1), jsonb_set(t338.sv('DTM-9383', t338.k(12), 1), '{tramos}', '[999999999]'))) like '22023: SERVICIOS_CAMBIARON%' and t338.nv('DTM-9383') = 0);
select t338.afirma('B4 malformed payloads (repeated service, empty, non-array, bad key, no legs list) are refused with 22023',
  t338.guardar('DTM-9383', jsonb_build_array(t338.sv('DTM-9383', t338.k(11), 1), t338.sv('DTM-9383', t338.k(11), 2))) like '22023:%' and t338.guardar('DTM-9383', '[]'::jsonb) like '22023:%'
  and t338.guardar('DTM-9383', '{"clave":"10"}'::jsonb) like '22023:%' and t338.guardar('DTM-9383', jsonb_build_array(jsonb_build_object('clave', 'no-uuid', 'tramos', '[1]'::jsonb, 'contenido', t338.v(1)))) like '22023:%'
  and t338.guardar('DTM-9383', jsonb_build_array(jsonb_build_object('clave', t338.k(11)::text, 'contenido', t338.v(1)))) like '22023:%');
-- atomicity: first service valid, second service payload element invalid → nothing written
select t338.afirma('B5 atomic: a payload whose SECOND element is invalid writes nothing (the first is not created)',
  t338.guardar('DTM-9383', jsonb_build_array(t338.sv('DTM-9383', t338.k(11), 1), jsonb_build_object('clave', t338.k(12)::text, 'tramos', (t338.sv('DTM-9383', t338.k(12), 1)) -> 'tramos', 'contenido', '{"clase":"hotel"}'::jsonb))) like '22023:%' and t338.nv('DTM-9383') = 0);
select t338.afirma('B6 constraints: unique per (contract, service); an air voucher without a key is refused; a non-air voucher cannot leave «vigente»',
  t338.intenta(format($q$insert into public.vouchers (numero_contrato, tipo, servicio_clave, contenido) values ('DTM-9381', 'vuelo', %L, '{"clase":"vuelo"}')$q$, t338.k(1)::text), 'super') like '23505:%vouchers_vuelo_uno_por_servicio%'
  and t338.intenta($q$insert into public.vouchers (numero_contrato, tipo, contenido) values ('DTM-9381', 'vuelo', '{"clase":"vuelo"}')$q$, 'super') like '23514:%'
  and t338.intenta($q$insert into public.vouchers (numero_contrato, tipo, proveedor, estado, contenido) values ('DTM-9381', 'hotel', 'H', 'revisar', '{"clase":"hotel"}')$q$, 'super') like '23514:%'
  and t338.intenta($q$insert into public.vouchers (numero_contrato, tipo, servicio_clave, estado, contenido) values ('DTM-9381', 'vuelo', 'x-estado', 'otro', '{"clase":"vuelo"}')$q$, 'super') like '23514:%');

-- ── C · transitions on DTM-9384 (anchor removal, leg removal/recreation, service removal, merge, split) ──
select t338.leg('DTM-9384', t338.k(21), 'P21A', 'ida'), t338.leg('DTM-9384', t338.k(21), 'P21B', 'regreso'), t338.leg('DTM-9384', t338.k(22), null, 'ida'), t338.leg('DTM-9384', t338.k(23), null, 'ida'), t338.leg('DTM-9384', t338.k(23), null, 'regreso');
create temp table t338_c0 as select t338.guardar('DTM-9384', (select jsonb_agg(t338.sv('DTM-9384', t338.k(n), n)) from generate_series(21, 23) n)) r;
create temp table t338_c21 as select t338.estado('DTM-9384', t338.k(21)) e;
create temp table t338_c22 as select t338.estado('DTM-9384', t338.k(22)) e;
create temp table t338_c23 as select t338.estado('DTM-9384', t338.k(23)) e;
-- C1 the ANCHOR leg (lowest id) of service 21 is removed. Old design: the key changed and the link kept the old itinerary. Now: same service, same link, flagged until regenerated.
delete from public.contrato_vuelos where id = (select min(id) from public.contrato_vuelos where numero_contrato = 'DTM-9384' and servicio_aereo = t338.k(21));
select t338.afirma('C1 removing the ANCHOR leg flags that service «revisar» immediately (revision +1); the other services stay vigente; the link is the same row',
  t338.p(t338.estado('DTM-9384', t338.k(21)), 6) = 'revisar' and t338.p(t338.estado('DTM-9384', t338.k(21)), 1) = '1' and t338.p(t338.estado('DTM-9384', t338.k(21)), 3) = t338.p((select e from t338_c21), 3)
  and t338.estado('DTM-9384', t338.k(22)) = (select e from t338_c22) and t338.estado('DTM-9384', t338.k(23)) = (select e from t338_c23));
create temp table t338_c1b as select t338.guardar('DTM-9384', (select jsonb_agg(t338.sv('DTM-9384', t338.k(n), n + case when n = 21 then 100 else 0 end)) from generate_series(21, 23) n)) r;
select t338.afirma('C2 regeneration after the anchor removal keeps the SAME id and token for the same service, content updated, state back to «vigente»; no extra voucher',
  (select r from t338_c1b) = 'ok' and t338.nv('DTM-9384') = 3 and t338.p(t338.estado('DTM-9384', t338.k(21)), 6) = 'vigente' and t338.p(t338.estado('DTM-9384', t338.k(21)), 2) = t338.p((select e from t338_c21), 2)
  and t338.p(t338.estado('DTM-9384', t338.k(21)), 3) = t338.p((select e from t338_c21), 3) and t338.p(t338.estado('DTM-9384', t338.k(21)), 5) <> t338.p((select e from t338_c21), 5)
  and (select count(*) from t338.g where retirado) = 0);
-- C3 leg REMOVED AND RECREATED inside one transaction (what the flight editor does) keeps the service alive: «revisar», never «retirado»
create temp table t338_c23b as select t338.estado('DTM-9384', t338.k(23)) e;
delete from public.contrato_vuelos where numero_contrato = 'DTM-9384' and servicio_aereo = t338.k(23);
insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion, servicio_aereo) values ('DTM-9384', 'AV', 'ida', t338.k(23)), ('DTM-9384', 'AV', 'regreso', t338.k(23));
select t338.afirma('C3 every leg of a service deleted and re-created with the same service: «revisar» (not «retirado»), same link; regenerating restores «vigente» and the link is unchanged',
  t338.p(t338.estado('DTM-9384', t338.k(23)), 6) = 'revisar' and t338.p(t338.estado('DTM-9384', t338.k(23)), 3) = t338.p((select e from t338_c23b), 3)
  and t338.guardar('DTM-9384', (select jsonb_agg(t338.sv('DTM-9384', t338.k(n), n + case when n = 21 then 100 else 0 end)) from generate_series(21, 23) n)) = 'ok'
  and t338.p(t338.estado('DTM-9384', t338.k(23)), 6) = 'vigente' and t338.p(t338.estado('DTM-9384', t338.k(23)), 3) = t338.p((select e from t338_c23b), 3) and t338.nv('DTM-9384') = 3);
-- C4 service REMOVED (all its legs deleted): its voucher is «retirado» at once; history kept; regeneration neither revives nor recreates it
create temp table t338_c22b as select t338.estado('DTM-9384', t338.k(22)) e;
delete from public.contrato_vuelos where numero_contrato = 'DTM-9384' and servicio_aereo = t338.k(22);
select t338.afirma('C4 removing a whole service retires its voucher immediately (row kept, revision +1, same token); the others are not retired',
  t338.p(t338.estado('DTM-9384', t338.k(22)), 6) = 'retirado' and t338.p(t338.estado('DTM-9384', t338.k(22)), 1)::int = t338.p((select e from t338_c22b), 1)::int + 1 and t338.p(t338.estado('DTM-9384', t338.k(22)), 3) = t338.p((select e from t338_c22b), 3)
  and t338.p(t338.estado('DTM-9384', t338.k(21)), 6) = 'vigente' and t338.p(t338.estado('DTM-9384', t338.k(23)), 6) = 'vigente');
create temp table t338_c4b as select t338.guardar('DTM-9384', (select jsonb_agg(t338.sv('DTM-9384', t338.k(n), n + case when n = 21 then 100 else 0 end)) from generate_series(21, 23, 2) n)) r;
select t338.afirma('C5 regeneration after the removal: the retired voucher stays retired and is not re-created; the remaining services are untouched; no signal duplicates',
  (select r from t338_c4b) = 'ok' and t338.nv('DTM-9384') = 3 and t338.p(t338.estado('DTM-9384', t338.k(22)), 6) = 'retirado' and t338.p(t338.estado('DTM-9384', t338.k(22)), 1)::int = t338.p((select e from t338_c22b), 1)::int + 1
  and (select count(*) from t338.g where creado or actualizado or retirado) = 0);
-- C6 MERGE (explicit): the legs of service 23 are moved into service 21 → 23 is retired (no legs left), 21 flagged
create temp table t338_c6 as select t338.estado('DTM-9384', t338.k(21)) e;
update public.contrato_vuelos set servicio_aereo = t338.k(21) where numero_contrato = 'DTM-9384' and servicio_aereo = t338.k(23);
select t338.afirma('C6 merging service 23 into 21 (legs re-associated): 23 «retirado»; 21 keeps its link and is «revisar»',
  t338.p(t338.estado('DTM-9384', t338.k(23)), 6) = 'retirado' and t338.p(t338.estado('DTM-9384', t338.k(21)), 6) = 'revisar' and t338.p(t338.estado('DTM-9384', t338.k(21)), 3) = t338.p((select e from t338_c6), 3));
create temp table t338_c6b as select t338.guardar('DTM-9384', jsonb_build_array(t338.sv('DTM-9384', t338.k(21), 121))) r;
select t338.afirma('C7 regenerating after the merge: 21 «vigente» with the same link, 23 and 22 stay «retirado»; only one air voucher is current',
  (select r from t338_c6b) = 'ok' and t338.p(t338.estado('DTM-9384', t338.k(21)), 6) = 'vigente' and t338.p(t338.estado('DTM-9384', t338.k(21)), 3) = t338.p((select e from t338_c6), 3)
  and (select count(*) from public.vouchers where numero_contrato = 'DTM-9384' and tipo = 'vuelo' and estado = 'vigente') = 1 and (select count(*) from t338.g where retirado) = 0);
-- C8 SPLIT (explicit): one leg of 21 moves to a brand new service 24 → 21 keeps its link («revisar»), 24 gets a NEW voucher/link on regeneration
update public.contrato_vuelos set servicio_aereo = t338.k(24) where id = (select max(id) from public.contrato_vuelos where numero_contrato = 'DTM-9384' and servicio_aereo = t338.k(21));
select t338.afirma('C8 splitting a leg off a service: the original keeps its link and is «revisar» (still has legs)', t338.p(t338.estado('DTM-9384', t338.k(21)), 6) = 'revisar' and t338.p(t338.estado('DTM-9384', t338.k(21)), 3) = t338.p((select e from t338_c6), 3));
create temp table t338_c8 as select t338.guardar('DTM-9384', jsonb_build_array(t338.sv('DTM-9384', t338.k(21), 122), t338.sv('DTM-9384', t338.k(24), 124))) r;
select t338.afirma('C9 regenerating after the split: 21 keeps its token (vigente); 24 is created with a new token; old retired vouchers are untouched',
  (select r from t338_c8) = 'ok' and t338.p(t338.estado('DTM-9384', t338.k(21)), 3) = t338.p((select e from t338_c6), 3) and t338.p(t338.estado('DTM-9384', t338.k(21)), 6) = 'vigente'
  and t338.p(t338.estado('DTM-9384', t338.k(24)), 3) <> t338.p(t338.estado('DTM-9384', t338.k(21)), 3) and (select creado from t338.g where clave = t338.k(24)::text) and t338.p(t338.estado('DTM-9384', t338.k(22)), 6) = 'retirado');
-- C10 a leg field edit that is NOT a change (same values rewritten) does not flag; a real field edit does
update public.contrato_vuelos set aerolinea = aerolinea, orden = orden where numero_contrato = 'DTM-9384' and servicio_aereo = t338.k(24);
select t338.afirma('C10 rewriting identical values does not flag the voucher (a no-op save never raises a notice)', t338.p(t338.estado('DTM-9384', t338.k(24)), 6) = 'vigente');

update public.contrato_vuelos set record = 'NEWPNR' where numero_contrato = 'DTM-9384' and servicio_aereo = t338.k(24);
select t338.afirma('C11 saving a PNR on a leg after the voucher was generated flags that service only', t338.p(t338.estado('DTM-9384', t338.k(24)), 6) = 'revisar' and t338.p(t338.estado('DTM-9384', t338.k(21)), 6) = 'vigente');
-- C11b an UNASSOCIATED leg that gets its FIRST service joins that service: its voucher is flagged too (the itinerary changed)
create temp table t338_c11b as select t338.guardar('DTM-9384', jsonb_build_array(t338.sv('DTM-9384', t338.k(21), 125), t338.sv('DTM-9384', t338.k(24), 126))) r;
select t338.leg('DTM-9384', null, 'HIST01', 'ida', 'AVHIST');
update public.contrato_vuelos set servicio_aereo = null where numero_contrato = 'DTM-9384' and numero_vuelo = 'AVHIST';
update public.contrato_vuelos set servicio_aereo = t338.k(21) where numero_contrato = 'DTM-9384' and numero_vuelo = 'AVHIST';
select t338.afirma('C11b a leg that had NO service and joins service 21 flags service 21 «revisar» (the target of the association changed)',
  (select r from t338_c11b) = 'ok' and t338.p(t338.estado('DTM-9384', t338.k(21)), 6) = 'revisar');
-- C12 stale payload: legs change between building the payload and writing it → rejected, nothing written
create temp table t338_stale as select jsonb_build_array(t338.sv('DTM-9384', t338.k(21), 130), t338.sv('DTM-9384', t338.k(24), 131)) p;
insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion, servicio_aereo) values ('DTM-9384', 'AV', 'ida', t338.k(21));
create temp table t338_c12 as select t338.estado('DTM-9384', t338.k(24)) e;
select t338.afirma('C12 a payload built BEFORE another leg change (stale) is rejected with SERVICIOS_CAMBIARON and writes nothing',
  t338.guardar('DTM-9384', (select p from t338_stale)) like '22023: SERVICIOS_CAMBIARON%' and t338.estado('DTM-9384', t338.k(24)) = (select e from t338_c12));
-- C12b same ids, but a saved FIELD changed after the payload was built (concurrent editor save): rejected too — a stale itinerary is never stored as «vigente»
create temp table t338_stale2 as select jsonb_build_array(t338.sv('DTM-9384', t338.k(21), 150), t338.sv('DTM-9384', t338.k(24), 151)) p;
update public.contrato_vuelos set hora_salida = '23:59' where numero_contrato = 'DTM-9384' and servicio_aereo = t338.k(24);
create temp table t338_c12b as select t338.estado('DTM-9384', t338.k(24)) e;
select t338.afirma('C12b same leg ids but an edited field after reading → SERVICIOS_CAMBIARON; the voucher stays «revisar», nothing written',
  t338.guardar('DTM-9384', (select p from t338_stale2)) like '22023: SERVICIOS_CAMBIARON%' and t338.estado('DTM-9384', t338.k(24)) = (select e from t338_c12b) and t338.p(t338.estado('DTM-9384', t338.k(24)), 6) = 'revisar');
-- C13 atomic rollback: failure injected between the upserts and the retirement leaves nothing changed (savepoint)
insert into public.vouchers (numero_contrato, tipo, proveedor, servicio_clave, contenido) values ('DTM-9384', 'vuelo', 'Servicio aéreo', 'legado-x', '{"clase":"vuelo"}');
create function t338.falla() returns trigger language plpgsql as $$ begin raise exception 'inyectado' using errcode = 'P0001'; end $$;
create trigger t338_falla after update on public.vouchers for each row when (new.estado = 'retirado') execute function t338.falla();
create temp table t338_c13b as select t338.estado('DTM-9384', t338.k(21)) e21, (select count(*) from public.vouchers where numero_contrato = 'DTM-9384' and estado = 'retirado') n;
select t338.afirma('C13 failure injected on the retirement step rolls back the WHOLE regeneration (earlier upserts included)',
  t338.guardar('DTM-9384', jsonb_build_array(t338.sv('DTM-9384', t338.k(21), 140), t338.sv('DTM-9384', t338.k(24), 124))) like 'P0001: inyectado%' and t338.estado('DTM-9384', t338.k(21)) = (select e21 from t338_c13b)
  and (select count(*) from public.vouchers where numero_contrato = 'DTM-9384' and estado = 'retirado') = (select n from t338_c13b));
drop trigger t338_falla on public.vouchers;
delete from public.vouchers where servicio_clave = 'legado-x';

-- ── V · V5-2: legacy ida+regreso fields (one row holds both directions) invalidate an issued voucher too ──
insert into public.contrato_vuelos (numero_contrato, servicio_aereo, aerolinea, origen_codigo, destino_codigo, fecha_salida, vuelo_ida, hora_salida_ida, hora_llegada_ida, fecha_regreso, vuelo_regreso, hora_salida_reg, hora_llegada_reg, orden)
  values ('DTM-9391', t338.k(91), 'AV', 'BOG', 'CTG', '2027-06-07', 'AV1', '08:00', '09:30', '2027-06-10', 'AV2', '18:00', '19:30', 0);
create temp table t338_v0 as select t338.guardar('DTM-9391', jsonb_build_array(t338.sv('DTM-9391', t338.k(91), 1))) r;
create temp table t338_v0e as select t338.estado('DTM-9391', t338.k(91)) e;
create temp table t338_vres (campo text, antes text, tras_noop text, tras_cambio text, tras_regen text);
do $$
declare c text; valores jsonb := '{"vuelo_ida":"NEW1","vuelo_regreso":"NEW2","hora_salida_ida":"10:00","hora_llegada_ida":"11:30","hora_salida_reg":"20:00","hora_llegada_reg":"21:30","fecha_regreso":"2027-06-12"}'::jsonb;
        a text; b text; d text; e text;
begin
  for c in select k from jsonb_object_keys(valores) k order by 1 loop
    a := t338.p(t338.estado('DTM-9391', t338.k(91)), 6);
    execute format('update public.contrato_vuelos set %1$I = %1$I where numero_contrato = %2$L', c, 'DTM-9391');          -- identical values
    b := t338.p(t338.estado('DTM-9391', t338.k(91)), 6);
    execute format('update public.contrato_vuelos set %1$I = %2$L where numero_contrato = %3$L', c, valores ->> c, 'DTM-9391'); -- real change
    d := t338.p(t338.estado('DTM-9391', t338.k(91)), 6);
    perform t338.guardar('DTM-9391', jsonb_build_array(t338.sv('DTM-9391', t338.k(91), 1, '2027-01-01', c)));                 -- content differs per field, so the revision rises
    e := t338.p(t338.estado('DTM-9391', t338.k(91)), 6);
    insert into t338_vres values (c, a, b, d, e);
  end loop;
end $$;
select t338.afirma('V1 each of the 7 legacy fields (vuelo_ida, vuelo_regreso, hora_salida_ida/llegada_ida, hora_salida_reg/llegada_reg, fecha_regreso): a no-op rewrite flags nothing, a real change flags «revisar», regeneration restores «vigente»',
  (select count(*) from t338_vres) = 7 and (select bool_and(antes = 'vigente' and tras_noop = 'vigente' and tras_cambio = 'revisar' and tras_regen = 'vigente') from t338_vres),
  (select string_agg(campo || ':' || antes || '/' || tras_noop || '/' || tras_cambio || '/' || tras_regen, ' ') from t338_vres));
select t338.afirma('V2 the link never changed through the seven invalidations (same id and token) and the revision grew monotonically',
  t338.p(t338.estado('DTM-9391', t338.k(91)), 2) = t338.p((select e from t338_v0e), 2) and t338.p(t338.estado('DTM-9391', t338.k(91)), 3) = t338.p((select e from t338_v0e), 3) and t338.p(t338.estado('DTM-9391', t338.k(91)), 1)::int >= 14);
select t338.afirma('V3 the lock protocol objects exist: leg lock trigger (fires first), generation helper not executable by anon, trigger function not executable by clients',
  exists (select 1 from pg_trigger where tgrelid = 'public.contrato_vuelos'::regclass and tgname = 't_00_tramo_candado' and not tgisinternal)
  and (select tgname from pg_trigger where tgrelid = 'public.contrato_vuelos'::regclass and not tgisinternal and tgtype & 2 = 2 order by tgname limit 1) = 't_00_tramo_candado'
  and has_function_privilege('authenticated', 'public.bloquear_voucher_vuelo(text)', 'execute') and not has_function_privilege('anon', 'public.bloquear_voucher_vuelo(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.fn_tramo_candado()', 'execute'));

-- ── O · the DISPLAY ORDER is rendered, but only the resulting order matters (not the absolute `orden` values) ──
select t338.leg('DTM-9392', t338.k(92), null, 'ida', 'AVO1'), t338.leg('DTM-9392', t338.k(92), null, 'regreso', 'AVO2');
create temp table t338_o0 as select t338.guardar('DTM-9392', jsonb_build_array(t338.sv('DTM-9392', t338.k(92), 1))) r;
create temp table t338_o0e as select t338.estado('DTM-9392', t338.k(92)) e;
update public.contrato_vuelos set orden = orden + 20 where numero_contrato = 'DTM-9392';                       -- 0,1 → 20,21: same order
select t338.afirma('O1 renumbering `orden` without changing the resulting order (20,21 instead of 0,1) flags nothing — the editor normalizes it on its first save', t338.estado('DTM-9392', t338.k(92)) = (select e from t338_o0e));
update public.contrato_vuelos set orden = case numero_vuelo when 'AVO1' then 21 else 20 end where numero_contrato = 'DTM-9392';   -- swapped order
select t338.afirma('O2 swapping two legs (the issued document lists them in a different order) flags the voucher «revisar»', t338.p(t338.estado('DTM-9392', t338.k(92)), 6) = 'revisar');
create temp table t338_o2 as select t338.guardar('DTM-9392', jsonb_build_array(t338.sv('DTM-9392', t338.k(92), 2))) r;
select t338.afirma('O3 regeneration restores «vigente» at the same link; the stored fingerprint now matches the new order', (select r from t338_o2) = 'ok' and t338.p(t338.estado('DTM-9392', t338.k(92)), 6) = 'vigente' and t338.p(t338.estado('DTM-9392', t338.k(92)), 3) = t338.p((select e from t338_o0e), 3)
  and (select huella from public.vouchers where numero_contrato = 'DTM-9392') = public.huella_servicio_aereo('DTM-9392', t338.k(92)));
select t338.afirma('O4 a stored fingerprint exists on every generated air voucher and equals the current one while «vigente»', not exists (select 1 from public.vouchers where tipo = 'vuelo' and estado = 'vigente' and servicio_clave ~ '^[0-9a-f-]{36}$' and numero_contrato in ('DTM-9391', 'DTM-9392') and huella is distinct from public.huella_servicio_aereo(numero_contrato, servicio_clave::uuid)));

-- ── D · default association for the existing writers ────────────────────
insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion) values ('DTM-9389', 'AV', 'ida'), ('DTM-9389', 'AV', 'regreso'), ('DTM-9389', 'AV', 'ida');
insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion) values ('DTM-9382', 'AV', 'ida');
select t338.afirma('D1 legs a contract receives with no service share ONE new service per transaction; another contract gets a different one; nothing stays NULL',
  (select count(distinct servicio_aereo) from public.contrato_vuelos where numero_contrato = 'DTM-9389') = 1 and (select count(*) from public.contrato_vuelos where numero_contrato = 'DTM-9389' and servicio_aereo is null) = 0
  and (select servicio_aereo from public.contrato_vuelos where numero_contrato = 'DTM-9382' limit 1) is distinct from (select servicio_aereo from public.contrato_vuelos where numero_contrato = 'DTM-9389' limit 1));

-- ── E · the operational flight editor (guardar_tramos_contrato) ──────────
select t338.leg('DTM-9388', t338.k(31), 'E1', 'ida', 'AV310'), t338.leg('DTM-9388', t338.k(31), 'E2', 'regreso', 'AV311'), t338.leg('DTM-9388', t338.k(32), null, 'ida', 'AV320');
create temp table t338_ids as select (select id from public.contrato_vuelos where numero_contrato = 'DTM-9388' and numero_vuelo = 'AV310') a, (select id from public.contrato_vuelos where numero_contrato = 'DTM-9388' and numero_vuelo = 'AV311') b, (select id from public.contrato_vuelos where numero_contrato = 'DTM-9388' and numero_vuelo = 'AV320') c;
create function t338.tr(p_id bigint, p_vuelo text, p_dir text, p_svc text default null, p_record text default null) returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', p_id, 'aerolinea', 'AV', 'record', p_record, 'direccion', p_dir, 'origenCodigo', case when p_dir = 'regreso' then 'CTG' else 'BOG' end, 'destinoCodigo', case when p_dir = 'regreso' then 'BOG' else 'CTG' end, 'numeroVuelo', p_vuelo, 'servicio', p_svc)) $$;
create function t338.editor(p_tramos jsonb) returns text language plpgsql as $$
begin return t338.intenta(format('delete from t338.g; select * from public.guardar_tramos_contrato(%L, %L::jsonb)', 'DTM-9388', p_tramos::text), 'admin'); end $$;
create temp table t338_e0 as select t338.guardar('DTM-9388', jsonb_build_array(t338.sv('DTM-9388', t338.k(31), 31), t338.sv('DTM-9388', t338.k(32), 32))) r;
create temp table t338_e31 as select t338.estado('DTM-9388', t338.k(31)) e;
select t338.afirma('E1 saving with NO service field keeps each leg in its saved service and changes nothing in vouchers (identical values)',
  t338.editor(jsonb_build_array(t338.tr((select a from t338_ids), 'AV310', 'ida', null, 'E1'), t338.tr((select b from t338_ids), 'AV311', 'regreso', null, 'E2'), t338.tr((select c from t338_ids), 'AV320', 'ida'))) = 'ok'
  and (select count(distinct servicio_aereo) from public.contrato_vuelos where numero_contrato = 'DTM-9388') = 2 and (select servicio_aereo from public.contrato_vuelos where id = (select a from t338_ids)) = t338.k(31)
  and t338.estado('DTM-9388', t338.k(31)) = (select e from t338_e31));
select t338.afirma('E2 an unknown service id, or a service of ANOTHER contract, is rejected and nothing is written',
  t338.editor(jsonb_build_array(t338.tr((select a from t338_ids), 'AV310', 'ida', t338.k(99)::text, 'E1'), t338.tr((select c from t338_ids), 'AV320', 'ida'))) like 'P0001: El servicio del tramo 1 no existe en este contrato%'
  and t338.editor(jsonb_build_array(t338.tr((select a from t338_ids), 'AV310', 'ida', t338.k(21)::text, 'E1'))) like 'P0001: El servicio del tramo 1 no existe%'
  and (select count(*) from public.contrato_vuelos where numero_contrato = 'DTM-9388') = 3 and t338.p(t338.estado('DTM-9388', t338.k(31)), 6) = 'vigente');
select t338.afirma('E3 malformed service values are refused', t338.editor(jsonb_build_array(t338.tr((select a from t338_ids), 'AV310', 'ida', 'abc'))) like 'P0001: El servicio aéreo de un tramo es inválido%'
  and t338.editor(jsonb_build_array(jsonb_build_object('id', (select a from t338_ids), 'aerolinea', 'AV', 'servicio', 5))) like 'P0001: El campo servicio de un tramo debe ser texto%');
-- (the editor call is made in its own statement first: an outer subquery would not see writes made inside a volatile function of the same statement)
create temp table t338_e4 as select t338.editor(jsonb_build_array(t338.tr((select a from t338_ids), 'AV310', 'ida', null, 'E1'), t338.tr((select b from t338_ids), 'AV311', 'regreso', 'nuevo:1', 'E2'), t338.tr((select c from t338_ids), 'AV320', 'ida'))) r;
select t338.afirma('E4 split: moving the return leg to «nuevo:1» creates a new service (uuid) and flags the original «revisar»',
  (select r from t338_e4) = 'ok' and (select count(distinct servicio_aereo) from public.contrato_vuelos where numero_contrato = 'DTM-9388') = 3 and t338.p(t338.estado('DTM-9388', t338.k(31)), 6) = 'revisar'
  and (select servicio_aereo from public.contrato_vuelos where id = (select b from t338_ids)) not in (t338.k(31), t338.k(32)));
select t338.afirma('E4b the editor result carries servicio_aereo for every leg',
  t338.intenta($q$do $d$ declare n int; begin
    select count(*) into n from public.guardar_tramos_contrato('DTM-9388', (select jsonb_agg(t338.tr(c.id, c.numero_vuelo, c.direccion)) from public.contrato_vuelos c where c.numero_contrato = 'DTM-9388')) r where r.servicio_aereo is not null;
    if n <> 3 then raise exception 'n=%', n; end if; end $d$$q$, 'admin') = 'ok');
create temp table t338_e5 as select t338.editor(jsonb_build_array(t338.tr((select a from t338_ids), 'AV310', 'ida', null, 'E1'), t338.tr((select b from t338_ids), 'AV311', 'regreso', t338.k(31)::text, 'E2'), t338.tr((select c from t338_ids), 'AV320', 'ida'))) r;
select t338.afirma('E5 merge: choosing an existing service for a leg re-associates it; the service left without legs is retired by the trigger',
  (select r from t338_e5) = 'ok' and (select count(distinct servicio_aereo) from public.contrato_vuelos where numero_contrato = 'DTM-9388') = 2 and (select servicio_aereo from public.contrato_vuelos where id = (select b from t338_ids)) = t338.k(31));
create temp table t338_e6a as select t338.editor(jsonb_build_array(t338.tr((select a from t338_ids), 'AV310', 'ida', null, 'E1'), t338.tr((select c from t338_ids), 'AV320', 'ida'), t338.tr(null, 'AV999', 'ida'))) r;
create temp table t338_e6b as select t338.editor(jsonb_build_array(t338.tr((select a from t338_ids), 'AV310', 'ida', null, 'E1'), t338.tr((select b from t338_ids), 'AV311', 'regreso', null, 'E2'), t338.tr(null, 'AV999', 'ida'))) r;
select t338.afirma('E6 a NEW leg with no service: refused when the payload has several services (not guessed); joins the only one otherwise',
  (select r from t338_e6a) like 'P0001: Hay un tramo nuevo sin servicio%' and (select r from t338_e6b) = 'ok'
  and (select servicio_aereo from public.contrato_vuelos where numero_contrato = 'DTM-9388' and numero_vuelo = 'AV999') = t338.k(31) and not exists (select 1 from public.contrato_vuelos where numero_contrato = 'DTM-9388' and numero_vuelo = 'AV320'));
-- historical leg without service: the editor demands an explicit one
update public.contrato_vuelos set servicio_aereo = null where numero_contrato = 'DTM-9388' and numero_vuelo = 'AV999';
create temp table t338_e7 as select (select id from public.contrato_vuelos where numero_vuelo = 'AV999' and numero_contrato = 'DTM-9388') x;
create temp table t338_e7a as select t338.editor(jsonb_build_array(t338.tr((select a from t338_ids), 'AV310', 'ida', null, 'E1'), t338.tr((select x from t338_e7), 'AV999', 'ida'))) r;
create temp table t338_e7b as select t338.editor(jsonb_build_array(t338.tr((select a from t338_ids), 'AV310', 'ida', null, 'E1'), t338.tr((select x from t338_e7), 'AV999', 'ida', 'nuevo:2'))) r;
select t338.afirma('E7 a saved leg whose service is unknown (historical ambiguity) cannot be saved until a service is chosen; choosing one works',
  (select r from t338_e7a) like 'P0001: El tramo 2 no tiene servicio aéreo asociado%' and (select r from t338_e7b) = 'ok'
  and (select count(distinct servicio_aereo) from public.contrato_vuelos where numero_contrato = 'DTM-9388') = 2 and (select count(*) from public.contrato_vuelos where numero_contrato = 'DTM-9388' and servicio_aereo is null) = 0);

-- ── R · roles ───────────────────────────────────────────────────────────
select t338.afirma('R1 RLS applies: venta writes its OWN contract, not a colleague''s (nothing created); anon cannot execute; the old function is gone; the read helper hides foreign contracts',
  t338.guardar('DTM-9389', jsonb_build_array(t338.sv('DTM-9389', (select servicio_aereo from public.contrato_vuelos where numero_contrato = 'DTM-9389' limit 1), 1)), 'venta') = 'ok'
  and t338.guardar('DTM-9382', jsonb_build_array(t338.sv('DTM-9382', (select servicio_aereo from public.contrato_vuelos where numero_contrato = 'DTM-9382' limit 1), 1)), 'venta') like '42501:%' and t338.nv('DTM-9382') = 0
  and not has_function_privilege('anon', 'public.guardar_vouchers_vuelo(text,jsonb)', 'execute') and has_function_privilege('authenticated', 'public.guardar_vouchers_vuelo(text,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.servicios_aereos_contrato(text)', 'execute') and not exists (select 1 from pg_proc where proname = 'guardar_voucher_vuelo')
  and not has_function_privilege('authenticated', 'public.fn_tramo_marca_vouchers()', 'execute') and not has_function_privilege('authenticated', 'public.fn_marcar_voucher_servicio(text,uuid,boolean)', 'execute'));
delete from public.vouchers where numero_contrato = 'DTM-9389';

-- ── G · Gestión de contratos: the internal signal ───────────────────────
create function t338.gestion(p_num text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', t338.u('super'), 'role', 'authenticated', 'session_id', t338.s('super'))::text, true);
  perform set_config('request.jwt.claim.sub', t338.u('super')::text, true);
  execute 'set local role authenticated';
  select public.fn_gestion_contratos(jsonb_build_object('numero', p_num)) -> 'filas' -> 0 -> 'voucher' into r;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $$;
create function t338.acusa(p_num text, p_accion text default 'marcar') returns text language sql as $$
  select t338.intenta(format($f$select public.registrar_seguimiento_contrato(%L, (select contrato_uid from public.ventas where numero_contrato = %L), 'voucher_entregado', %L, %L, null)$f$, p_num, p_num, p_accion, case when p_accion = 'marcar' then 'correo' end), 'super') $$;

select t338.leg('DTM-9385', t338.k(41), 'G1', 'ida'), t338.leg('DTM-9385', t338.k(42), 'G2', 'ida'), t338.leg('DTM-9386', t338.k(51), 'G3', 'ida');
create temp table t338_g0 as select t338.guardar('DTM-9385', jsonb_build_array(t338.sv('DTM-9385', t338.k(41), 1), t338.sv('DTM-9385', t338.k(42), 1))) r;
create temp table t338_g0b as select t338.guardar('DTM-9386', jsonb_build_array(t338.sv('DTM-9386', t338.k(51), 1))) r;
select t338.afirma('G1 before any acknowledgment: voucher generated, delivery pending, not «updated», none «not current»',
  t338.gestion('DTM-9385') ->> 'entrega' = 'pendiente' and (t338.gestion('DTM-9385') ->> 'actualizado')::boolean = false and (t338.gestion('DTM-9385') ->> 'n')::int = 2 and (t338.gestion('DTM-9385') ->> 'aereo_no_vigente')::int = 0);
create temp table t338_g2 as select t338.acusa('DTM-9385') a, t338.acusa('DTM-9386') b;
select t338.afirma('G2 the superadmin registers the delivery manually: «entregado», not updated', (select a from t338_g2) = 'ok' and (select b from t338_g2) = 'ok'
  and t338.gestion('DTM-9385') ->> 'entrega' = 'entregado' and (t338.gestion('DTM-9385') ->> 'actualizado')::boolean = false);
create temp table t338_g3 as select t338.guardar('DTM-9385', jsonb_build_array(t338.sv('DTM-9385', t338.k(41), 1), t338.sv('DTM-9385', t338.k(42), 1))) r;
select t338.afirma('G3 an IDENTICAL regeneration after the delivery raises no signal (still «entregado»)',
  t338.gestion('DTM-9385') ->> 'entrega' = 'entregado' and (t338.gestion('DTM-9385') ->> 'actualizado')::boolean = false and (t338.gestion('DTM-9385') ->> 'acuse_anterior')::boolean = false);
update public.contrato_vuelos set numero_vuelo = 'AV777' where numero_contrato = 'DTM-9385' and servicio_aereo = t338.k(42);
select t338.afirma('G4 a leg change after the delivery (BEFORE regenerating): the delivery is superseded, «actualizado» = true and one air voucher is NOT current — the internal signal exists without regenerating',
  t338.gestion('DTM-9385') ->> 'entrega' = 'pendiente' and (t338.gestion('DTM-9385') ->> 'actualizado')::boolean and (t338.gestion('DTM-9385') ->> 'aereo_no_vigente')::int = 1
  and t338.gestion('DTM-9386') ->> 'entrega' = 'entregado' and (t338.gestion('DTM-9386') ->> 'actualizado')::boolean = false);
create temp table t338_g5 as select t338.guardar('DTM-9385', jsonb_build_array(t338.sv('DTM-9385', t338.k(41), 1), t338.sv('DTM-9385', t338.k(42), 2))) r;
select t338.afirma('G5 regenerating: none «not current» any more; the signal stays until the staff register the communication again (no duplicate)',
  (t338.gestion('DTM-9385') ->> 'aereo_no_vigente')::int = 0 and (t338.gestion('DTM-9385') ->> 'actualizado')::boolean and t338.gestion('DTM-9385') ->> 'entrega' = 'pendiente');
create temp table t338_g6 as select t338.acusa('DTM-9385') r;
create temp table t338_g6b as select t338.acusa('DTM-9385') r;
select t338.afirma('G6 re-registering the communication clears the signal; a second identical registration is refused as already current',
  (select r from t338_g6) = 'ok' and t338.gestion('DTM-9385') ->> 'entrega' = 'entregado' and (t338.gestion('DTM-9385') ->> 'actualizado')::boolean = false and (select r from t338_g6b) like 'F4703:%');
delete from public.contrato_vuelos where numero_contrato = 'DTM-9385' and servicio_aereo = t338.k(42);
select t338.afirma('G7 removing a service after the delivery: its voucher is retired (internal «updated» signal, one voucher not current); the other voucher is untouched',
  t338.gestion('DTM-9385') ->> 'entrega' = 'pendiente' and (t338.gestion('DTM-9385') ->> 'actualizado')::boolean and (t338.gestion('DTM-9385') ->> 'aereo_no_vigente')::int = 1
  and t338.p(t338.estado('DTM-9385', t338.k(41)), 6) = 'vigente' and t338.p(t338.estado('DTM-9385', t338.k(42)), 6) = 'retirado');
-- 309 behaviour preserved: a NEW service/hotel voucher (higher id) still supersedes an acknowledgment, but it is not «updated»
create temp table t338_g9 as select t338.acusa('DTM-9386') r;
insert into public.vouchers (numero_contrato, tipo, proveedor, contenido) values ('DTM-9386', 'hotel', 'Hotel Z', '{"clase":"hotel"}');
select t338.afirma('G8 309 behaviour kept: a NEW voucher (higher id) supersedes the acknowledgment but is NOT reported as «updated»',
  t338.gestion('DTM-9386') ->> 'entrega' = 'pendiente' and (t338.gestion('DTM-9386') ->> 'acuse_anterior')::boolean and not (t338.gestion('DTM-9386') ->> 'actualizado')::boolean);
insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete, asesor, estado) values ('DTM-9387', 'Acuse previo a 338', 'mayorista', 'dinamico', 'C338 venta dueno', 'confirmado');
insert into public.vouchers (numero_contrato, tipo, proveedor, contenido) values ('DTM-9387', 'hotel', 'Hotel Y', '{"clase":"hotel"}');
insert into public.contrato_seguimiento (numero_contrato, contrato_uid, tenant, tipo, accion, canal, referencia, actor_id, actor_email, actor_nombre)
  select 'DTM-9387', contrato_uid, tenant, 'voucher_entregado', 'marcar', 'correo', jsonb_build_object('n', 1, 'max_id', (select max(id) from public.vouchers where numero_contrato = 'DTM-9387')), t338.u('super'), 'c338-super@x.test', 'C338 super'
    from public.ventas where numero_contrato = 'DTM-9387';
select t338.afirma('G9 an acknowledgment written BEFORE 338 (no rev) stays «entregado» while nothing changed', t338.gestion('DTM-9387') ->> 'entrega' = 'entregado' and not (t338.gestion('DTM-9387') ->> 'actualizado')::boolean);

do $$
declare n_mal int; r record;
begin
  select count(*) into n_mal from t338.res where not ok;
  for r in select nombre, detalle from t338.res where not ok loop raise notice 'FALLO: % -- %', r.nombre, r.detalle; end loop;
  if n_mal > 0 then raise exception 'TEST 338 SQL: % fallo(s)', n_mal; end if;
  raise notice 'TEST 338 SQL: ALL OK (% comprobaciones)', (select count(*) from t338.res);
end $$;
rollback;
