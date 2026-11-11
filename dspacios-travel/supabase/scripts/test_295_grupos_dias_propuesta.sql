-- Pruebas de la 295 (base local desechable, después de 293 + fixture_293 + 295 + fixture_295).
-- Cada aserción imprime «OK …» o aborta con «FALLO …». La corre test_295_grupos_dias_propuesta.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema if not exists t295;
grant usage on schema t295 to public;
create or replace function t295.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FALLO %', m; end if; raise notice 'OK    %', m; end $$;
create or replace function t295.falla(sql text, patron text, m text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if sqlerrm ~* patron or sqlstate ~* patron then raise notice 'OK    % (rechazado [%]: %)', m, sqlstate, sqlerrm; return; end if;
    raise exception 'FALLO % — error distinto [%]: %', m, sqlstate, sqlerrm;
  end;
  raise exception 'FALLO % — no se rechazó', m;
end $$;
create or replace function t295.pasa(sql text, m text) returns void language plpgsql as $$
begin execute sql; raise notice 'OK    %', m;
exception when others then raise exception 'FALLO % — [%] %', m, sqlstate, sqlerrm; end $$;
create or replace function t295.huella(v bigint) returns text language sql as $$ select public.grupos_dias_config(v)->>'huella' $$;
create table t295.marca (k text primary key, v text);
grant all on t295.marca to public;
grant execute on all functions in schema t295 to public;
-- Huella de TODAS las tarifas al empezar (tarifas vigentes intactas al final).
insert into t295.marca values ('tarifas', (select md5(string_agg(to_jsonb(t)::text, E'\n' order by t.id)) from public.tarifa_hotel t));

-- ── Como operaciones de Mayorista ─────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
set role authenticated;

-- A. Lectura
select t295.ok((select (c->'vigencia'->>'nombre') = 'ALTA' and jsonb_array_length(c->'grupos') = 0 and jsonb_array_length(c->'origen') = 2
                       and (c->'categorias') ? 'Estándar' and (c->'regimenes') ? 'PAM' and c->'promociones'->0->>'temporada' = 'PROMO-ALTA'
                from (select public.grupos_dias_config(930101) c) x),
               'A1 la lectura trae vigencia, grupos, tarifas de origen (2, incluido el duplicado legado), catálogo y la promoción vinculada');
select t295.ok(t295.huella(930101) = t295.huella(930101), 'A2 la huella es estable entre lecturas');

-- B. Grupos
select t295.pasa(format($q$select public.grupos_dias_guardar(930101, %L, '[{"nombre":"Semana","dias":[1,2,3,4]},{"nombre":"Fin de semana","dias":[5,6,7]}]'::jsonb)$q$, t295.huella(930101)),
                 'B1 crear dos grupos en un solo guardado');
select t295.ok((select count(*) = 2 and bool_and(not activo) from public.hotel_temporada_grupos where temporada_id = 930101), 'B2 los grupos nacen inactivos');
select t295.falla($q$select public.grupos_dias_guardar(930101, 'huella-vieja', '[]'::jsonb)$q$, 'PT409|CONFIG_DESACTUALIZADA', 'B3 huella obsoleta: rechazado, pide recargar');
-- Mover el jueves de Semana a Fin de semana en un solo guardado (primero se aplica lo que libera días).
select t295.pasa(format($q$select public.grupos_dias_guardar(930101, %L, jsonb_build_array(
    jsonb_build_object('id', (select id from public.hotel_temporada_grupos where temporada_id = 930101 and nombre = 'Fin de semana'), 'nombre', 'Fin de semana', 'dias', '[4,5,6,7]'::jsonb),
    jsonb_build_object('id', (select id from public.hotel_temporada_grupos where temporada_id = 930101 and nombre = 'Semana'), 'nombre', 'Semana', 'dias', '[1,2,3]'::jsonb)))$q$, t295.huella(930101)),
                 'B4 un día pasa de un grupo a otro en un solo guardado');
select t295.falla(format($q$select public.grupos_dias_guardar(930101, %L, '[{"nombre":"Choca","dias":[3]}]'::jsonb)$q$, t295.huella(930101)), 'comparte días', 'B5 alta con días ya usados: rechazado');
select t295.falla(format($q$select public.grupos_dias_guardar(930108, %L, '[{"nombre":"Semana","dias":[1]}]'::jsonb)$q$, t295.huella(930108)), 'solo se configuran en vigencias de tarifa', 'B6 grupos en una vigencia de promoción: rechazado');
select t295.falla(format($q$select public.grupos_dias_guardar(930103, %L, '[{"nombre":"Semana","dias":[1]}]'::jsonb)$q$, t295.huella(930103)), 'nombre repetido', 'B7 vigencia de nombre repetido: rechazado (293)');
reset role;
select t295.falla($q$update public.hotel_temporadas set tipo = 'descuento_pct' where id = 930101$q$, 'no puede pasar a tipo', 'B8 una vigencia con grupos no cambia de tipo');
set role authenticated;

-- C. Propuesta
create temp table _g as select nombre, id from public.hotel_temporada_grupos where temporada_id = 930101;
grant select on _g to public;
select t295.pasa(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null, jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Estándar', 'alimentacion', 'PAM',
                       'neto_doble', 100000, 'neto_sencilla', 150000, 'neto_nino', 0),
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Fin de semana'), 'tipo_habitacion', 'Estándar', 'alimentacion', 'PAM',
                       'neto_doble', 180000, 'origen_tarifa_id', (select max(id) from public.tarifa_hotel where hotel_id = 9301 and temporada = 'ALTA'))))$q$,
                 t295.huella(930101)), 'C1 guardar propuesta (una escrita a mano, otra con sugerencia aceptada)');
