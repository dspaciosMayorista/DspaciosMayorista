-- Pruebas de la 297 (base local desechable: 293 + fixture_293 + 295 + fixture_295 + 297 + fixture_297).
-- Cada aserción imprime «OK …» o aborta con «FALLO …». La corre test_297_calculadora_grupos_dias.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema if not exists t297;
grant usage on schema t297 to public;
create or replace function t297.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FALLO %', m; end if; raise notice 'OK    %', m; end $$;
create or replace function t297.pasa(sql text, m text) returns void language plpgsql as $$
begin execute sql; raise notice 'OK    %', m;
exception when others then raise exception 'FALLO % — [%] %', m, sqlstate, sqlerrm; end $$;
-- Huella de TODO lo que la RPC puede tocar (propuestas, bases, calculadoras, grupos, tarifas). Leída como
-- dueño (security definer) para que la RLS no la recorte.
create or replace function t297.estado() returns text language sql security definer set search_path = public as $$
  select md5(concat_ws('|',
    (select coalesce(string_agg(to_jsonb(p)::text, E'\n' order by p.id), '') from public.hotel_grupo_tarifa_propuesta p),
    (select coalesce(string_agg(to_jsonb(b)::text, E'\n' order by b.id), '') from public.hotel_calculadora_grupo_bases b),
    (select coalesce(string_agg(to_jsonb(c)::text, E'\n' order by c.id), '') from public.hotel_calculadora c),
    (select coalesce(string_agg(to_jsonb(g)::text, E'\n' order by g.id), '') from public.hotel_temporada_grupos g),
    (select coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '') from public.tarifa_hotel t)))
$$;
-- Rechazo ATÓMICO: la llamada falla con el patrón esperado y NADA cambia.
create or replace function t297.atomico(sql text, patron text, m text) returns void language plpgsql as $$
declare v_antes text := t297.estado();
begin
  begin execute sql;
  exception when others then
    if not (sqlerrm ~* patron or sqlstate ~* patron) then raise exception 'FALLO % — error distinto [%]: %', m, sqlstate, sqlerrm; end if;
    if t297.estado() <> v_antes then raise exception 'FALLO % — rechazado pero cambió algo', m; end if;
    raise notice 'OK    % (rechazado [%]: %; nada cambió)', m, sqlstate, sqlerrm; return;
  end;
  raise exception 'FALLO % — no se rechazó', m;
end $$;
create or replace function t297.huella(v bigint) returns text language sql security definer set search_path = public as $$
  select public._grupos_43_config(v)->>'huella' $$;
create or replace function t297.cv(h bigint) returns bigint language sql security definer set search_path = public as $$
  select version from public.hotel_calculadora where hotel_id = h $$;
create or replace function t297.bv(g uuid, t text) returns bigint language sql security definer set search_path = public as $$
  select version from public.hotel_calculadora_grupo_bases where grupo_id = g and tipo = t $$;
-- Llamada armada: los valores %s son literales SQL ya citados.
create or replace function t297.rpc(t bigint, g uuid, tipo text, bases jsonb, filas jsonb,
  huella text default null, calc bigint default null, bver bigint default -1) returns text language sql security definer set search_path = public as $$
  select format('select public.grupos_dias_guardar_calculadora(%s, %L, %L, %L, %s, %s, %L::jsonb, %L::jsonb)',
    t, coalesce(huella, t297.huella(t)), g, tipo,
    coalesce(calc, t297.cv((select hotel_id from public.hotel_temporadas where id = t)))::text,
    case when bver = -1 then coalesce(t297.bv(g, tipo)::text, 'null') else coalesce(bver::text, 'null') end,
    bases, filas)
$$;
create table t297.marca (k text primary key, v text);
grant all on t297.marca to public;
grant execute on all functions in schema t297 to public;
insert into t297.marca values ('tarifas', (select md5(string_agg(to_jsonb(t)::text, E'\n' order by t.id)) from public.tarifa_hotel t));

