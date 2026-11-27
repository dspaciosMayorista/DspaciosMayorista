-- SQL battery for migrations 336 (conversion claim) and 337 (atomic air voucher). DISPOSABLE databases only. One transaction, ends in ROLLBACK.
-- Usage: psql -X -q -v ON_ERROR_STOP=1 -f test_336_337_conversion_voucher.sql   (database with migrations 001-337)
-- Expected last line: "TEST 336/337 SQL: ALL OK".
begin;

create schema t336;
create table t336.res (nombre text, ok boolean, detalle text);
create function t336.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void language plpgsql as $$
begin
  insert into t336.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre; else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;
create function t336.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000336' || case p_k when 'admin' then '002' when 'venta' then '005' when 'otro' then '006' else '999' end)::uuid $$;
create function t336.s(p_k text) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-000000336' || case p_k when 'admin' then '102' when 'venta' then '105' when 'otro' then '106' else '199' end)::uuid $$;
-- Runs SQL as the given session user (subtransaction); returns 'ok' or 'SQLSTATE: message'.
create function t336.intenta(p_sql text, p_k text default 'admin', p_rol text default 'authenticated') returns text language plpgsql as $$
declare v text := 'ok';
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', t336.u(p_k), 'role', 'authenticated', 'session_id', t336.s(p_k))::text, true);
    perform set_config('request.jwt.claim.sub', t336.u(p_k)::text, true);
    execute format('set local role %I', p_rol);
    execute p_sql;
    reset role;
  exception when others then v := sqlstate || ': ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

insert into auth.users (id, email) select t336.u(k), 'c336-' || k || '@x.test' from unnest(array['admin','venta','otro']) k on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t336.u(k), 'c336-' || k || '@x.test', n, r::rol_usuario, true, 'mayorista'
from (values ('admin','C336 admin','administracion'), ('venta','C336 venta dueno','venta'), ('otro','C336 venta otro','venta')) v(k, n, r)
on conflict (id) do update set rol = excluded.rol, nombre = excluded.nombre, activo = true, tenant = excluded.tenant;
insert into auth.sessions (id, user_id) select t336.s(k), t336.u(k) from unnest(array['admin','venta','otro']) k on conflict do nothing;

-- ── C · claim of a quotation conversion (336) ───────────────────────────
insert into public.cotizaciones (id, tenant) values (933601, 'mayorista'), (933602, 'mayorista');
create temp table t336_tok (k text primary key, v uuid);
insert into t336_tok select 'a', public.reclamar_conversion_cotizacion(933601);
select t336.afirma('C1 the first claim returns a token', (select v from t336_tok where k = 'a') is not null);
select t336.afirma('C2 a second claim while the first is live returns NULL (no second conversion, no second number)', public.reclamar_conversion_cotizacion(933601) is null);
select t336.afirma('C3 another quotation is independent', public.reclamar_conversion_cotizacion(933602) is not null);
select t336.afirma('C4 releasing with a WRONG token does nothing', public.liberar_conversion_cotizacion(933601, gen_random_uuid()) = false
  and exists (select 1 from public.cotizacion_conversion_reclamo where cotizacion_id = 933601));
create temp table t336_lib as select public.liberar_conversion_cotizacion(933601, (select v from t336_tok where k = 'a')) as r;
select t336.afirma('C5 releasing with the right token frees it', (select r from t336_lib) and not exists (select 1 from public.cotizacion_conversion_reclamo where cotizacion_id = 933601));
insert into t336_tok select 'b', public.reclamar_conversion_cotizacion(933601);
select t336.afirma('C6 after release the quotation can be claimed again', (select v from t336_tok where k = 'b') is not null);
update public.cotizacion_conversion_reclamo set expira_en = now() - interval '1 second' where cotizacion_id = 933601;
insert into t336_tok select 'c', public.reclamar_conversion_cotizacion(933601);
select t336.afirma('C7 an EXPIRED claim (crashed process) is taken over with a new token', (select v from t336_tok where k = 'c') is not null and (select v from t336_tok where k = 'c') <> (select v from t336_tok where k = 'b'));
select t336.afirma('C8 the old holder can no longer release the new claim', public.liberar_conversion_cotizacion(933601, (select v from t336_tok where k = 'b')) = false);
select t336.afirma('C9 ttl out of range / invalid quotation are rejected',
  t336.intenta('select public.reclamar_conversion_cotizacion(933601, 5)', 'admin', 'service_role') like '22023:%' and t336.intenta('select public.reclamar_conversion_cotizacion(0)', 'admin', 'service_role') like '22023:%');
select t336.afirma('C10 not executable by anon/authenticated; the table has no direct grants for them',
  not has_function_privilege('anon', 'public.reclamar_conversion_cotizacion(bigint,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.reclamar_conversion_cotizacion(bigint,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.liberar_conversion_cotizacion(bigint,uuid)', 'execute')
  and not has_table_privilege('authenticated', 'public.cotizacion_conversion_reclamo', 'select')
  and has_function_privilege('service_role', 'public.reclamar_conversion_cotizacion(bigint,integer)', 'execute'));
select t336.afirma('C11 an authenticated session cannot call the claim (permission denied)', t336.intenta('select public.reclamar_conversion_cotizacion(933602)') like '42501:%');
delete from public.cotizaciones where id = 933602;
select t336.afirma('C12 deleting the quotation removes its claim', not exists (select 1 from public.cotizacion_conversion_reclamo where cotizacion_id = 933602));

