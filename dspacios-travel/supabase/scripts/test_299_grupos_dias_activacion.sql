-- Pruebas de la 299 (base local desechable: 293 + fixture_293 + 295 + fixture_295 + 297 + fixture_297 + 299 +
-- fixture_299). Cada aserción imprime «OK …» o aborta con «FALLO …». La corre test_299_grupos_dias_activacion.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema if not exists t299;
grant usage on schema t299 to public;
create or replace function t299.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FALLO %', m; end if; raise notice 'OK    %', m; end $$;
create or replace function t299.pasa(sql text, m text) returns void language plpgsql as $$
begin execute sql; raise notice 'OK    %', m;
exception when others then raise exception 'FALLO % — [%] %', m, sqlstate, sqlerrm; end $$;
create or replace function t299.estado() returns text language sql security definer set search_path = public as $$
  select md5(concat_ws('|',
    (select coalesce(string_agg(to_jsonb(p)::text, E'\n' order by p.id), '') from public.hotel_grupo_tarifa_propuesta p),
    (select coalesce(string_agg(to_jsonb(b)::text, E'\n' order by b.id), '') from public.hotel_calculadora_grupo_bases b),
    (select coalesce(string_agg(to_jsonb(g)::text, E'\n' order by g.id), '') from public.hotel_temporada_grupos g),
    (select coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '') from public.hotel_temporadas t),
    (select coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '') from public.tarifa_hotel t)))
$$;
create or replace function t299.atomico(sql text, patron text, m text) returns void language plpgsql as $$
declare v_antes text := t299.estado();
begin
  begin execute sql;
  exception when others then
    if not (sqlerrm ~* patron or sqlstate ~* patron) then raise exception 'FALLO % — error distinto [%]: %', m, sqlstate, sqlerrm; end if;
    if t299.estado() <> v_antes then raise exception 'FALLO % — rechazado pero cambió algo', m; end if;
    raise notice 'OK    % (rechazado [%]: %; nada cambió)', m, sqlstate, left(sqlerrm, 160); return;
  end;
  raise exception 'FALLO % — no se rechazó', m;
end $$;
create or replace function t299.h(v bigint) returns text language sql security definer set search_path = public as $$
  select public._grupos_43_config(v)->>'huella' $$;
create or replace function t299.hab(v bigint) returns jsonb language sql security definer set search_path = public as $$
  select public._grupos_43_habilitaciones(v) $$;
create or replace function t299.n(sql text) returns bigint language plpgsql security definer set search_path = public as $$
declare r bigint; begin execute sql into r; return r; end $$;
grant execute on all functions in schema t299 to public;

-- Operaciones Mayorista (escribe catálogo).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);

-- ── A. Estado inicial, guardas y permisos ────────────────────────────────────────────
select t299.ok((select public._grupos_43_config(930101)->>'estado') = 'preparado'
               and jsonb_array_length(public._grupos_43_config(930101)->'vigentes') = 0, 'A1 ALTA preparada, sin tarifas por grupo');
select t299.ok(not exists (select 1 from pg_constraint where conname = 'hotel_temporada_grupos_inactivos_43'), 'A2 candado de la 293 retirado');
select t299.atomico($q$update public.hotel_temporada_grupos set activo = true where id = '00000000-0000-4000-8000-0000000c0001'$q$,
  'aplicar a la venta', 'A3 activar un grupo fuera de las RPC (incluso como dueño)');
select t299.atomico($q$insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, grupo_id, neto_doble)
  values (9301, 'Estándar', 'PAM', 'ALTA', '00000000-0000-4000-8000-0000000c0001', 1)$q$,
  'Grupos de días', 'A4 insertar una tarifa por grupo fuera de las RPC');
set role authenticated;
select t299.atomico($q$insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (930105, 'X', array[1])$q$,
  '42501|permission denied|permiso', 'A5 authenticated ya no escribe grupos directo');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009304","session_id":"00000000-0000-4000-8000-00000000a304","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009304', false);