select t295.ok((select count(*) = 2 from public.hotel_grupo_tarifa_propuesta), 'C2 dos filas de propuesta');
select t295.ok((select neto_nino = 0 and neto_nino2 is null and neto_infante is null and origen_huella is null
                from public.hotel_grupo_tarifa_propuesta p join _g on _g.id = p.grupo_id where _g.nombre = 'Semana'),
               'C3 niño 0 se guarda como 0 (gratis); niño 2 e infante quedan nulos: nada se completa');
select t295.ok((select origen_huella is not null and confirmado_por = '00000000-0000-4000-8000-000000009302'
                from public.hotel_grupo_tarifa_propuesta p join _g on _g.id = p.grupo_id where _g.nombre = 'Fin de semana'),
               'C4 sugerencia aceptada: queda su huella de origen y quién confirmó');
select t295.falla(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null, jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Inventada', 'alimentacion', 'PAM', 'neto_doble', 1)))$q$,
    t295.huella(930101)), 'no está configurada', 'C5 categoría que el hotel no tiene: rechazado');
select t295.falla(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null, jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Estándar', 'alimentacion', 'PAM', 'neto_doble', -5)))$q$,
    t295.huella(930101)), 'netos', 'C6 neto negativo: rechazado');
select t295.falla(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null, jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Estándar', 'alimentacion', 'PC', 'neto_doble', 1),
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Estándar', 'alimentacion', 'PC', 'neto_doble', 2)))$q$,
    t295.huella(930101)), 'repite una combinación', 'C7 combinación repetida en el lote: rechazado (nunca «la última gana»)');
select t295.falla(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null, jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Estándar', 'alimentacion', 'PC', 'neto_doble', 1, 'edad_infante_min', 0)))$q$,
    t295.huella(930101)), 'edades', 'C8 edades incompletas: rechazado');
select t295.falla(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null, jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Superior', 'alimentacion', 'PC', 'neto_doble', 1,
                       'origen_tarifa_id', (select max(id) from public.tarifa_hotel where hotel_id = 9301 and temporada = 'ALTA'))))$q$,
    t295.huella(930101)), 'no corresponde', 'C9 sugerencia de otra combinación: rechazado');
select t295.pasa(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null, jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Superior', 'alimentacion', 'PC', 'neto_doble', 120000)))$q$,
    t295.huella(930101)), 'C10 actualizar agrega una combinación sin tocar las demás');
select t295.ok((select count(*) = 3 from public.hotel_grupo_tarifa_propuesta), 'C11 tres filas');
select t295.pasa(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null, jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Superior', 'alimentacion', 'PC',
      'neto_sencilla', null, 'neto_doble', null, 'neto_triple', null, 'neto_multiple', null, 'neto_nino', null, 'neto_nino2', null, 'neto_infante', null)))$q$,
    t295.huella(930101)), 'C12 actualizar con los siete netos en null (explícito) quita esa combinación');