-- ── V · atomic air voucher (337) ────────────────────────────────────────
insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete, asesor, estado) values
  ('DTM-9361', 'Contrato del dueño', 'mayorista', 'dinamico', 'C336 venta dueno', 'confirmado'),
  ('DTM-9362', 'Contrato ajeno', 'mayorista', 'dinamico', 'C336 venta otro', 'confirmado');
create table t336.g (id bigint, tok uuid, creado boolean);
grant all on schema t336 to public; grant all on all tables in schema t336 to public;
create function t336.guardar(p_num text, p_json jsonb, p_k text default 'admin') returns text language plpgsql as $$
declare r text;
begin
  r := t336.intenta(format('delete from t336.g; insert into t336.g select * from public.guardar_voucher_vuelo(%L, %L::jsonb)', p_num, p_json::text), p_k);
  return r;
end $$;
create temp table t336_r1 as select t336.guardar('DTM-9361', '{"clase":"vuelo","n":1}') as r;
select t336.afirma('V1 first call creates the voucher (creado = true)', (select r from t336_r1) = 'ok'
  and (select creado from t336.g limit 1) and (select count(*) from public.vouchers where numero_contrato = 'DTM-9361' and tipo = 'vuelo') = 1);
create temp table t336_v1 as select id, share_token, contenido from public.vouchers where numero_contrato = 'DTM-9361' and tipo = 'vuelo';
create temp table t336_r2 as select t336.guardar('DTM-9361', '{"clase":"vuelo","n":2}') as r;
select t336.afirma('V2 second call updates IN PLACE: same id and SAME share_token, new content, creado = false',
  (select r from t336_r2) = 'ok' and not (select creado from t336.g limit 1)
  and (select count(*) from public.vouchers where numero_contrato = 'DTM-9361' and tipo = 'vuelo') = 1
  and (select (id, share_token) from public.vouchers where numero_contrato = 'DTM-9361' and tipo = 'vuelo') = (select (id, share_token) from t336_v1)
  and (select contenido->>'n' from public.vouchers where numero_contrato = 'DTM-9361' and tipo = 'vuelo') = '2');
select t336.afirma('V3 the invariant: a second air voucher for the same contract cannot be inserted directly (23505)',
  t336.intenta($q$insert into public.vouchers (numero_contrato, tipo, contenido) values ('DTM-9361', 'vuelo', '{"clase":"vuelo"}')$q$) like '23505:%vouchers_vuelo_uno_por_contrato%');
select t336.afirma('V4 hotel/service vouchers are NOT limited by the index (several allowed)',
  t336.intenta($q$insert into public.vouchers (numero_contrato, tipo, proveedor, contenido) values ('DTM-9361', 'servicios', 'P1', '{"a":1}'), ('DTM-9361', 'servicios', 'P2', '{"a":2}'), ('DTM-9361', 'hotel', 'H', '{"a":3}')$q$) = 'ok');
select t336.afirma('V5 content that is not a flight voucher is rejected and the stored voucher is untouched',
  t336.guardar('DTM-9361', '{"clase":"hotel"}') like '22023:%' and t336.guardar('DTM-9361', '[]') like '22023:%'
  and (select contenido->>'n' from public.vouchers where numero_contrato = 'DTM-9361' and tipo = 'vuelo') = '2');
select t336.afirma('V6 RLS still applies: venta writes its OWN contract', t336.guardar('DTM-9361', '{"clase":"vuelo","n":3}', 'venta') = 'ok');
select t336.afirma('V7 RLS still applies: venta cannot write a colleague''s contract; nothing is created',
  t336.guardar('DTM-9362', '{"clase":"vuelo","n":1}', 'venta') like '42501:%' and not exists (select 1 from public.vouchers where numero_contrato = 'DTM-9362'));
select t336.afirma('V8 anon cannot execute', not has_function_privilege('anon', 'public.guardar_voucher_vuelo(text,jsonb)', 'execute'));
-- NEGATIVE CONTROL: the round-1 application sequence (DELETE, then INSERT) loses the issued voucher when the INSERT fails; the function does not.
create function t336.viejo_falla() returns boolean language plpgsql as $$
declare quedan int;
begin
  delete from public.vouchers where numero_contrato = 'DTM-9361' and tipo = 'vuelo';           -- request 1 (committed on its own)
  begin
    insert into public.vouchers (numero_contrato, tipo, contenido) values ('DTM-9361', 'vuelo', null);   -- request 2 fails (NOT NULL)
  exception when others then null; end;
  select count(*) into quedan from public.vouchers where numero_contrato = 'DTM-9361' and tipo = 'vuelo';
  return quedan = 0;
end $$;
select t336.afirma('V9 negative control: DELETE-then-INSERT with a failing INSERT leaves NO air voucher (the defect the function removes)', t336.viejo_falla());

do $$
declare n_mal int; r record;
begin
  select count(*) into n_mal from t336.res where not ok;
  for r in select nombre, detalle from t336.res where not ok loop raise notice 'FALLO: % -- %', r.nombre, r.detalle; end loop;
  if n_mal > 0 then raise exception 'TEST 336/337 SQL: % fallo(s)', n_mal; end if;
  raise notice 'TEST 336/337 SQL: ALL OK (% comprobaciones)', (select count(*) from t336.res);
end $$;
rollback;