select t299.atomico('select public.grupos_dias_alcance(930101)', '42501', 'A6 venta no lee el alcance');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009303","session_id":"00000000-0000-4000-8000-00000000a303","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009303', false);
select t299.ok(public.grupos_dias_alcance(930101) ? 'habilitaciones', 'A7 operaciones Minorista lee el alcance');
select t299.atomico(format('select public.grupos_dias_activar(930101, %L, %L::jsonb)', t299.h(930101), t299.hab(930101)),
  '42501', 'A8 operaciones Minorista no aplica a la venta');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);

-- Propuesta de la Semana: doble 95.000 y triple 80.000 (la tarifa «todos los días» no vende triple).
select t299.pasa(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null,
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Estándar","alimentacion":"PAM","neto_sencilla":140000,"neto_doble":95000,"neto_triple":80000}]'::jsonb)$q$,
  t299.h(930101)), 'B0 propuesta de la Semana guardada');

-- ── B. Alcance ───────────────────────────────────────────────────────────────────────
select t299.ok((select jsonb_agg(e->>'acomodacion' order by e->>'acomodacion') from jsonb_array_elements(t299.hab(930101)) e) = '["triple"]'::jsonb,
  'B1 habilitación detectada: solo el triple de la Semana (sencilla y doble ya se venden; infante nunca es habilitación)');
select t299.ok(jsonb_array_length(public.grupos_dias_alcance(930101)->'edades_conflicto') = 1,
  'B2 regla de edad distinta entre grupos (Fin de semana con 0-1/2-11, Semana con la general) detectada');
select t299.ok(jsonb_array_length(public.grupos_dias_alcance(930101)->'empates') > 0
               and (select bool_and(e->'b'->>'nombre' = 'PUENTE' or e->'a'->>'nombre' = 'PUENTE') from jsonb_array_elements(public.grupos_dias_alcance(930101)->'empates') e),
  'B3 empate simulado con PUENTE (misma prioridad, mismas noches y combinación)');
select t299.ok((select e->>'desde' = '2027-01-10' and e->>'hasta' = '2027-01-12' and e->>'acomodacion' = 'doble'
                from jsonb_array_elements(public.grupos_dias_alcance(930101)->'empates') e
                where e->>'acomodacion' = 'doble' limit 1), 'B4 el empate se reporta como un rango (10–12 ene), por acomodación');
select t299.ok(public.grupos_dias_alcance(930101)->'dias_sin_grupo' = '[]'::jsonb, 'B5 los 7 días están cubiertos');
select t299.ok(jsonb_array_length(public._grupos_43_empates(9304, null)) = 0,
  'B6 dos vigencias SIN grupos empatadas (hotel 9304) siguen como hoy: no es conflicto');

-- ── C. Aplicar: rechazos atómicos ─────────────────────────────────────────────────────
select t299.atomico(format('select public.grupos_dias_activar(930101, %L, %L::jsonb)', 'huella-vieja', t299.hab(930101)),
  'PT409', 'C1 huella obsoleta');
select t299.atomico(format('select public.grupos_dias_activar(930101, %L, %L::jsonb)', t299.h(930101), t299.hab(930101)),
  'regla de edad', 'C2 reglas de edad incoherentes entre grupos');
-- Misma regla en la Semana (la del Fin de semana).
select t299.pasa(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null,
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Estándar","alimentacion":"PAM","edad_infante_min":0,"edad_infante_max":1,"edad_nino_min":2,"edad_nino_max":11}]'::jsonb)$q$,
  t299.h(930101)), 'C2b misma regla de edad en la Semana');
select t299.atomico(format('select public.grupos_dias_activar(930101, %L, %L::jsonb)', t299.h(930101), '[]'),
  'HABILITACIONES', 'C3 habilitación sin confirmar');