-- ── V. Versión de hotel_calculadora (como dueño: el trigger rige para cualquier escritor) ──
select t297.ok((select bool_and(version = 1) from public.hotel_calculadora where hotel_id in (9301, 9303)), 'V1 al insertar la versión es 1');
do $$
declare v0 bigint := (select version from public.hotel_calculadora where hotel_id = 9301);
begin
  update public.hotel_calculadora set params = params where hotel_id = 9301;
  update public.hotel_calculadora set params = params where hotel_id = 9301;
  perform t297.ok((select version from public.hotel_calculadora where hotel_id = 9301) = v0 + 2,
                  'V2 dos actualizaciones en la MISMA transacción: la versión sube dos veces (no basta updated_at = now())');
end $$;
do $$
declare v0 bigint := (select version from public.hotel_calculadora where hotel_id = 9301);
begin
  update public.hotel_calculadora set version = 1, params = params where hotel_id = 9301;
  perform t297.ok((select version from public.hotel_calculadora where hotel_id = 9301) = v0 + 1, 'V3 el escritor no puede fijar ni repetir la versión');
end $$;
do $$
declare v0 bigint := (select version from public.hotel_calculadora where hotel_id = 9301); n int;
begin
  update public.hotel_calculadora set params = params where hotel_id = 9301 and version = v0; get diagnostics n = row_count;
  perform t297.ok(n = 1, 'V4 escritura condicionada a la versión leída: pasa');
  update public.hotel_calculadora set params = params where hotel_id = 9301 and version = v0; get diagnostics n = row_count;
  perform t297.ok(n = 0, 'V5 la misma escritura con la versión vieja: 0 filas (la app pide recargar)');
end $$;

-- ── Como operaciones de Mayorista ─────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
set role authenticated;

do $$
declare v0 bigint := t297.cv(9301); n int;
begin
  update public.hotel_calculadora set params = params where hotel_id = 9301 and version = v0; get diagnostics n = row_count;
  perform t297.ok(n = 1 and t297.cv(9301) = v0 + 1, 'V6 un escritor por la API (operaciones Mayorista) también cambia la versión');
end $$;

-- R. Guardado correcto
select t297.pasa(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai',
  '[{"categoria":"Estándar","precio":120000,"usarEdadesPropias":true,"edadesPropias":{"infanteMin":0,"infanteMax":1,"ninoMin":2,"ninoMax":11},"condicionesPropias":"Semana"}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Estándar","alimentacion":"PAM","neto_sencilla":180000,"neto_doble":120000,"neto_triple":112000,"neto_multiple":108000,"neto_nino":60000,"neto_nino2":null,"neto_infante":0,"origen_tarifa_id":null,"notas":"Semana","nota_infante":null,"edad_infante_min":0,"edad_infante_max":1,"edad_nino_min":2,"edad_nino_max":11},
    {"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Estándar","alimentacion":"PC","neto_sencilla":225000,"neto_doble":165000,"neto_triple":157000,"neto_multiple":153000,"neto_nino":105000,"neto_nino2":null,"neto_infante":45000,"origen_tarifa_id":null}]'),
  'R1 propuesta (2 combinaciones) y bases del grupo Semana en un solo guardado');
select t297.ok((select count(*) = 2 from public.hotel_grupo_tarifa_propuesta where grupo_id = '00000000-0000-4000-8000-0000000c0001')
               and t297.bv('00000000-0000-4000-8000-0000000c0001', 'dubai') = 1
               and (select bases->0->>'precio' = '120000' from public.hotel_calculadora_grupo_bases where grupo_id = '00000000-0000-4000-8000-0000000c0001'),
               'R2 la propuesta y las bases quedaron guardadas (bases versión 1)');