select t295.ok((select count(*) = 2 from public.hotel_grupo_tarifa_propuesta), 'C13 vuelven a ser dos');
select t295.falla(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'reemplazar_grupo', (select id from _g where nombre = 'Semana'), jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Fin de semana'), 'tipo_habitacion', 'Estándar', 'alimentacion', 'PAM', 'neto_doble', 1)))$q$,
    t295.huella(930101)), 'solo admite filas de ese grupo', 'C14 reemplazar un grupo con filas de otro: rechazado');
select t295.pasa(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'reemplazar_grupo', (select id from _g where nombre = 'Semana'), jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Estándar', 'alimentacion', 'PC', 'neto_doble', 110000)))$q$,
    t295.huella(930101)), 'C15 reemplazar un grupo');
select t295.ok((select count(*) = 2 and count(*) filter (where p.alimentacion = 'PC') = 1
                       and count(*) filter (where _g.nombre = 'Fin de semana') = 1
                from public.hotel_grupo_tarifa_propuesta p join _g on _g.id = p.grupo_id),
               'C16 reemplazar Semana conservó Fin de semana');
select t295.falla(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'reemplazar_vigencia', null, jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Estándar', 'alimentacion', 'PC')))$q$,
    t295.huella(930101)), 'sin ningún neto', 'C17 en un reemplazo, una fila sin netos es error');

-- C-bis. Decimales exactos; campo omitido se conserva; null presente borra
select t295.pasa(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null, jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Superior', 'alimentacion', 'PAM',
      'neto_doble', 123.45, 'neto_nino', 0, 'notas', 'Vista al mar', 'nota_infante', 'Cuna',
      'edad_infante_min', 0, 'edad_infante_max', 1, 'edad_nino_min', 2, 'edad_nino_max', 11)))$q$, t295.huella(930101)),
  'C18 propuesta con decimales, cero y override completo de edades y notas');
select t295.pasa(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null, jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Superior', 'alimentacion', 'PAM', 'neto_sencilla', 150000.5)))$q$,
    t295.huella(930101)), 'C19 editar solo un neto (el resto de campos omitidos)');
select t295.ok((select neto_doble = 123.45 and neto_sencilla = 150000.5 and neto_nino = 0 and notas = 'Vista al mar' and nota_infante = 'Cuna'
                       and edad_infante_min = 0 and edad_infante_max = 1 and edad_nino_min = 2 and edad_nino_max = 11
                from public.hotel_grupo_tarifa_propuesta p join _g on _g.id = p.grupo_id
                where _g.nombre = 'Semana' and p.tipo_habitacion = 'Superior' and p.alimentacion = 'PAM'),
               'C20 decimales exactos y notas/edades conservadas al editar solo un neto');
select t295.falla(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null, jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Superior', 'alimentacion', 'PAM', 'edad_nino_max', null)))$q$,
    t295.huella(930101)), 'edades_todas_o_ninguna', 'C21 borrar UNA edad deja el override incompleto: rechazado');
select t295.pasa(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null, jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Superior', 'alimentacion', 'PAM',
      'notas', null, 'nota_infante', null, 'edad_infante_min', null, 'edad_infante_max', null, 'edad_nino_min', null, 'edad_nino_max', null)))$q$,
    t295.huella(930101)), 'C22 borrado intencional de notas y edades (null presente)');
select t295.ok((select notas is null and nota_infante is null and edad_infante_min is null and neto_doble = 123.45
                from public.hotel_grupo_tarifa_propuesta p join _g on _g.id = p.grupo_id
                where _g.nombre = 'Semana' and p.tipo_habitacion = 'Superior' and p.alimentacion = 'PAM'),
               'C23 notas y edades borradas; los netos siguen');
select t295.pasa(format($q$select public.grupos_dias_guardar_propuesta(930101, %L, 'actualizar', null, jsonb_build_array(
    jsonb_build_object('grupo_id', (select id from _g where nombre = 'Semana'), 'tipo_habitacion', 'Superior', 'alimentacion', 'PAM',
      'neto_sencilla', null, 'neto_doble', null, 'neto_triple', null, 'neto_multiple', null, 'neto_nino', null, 'neto_nino2', null, 'neto_infante', null)))$q$,
    t295.huella(930101)), 'C24 limpieza de la fila de prueba');