select t299.atomico(format('select public.grupos_dias_activar(930101, %L, %L::jsonb)', t299.h(930101),
  (select jsonb_agg(e || '{"acomodacion":"cuadruple"}') from jsonb_array_elements(t299.hab(930101)) e)),
  'HABILITACIONES', 'C4 habilitación confirmada que no corresponde');
select t299.atomico(format('select public.grupos_dias_activar(930101, %L, %L::jsonb)', t299.h(930101), t299.hab(930101)),
  'EMPATE_PRIORIDAD', 'C5 empate de prioridad con PUENTE');
select t299.atomico(format('select public.grupos_dias_activar(930109, %L, %L::jsonb)', t299.h(930109), '[]'),
  'compra cerrada', 'C6 vigencia con la compra cerrada');
select t299.atomico(format('select public.grupos_dias_activar(930102, %L, %L::jsonb)', t299.h(930102), '[]'),
  'Ningún grupo tiene tarifas', 'C7 vigencia sin propuesta');
-- Sugerencia aceptada y luego cambiada su tarifa de origen.
do $$ declare v_origen bigint := (select min(id) from public.tarifa_hotel where hotel_id = 9301 and temporada = 'ALTA' and grupo_id is null);
begin
  perform public.grupos_dias_guardar_propuesta(930101, t299.h(930101), 'actualizar', null,
    jsonb_build_array(jsonb_build_object('grupo_id', '00000000-0000-4000-8000-0000000c0001', 'tipo_habitacion', 'Estándar',
      'alimentacion', 'PAM', 'neto_sencilla', 150000, 'origen_tarifa_id', v_origen)));
  update public.tarifa_hotel set neto_sencilla = 151000 where id = v_origen;
end $$;
select t299.ok(jsonb_array_length(public.grupos_dias_alcance(930101)->'obsoletas') = 1, 'C8a sugerencia obsoleta detectada');
select t299.atomico(format('select public.grupos_dias_activar(930101, %L, %L::jsonb)', t299.h(930101), t299.hab(930101)),
  'sugerencias aceptadas', 'C8 sugerencia obsoleta');
do $$ begin
  update public.tarifa_hotel set neto_sencilla = 150000 where hotel_id = 9301 and temporada = 'ALTA' and grupo_id is null and neto_sencilla = 151000;
end $$;
select t299.ok(jsonb_array_length(public.grupos_dias_alcance(930101)->'obsoletas') = 0, 'C8b la sugerencia vuelve a estar vigente');

-- Resolver el empate: PUENTE pasa a prioridad 2 (gana sin empate).
update public.hotel_temporadas set prioridad = 2 where id = 930106;
select t299.ok(jsonb_array_length(public.grupos_dias_alcance(930101)->'empates') = 0, 'C9 empate resuelto al cambiar la prioridad');

-- ── D. Aplicar a la venta ─────────────────────────────────────────────────────────────
select t299.pasa(format('select public.grupos_dias_activar(930101, %L, %L::jsonb)', t299.h(930101), t299.hab(930101)),
  'D1 aplicar a la venta con la habilitación confirmada');
select t299.ok((select bool_and(activo) from public.hotel_temporada_grupos where temporada_id = 930101), 'D2 los dos grupos quedaron activos');
select t299.ok(t299.n($q$select count(*) from public.tarifa_hotel where hotel_id = 9301 and temporada = 'ALTA' and grupo_id is null$q$) = 0,
  'D3 la tarifa «todos los días» de ALTA (y su duplicado de legado) ya no se vende');
select t299.ok(t299.n($q$select count(*) from public.tarifa_hotel t join public.hotel_grupo_tarifa_propuesta p
                         on p.grupo_id = t.grupo_id and p.tipo_habitacion = t.tipo_habitacion and p.alimentacion = t.alimentacion
                        where t.hotel_id = 9301 and t.temporada = 'ALTA'
                          and row(t.neto_sencilla, t.neto_doble, t.neto_triple, t.notas, t.edad_infante_max)
                              is not distinct from row(p.neto_sencilla, p.neto_doble, p.neto_triple, p.notas, p.edad_infante_max)$q$) = 2,
  'D4 se vende EXACTAMENTE la propuesta (2 filas, mismos netos, notas y edades)');