select t297.pasa(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0002', 'dubai', '[{"categoria":"Estándar","precio":140000}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0002","tipo_habitacion":"Estándar","alimentacion":"PAM","neto_doble":140000,"origen_tarifa_id":null}]'),
  'R3 fila sin notas ni edades (omitidas) en el Fin de semana');
select t297.ok((select neto_doble = 140000 and notas = 'Vista al mar' and nota_infante = 'Cuna' and edad_nino_max = 11
                from public.hotel_grupo_tarifa_propuesta where grupo_id = '00000000-0000-4000-8000-0000000c0002' and alimentacion = 'PAM'),
               'R4 notas y edades existentes se conservan cuando la fila no las trae');
select t297.ok((select count(*) = 0 from public.hotel_grupo_tarifa_propuesta where grupo_id = '00000000-0000-4000-8000-0000000c0002' and alimentacion = 'PC'),
               'R5 otros grupos no se tocan: el Fin de semana no recibió las filas de Semana');
select t297.pasa(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":125000}]', '[]'),
  'R6 guardar solo las bases (sin cambios de propuesta)');
select t297.ok(t297.bv('00000000-0000-4000-8000-0000000c0001', 'dubai') = 2, 'R7 la versión de las bases sube en cada guardado');

-- N. Rechazos atómicos: cada uno trae una fila VÁLIDA que cambiaría la propuesta; nada debe cambiar.
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]', calc => 1),
  'PT409|cambió desde que la abriste', 'N1 versión de la calculadora vieja');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]', huella => 'vieja'),
  'PT409|CONFIG_DESACTUALIZADA', 'N2 huella de la vigencia vieja');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'mixta', '{"PAM":[{"categoria":"Estándar","sencilla":1,"doble":1,"triple":0,"multiple":0,"nino":0}]}',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'PT409|cambió de tipo', 'N3 tipo distinto del guardado en el hotel');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]', bver => 1),
  'PT409|bases de este grupo cambiaron', 'N4 versión de las bases vieja');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0002', 'dubai', '[{"categoria":"Estándar","precio":1}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0002","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]', bver => null),
  'PT409|bases de este grupo cambiaron', 'N4b bases creadas por otro (se esperaban inexistentes)');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1},
    {"grupo_id":"00000000-0000-4000-8000-0000000c0002","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'solo del grupo solicitado|grupo solicitado', 'N5 una fila de otro grupo');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Estándar","alimentacion":"PAM","neto_doble":1,"origen_tarifa_id":1}]'),
  'sugerencia aceptada', 'N6 fila calculada marcada como sugerencia aceptada');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Estándar","alimentacion":"PAM","neto_sencilla":null,"neto_doble":null,"neto_triple":null,"neto_multiple":null,"neto_nino":null,"neto_nino2":null,"neto_infante":null}]'),
  'al menos un neto', 'N7 fila sin netos (la calculadora no quita combinaciones)');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1,"precio_final_autoritativo":true}]'),
  'Campo no permitido', 'N8 campo desconocido en una fila');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":-1}]'),
  'mayores o iguales a 0', 'N9 neto negativo');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1,"edad_infante_min":2,"edad_infante_max":3,"edad_nino_min":4,"edad_nino_max":10}]'),
  'edades_rangos|23514', 'N10 edades fuera de regla en la fila (restricción de la 295)');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Suite","alimentacion":"PAM","neto_doble":1}]'),
  'no está configurada', 'N11 categoría de la fila no configurada en el hotel');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":0}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'precio mayor que 0', 'N12 base con precio 0 (la propuesta ya escrita se revierte)');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Suite","precio":1}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'no está configurada', 'N13 base con categoría fuera del catálogo del hotel');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1},{"categoria":"Estándar","precio":2}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'se repite', 'N14 categoría repetida en las bases');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai',
  '[{"categoria":"Estándar","precio":1,"usarEdadesPropias":true,"edadesPropias":{"infanteMin":2,"infanteMax":3,"ninoMin":4,"ninoMax":10}}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'Edades propias no válidas', 'N15 edades propias de la base fuera de regla');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1,"temporada":"ALTA"}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'Campo no permitido', 'N16 campo desconocido en una base');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai',
  '[{"categoria":"Estándar","precio":1,"usarSuplementosPropios":true,"suplementosPropios":[{"regimen":"FULL","monto":1}]}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'Suplemento propio no válido', 'N17 suplemento propio de un régimen no configurado');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '{"PAM":[]}',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Superior","alimentacion":"PAM","neto_doble":1}]'),
  'se esperaba una lista', 'N18 bases de Dubai con forma de Mixta');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0003', 'dubai', '[{"categoria":"Estándar","precio":1}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0003","tipo_habitacion":"Estándar","alimentacion":"PAM","neto_doble":1}]'),
  'no pertenece a esta vigencia', 'N19 grupo de otra vigencia');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0009', 'dubai', '[{"categoria":"Estándar","precio":1}]', '[]'),
  'PT409|ya no existe', 'N20 grupo inexistente');
