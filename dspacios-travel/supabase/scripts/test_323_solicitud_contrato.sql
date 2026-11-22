-- ════════════════════════════════════════════════════════════════════════
-- PRUEBAS SQL · #78 (migración 323). «Solicitar contrato» por la RPC REAL y con avisos persistidos. SOLO base desechable, termina en ROLLBACK.
-- Uso (desde supabase/scripts, base con 001-323):  psql -v ON_ERROR_STOP=1 -f test_323_solicitud_contrato.sql <base>
-- ESTADO: ESCRITA SIN EJECUTAR (el motor Docker estaba caído al prepararla). Hay que correrla y, si un fixture no cuadra con el esquema, corregir el fixture, no el criterio.
-- Esperado (a mano): config_solicitudes.emails = «c216-admin@x.test; C216-GERENCIA@x.test, nadie@fuera.test» → reciben aviso admin (administracion) y gerencia de
-- mayorista (2 filas, 'nadie@fuera.test' no es usuario); NO ventaA (rol venta), NO adminMin (otra agencia), NO oper (no figura en la lista) → notificados = 2.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;
\ir test_216_fixtures.sql

create schema t323;
create function t323.cot(p_creado_por text, p_extra jsonb default '{}'::jsonb, p_tenant text default 'mayorista', p_precio numeric default 1000000, p_vig date default null) returns bigint
language plpgsql as $$
declare v bigint;
begin
  insert into public.cotizaciones (tipo, estado, payload, creado_por, tenant, precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, pax)
  values ('tarifario', 'abierta', coalesce(p_extra, '{}'::jsonb), p_creado_por, p_tenant, p_precio, 'COP', current_date + 60, current_date + 63, coalesce(p_vig, current_date + 5), 2)
  returning id into v;
  return v;
end $$;
create function t323.pedir(p_k text, p_cot bigint) returns text language sql volatile as $$
  select t216.escalar('service_role', null, format('select public.solicitar_contrato_cotizacion(%s, %L)::text', p_cot, t216.u(p_k)))
$$;

update public.config_solicitudes set emails = 'c216-admin@x.test; C216-GERENCIA@x.test, nadie@fuera.test' where id = 1;
update public.usuarios set aliado_id = null where id = t216.u('agencia');

-- A. Dueño directo (correo de la sesión): crea el evento y avisa SOLO a los configurados, activos, internos y de su agencia.
select set_config('t323.a', t323.cot('c216-agencia@x.test')::text, true);
select set_config('t323.ra', t323.pedir('agencia', current_setting('t323.a')::bigint), true);
select t216.afirma('A1 estado solicitada y 2 notificados', current_setting('t323.ra') like '%"estado": "solicitada"%' and current_setting('t323.ra') like '%"notificados": 2%', current_setting('t323.ra'));
select t216.afirma('A2 evento persistido (1 abierto, solicitante = el aliado)',
  (select count(*) = 1 and bool_and(solicitante_id = t216.u('agencia')) and bool_and(estado = 'solicitada') from public.cotizacion_solicitudes_contrato where cotizacion_id = current_setting('t323.a')::bigint));
select t216.afirma('A3 avisos: exactamente admin y gerencia, tipo solicitud_contrato, con cotizacion_id',
  (select array_agg(usuario_id order by usuario_id::text) = (select array_agg(x order by x::text) from unnest(array[t216.u('admin'), t216.u('gerencia')]) x)
          and bool_and(tipo = 'solicitud_contrato') and bool_and(cotizacion_id = current_setting('t323.a')::bigint)
     from public.avisos where cotizacion_id = current_setting('t323.a')::bigint));
select t216.afirma('A4 no reciben: venta, otra agencia, operaciones fuera de la lista',
  not exists (select 1 from public.avisos where cotizacion_id = current_setting('t323.a')::bigint and usuario_id in (t216.u('ventaA'), t216.u('adminMin'), t216.u('oper'))));

-- B. Repetir sin cambios: idempotente (mismo evento, ningún aviso nuevo).
select set_config('t323.rb', t323.pedir('agencia', current_setting('t323.a')::bigint), true);
select t216.afirma('B1 ya_solicitada', current_setting('t323.rb') like '%"estado": "ya_solicitada"%', current_setting('t323.rb'));
select t216.afirma('B2 sigue 1 evento y 2 avisos',
  (select count(*) from public.cotizacion_solicitudes_contrato where cotizacion_id = current_setting('t323.a')::bigint) = 1
  and (select count(*) from public.avisos where cotizacion_id = current_setting('t323.a')::bigint) = 2);

-- C. Pedir de nuevo TRAS un cambio (precio): el evento anterior queda 'reemplazada' y hay uno abierto nuevo (con sus avisos).
update public.cotizaciones set precio_venta = 1200000 where id = current_setting('t323.a')::bigint;
select set_config('t323.rc', t323.pedir('agencia', current_setting('t323.a')::bigint), true);
select t216.afirma('C1 reemplazada', current_setting('t323.rc') like '%"estado": "reemplazada"%', current_setting('t323.rc'));
select t216.afirma('C2 un abierto y uno reemplazado; 4 avisos en total',
  (select count(*) filter (where estado = 'solicitada') = 1 and count(*) filter (where estado = 'reemplazada') = 1 from public.cotizacion_solicitudes_contrato where cotizacion_id = current_setting('t323.a')::bigint)
  and (select count(*) from public.avisos where cotizacion_id = current_setting('t323.a')::bigint) = 4);

