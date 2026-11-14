-- Pruebas de la 298 (base local desechable; las prepara test_298_calculadora_grupos_generales.sh).
-- Estado de partida: bases de «Semana» (G1) guardadas CON LA 297 antes de aplicar la 298 (compatibilidad).
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema if not exists t298;
grant usage on schema t298 to public;
create or replace function t298.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FALLO %', m; end if; raise notice 'OK    %', m; end $$;
create or replace function t298.pasa(sql text, m text) returns void language plpgsql as $$
begin execute sql; raise notice 'OK    %', m;
exception when others then raise exception 'FALLO % — [%] %', m, sqlstate, sqlerrm; end $$;
create or replace function t298.estado() returns text language sql security definer set search_path = public as $$
  select md5(concat_ws('|',
    (select coalesce(string_agg(to_jsonb(p)::text, E'\n' order by p.id), '') from public.hotel_grupo_tarifa_propuesta p),
    (select coalesce(string_agg(to_jsonb(b)::text, E'\n' order by b.id), '') from public.hotel_calculadora_grupo_bases b),
    (select coalesce(string_agg(to_jsonb(c)::text, E'\n' order by c.id), '') from public.hotel_calculadora c),
    (select coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '') from public.tarifa_hotel t)))
$$;
create or replace function t298.atomico(sql text, patron text, m text) returns void language plpgsql as $$
declare v_antes text := t298.estado();
begin
  begin execute sql;
  exception when others then
    if not (sqlerrm ~* patron or sqlstate ~* patron) then raise exception 'FALLO % — error distinto [%]: %', m, sqlstate, sqlerrm; end if;
    if t298.estado() <> v_antes then raise exception 'FALLO % — rechazado pero cambió algo', m; end if;
    raise notice 'OK    % (rechazado [%]: %; nada cambió)', m, sqlstate, sqlerrm; return;
  end;
  raise exception 'FALLO % — no se rechazó', m;
end $$;
create or replace function t298.huella(v bigint) returns text language sql security definer set search_path = public as $$
  select public._grupos_43_config(v)->>'huella' $$;
create or replace function t298.cv(h bigint) returns bigint language sql security definer set search_path = public as $$
  select version from public.hotel_calculadora where hotel_id = h $$;
create or replace function t298.bv(g uuid) returns bigint language sql security definer set search_path = public as $$
  select version from public.hotel_calculadora_grupo_bases where grupo_id = g and tipo = 'dubai' $$;
create or replace function t298.gen(g uuid) returns jsonb language sql security definer set search_path = public as $$
  select generales from public.hotel_calculadora_grupo_bases where grupo_id = g and tipo = 'dubai' $$;
create or replace function t298.params() returns text language sql security definer set search_path = public as $$
  select params::text from public.hotel_calculadora where hotel_id = 9301 $$;
-- Llamada a la RPC nueva con los valores vigentes salvo los que se indiquen.
create or replace function t298.rpc(g uuid, bases jsonb, generales jsonb, filas jsonb default '[]',
  huella text default null, bver bigint default -1, tipo text default 'dubai') returns text
language sql security definer set search_path = public as $$
  select format('select public.grupos_dias_guardar_calculadora_grupo(930101, %L, %L, %L, %s, %s, %L::jsonb, %s, %L::jsonb)',
    coalesce(huella, t298.huella(930101)), g, tipo, t298.cv(9301),
    case when bver = -1 then coalesce(t298.bv(g)::text, 'null') else coalesce(bver::text, 'null') end,
    bases, case when generales is null then 'null' else quote_literal(generales::text) || '::jsonb' end, filas)
$$;
create table t298.marca (k text primary key, v text);
grant all on t298.marca to public;
grant execute on all functions in schema t298 to public;
insert into t298.marca values ('params', t298.params());

-- K. Compatibilidad: lo guardado con la 297 antes de la 298 sigue igual y significa «los generales del hotel».
select t298.ok(t298.gen('00000000-0000-4000-8000-0000000c0001') is null and t298.bv('00000000-0000-4000-8000-0000000c0001') = 1,
  'K1 las bases de Semana guardadas con la 297 quedan con generales = null (los del hotel) y en su versión');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
set role authenticated;

