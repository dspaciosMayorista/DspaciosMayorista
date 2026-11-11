-- Pruebas de la 293 (después de la migración, base local desechable). Cada aserción imprime
-- «OK …» o aborta con «FALLO …». La corre test_293_vigencia_grupos_dias.sh como `postgres`.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema if not exists t293;
grant usage on schema t293 to public;
create or replace function t293.ok(c boolean, m text) returns void language plpgsql as $$
begin
  if c is distinct from true then raise exception 'FALLO %', m; end if;
  raise notice 'OK    %', m;
end $$;
create or replace function t293.falla(sql text, patron text, m text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm ~* patron then raise notice 'OK    % (rechazado: %)', m, sqlerrm; return; end if;
    raise exception 'FALLO % — error distinto: %', m, sqlerrm;
  end;
  raise exception 'FALLO % — no se rechazó', m;
end $$;
create or replace function t293.pasa(sql text, m text) returns void language plpgsql as $$
begin
  execute sql;
  raise notice 'OK    %', m;
exception when others then
  raise exception 'FALLO % — %', m, sqlerrm;
end $$;
grant execute on all functions in schema t293 to public;

-- ── A. Compatibilidad: tarifas y vigencias sin grupos siguen igual ──────────────
select t293.pasa($q$insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble)
                   values (9301, 'Estándar', 'PAM', 'ALTA', 100000)$q$, 'A1 otro duplicado histórico «todos los días» se acepta (el índice es solo para filas con grupo)');
select t293.pasa($q$update public.tarifa_hotel set neto_doble = 101000 where hotel_id = 9301 and temporada = 'BAJA'$q$, 'A2 editar una tarifa sin grupo');
select t293.ok((select count(*) = 1 from public.tarifa_hotel_historial h
                where h.hotel_id = 9301 and h.operacion = 'UPDATE' and h.datos ? 'grupo_id'
                  and h.datos->'grupo_id' = 'null'::jsonb and h.datos->'grupo_dias' = 'null'::jsonb
                  and (h.datos->>'neto_doble')::numeric = 80000),
               'A3 el historial guarda la versión anterior con grupo_id/grupo_dias nulos');
select t293.pasa($q$update public.tarifa_hotel set neto_doble = 80000 where hotel_id = 9301 and temporada = 'BAJA'$q$, 'A4 revertir la edición');
select t293.pasa($q$insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo)
                   values (930106, 9301, 'DUP', '2027-05-01', '2027-05-31', 1, 'tarifa')$q$, 'A5 crear otra vigencia de nombre repetido sin grupos (como hoy)');
select t293.pasa($q$update public.hotel_temporadas set nombre = 'BAJA2' where id = 930102$q$, 'A6 renombrar una vigencia sin grupos');
select t293.pasa($q$update public.tarifa_hotel set temporada = 'BAJA2' where hotel_id = 9301 and temporada = 'BAJA'$q$, 'A7 cascada de nombre en tarifas (como actualizarTemporada)');
select t293.pasa($q$update public.hotel_temporadas set nombre = 'BAJA' where id = 930102;
                    update public.tarifa_hotel set temporada = 'BAJA' where hotel_id = 9301 and temporada = 'BAJA2'$q$, 'A8 devolver el nombre');
select t293.pasa($q$update public.hoteles set modelo_tarifario = 'unidad' where id = 9303;
                    update public.hoteles set modelo_tarifario = 'persona' where id = 9303$q$, 'A9 hotel sin grupos cambia de modelo (como hoy)');
select t293.pasa($q$delete from public.tarifa_hotel where hotel_id = 9301 and temporada = 'ALTA' and id = (select max(id) from public.tarifa_hotel where hotel_id = 9301 and temporada = 'ALTA')$q$,
                 'A10 borrar una tarifa sin grupo');
select t293.pasa($q$delete from public.hotel_temporadas where id = 930106$q$, 'A11 borrar una vigencia sin grupos');