select t297.atomico(t297.rpc(930201, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1}]', '[]', calc => 1),
  'no pertenece a esta vigencia|unidad', 'N21 vigencia de un hotel por unidad');
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'otro', '[]', '[]'),
  'Tipo de calculadora no válido', 'N22 tipo inexistente');

-- M. Mixta (hotel 9303)
select t297.pasa(t297.rpc(930301, '00000000-0000-4000-8000-0000000c0003', 'mixta',
  '{"PAM":[{"categoria":"Estándar","sencilla":200000,"doble":150000,"triple":0,"multiple":0,"nino":50000,"nino2":null,"infante":null}]}',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0003","tipo_habitacion":"Estándar","alimentacion":"PAM","neto_sencilla":200000,"neto_doble":75000,"neto_triple":0,"neto_multiple":0,"neto_nino":50000,"neto_nino2":null,"neto_infante":null,"origen_tarifa_id":null}]'),
  'M1 Mixta: bases por régimen y su propuesta');
select t297.atomico(t297.rpc(930301, '00000000-0000-4000-8000-0000000c0003', 'mixta',
  '{"PC":[{"categoria":"Estándar","sencilla":1,"doble":1,"triple":0,"multiple":0,"nino":0}]}', '[]'),
  'no está configurado', 'M2 Mixta: régimen no configurado en el hotel');
select t297.atomico(t297.rpc(930301, '00000000-0000-4000-8000-0000000c0003', 'mixta',
  '{"PAM":[{"categoria":"Estándar","sencilla":-1,"doble":1,"triple":0,"multiple":0,"nino":0}]}', '[]'),
  'mayores o iguales a 0', 'M3 Mixta: valor negativo');

-- P. Permisos
select t297.atomico($q$insert into public.hotel_calculadora_grupo_bases (grupo_id, tipo, bases) values ('00000000-0000-4000-8000-0000000c0002', 'dubai', '[]')$q$,
  '42501|permission denied|permiso', 'P1 escribir las bases directo por la API: prohibido (solo por la RPC)');
select t297.atomico($q$update public.hotel_calculadora_grupo_bases set bases = '[]'$q$, '42501|permission denied|permiso', 'P2 actualizar las bases directo: prohibido');
select t297.ok((select count(*) >= 1 from public.hotel_calculadora_grupo_bases), 'P3 operaciones Mayorista lee las bases (RLS interna)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009304","session_id":"00000000-0000-4000-8000-00000000a304","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009304', false);
set role authenticated;
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1}]', '[]'),
  '42501|Sin permiso', 'P4 venta: sin permiso');
select t297.ok((select count(*) = 0 from public.hotel_calculadora_grupo_bases), 'P5 venta no lee las bases');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009303","session_id":"00000000-0000-4000-8000-00000000a303","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009303', false);
set role authenticated;
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":1}]', '[]'),
  '42501|Mayorista', 'P6 operaciones de Minorista: sin permiso de catálogo');
reset role;
set role anon;
select t297.atomico(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[]', '[]'),
  '42501|permission denied', 'P7 anon no ejecuta la RPC');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009301","session_id":"00000000-0000-4000-8000-00000000a301","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009301', false);
set role authenticated;
select t297.pasa(t297.rpc(930101, '00000000-0000-4000-8000-0000000c0001', 'dubai', '[{"categoria":"Estándar","precio":126000}]', '[]'),
  'P8 superadmin en sesión Mayorista guarda');

-- L. Lectura con bases (una sola llamada): la configuración de la 295 + tipo y versión de las bases de cada grupo.
select t297.ok((select c->>'huella' = t297.huella(930101)
                       and jsonb_path_exists(c->'bases', '$[*] ? (@.grupo_id == "00000000-0000-4000-8000-0000000c0002" && @.tipo == "dubai" && @.version == 1 && @.categorias == 1)')
                from (select public.grupos_dias_config_bases(930101) c) x),
               'L1 grupos_dias_config_bases trae la misma huella de la 295 y las bases de cada grupo con su versión');

-- C. Borrar un grupo con bases: la 295 ya no se las lleva; el borrado nuevo exige las versiones revisadas.
select t297.atomico(format('select public.grupos_dias_borrar(%L, %L)', '00000000-0000-4000-8000-0000000c0002', t297.huella(930101)),
  'foreign key|23503', 'C1 el borrado de la 295 no puede llevarse bases guardadas (FK restrictiva): nada se borra');