select t299.ok((select grupo_dias from public.tarifa_hotel where grupo_id = '00000000-0000-4000-8000-0000000c0002') = array[5,6,7]::smallint[],
  'D5 cada tarifa por grupo lleva la copia de sus días');
select t299.ok(t299.n($q$select count(*) from public.tarifa_hotel_historial where hotel_id = 9301 and motivo = 'grupos_aplicar'$q$) = 2,
  'D6 historial: las 2 filas «todos los días» quitadas, con motivo grupos_aplicar');
select t299.ok(public._grupos_43_config(930101)->>'estado' = 'activo' and public._grupos_43_pendientes(930101) = 0,
  'D7 estado activo, sin cambios pendientes');
select t299.ok((select origen_tarifa_id is null from public.hotel_grupo_tarifa_propuesta where grupo_id = '00000000-0000-4000-8000-0000000c0001'),
  'D8 la sugerencia consumida se desmarca');
select t299.atomico(format('select public.grupos_dias_activar(930101, %L, %L::jsonb)', t299.h(930101), '[]'),
  'No hay cambios pendientes', 'D9 aplicar sin cambios');
select t299.ok(t299.n($q$select count(*) from public.tarifa_hotel where hotel_id = 9304$q$) = 2, 'D10 hotel sin grupos intacto');

-- ── E. Borrador con la venta activa ──────────────────────────────────────────────────
select t299.pasa(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null,
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Estándar","alimentacion":"PAM","neto_doble":97000}]'::jsonb)$q$,
  t299.h(930101)), 'E1 editar el borrador de un grupo activo');
select t299.ok(public._grupos_43_pendientes(930101) = 1
               and (select neto_doble from public.tarifa_hotel where grupo_id = '00000000-0000-4000-8000-0000000c0001') = 95000,
  'E2 un cambio pendiente; lo que se vende sigue en 95.000');
select t299.pasa(format('select public.grupos_dias_descartar(930101, %L)', t299.h(930101)), 'E3 descartar el borrador');
select t299.ok(public._grupos_43_pendientes(930101) = 0
               and (select neto_doble from public.hotel_grupo_tarifa_propuesta where grupo_id = '00000000-0000-4000-8000-0000000c0001') = 95000,
  'E4 el borrador vuelve a ser lo vigente');
insert into public.hotel_calculadora (hotel_id, tipo, params) values (9301, 'dubai', '{"bases":[]}') on conflict do nothing;
select t299.pasa(format($q$select public.grupos_dias_guardar_calculadora(930101, %L, '00000000-0000-4000-8000-0000000c0002', 'dubai',
  %s, null, '[{"categoria":"Estándar","precio":120000}]'::jsonb,
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0002","tipo_habitacion":"Estándar","alimentacion":"PAM","neto_doble":135000}]'::jsonb)$q$,
  t299.h(930101), (select version from public.hotel_calculadora where hotel_id = 9301)), 'E5 la calculadora por grupo escribe el borrador de un grupo activo');
select t299.ok(public._grupos_43_pendientes(930101) = 1
               and (select neto_doble from public.tarifa_hotel where grupo_id = '00000000-0000-4000-8000-0000000c0002') = 130000,
  'E6 la calculadora no cambió lo que se vende');
select t299.pasa(format('select public.grupos_dias_activar(930101, %L, %L::jsonb)', t299.h(930101), t299.hab(930101)), 'E7 aplicar el cambio');
select t299.ok((select neto_doble from public.tarifa_hotel where grupo_id = '00000000-0000-4000-8000-0000000c0002') = 135000
               and t299.n($q$select count(*) from public.tarifa_hotel_historial where hotel_id = 9301 and motivo = 'grupos_aplicar' and operacion = 'UPDATE'$q$) = 1,
  'E8 solo esa fila cambió (UPDATE en el historial, la otra intacta)');

-- ── F. Protecciones con la venta activa ──────────────────────────────────────────────
select t299.atomico($q$update public.tarifa_hotel set neto_doble = 1 where grupo_id = '00000000-0000-4000-8000-0000000c0001'$q$,
  'Grupos de días', 'F1 editar una tarifa por grupo a mano');
select t299.atomico($q$delete from public.tarifa_hotel where grupo_id = '00000000-0000-4000-8000-0000000c0001'$q$,
  'Grupos de días', 'F2 borrar una tarifa por grupo a mano');
select t299.atomico($q$insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble) values (9301, 'Superior', 'PC', 'ALTA', 1)$q$,
  'todos los días', 'F3 tarifa «todos los días» en una vigencia que se vende por grupos');