-- ── B. Inactividad: los grupos existen pero no se activan ni se usan ──────────────
select t293.pasa($q$insert into public.hotel_temporada_grupos (id, temporada_id, nombre, dias)
                   values ('00000000-0000-4000-8000-0000000b0001', 930101, ' Fin de semana ', array[7,5,6])$q$, 'B1 crear un grupo (inactivo)');
select t293.ok((select activo = false and dias = array[5,6,7]::smallint[] and nombre = 'Fin de semana'
                from public.hotel_temporada_grupos where id = '00000000-0000-4000-8000-0000000b0001'),
               'B2 nace inactivo, días ordenados y nombre recortado');
select t293.falla($q$insert into public.hotel_temporada_grupos (temporada_id, nombre, dias, activo) values (930101, 'Activo', array[1], true)$q$,
                  'inactivos_43', 'B3 crear un grupo activo');
select t293.falla($q$update public.hotel_temporada_grupos set activo = true where id = '00000000-0000-4000-8000-0000000b0001'$q$,
                  'inactivos_43', 'B4 activar un grupo existente');
select t293.falla($q$insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble, grupo_id)
                   values (9301, 'Estándar', 'PAM', 'ALTA', 90000, '00000000-0000-4000-8000-0000000b0001')$q$,
                  'inactivos', 'B5 tarifa apuntando a un grupo inactivo');
select t293.falla($q$update public.tarifa_hotel set grupo_id = '00000000-0000-4000-8000-0000000b0001' where hotel_id = 9301 and temporada = 'ALTA'$q$,
                  'inactivos', 'B6 enlazar una tarifa existente a un grupo inactivo');
select t293.falla($q$update public.tarifa_hotel set grupo_dias = array[1]::smallint[] where hotel_id = 9301 and temporada = 'BAJA'$q$,
                  'grupo_dias_coherente', 'B7 días sueltos sin grupo');
select t293.ok((select count(*) = 0 from public.tarifa_hotel where grupo_id is not null or grupo_dias is not null),
               'B8 ninguna tarifa tiene grupo');

-- ── C. Controles de los grupos ─────────────────────────────────────────────────
select t293.falla($q$insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (930101, 'Choca', array[4,5])$q$,
                  'comparte días', 'C1 solape de días en la misma vigencia');
select t293.falla($q$insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (930101, 'Repite', array[1,1])$q$,
                  'repite días', 'C2 días repetidos');
select t293.falla($q$insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (930101, 'Fuera', array[0,8])$q$,
                  'dias_validos', 'C3 días fuera de 1..7');
select t293.falla($q$insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (930101, 'Vacío', '{}'::smallint[])$q$,
                  'dias_validos', 'C4 grupo sin días');
select t293.falla($q$insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (930101, '  ', array[1])$q$,
                  'nombre_valido', 'C5 nombre vacío');
select t293.falla($q$insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (930101, 'fin de SEMANA', array[1])$q$,
                  'nombre_uq', 'C6 nombre de grupo repetido en la vigencia (sin distinguir mayúsculas)');
select t293.falla($q$insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (930103, 'Semana', array[1,2,3,4])$q$,
                  'nombre repetido', 'C7 vigencia de nombre repetido no admite grupos');
select t293.falla($q$insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (930201, 'Semana', array[1,2,3,4])$q$,
                  'modelo por unidad', 'C8 hotel de modelo por unidad no admite grupos');
select t293.pasa($q$insert into public.hotel_temporada_grupos (id, temporada_id, nombre, dias)
                   values ('00000000-0000-4000-8000-0000000b0002', 930101, 'Semana', array[1,2,3,4])$q$, 'C9 grupo complementario sin solape');
select t293.falla($q$update public.hotel_temporada_grupos set temporada_id = 930105 where id = '00000000-0000-4000-8000-0000000b0002'$q$,
                  'no se puede mover', 'C10 mover un grupo a otra vigencia');
select t293.falla($q$update public.hotel_temporada_grupos set dias = array[4,5] where id = '00000000-0000-4000-8000-0000000b0002'$q$,
                  'comparte días', 'C11 editar días creando solape');