select t297.atomico(format($q$select public.grupos_dias_borrar_con_bases(%L, %L, '[]'::jsonb)$q$, '00000000-0000-4000-8000-0000000c0002', t297.huella(930101)),
  'PT409|cambiaron desde que revisaste', 'C2 la vista previa no mostró bases (y hay): rechazado, nada se borra');
select t297.atomico(format($q$select public.grupos_dias_borrar_con_bases(%L, %L, '[{"tipo":"dubai","version":7}]'::jsonb)$q$, '00000000-0000-4000-8000-0000000c0002', t297.huella(930101)),
  'PT409|cambiaron desde que revisaste', 'C3 versión de las bases distinta de la revisada: rechazado, nada se borra');
select t297.atomico(format($q$select public.grupos_dias_borrar_con_bases(%L, 'vieja', '[{"tipo":"dubai","version":1}]'::jsonb)$q$, '00000000-0000-4000-8000-0000000c0002'),
  'PT409|CONFIG_DESACTUALIZADA', 'C4 huella vieja: rechazado, nada se borra');
select t297.pasa(format($q$select public.grupos_dias_borrar_con_bases(%L, %L, '[{"tipo":"dubai","version":1}]'::jsonb)$q$, '00000000-0000-4000-8000-0000000c0002', t297.huella(930101)),
  'C5 con las versiones revisadas: borra el grupo, sus propuestas y sus bases');
select t297.ok((select count(*) = 0 from public.hotel_calculadora_grupo_bases where grupo_id = '00000000-0000-4000-8000-0000000c0002')
               and not exists (select 1 from public.hotel_temporada_grupos where id = '00000000-0000-4000-8000-0000000c0002')
               and (select count(*) = 1 from public.hotel_calculadora_grupo_bases where grupo_id = '00000000-0000-4000-8000-0000000c0001'),
               'C6 se borraron el grupo y sus bases; las de otros grupos no');
select t297.pasa(format($q$select public.grupos_dias_borrar_con_bases(%L, %L, '[]'::jsonb)$q$, '00000000-0000-4000-8000-0000000c0005', t297.huella(930102)),
  'C7 un grupo sin bases se borra igual con lista vacía');

-- Q. Compra cerrada (regla de la RPC 203: todas sus filas con ese nombre con compra_fin < fecha_negocio()).
select t297.atomico(t297.rpc(930109, '00000000-0000-4000-8000-0000000c0004', 'dubai', '[{"categoria":"Estándar","precio":1}]',
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0004","tipo_habitacion":"Estándar","alimentacion":"PAM","neto_doble":1}]'),
  'compra cerrada', 'Q1 vigencia con la compra cerrada: no se guarda ni la propuesta ni las bases');
select t297.atomico(t297.rpc(930109, '00000000-0000-4000-8000-0000000c0004', 'dubai', '[{"categoria":"Estándar","precio":1}]', '[]'),
  'compra cerrada', 'Q2 tampoco solo las bases');
reset role;
select t297.ok((select count(*) = 0 from public.hotel_grupo_tarifa_propuesta where grupo_id = '00000000-0000-4000-8000-0000000c0004')
               and (select count(*) = 0 from public.hotel_calculadora_grupo_bases where grupo_id = '00000000-0000-4000-8000-0000000c0004'),
               'Q3 sin escrituras parciales en el grupo de la vigencia cerrada');

-- I. Invariantes
select t297.ok((select count(*) = 0 from public.hotel_temporada_grupos where activo), 'I1 ningún grupo activo');
select t297.ok((select count(*) = 0 from public.tarifa_hotel where grupo_id is not null), 'I2 ninguna tarifa por grupo en tarifa_hotel');
select t297.ok((select md5(string_agg(to_jsonb(t)::text, E'\n' order by t.id)) from public.tarifa_hotel t) = (select v from t297.marca where k = 'tarifas'),
               'I3 tarifas vigentes intactas');
select t297.ok(exists (select 1 from pg_constraint where conname = 'hotel_temporada_grupos_inactivos_43' and convalidated), 'I4 candado de la 293 intacto');
select t297.ok((select count(*) from public.auditoria where tabla = 'hotel_calculadora_grupo_bases') >= 4, 'I5 las bases quedan en la auditoría');

drop schema t297 cascade;