select t299.pasa($q$do $d$ begin
  update public.hotel_temporadas set nombre = 'ALTA2' where id = 930101;
  update public.tarifa_hotel set temporada = 'ALTA2' where hotel_id = 9301 and temporada = 'ALTA';
  update public.hotel_temporadas set nombre = 'ALTA' where id = 930101;
  update public.tarifa_hotel set temporada = 'ALTA' where hotel_id = 9301 and temporada = 'ALTA2';
end $d$$q$, 'F4 renombrar la vigencia (cascada del nombre) sigue permitido');
select t299.atomico(format($q$select public.grupos_dias_guardar(930101, %L, '[{"id":"00000000-0000-4000-8000-0000000c0001","nombre":"Semana","dias":[1,2,3]}]'::jsonb)$q$,
  t299.h(930101)), 'no se cambian mientras se vende', 'F5 cambiar los días de un grupo activo');
select t299.pasa(format($q$select public.grupos_dias_guardar(930101, %L, '[{"id":"00000000-0000-4000-8000-0000000c0001","nombre":"Entre semana","dias":[1,2,3,4]}]'::jsonb)$q$,
  t299.h(930101)), 'F6 renombrar un grupo activo sí');
-- Empate creado por una edición directa de prioridad: se rechaza al confirmar (aquí, al forzar la comprobación).
select t299.atomico($q$do $d$ begin update public.hotel_temporadas set prioridad = 1 where id = 930106; set constraints all immediate; end $d$$q$,
  'EMPATE_PRIORIDAD', 'F11 bajar la prioridad de PUENTE crea un empate: rechazado');
select t299.atomico($q$do $d$ begin
  insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (930107, 9301, 'OTRA', '2027-01-20', '2027-01-22', 1, 'tarifa');
  insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_triple) values (9301, 'Estándar', 'PAM', 'OTRA', 70000);
  set constraints all immediate; end $d$$q$,
  'EMPATE_PRIORIDAD', 'F12 una vigencia nueva con la misma prioridad y precio para el triple: rechazada');
select t299.pasa($q$do $d$ begin
  insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, regimen_restringido) values (930107, 9301, 'OTRA', '2027-01-20', '2027-01-22', 1, 'tarifa', 'PC');
  insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble) values (9301, 'Estándar', 'PC', 'OTRA', 70000);
  set constraints all immediate;
  delete from public.tarifa_hotel where hotel_id = 9301 and temporada = 'OTRA';
  delete from public.hotel_temporadas where id = 930107;
end $d$$q$, 'F13 restringida a otro régimen (PC): no compite, se acepta');


select t299.atomico($q$select public.generar_tarifas_hotel_calculadora(9301,
  '[{"tipo_habitacion":"Estándar","alimentacion":"PAM","temporada":"ALTA","neto_doble":1}]'::jsonb,
  (select jsonb_agg(to_jsonb(t)) from public.tarifa_hotel t where t.hotel_id = 9301), false)$q$,
  'se vende por grupos', 'F7 la calculadora general no escribe una vigencia por grupos');