-- D. Asistida: la dueña es la ficha congelada en el plan (aliado_id), no el correo.
insert into public.aliados (nombre, nit) values ('Aliado T323', '900323') ;
update public.usuarios set aliado_id = (select id from public.aliados where nit = '900323') where id = t216.u('agencia');
select set_config('t323.d', t323.cot('otro@x.test', jsonb_build_object('b2bAsistido', jsonb_build_object('aliado_id', (select id from public.aliados where nit = '900323'))))::text, true);
select t216.afirma('D1 asistida con SU ficha: permitido', t323.pedir('agencia', current_setting('t323.d')::bigint) like '%"estado": "solicitada"%');

-- E. Aislamiento y rechazos (los rechazos no dejan filas ni avisos).
select set_config('t323.e', t323.cot('otra-agencia@x.test')::text, true);
select t216.rechaza('E1 cotización de OTRO aliado: igual que no existe', t323.pedir('agencia', current_setting('t323.e')::bigint), 'SOLICITUD_NO_ENCONTRADA');
select t216.rechaza('E2 un interno (no aliado) no puede solicitar', t323.pedir('admin', current_setting('t323.a')::bigint), 'SOLICITUD_ACTOR');
select t216.rechaza('E3 usuario inexistente', t216.escalar('service_role', null, format('select public.solicitar_contrato_cotizacion(%s, %L)::text', current_setting('t323.a'), '00000000-0000-0000-0000-000000000000')), 'SOLICITUD_ACTOR');
select t216.rechaza('E4 anon no ejecuta la RPC', t216.escalar('anon', null, format('select public.solicitar_contrato_cotizacion(%s, %L)::text', current_setting('t323.a'), t216.u('agencia'))), 'permission denied');
select t216.rechaza('E5 authenticated no ejecuta la RPC', t216.escalar('authenticated', t216.u('agencia'), format('select public.solicitar_contrato_cotizacion(%s, %L)::text', current_setting('t323.a'), t216.u('agencia'))), 'permission denied');
select t216.afirma('E6 sin evento ni aviso para la de otro aliado',
  not exists (select 1 from public.cotizacion_solicitudes_contrato where cotizacion_id = current_setting('t323.e')::bigint) and not exists (select 1 from public.avisos where cotizacion_id = current_setting('t323.e')::bigint));

select set_config('t323.f1', t323.cot('c216-agencia@x.test', '{}', 'mayorista', 1, current_date - 1)::text, true);
select t216.rechaza('F1 vencida', t323.pedir('agencia', current_setting('t323.f1')::bigint), 'SOLICITUD_VENCIDA');
select set_config('t323.f2', t323.cot('c216-agencia@x.test')::text, true);
update public.cotizaciones set estado = 'descartada' where id = current_setting('t323.f2')::bigint;
select t216.rechaza('F2 descartada', t323.pedir('agencia', current_setting('t323.f2')::bigint), 'SOLICITUD_NO_APLICA');
select set_config('t323.f3', t323.cot('c216-agencia@x.test')::text, true);
update public.cotizaciones set fecha_salida = current_date - 2 where id = current_setting('t323.f3')::bigint;
select t216.rechaza('F3 salida pasada', t323.pedir('agencia', current_setting('t323.f3')::bigint), 'SOLICITUD_SALIDA_PASADA');

-- G. Sin responsables configurados: se guarda igual y se dice (notificados = 0), sin inventar destinatarios.
update public.config_solicitudes set emails = null where id = 1;
select set_config('t323.g', t323.cot('c216-agencia@x.test')::text, true);
select set_config('t323.rg', t323.pedir('agencia', current_setting('t323.g')::bigint), true);
select t216.afirma('G1 guardada con 0 notificados', current_setting('t323.rg') like '%"notificados": 0%' and exists (select 1 from public.cotizacion_solicitudes_contrato where cotizacion_id = current_setting('t323.g')::bigint), current_setting('t323.rg'));
select t216.afirma('G2 ningún aviso creado', not exists (select 1 from public.avisos where cotizacion_id = current_setting('t323.g')::bigint));

-- H. Superadmin recibe de cualquier agencia si figura en la lista; cotización de otra agencia no avisa a un administrador de la primera.
update public.config_solicitudes set emails = 'c216-super@x.test, c216-admin@x.test' where id = 1;
select set_config('t323.h', t323.cot('c216-agencia@x.test', '{}', 'minorista')::text, true);
select t323.pedir('agencia', current_setting('t323.h')::bigint);
select t216.afirma('H1 cotización de minorista: avisa al superadmin y NO al administrador de mayorista',
  (select array_agg(usuario_id order by usuario_id::text) = array[t216.u('super')] from public.avisos where cotizacion_id = current_setting('t323.h')::bigint));

-- I. Solo service_role toca la tabla de eventos.
select t216.rechaza('I1 authenticated no lee la tabla', t216.escalar('authenticated', t216.u('admin'), 'select count(*)::text from public.cotizacion_solicitudes_contrato'), 'permission denied');

select count(*) filter (where ok) as aciertos, count(*) filter (where not ok) as fallos, count(*) as total from t216.res;
select nombre, detalle from t216.res where not ok;
do $$ begin
  if exists (select 1 from t216.res where not ok) then raise exception 'test_323: hay % fallos', (select count(*) from t216.res where not ok); end if;
end $$;
rollback;