select t293.pasa($q$update public.hotel_temporada_grupos set dias = array[1,2,3] where id = '00000000-0000-4000-8000-0000000b0002'$q$,
                 'C12 editar días sin solape');

-- ── D. Vigencias y hoteles con grupos ─────────────────────────────────────────────
select t293.falla($q$insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo)
                    values (9301, ' ALTA', '2027-06-01', '2027-06-30', 1, 'tarifa')$q$, 'con grupos', 'D1 crear otra vigencia con el nombre de una que tiene grupos');
select t293.falla($q$update public.hotel_temporadas set nombre = 'ALTA' where id = 930105$q$, 'con grupos', 'D2 renombrar otra vigencia al nombre de una con grupos');
select t293.falla($q$update public.hotel_temporadas set nombre = 'BAJA' where id = 930101$q$, 'no puede repetir', 'D3 renombrar la vigencia con grupos a un nombre existente');
select t293.pasa($q$update public.hotel_temporadas set nombre = 'ALTA ENERO' where id = 930101;
                    update public.hotel_temporadas set nombre = 'ALTA' where id = 930101$q$, 'D4 renombrar la vigencia con grupos a un nombre libre');
select t293.falla($q$update public.hotel_temporadas set hotel_id = 9303 where id = 930101$q$, 'otro hotel', 'D5 mover de hotel una vigencia con grupos');
select t293.falla($q$update public.hoteles set modelo_tarifario = 'unidad' where id = 9301$q$, 'modelo por unidad', 'D6 hotel con grupos no pasa a unidad');
select t293.falla($q$delete from public.hotel_temporadas where id = 930101$q$, 'foreign key|llave foránea|violates', 'D7 borrar una vigencia con grupos (restrict)');
select t293.pasa($q$insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo)
                    values (9303, 'ALTA 2', '2027-06-01', '2027-06-30', 1, 'tarifa')$q$, 'D8 otro hotel no se ve afectado');
select t293.ok((select count(*) = 2 from public.auditoria where tabla = 'hotel_temporada_grupos' and accion in ('INSERT','insert')),
               'D9 la auditoría registra los grupos creados');

-- ── E. Activación SIMULADA (todo se deshace): controles para cuando el motor los soporte ──
begin;
alter table public.hotel_temporada_grupos drop constraint hotel_temporada_grupos_inactivos_43;
insert into public.hotel_temporada_grupos (id, temporada_id, nombre, dias) values
  ('00000000-0000-4000-8000-0000000e0001', 930105, 'Semana', array[1,2,3,4]),
  ('00000000-0000-4000-8000-0000000e0002', 930105, 'Fin de semana', array[5,6,7]);
update public.hotel_temporada_grupos set activo = true;
select t293.falla($q$insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble, grupo_id)
                   values (9301, 'Estándar', 'PAM', 'ALTA', 90000, '00000000-0000-4000-8000-0000000b0001')$q$,
                  'todos los días', 'E1 tarifa por grupo en una vigencia con tarifas de todos los días');
select t293.pasa($q$insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble, grupo_id, grupo_dias)
                   values (9301, 'Estándar', 'PAM', 'NUEVA', 100000, '00000000-0000-4000-8000-0000000e0001', array[7]::smallint[]),
                          (9301, 'Estándar', 'PAM', 'NUEVA', 150000, '00000000-0000-4000-8000-0000000e0002', null)$q$,
                 'E2 tarifas por grupo en una vigencia sin tarifas de todos los días');
select t293.ok((select count(*) = 2 from public.tarifa_hotel
                where temporada = 'NUEVA' and ((grupo_id = '00000000-0000-4000-8000-0000000e0001' and grupo_dias = array[1,2,3,4]::smallint[])
                   or (grupo_id = '00000000-0000-4000-8000-0000000e0002' and grupo_dias = array[5,6,7]::smallint[]))),
               'E3 grupo_dias lo fija el grupo (se ignora lo que mande el cliente)');
select t293.falla($q$insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble, grupo_id)
                   values (9301, 'Estándar', 'PAM', 'NUEVA', 99000, '00000000-0000-4000-8000-0000000e0001')$q$,
                  'tarifa_hotel_grupo_clave_uq', 'E4 clave repetida con grupo (índice parcial)');