select t299.atomico($q$select public.generar_tarifas_hotel_calculadora(9301,
  '[{"tipo_habitacion":"Estándar","alimentacion":"PAM","temporada":"PROMO-ALTA","neto_doble":1,"precio_final_autoritativo":true,"temporada_base":"ALTA"}]'::jsonb,
  (select jsonb_agg(to_jsonb(t)) from public.tarifa_hotel t where t.hotel_id = 9301), false)$q$,
  'se vende por grupos', 'F8 ni una promoción calculada desde ella');
do $$ declare r jsonb; begin
  r := public.generar_tarifas_hotel_calculadora(9301,
    '[{"tipo_habitacion":"Estándar","alimentacion":"PAM","temporada":"BAJA","neto_doble":81000}]'::jsonb,
    (select jsonb_agg(to_jsonb(t)) from public.tarifa_hotel t where t.hotel_id = 9301), true, null);
  perform t299.ok(r->'con_grupos' = '["ALTA"]'::jsonb, 'F9 «Reemplazar todo» informa la vigencia por grupos conservada');
end $$;
select t299.ok(t299.n($q$select count(*) from public.tarifa_hotel where hotel_id = 9301 and grupo_id is not null$q$) = 2
               and t299.n($q$select count(*) from public.tarifa_hotel where hotel_id = 9301 and temporada = 'PROMO-ALTA'$q$) = 1
               and t299.n($q$select count(*) from public.tarifa_hotel where hotel_id = 9301 and temporada = 'BAJA' and neto_doble = 81000$q$) = 1,
  'F10 «Reemplazar todo» conserva las tarifas por grupo y la promoción calculada desde ALTA; reemplaza BAJA');
-- ── G. Borrar grupos activos ──────────────────────────────────────────────────────────
select t299.atomico(format($q$select public.grupos_dias_borrar_con_bases('00000000-0000-4000-8000-0000000c0002', %L, '[]'::jsonb)$q$, t299.h(930101)),
  'PT409', 'G1 borrar con bases distintas de las revisadas');
select t299.pasa(format($q$select public.grupos_dias_borrar_con_bases('00000000-0000-4000-8000-0000000c0002', %L, %L::jsonb)$q$, t299.h(930101),
  (select jsonb_agg(jsonb_build_object('tipo', tipo, 'version', version)) from public.hotel_calculadora_grupo_bases where grupo_id = '00000000-0000-4000-8000-0000000c0002')),
  'G2 borrar el Fin de semana (activo, no es el último)');
select t299.ok(t299.n($q$select count(*) from public.tarifa_hotel where grupo_id = '00000000-0000-4000-8000-0000000c0002'$q$) = 0
               and t299.n($q$select count(*) from public.tarifa_hotel_historial where hotel_id = 9301 and motivo = 'grupos_borrar'$q$) = 1
               and public.grupos_dias_alcance(930101)->'dias_sin_grupo' = '[5, 6, 7]'::jsonb,
  'G3 sus tarifas salen de la venta (historial grupos_borrar) y V–D quedan sin grupo');
select t299.atomico(format($q$select public.grupos_dias_borrar('00000000-0000-4000-8000-0000000c0001', %L)$q$, t299.h(930101)),
  'último grupo', 'G4 no se borra el último grupo que se vende');

-- ── H. Volver a «todos los días» ─────────────────────────────────────────────────────
select t299.atomico(format($q$select public.grupos_dias_volver_todos(930101, %L, '[]'::jsonb)$q$, t299.h(930101)),
  'Elige, para cada combinación', 'H1 sin elegir no se ejecuta');