-- G. Semana y Finde con modificadores y suplemento FULL distintos.
select t298.pasa(t298.rpc('00000000-0000-4000-8000-0000000c0001', '[{"categoria":"Estándar","precio":100000}]',
  '{"regimen_base":"PAM","modificadores":{"sencilla_pct":60,"pax3_pct":-20,"pax4_pct":-20,"nino_pct":-50,"infante_pct":-100},"suplementos":[{"regimen":"PC","monto":45000},{"regimen":"FULL","monto":80000}]}',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Estándar","alimentacion":"FULL","neto_doble":180000}]'),
  'G1 Semana: bases + propuesta + parámetros propios (Sencilla +60 %, FULL 80.000)');
select t298.pasa(t298.rpc('00000000-0000-4000-8000-0000000c0002', '[{"categoria":"Estándar","precio":140000}]',
  '{"regimen_base":"PAM","modificadores":{"sencilla_pct":40,"pax3_pct":-10,"pax4_pct":-10,"nino_pct":-30,"infante_pct":-100},"suplementos":[{"regimen":"PC","monto":50000},{"regimen":"FULL","monto":120000}]}',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0002","tipo_habitacion":"Estándar","alimentacion":"FULL","neto_doble":260000}]'),
  'G2 Finde: sus propios parámetros (Sencilla +40 %, FULL 120.000)');
select t298.ok(t298.gen('00000000-0000-4000-8000-0000000c0001')->'suplementos' @> '[{"regimen":"FULL","monto":80000}]'
               and t298.gen('00000000-0000-4000-8000-0000000c0002')->'suplementos' @> '[{"regimen":"FULL","monto":120000}]'
               and (t298.gen('00000000-0000-4000-8000-0000000c0001')->'modificadores'->>'sencilla_pct')::int = 60
               and (t298.gen('00000000-0000-4000-8000-0000000c0002')->'modificadores'->>'sencilla_pct')::int = 40,
  'G3 al reabrir, cada grupo trae SUS parámetros (aislados entre grupos)');
select t298.ok(t298.params() = (select v from t298.marca where k = 'params'), 'G4 la calculadora general del hotel no cambió');
select t298.ok(t298.bv('00000000-0000-4000-8000-0000000c0001') = 3, 'G5 la versión de las bases de Semana sube con el guardado (1 → 3: bases y parámetros, una transacción)');
select t298.pasa(t298.rpc('00000000-0000-4000-8000-0000000c0002', '[{"categoria":"Estándar","precio":140000}]', null),
  'G6 Finde vuelve a «usar los generales del hotel» (null explícito)');
select t298.ok(t298.gen('00000000-0000-4000-8000-0000000c0002') is null and t298.gen('00000000-0000-4000-8000-0000000c0001') is not null,
  'G7 Finde en null; Semana conserva los suyos');

-- N. Rechazos atómicos (cada uno con una fila válida que cambiaría la propuesta).
select t298.atomico(t298.rpc('00000000-0000-4000-8000-0000000c0001', '[{"categoria":"Estándar","precio":1}]',
  '{"promos":[{"temporadaBase":"ALTA","temporadaPromo":"BAJA","regimen":"PAM","descuentoPct":10}]}',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'no permitido.*promociones', 'N1 una promoción como «parámetro» del grupo: rechazada, nada se guarda');
select t298.atomico(t298.rpc('00000000-0000-4000-8000-0000000c0001', '[{"categoria":"Estándar","precio":1}]', '{"bases":[]}',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'no permitido', 'N2 bases dentro de los parámetros: rechazadas');
select t298.atomico(t298.rpc('00000000-0000-4000-8000-0000000c0001', '[{"categoria":"Estándar","precio":1}]', '{"suplementos":[{"regimen":"PREMIUM","monto":1}]}',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'Suplemento no válido', 'N3 suplemento de un régimen no configurado en el hotel');
select t298.atomico(t298.rpc('00000000-0000-4000-8000-0000000c0001', '[{"categoria":"Estándar","precio":1}]', '{"modificadores":{"descuento_pct":10}}',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'Modificador no válido', 'N4 modificador desconocido');
select t298.atomico(t298.rpc('00000000-0000-4000-8000-0000000c0001', '[{"categoria":"Estándar","precio":1}]', '{"regimen_base":"PREMIUM"}',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'no está configurado', 'N5 régimen base no configurado');
select t298.atomico(t298.rpc('00000000-0000-4000-8000-0000000c0001', '[{"categoria":"Estándar","precio":1}]', '[1]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'deben ser un objeto', 'N6 parámetros con forma de lista');
select t298.atomico(t298.rpc('00000000-0000-4000-8000-0000000c0001', '[{"categoria":"Estándar","precio":1}]', '{"modificadores":{"sencilla_pct":10}}',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]', bver => 1),
  'PT409|bases de este grupo cambiaron', 'N7 versión de las bases vieja: nada se guarda (ni bases ni parámetros)');
select t298.atomico(t298.rpc('00000000-0000-4000-8000-0000000c0001', '[{"categoria":"Estándar","precio":1}]', '{"modificadores":{"sencilla_pct":10}}',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]', huella => 'vieja'),
  'PT409|CONFIG_DESACTUALIZADA', 'N8 huella vieja');
reset role;
-- Mixta y Corporativa: validación de sus parámetros (llamada directa al validador, como dueño).
select t298.atomico($q$select public._calc_grupos_43_validar_generales('mixta', '{"pax":{"doble":0}}', '["PAM"]')$q$, 'Pax por habitación no válido', 'N9 Mixta: pax 0');
select t298.atomico($q$select public._calc_grupos_43_validar_generales('mixta', '{"acom":{"doble":{"modo":"x","iva":true}}}', '["PAM"]')$q$, 'Modo por acomodación', 'N10 Mixta: modo desconocido');
select t298.atomico($q$select public._calc_grupos_43_validar_generales('corporativa', '{"descuento_pct":150}', '["PAM"]')$q$, 'entre 0 y 100', 'N11 Corporativa: descuento de la tarifa > 100');
select t298.atomico($q$select public._calc_grupos_43_validar_generales('corporativa', '{"promos":[]}', '["PAM"]')$q$, 'no permitido', 'N12 Corporativa: promociones rechazadas');
select t298.pasa($q$select public._calc_grupos_43_validar_generales('mixta', '{"iva_pct":19,"acom":{"doble":{"modo":"hab","iva":false}},"nino":{"iva":true},"pax":{"doble":2},"infante_nota":"Cuna"}', '["PAM"]')$q$,
  'N13 Mixta: parámetros completos válidos');
select t298.pasa($q$select public._calc_grupos_43_validar_generales('corporativa', '{"regimen_base":"PAM","persona_adicional":90000,"nino_adicional":40000,"impuesto_pct":0,"descuento_pct":10,"suplementos_regimen":[{"regimen":"PAM","adulto":0,"nino":0}]}', '["PAM"]')$q$,
  'N14 Corporativa: parámetros completos válidos');

-- C. Otro camino que reescribe las bases (la RPC de la 297 sola): deja los generales en null.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
set role authenticated;
select t298.pasa(format('select public.grupos_dias_guardar_calculadora(930101, %L, %L, %L, %s, %s, %L::jsonb, %L::jsonb)',
  t298.huella(930101), '00000000-0000-4000-8000-0000000c0001', 'dubai', t298.cv(9301), t298.bv('00000000-0000-4000-8000-0000000c0001'),
  '[{"categoria":"Estándar","precio":100000}]', '[]'), 'C1 guardar Semana con la RPC de la 297 (calcula con los generales del hotel)');
select t298.ok(t298.gen('00000000-0000-4000-8000-0000000c0001') is null,
  'C2 … y la fila queda con generales = null: nunca guarda unos parámetros distintos de los usados para calcular');
select t298.ok(not exists (select 1 from public.hotel_calculadora_grupo_bases where generales is not null), 'C3 sin generales propios en ningún grupo');
-- Vuelve a dejar Semana con parámetros propios para la vista previa del borrado y el rollback protegido.
select t298.pasa(t298.rpc('00000000-0000-4000-8000-0000000c0001', '[{"categoria":"Estándar","precio":100000}]', '{"suplementos":[{"regimen":"FULL","monto":80000}]}'),
  'C4 Semana vuelve a parámetros propios');
select t298.ok(jsonb_path_exists(public.grupos_dias_config_bases(930101)->'bases',
  '$[*] ? (@.grupo_id == "00000000-0000-4000-8000-0000000c0001" && @.generales_propios == true)'),
  'C5 la lectura con bases dice qué grupo tiene parámetros propios (vista previa del borrado)');

-- P. Permisos
select t298.atomico($q$update public.hotel_calculadora_grupo_bases set generales = '{}'$q$, '42501|permission denied', 'P1 escribir los parámetros directo por la API: prohibido');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009304","session_id":"00000000-0000-4000-8000-00000000a304","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009304', false);
set role authenticated;
select t298.atomico(t298.rpc('00000000-0000-4000-8000-0000000c0001', '[{"categoria":"Estándar","precio":1}]', '{}'), '42501|Sin permiso', 'P2 venta: sin permiso');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009303","session_id":"00000000-0000-4000-8000-00000000a303","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009303', false);
set role authenticated;
select t298.atomico(t298.rpc('00000000-0000-4000-8000-0000000c0001', '[{"categoria":"Estándar","precio":1}]', '{}'), '42501|Mayorista', 'P3 operaciones Minorista: sin permiso de catálogo');
reset role;
set role anon;
select t298.atomico(t298.rpc('00000000-0000-4000-8000-0000000c0001', '[]', null), '42501|permission denied', 'P4 anon no ejecuta la RPC');
reset role;

-- I. Invariantes
select t298.ok((select count(*) = 0 from public.hotel_temporada_grupos where activo), 'I1 ningún grupo activo');
select t298.ok((select count(*) = 0 from public.tarifa_hotel where grupo_id is not null), 'I2 ninguna tarifa por grupo');
select t298.ok(t298.params() = (select v from t298.marca where k = 'params'), 'I3 la calculadora general del hotel nunca cambió');
drop schema t298 cascade;