select t293.falla($q$insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble)
                   values (9301, 'Superior', 'PC', 'NUEVA', 99000)$q$,
                  'por grupo de días', 'E5 tarifa de todos los días en una vigencia con tarifas por grupo');
select t293.falla($q$insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble, grupo_id)
                   values (9301, 'Superior', 'PC', 'BAJA', 99000, '00000000-0000-4000-8000-0000000e0001')$q$,
                  'no coincide', 'E6 tarifa con grupo de otra vigencia');
select t293.falla($q$insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble, grupo_id)
                   values (9303, 'Superior', 'PC', 'NUEVA', 99000, '00000000-0000-4000-8000-0000000e0001')$q$,
                  'no coincide', 'E7 tarifa con grupo de otro hotel');
update public.hotel_temporada_grupos set dias = array[1,2,3] where id = '00000000-0000-4000-8000-0000000e0001';
select t293.ok((select grupo_dias = array[1,2,3]::smallint[] from public.tarifa_hotel
                where grupo_id = '00000000-0000-4000-8000-0000000e0001'),
               'E8 cambiar los días del grupo actualiza la copia de la tarifa');
select t293.ok((select count(*) = 1 from public.tarifa_hotel_historial h
                where h.datos->>'grupo_id' = '00000000-0000-4000-8000-0000000e0001'
                  and h.datos->'grupo_dias' = '[1,2,3,4]'::jsonb),
               'E9 el historial conserva la versión anterior con su grupo y sus días (1–4)');
select t293.falla($q$delete from public.hotel_temporada_grupos where id = '00000000-0000-4000-8000-0000000e0001'$q$,
                  'foreign key|llave foránea|violates', 'E10 borrar un grupo con tarifas (restrict)');
select t293.pasa($q$update public.hotel_temporadas set nombre = 'NUEVA 2' where id = 930105;
                    update public.tarifa_hotel set temporada = 'NUEVA 2' where hotel_id = 9301 and temporada = 'NUEVA'$q$,
                 'E11 renombrar una vigencia con tarifas por grupo con la cascada de actualizarTemporada');
rollback;
select t293.ok((select count(*) = 0 from public.hotel_temporada_grupos where temporada_id = 930105)
               and exists (select 1 from pg_constraint where conname = 'hotel_temporada_grupos_inactivos_43'),
               'E12 la simulación no dejó rastro (candado de inactividad intacto)');

-- ── F. RLS y permisos (mismos que tarifa_hotel) ───────────────────────────────────
-- Operaciones de Mayorista: lee y escribe.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false), set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);  -- ambas claves: auth.uid() moderno y el antiguo de la imagen local
set role authenticated;
select t293.ok((select count(*) = 2 from public.hotel_temporada_grupos), 'F1 operaciones (mayorista) lee los grupos');
select t293.pasa($q$insert into public.hotel_temporada_grupos (id, temporada_id, nombre, dias)
                   values ('00000000-0000-4000-8000-0000000f0001', 930102, 'Semana', array[1,2,3,4])$q$, 'F2 operaciones (mayorista) crea un grupo');
select t293.falla($q$update public.hotel_temporada_grupos set activo = true where id = '00000000-0000-4000-8000-0000000f0001'$q$,
                  'inactivos_43', 'F3 operaciones tampoco puede activarlo');
select t293.pasa($q$delete from public.hotel_temporada_grupos where id = '00000000-0000-4000-8000-0000000f0001'$q$, 'F4 operaciones (mayorista) borra un grupo sin tarifas');
reset role;
-- Operaciones de Minorista: lee (como tarifa_hotel) pero no escribe el catálogo global.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009303","session_id":"00000000-0000-4000-8000-00000000a303","role":"authenticated"}', false), set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009303', false);  -- ambas claves: auth.uid() moderno y el antiguo de la imagen local
set role authenticated;
select t293.ok((select count(*) = 2 from public.hotel_temporada_grupos), 'F5 operaciones (minorista) lee los grupos, igual que tarifa_hotel');
select t293.falla($q$insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (930102, 'Semana', array[1])$q$,
                  'row-level security|seguridad', 'F6 operaciones (minorista) no escribe el catálogo global');