select t299.atomico(format($q$select public.grupos_dias_volver_todos(930101, %L, '[{"tipo_habitacion":"Estándar","alimentacion":"PAM","grupo_id":"00000000-0000-4000-8000-0000000c0002"}]'::jsonb)$q$, t299.h(930101)),
  'no tiene esa tarifa', 'H2 elegir un grupo que no tiene esa tarifa');
select t299.pasa(format($q$select public.grupos_dias_volver_todos(930101, %L, '[{"tipo_habitacion":"Estándar","alimentacion":"PAM","grupo_id":"00000000-0000-4000-8000-0000000c0001"}]'::jsonb)$q$, t299.h(930101)),
  'H3 volver eligiendo la tarifa de la Semana');
select t299.ok(public._grupos_43_config(930101)->>'estado' = 'preparado'
               and t299.n($q$select count(*) from public.tarifa_hotel where hotel_id = 9301 and temporada = 'ALTA' and grupo_id is null and neto_doble = 95000 and neto_triple = 80000$q$) = 1
               and t299.n($q$select count(*) from public.tarifa_hotel where hotel_id = 9301 and grupo_id is not null$q$) = 0
               and t299.n($q$select count(*) from public.hotel_grupo_tarifa_propuesta where grupo_id = '00000000-0000-4000-8000-0000000c0001'$q$) = 1,
  'H4 ALTA vuelve a «todos los días» con la tarifa elegida; el grupo queda preparado con su propuesta');

-- ── I. Unidad y hoteles sin grupos ───────────────────────────────────────────────────
select t299.ok(t299.n($q$select count(*) from public.tarifa_hotel where hotel_id = 9304$q$) = 2
               and jsonb_array_length(public._grupos_43_empates(9304, null)) = 0, 'I1 hotel sin grupos: intacto y sin empates nuevos');
select t299.ok(t299.n($q$select count(*) from public.hotel_temporada_grupos where activo$q$) = 0, 'I2 nada quedó activo al final');

-- ── J. Correcciones: escrituras posteriores en la misma transacción, costo y horizonte ─────────────
-- J1: primera escritura válida y COMPROBADA (SET CONSTRAINTS IMMEDIATE); la segunda, en la MISMA transacción,
-- crea un empate ⇒ se rechaza TODO (también la primera).
-- PUENTE recupera su doble (F9 «reemplazar todo» la había quitado) para que pueda empatar.
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble)
  select 9301, 'Estándar', 'PAM', 'PUENTE', 90000
   where not exists (select 1 from public.tarifa_hotel where hotel_id = 9301 and temporada = 'PUENTE');
do $$ begin
  -- Estado: ALTA vuelve a venderse por grupos (Semana) para que haya empates posibles con PUENTE.
  perform public.grupos_dias_activar(930101, t299.h(930101), t299.hab(930101));
end $$;
select t299.ok(public._grupos_43_config(930101)->>'estado' = 'activo', 'J0 ALTA se vende por grupos (Semana)');
select t299.atomico($q$do $d$ begin
  update public.hotel_temporadas set prioridad = 3 where id = 930106;   -- válida: PUENTE sigue ganando sin empate
  set constraints all immediate;                                       -- comprobada aquí
  update public.hotel_temporadas set prioridad = 1 where id = 930106;   -- crea el empate
end $d$$q$, 'EMPATE_PRIORIDAD', 'J1 segunda escritura con empate tras una comprobación en la misma transacción: todo rechazado');
-- J2: 40 filas en UNA sentencia de un hotel con grupos activos ⇒ el detector corre UNA vez al confirmar.
set track_functions = 'all';
select pg_stat_force_next_flush();
create temporary table t299_llamadas as
  select coalesce((select calls from pg_stat_user_functions where funcname = '_grupos_43_empates' and schemaname = 'public'), 0) as antes;
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble)
  select 9301, 'Cat ' || g, 'PAM', 'BAJA', 1000 + g from generate_series(1, 40) g;