-- D. Escrituras directas a la tabla: no (solo por RPC)
select t295.falla($q$insert into public.hotel_grupo_tarifa_propuesta (grupo_id, tipo_habitacion, alimentacion, neto_doble) select id, 'Estándar', 'PAM', 1 from _g limit 1$q$,
                  'permission denied|permiso denegado', 'D1 insertar directo en la tabla: sin permiso');
select t295.falla($q$update public.hotel_temporada_grupos set activo = true$q$, 'inactivos_43', 'D2 activar un grupo sigue imposible (candado de la 293)');

-- E. Borrar un grupo: solo el grupo y SUS propuestas; promociones y tarifas intactas
reset role;
insert into t295.marca values ('promo', (select md5(string_agg(to_jsonb(t)::text, ',' order by t.id)) from public.tarifa_hotel t where temporada_base = 'ALTA'));
set role authenticated;
select t295.falla(format($q$select public.grupos_dias_borrar((select id from _g where nombre = 'Semana'), %L)$q$, 'vieja'), 'PT409|CONFIG_DESACTUALIZADA', 'E1 borrar con huella obsoleta: rechazado');
select t295.ok((select (r->>'propuestas_eliminadas')::int = 1 from (select public.grupos_dias_borrar((select id from _g where nombre = 'Semana'), t295.huella(930101)) r) x),
               'E2 borrar Semana elimina SU única propuesta');
select t295.ok((select count(*) = 1 from public.hotel_grupo_tarifa_propuesta p join _g on _g.id = p.grupo_id where _g.nombre = 'Fin de semana')
               and (select count(*) = 1 from public.hotel_temporada_grupos where temporada_id = 930101),
               'E3 el otro grupo y su propuesta siguen');
reset role;
select t295.ok((select md5(string_agg(to_jsonb(t)::text, ',' order by t.id)) from public.tarifa_hotel t where temporada_base = 'ALTA') = (select v from t295.marca where k = 'promo'),
               'E4 la promoción vinculada no se tocó');
select t295.ok((select count(*) >= 3 from public.auditoria where tabla = 'hotel_grupo_tarifa_propuesta')
               and (select count(*) >= 1 from public.auditoria where tabla = 'hotel_grupo_tarifa_propuesta' and accion ilike 'delete'),
               'E5 auditoría de propuestas (altas y bajas)');

-- F. Otros roles
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009303","session_id":"00000000-0000-4000-8000-00000000a303","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009303', false);
set role authenticated;
select t295.ok((select public.grupos_dias_config(930101) ? 'huella'), 'F1 operaciones de Minorista lee (igual que tarifa_hotel)');
select t295.falla(format($q$select public.grupos_dias_guardar(930101, %L, '[]'::jsonb)$q$, t295.huella(930101)), 'Mayorista|42501', 'F2 operaciones de Minorista no escribe el catálogo global');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009304","session_id":"00000000-0000-4000-8000-00000000a304","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009304', false);
set role authenticated;
select t295.falla($q$select public.grupos_dias_config(930101)$q$, 'Sin permiso|42501', 'F3 venta no lee la configuración');
select t295.ok((select count(*) = 0 from public.hotel_grupo_tarifa_propuesta), 'F4 venta no ve propuestas');
reset role;
set role anon;
select t295.falla($q$select public.grupos_dias_config(930101)$q$, 'permission denied|permiso denegado', 'F5 anon no ejecuta las RPC');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
set role authenticated;
select t295.falla(format($q$select public.grupos_dias_guardar(930201, %L, '[{"nombre":"Semana","dias":[1]}]'::jsonb)$q$, t295.huella(930201)), 'modelo por unidad', 'F6 hotel por unidad: rechazado');
reset role;

-- G. Lo que hoy se vende sigue intacto
select t295.ok((select md5(string_agg(to_jsonb(t)::text, E'\n' order by t.id)) from public.tarifa_hotel t) = (select v from t295.marca where k = 'tarifas'),
               'G1 tarifas vigentes intactas (huella de todas las tarifas igual que al empezar)');
select t295.ok((select count(*) = 0 from public.tarifa_hotel where grupo_id is not null) and (select count(*) = 0 from public.hotel_temporada_grupos where activo),
               'G2 ninguna tarifa por grupo y ningún grupo activo');

drop table _g;
drop schema t295 cascade;