reset role;
-- Venta: no ve ni escribe (igual que tarifa_hotel).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009304","session_id":"00000000-0000-4000-8000-00000000a304","role":"authenticated"}', false), set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009304', false);  -- ambas claves: auth.uid() moderno y el antiguo de la imagen local
set role authenticated;
select t293.ok((select count(*) = 0 from public.hotel_temporada_grupos) and (select count(*) = 0 from public.tarifa_hotel),
               'F7 venta no ve grupos (ni tarifas netas, como hoy)');
select t293.falla($q$insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (930102, 'Semana', array[1])$q$,
                  'row-level security|seguridad', 'F8 venta no crea grupos');
reset role;
-- Superadmin con sesión en Mayorista: escribe.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009301","session_id":"00000000-0000-4000-8000-00000000a301","role":"authenticated"}', false), set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009301', false);  -- ambas claves: auth.uid() moderno y el antiguo de la imagen local
set role authenticated;
select t293.pasa($q$insert into public.hotel_temporada_grupos (id, temporada_id, nombre, dias)
                   values ('00000000-0000-4000-8000-0000000f0002', 930102, 'Semana', array[1,2,3,4]);
                   delete from public.hotel_temporada_grupos where id = '00000000-0000-4000-8000-0000000f0002'$q$,
                 'F9 superadmin (sesión Mayorista) crea y borra un grupo');
reset role;
-- Anónimo: sin acceso alguno.
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
set role anon;
select t293.falla($q$select count(*) from public.hotel_temporada_grupos$q$, 'permission denied|permiso denegado', 'F10 anon no lee la tabla');
reset role;
select t293.ok(not has_function_privilege('authenticated', 'public.t43_60_candado_hotel(bigint, boolean)', 'execute')
               and not has_function_privilege('anon', 'public.tg_tarifa_hotel_grupo_43()', 'execute'),
               'F11 las funciones internas no son invocables por authenticated/anon');

-- ── G. Generación real de tarifas (RPC de la 203) sin cambios con la 293 ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009301","session_id":"00000000-0000-4000-8000-00000000a301","role":"authenticated"}', false), set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009301', false);  -- ambas claves: auth.uid() moderno y el antiguo de la imagen local
set role authenticated;
select t293.pasa($q$select public.generar_tarifas_hotel_calculadora(9303,
  '[{"tipo_habitacion":"Estándar","alimentacion":"PAM","temporada":"ALTA","neto_sencilla":131000,"neto_doble":91000},
    {"tipo_habitacion":"Superior","alimentacion":"PAM","temporada":"ALTA","neto_sencilla":160000,"neto_doble":120000}]'::jsonb,
  (select jsonb_agg(to_jsonb(t)) from public.tarifa_hotel t where hotel_id = 9303), false, 'calculadora_generar')$q$,
  'G1 generar tarifas con la calculadora (huella de previas con las columnas nuevas)');
select t293.pasa($q$select public.generar_tarifas_hotel_calculadora(9303,
  '[{"tipo_habitacion":"Estándar","alimentacion":"PAM","temporada":"ALTA","neto_sencilla":130000,"neto_doble":90000}]'::jsonb,
  (select jsonb_agg(to_jsonb(t)) from public.tarifa_hotel t where hotel_id = 9303), true, 'calculadora_reemplazar_todo')$q$,
  'G2 reemplazar todas las tarifas del hotel');
reset role;
select t293.ok((select count(*) = 1 and bool_and(neto_doble = 90000 and grupo_id is null and grupo_dias is null)
                from public.tarifa_hotel where hotel_id = 9303),
               'G3 resultado de la generación: una tarifa de todos los días, sin grupo');

-- Limpieza del esquema auxiliar (los grupos de ALTA quedan para probar el rollback protegido).
drop schema t293 cascade;