select pg_stat_force_next_flush();
select pg_stat_clear_snapshot();
select t299.ok((select coalesce((select calls from pg_stat_user_functions where funcname = '_grupos_43_empates' and schemaname = 'public'), 0) - antes from t299_llamadas) = 1,
  'J2 40 filas en un commit de un hotel con grupos activos: el detector corrió UNA vez');
delete from public.tarifa_hotel where hotel_id = 9301 and tipo_habitacion like 'Cat %';
-- J3–J5: horizonte. Hotel 9305 con vigencias en 2031 (fuera de la ventana anterior de 1.096 días desde hoy) y un
-- cruce de 2027 a 2030 (más de 1.096 noches): el primero se DETECTA; el segundo es «no verificable» y bloquea.
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario) values (9305, 9301, 'T299 HORIZONTE', 'persona');
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
  (930501, 9305, 'LEJANA', '2031-01-01', '2031-01-31', 1, 'tarifa'),
  (930502, 9305, 'LEJANA-PUENTE', '2031-01-10', '2031-01-12', 1, 'tarifa'),
  (930503, 9305, 'LARGA', '2027-01-01', '2030-12-31', 5, 'tarifa'),
  (930504, 9305, 'LARGA-OTRA', '2027-01-01', '2030-12-31', 5, 'tarifa');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble) values
  (9305, 'Estándar', 'PAM', 'LEJANA-PUENTE', 1), (9305, 'Estándar', 'PAM', 'LARGA-OTRA', 1);
insert into public.hotel_temporada_grupos (id, temporada_id, nombre, dias) values
  ('00000000-0000-4000-8000-0000000c0051', 930501, 'Todos', array[1,2,3,4,5,6,7]),
  ('00000000-0000-4000-8000-0000000c0053', 930503, 'Todos', array[1,2,3,4,5,6,7]);
insert into public.hotel_grupo_tarifa_propuesta (grupo_id, tipo_habitacion, alimentacion, neto_doble) values
  ('00000000-0000-4000-8000-0000000c0051', 'Estándar', 'PAM', 2), ('00000000-0000-4000-8000-0000000c0053', 'Estándar', 'PAM', 2);
select t299.ok((select e->>'tipo' = 'empate' and e->>'desde' = '2031-01-10' and e->>'hasta' = '2031-01-12'
                from jsonb_array_elements(public._grupos_43_empates(9305, 930501)) e where e->'b'->>'nombre' = 'LEJANA-PUENTE'),
  'J3 empate en 2031 (más allá de hoy + 1.096 días) detectado con su rango exacto');
select t299.ok((select e->>'tipo' = 'no_verificable' and (e->>'noches')::int > 1096
                from jsonb_array_elements(public._grupos_43_empates(9305, 930503)) e where e->'b'->>'nombre' = 'LARGA-OTRA'),
  'J4 cruce de más de 1.096 noches: «no verificable», explícito (no se declara sin conflictos)');
select t299.atomico(format('select public.grupos_dias_activar(930503, %L, %L::jsonb)', t299.h(930503), t299.hab(930503)),
  'No se pueden verificar', 'J5 aplicar con un cruce no verificable: rechazado');
select t299.ok(jsonb_array_length(public._grupos_43_empates(9304, null)) = 0, 'J6 hotel sin grupos: sigue sin conflictos');
-- Dejar el estado final sin grupos activos (I2 del arnés y el rollback lo esperan).
do $$ begin
  perform public.grupos_dias_volver_todos(930101, t299.h(930101),
    (select jsonb_agg(distinct jsonb_build_object('tipo_habitacion', tipo_habitacion, 'alimentacion', alimentacion, 'grupo_id', grupo_id))
       from public.tarifa_hotel where grupo_id = '00000000-0000-4000-8000-0000000c0001'));
end $$;
select t299.ok(t299.n($q$select count(*) from public.hotel_temporada_grupos where activo$q$) = 0, 'J7 nada activo al final');
