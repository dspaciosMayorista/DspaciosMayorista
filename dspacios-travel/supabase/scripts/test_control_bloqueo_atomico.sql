-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA — atomicidad de actualizar_control_bloqueo() (migración 151)
--
-- Corre contra una base local construida con `local-desde-cero.sh` (o en el
-- editor SQL de Supabase, DE SOLO LECTURA: termina en ROLLBACK). Comprueba
-- que el RPC reemplaza correctamente el patrón viejo (SELECT + UPDATE +
-- INSERT como tres llamadas sueltas de supabase-js, sin transacción entre
-- ellas):
--
--   1. Cambio correcto → actualiza los tres campos y registra EXACTAMENTE
--      un historial con el antes→después esperado.
--   2. Fallo forzado del INSERT del historial (trigger temporal de prueba,
--      no toca el esquema real) → el UPDATE también se revierte: los tres
--      campos quedan EXACTAMENTE como antes del intento.
--   3. Usuario sin permiso de escritura (`venta`, que sí puede LEER
--      bloqueos_vuelo) → no modifica nada ni registra nada. Nota: Postgres
--      exige que `SELECT ... FOR UPDATE` pase también la policy de UPDATE
--      (no solo la de SELECT) para poder bloquear la fila, así que en este
--      caso el rechazo ocurre ya en el SELECT ... FOR UPDATE — se documenta
--      aquí para que no sorprenda al leer el resultado.
--   4. Nota SIN cambio de estado → NO toca bloqueos_vuelo, pero SÍ registra
--      un historial con detalle en null y la nota.
--   5. Dos cambios consecutivos → cada entrada del historial refleja el
--      antes→después REAL de ESE cambio puntual (no el estado original ni
--      el final).
-- ─────────────────────────────────────────────────────────────────────────

begin;

insert into auth.users (id, email) values ('55555555-5555-5555-5555-555555555555', 'cv@test.com');
insert into public.usuarios (id, email, nombre, rol, activo) values
  ('55555555-5555-5555-5555-555555555555', 'cv@test.com', 'Control Vuelo', 'control_vuelo', true)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo;

insert into auth.users (id, email) values ('66666666-6666-6666-6666-666666666666', 'venta@test.com');
insert into public.usuarios (id, email, nombre, rol, activo) values
  ('66666666-6666-6666-6666-666666666666', 'venta@test.com', 'Venta', 'venta', true)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo;

insert into public.bloqueos_vuelo (id, record, cupos_total) values (9201, 'ATOMIC1', 5);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, true);

-- ── 1) Cambio correcto: actualiza y registra EXACTAMENTE un historial ─────
select public.actualizar_control_bloqueo(9201::bigint, 'individual', 'emitido', 'pendiente', '');
select 'caso 1: estado tras cambio correcto' as caso, modalidad_emision, estado_emision, estado_pago
  from public.bloqueos_vuelo where id = 9201;
select 'caso 1: historial' as caso, count(*) as n, string_agg(detalle, ' | ') as detalles
  from public.bloqueo_cambios where bloqueo_id = 9201;

reset role;
select set_config('request.jwt.claims', null, true);

-- ── 2) Fallo forzado del historial: deja los TRES estados sin cambios ─────
-- Trigger temporal (solo dentro de esta transacción) que revienta el INSERT
-- en bloqueo_cambios cuando la nota trae el centinela de prueba.
create or replace function pg_temp._forzar_fallo_historial() returns trigger
language plpgsql as $$
begin
  if new.nota = 'FORZAR_FALLO_TEST' then
    raise exception 'Fallo forzado por la prueba';
  end if;
  return new;
end;
$$;
create trigger _trg_forzar_fallo before insert on public.bloqueo_cambios
  for each row execute function pg_temp._forzar_fallo_historial();

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, true);

do $$
begin
  begin
    perform public.actualizar_control_bloqueo(9201::bigint, 'grupo', 'pendiente', 'pagado', 'FORZAR_FALLO_TEST');
    raise notice 'ERROR DE PRUEBA: no lanzó excepción';
  exception when others then
    raise notice 'OK: fallo forzado del historial lanzó excepción esperada: %', sqlerrm;
  end;
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

select 'caso 2: estado tras fallo forzado (debe = caso 1)' as caso, modalidad_emision, estado_emision, estado_pago
  from public.bloqueos_vuelo where id = 9201;
select 'caso 2: historial (debe seguir en 1)' as caso, count(*) as n from public.bloqueo_cambios where bloqueo_id = 9201;

drop trigger _trg_forzar_fallo on public.bloqueo_cambios;

-- ── 3) Usuario SIN permiso (venta puede leer, no escribir): no modifica ni registra ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','66666666-6666-6666-6666-666666666666','role','authenticated')::text, true);

do $$
begin
  begin
    perform public.actualizar_control_bloqueo(9201::bigint, 'grupo', 'pendiente', 'pagado', '');
    raise notice 'ERROR DE PRUEBA: venta pudo escribir';
  exception when others then
    raise notice 'OK: venta sin permiso lanzó excepción esperada: %', sqlerrm;
  end;
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

select 'caso 3: estado tras intento de venta (debe = caso 1)' as caso, modalidad_emision, estado_emision, estado_pago
  from public.bloqueos_vuelo where id = 9201;
select 'caso 3: historial (debe seguir en 1)' as caso, count(*) as n from public.bloqueo_cambios where bloqueo_id = 9201;

-- ── 4) Nota SIN cambio de estado: registra SOLO la nota (detalle en null) ─
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, true);

select public.actualizar_control_bloqueo(9201::bigint, 'individual', 'emitido', 'pendiente', 'Solo una nota, sin cambios');
select 'caso 4: estado (NO debe cambiar)' as caso, modalidad_emision, estado_emision, estado_pago
  from public.bloqueos_vuelo where id = 9201;
select 'caso 4: último historial' as caso, detalle, nota from public.bloqueo_cambios
  where bloqueo_id = 9201 order by id desc limit 1;

-- ── 5) Dos cambios consecutivos: antes/después correctos en cada uno ─────
select public.actualizar_control_bloqueo(9201::bigint, 'individual', 'emitido', 'pagado', '');
select public.actualizar_control_bloqueo(9201::bigint, 'grupo', 'emitido', 'pagado', '');

reset role;
select set_config('request.jwt.claims', null, true);

select 'caso 5: historial completo en orden' as caso, id, detalle, nota from public.bloqueo_cambios
  where bloqueo_id = 9201 order by id;

rollback;
