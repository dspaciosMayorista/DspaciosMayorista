-- Prueba LOCAL de la 278 (#90) en un Postgres desechable (NO es para producción). Uso:
--   psql -v ON_ERROR_STOP=1 -U postgres -f test_278_hotel_reglas_descuento.sql   (desde supabase/scripts; la migración se incluye con \i)
-- Siembra stubs mínimos de lo que la 278 presupone (hoteles, hotel_temporadas, mi_rol, puede_escribir_catalogo_global) y comprueba:
-- preflight APTO -> migración -> postcheck CORRECTA -> constraints -> RLS por rol -> candado de catálogo -> no reaplicable -> rollback limpio.
\set ON_ERROR_STOP on
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
drop table if exists public.hotel_reglas_descuento cascade;
drop table if exists public.hotel_temporadas cascade;
drop table if exists public.hoteles cascade;
create table public.hoteles (id bigint primary key, nombre text);
create table public.hotel_temporadas (id bigint primary key);
create or replace function public.mi_rol() returns text language sql stable as $$ select nullif(current_setting('app.rol', true), '') $$;
create or replace function public.puede_escribir_catalogo_global() returns boolean language sql stable as $$ select coalesce(current_setting('app.mayorista', true), 'on') = 'on' $$;
grant usage on schema public to anon, authenticated;
grant select on public.hoteles to anon, authenticated;
insert into public.hoteles values (1, 'Hotel A'), (2, 'Hotel B');

\echo '== PREFLIGHT (esperado: 99 APTO)'
\i preflight_278_hotel_reglas_descuento.sql
\echo '== MIGRACION'
\i ../migrations/20260601000278_hotel_reglas_descuento.sql
\echo '== POSTCHECK (esperado: 99 278 CORRECTA)'
\i postcheck_278_hotel_reglas_descuento.sql

\echo '== CONSTRAINTS'
do $$
declare falla int := 0;
begin
  insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct) values (1,'ebb',30,18),(1,'ebb',60,23),(1,'ebb',90,28),(1,'long_stay',4,25);
  begin insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct) values (1,'ebb',30,10); falla := falla + 1; exception when unique_violation then null; end;
  begin insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct) values (1,'otro',5,10); falla := falla + 1; exception when check_violation then null; end;
  begin insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct) values (1,'ebb',0,10); falla := falla + 1; exception when check_violation then null; end;
  begin insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct) values (1,'ebb',5,0); falla := falla + 1; exception when check_violation then null; end;
  begin insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct) values (1,'ebb',5,100); falla := falla + 1; exception when check_violation then null; end;
  begin insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct) values (99,'ebb',5,10); falla := falla + 1; exception when foreign_key_violation then null; end;
  if falla > 0 then raise exception 'CONSTRAINTS: % casos no fueron rechazados', falla; end if;
  raise notice 'CONSTRAINTS OK (unique, tipo, umbral>=1, 0<pct<100, FK)';
end $$;

\echo '== RLS POR ROL'
set role authenticated;
do $$
declare n int;
begin
  perform set_config('app.rol', 'venta', false);
  select count(*) into n from public.hotel_reglas_descuento; if n <> 4 then raise exception 'venta debe LEER 4 reglas, ve %', n; end if;
  begin insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct) values (2,'ebb',30,10); raise exception 'venta NO debe escribir'; exception when insufficient_privilege then null; end;
  perform set_config('app.rol', 'operaciones', false);
  insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct) values (2,'ebb',30,10);
  update public.hotel_reglas_descuento set pct = 11 where hotel_id = 2;
  perform set_config('app.rol', 'agencia', false);
  select count(*) into n from public.hotel_reglas_descuento; if n <> 0 then raise exception 'rol externo no debe ver reglas, ve %', n; end if;
  perform set_config('app.rol', 'operaciones', false); perform set_config('app.mayorista', 'off', false);
  begin insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct) values (2,'ebb',60,15); raise exception 'minorista NO debe escribir catalogo global'; exception when insufficient_privilege then null; end;
  perform set_config('app.mayorista', 'on', false);
  raise notice 'RLS OK (venta lee y no escribe; operaciones escribe; externo no ve; minorista bloqueado)';
end $$;
reset role;
set role anon;
do $$ begin
  begin perform count(*) from public.hotel_reglas_descuento; raise exception 'anon NO debe tener acceso'; exception when insufficient_privilege then raise notice 'anon bloqueado OK'; end;
end $$;
reset role;

\echo '== NO REAPLICABLE'
do $$ begin
  begin
    perform 1; execute 'create table public.hotel_reglas_descuento_x (id int)'; execute 'drop table public.hotel_reglas_descuento_x';
  end;
end $$;
\set ON_ERROR_STOP off
\i ../migrations/20260601000278_hotel_reglas_descuento.sql
\set ON_ERROR_STOP on

\echo '== ROLLBACK'
\i rollback_278_hotel_reglas_descuento.sql
select 'tabla tras rollback' as control, coalesce(to_regclass('public.hotel_reglas_descuento')::text, 'AUSENTE') as observado, 'AUSENTE' as esperado;
select 'hoteles intactos' as control, count(*)::text as observado, '2' as esperado from public.hoteles;
\echo '== PREFLIGHT otra vez tras rollback (esperado APTO: reaplicable)'
\i preflight_278_hotel_reglas_descuento.sql
