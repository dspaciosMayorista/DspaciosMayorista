-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA AUTO-VERIFICABLE — atomicidad de actualizar_control_bloqueo()
-- (migración 152)
--
-- ⚠️ Usa 'serie' (no 'individual') como valor de modalidad: la migración 155
-- amplía el dominio y la 157 lo cierra a solo serie/grupo — 'individual' deja
-- de ser válido en cuanto la 157 corre. Este script se pega DESPUÉS de la
-- 157 en la secuencia de despliegue, así que debe usar el valor vigente en
-- ese punto (mismo criterio de mecánica que probaba antes, solo el literal
-- cambia con el rename de la 155/157).
--
-- Corre contra una base local construida con `local-desde-cero.sh` (o en el
-- editor SQL de Supabase, DE SOLO LECTURA: termina en ROLLBACK). Se ejecuta
-- así, para que un fallo real corte la ejecución en vez de seguir de largo:
--
--   psql -v ON_ERROR_STOP=1 -f supabase/scripts/test_control_bloqueo_atomico.sql <conn>
--
-- Cada caso es una ASERCIÓN real, no una exhibición: si el resultado no es
-- el esperado, el script aborta con RAISE EXCEPTION (nunca RAISE NOTICE) y
-- psql sale con código distinto de cero por ON_ERROR_STOP=1. Los casos que
-- DEBEN fallar comprueban además el SQLSTATE/mensaje exactos — así un error
-- accidental (de conexión, de sintaxis, de otra tabla) no se confunde con el
-- rechazo esperado. Si TODO pasa, termina con un solo RAISE NOTICE de
-- resumen y hace ROLLBACK: no deja fixtures.
--
-- Cobertura (reemplaza el patrón viejo — SELECT + UPDATE + INSERT como tres
-- llamadas sueltas de supabase-js, sin transacción entre ellas):
--
--   1. Cambio correcto → los tres campos quedan EXACTOS, y se registra
--      EXACTAMENTE un historial con el detalle antes→después correcto
--      (los tres campos cambiaron: null → valor, "Sin definir" en el texto).
--   2. Fallo forzado del INSERT del historial (trigger temporal de prueba,
--      no toca el esquema real) → la excepción se propaga con el mensaje
--      del trigger, Y el UPDATE también se revierte: los tres campos y el
--      historial quedan EXACTAMENTE como en el caso 1 (rollback completo).
--   3. Usuario sin permiso de escritura (`venta`, que sí puede LEER
--      bloqueos_vuelo) → rechazado con el mensaje esperado ("no encontrado
--      o sin permiso para verlo" — el `SELECT ... FOR UPDATE` ya exige
--      también la policy de UPDATE para poder bloquear la fila, así que el
--      rechazo ocurre ahí, no en el UPDATE posterior). No modifica nada ni
--      registra nada.
--   4. Nota SIN cambio de estado → NO toca bloqueos_vuelo (los tres campos
--      quedan intactos), pero SÍ registra un historial con detalle NULL y
--      la nota tal cual.
--   5. Dos cambios consecutivos → cada entrada del historial refleja el
--      antes→después REAL de ESE cambio puntual (no el estado original ni
--      el final) — se verifican los 4 registros completos, en orden, con
--      su detalle exacto.
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

-- Helper de aserción: aborta con RAISE EXCEPTION si actual <> esperado.
create function pg_temp.assert_eq(actual anyelement, expected anyelement, etiqueta text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'ASSERT FALLÓ (%): esperado=%, obtuvo=%', etiqueta, expected, actual;
  end if;
end;
$$;

-- ── Caso 1: cambio correcto — estado final + historial exactos ────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, true);

select public.actualizar_control_bloqueo(9201::bigint, 'serie', 'emitido', 'pendiente', '');

reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare
  v_row record;
  v_hist record;
  v_detalle_esperado text :=
    'Modalidad de emisión: Sin definir → Serie · '
    || 'Estado de emisión: Sin definir → Emitido · '
    || 'Estado de pago: Sin definir → Pendiente';
begin
  select modalidad_emision, estado_emision, estado_pago into v_row
    from public.bloqueos_vuelo where id = 9201;
  perform pg_temp.assert_eq(v_row.modalidad_emision, 'serie', 'caso 1: modalidad_emision');
  perform pg_temp.assert_eq(v_row.estado_emision, 'emitido', 'caso 1: estado_emision');
  perform pg_temp.assert_eq(v_row.estado_pago, 'pendiente', 'caso 1: estado_pago');

  perform pg_temp.assert_eq(
    (select count(*) from public.bloqueo_cambios where bloqueo_id = 9201), 1::bigint, 'caso 1: cantidad de historiales'
  );
  select detalle, nota, registrado_por into v_hist from public.bloqueo_cambios where bloqueo_id = 9201;
  perform pg_temp.assert_eq(v_hist.detalle, v_detalle_esperado, 'caso 1: detalle antes→después');
  perform pg_temp.assert_eq(v_hist.nota, null::text, 'caso 1: nota vacía queda null');
  perform pg_temp.assert_eq(v_hist.registrado_por, 'Control Vuelo', 'caso 1: registrado_por resuelto por auth.uid()');
end $$;

-- ── Caso 2: fallo forzado del INSERT del historial → rollback COMPLETO ────
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
declare
  v_lanzo boolean := false;
  v_msg text;
begin
  begin
    perform public.actualizar_control_bloqueo(9201::bigint, 'grupo', 'pendiente', 'pagado', 'FORZAR_FALLO_TEST');
  exception
    when others then
      v_lanzo := true;
      get stacked diagnostics v_msg = message_text;
      if sqlstate is distinct from 'P0001' or v_msg is distinct from 'Fallo forzado por la prueba' then
        raise exception 'ASSERT FALLÓ (caso 2): error inesperado sqlstate=% mensaje=%', sqlstate, v_msg;
      end if;
  end;
  if not v_lanzo then
    raise exception 'ASSERT FALLÓ (caso 2): el fallo forzado del historial debía propagar una excepción y no lo hizo';
  end if;
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

drop trigger _trg_forzar_fallo on public.bloqueo_cambios;

do $$
declare v_row record;
begin
  -- El UPDATE también debe haberse revertido: los tres campos siguen como
  -- en el caso 1 (individual/emitido/pendiente), NO como 'grupo'/'pendiente'/
  -- 'pagado' que llevaba el intento fallido.
  select modalidad_emision, estado_emision, estado_pago into v_row
    from public.bloqueos_vuelo where id = 9201;
  perform pg_temp.assert_eq(v_row.modalidad_emision, 'serie', 'caso 2: modalidad_emision NO debía cambiar');
  perform pg_temp.assert_eq(v_row.estado_emision, 'emitido', 'caso 2: estado_emision NO debía cambiar');
  perform pg_temp.assert_eq(v_row.estado_pago, 'pendiente', 'caso 2: estado_pago NO debía cambiar');
  perform pg_temp.assert_eq(
    (select count(*) from public.bloqueo_cambios where bloqueo_id = 9201), 1::bigint,
    'caso 2: el historial debía seguir en 1 (el fallido no debía quedar registrado)'
  );
end $$;

-- ── Caso 3: usuario SIN permiso de escritura (venta lee, no escribe) ──────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','66666666-6666-6666-6666-666666666666','role','authenticated')::text, true);

do $$
declare
  v_lanzo boolean := false;
  v_msg text;
begin
  begin
    perform public.actualizar_control_bloqueo(9201::bigint, 'grupo', 'pendiente', 'pagado', '');
  exception
    when others then
      v_lanzo := true;
      get stacked diagnostics v_msg = message_text;
      if sqlstate is distinct from 'P0001' or v_msg is distinct from 'Bloqueo no encontrado o sin permiso para verlo.' then
        raise exception 'ASSERT FALLÓ (caso 3): error inesperado sqlstate=% mensaje=%', sqlstate, v_msg;
      end if;
  end;
  if not v_lanzo then
    raise exception 'ASSERT FALLÓ (caso 3): venta sin permiso debía ser rechazada y no lo fue';
  end if;
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare v_row record;
begin
  select modalidad_emision, estado_emision, estado_pago into v_row
    from public.bloqueos_vuelo where id = 9201;
  perform pg_temp.assert_eq(v_row.modalidad_emision, 'serie', 'caso 3: modalidad_emision NO debía cambiar');
  perform pg_temp.assert_eq(v_row.estado_emision, 'emitido', 'caso 3: estado_emision NO debía cambiar');
  perform pg_temp.assert_eq(v_row.estado_pago, 'pendiente', 'caso 3: estado_pago NO debía cambiar');
  perform pg_temp.assert_eq(
    (select count(*) from public.bloqueo_cambios where bloqueo_id = 9201), 1::bigint,
    'caso 3: el historial debía seguir en 1 (venta no pudo registrar nada)'
  );
end $$;

-- ── Caso 4: nota SIN cambio de estado — solo se registra la nota ─────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, true);

select public.actualizar_control_bloqueo(9201::bigint, 'serie', 'emitido', 'pendiente', 'Solo una nota, sin cambios');

reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare v_row record; v_hist record;
begin
  select modalidad_emision, estado_emision, estado_pago into v_row
    from public.bloqueos_vuelo where id = 9201;
  perform pg_temp.assert_eq(v_row.modalidad_emision, 'serie', 'caso 4: modalidad_emision NO debía tocarse');
  perform pg_temp.assert_eq(v_row.estado_emision, 'emitido', 'caso 4: estado_emision NO debía tocarse');
  perform pg_temp.assert_eq(v_row.estado_pago, 'pendiente', 'caso 4: estado_pago NO debía tocarse');

  perform pg_temp.assert_eq(
    (select count(*) from public.bloqueo_cambios where bloqueo_id = 9201), 2::bigint, 'caso 4: cantidad de historiales'
  );
  select detalle, nota into v_hist from public.bloqueo_cambios where bloqueo_id = 9201 order by id desc limit 1;
  perform pg_temp.assert_eq(v_hist.detalle, null::text, 'caso 4: detalle debe quedar null (nada cambió)');
  perform pg_temp.assert_eq(v_hist.nota, 'Solo una nota, sin cambios', 'caso 4: nota tal cual');
end $$;

-- ── Caso 5: dos cambios consecutivos — antes→después real en cada uno ────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, true);

select public.actualizar_control_bloqueo(9201::bigint, 'serie', 'emitido', 'pagado', '');
select public.actualizar_control_bloqueo(9201::bigint, 'grupo', 'emitido', 'pagado', '');

reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare v_row record;
begin
  select modalidad_emision, estado_emision, estado_pago into v_row
    from public.bloqueos_vuelo where id = 9201;
  perform pg_temp.assert_eq(v_row.modalidad_emision, 'grupo', 'caso 5: estado final modalidad_emision');
  perform pg_temp.assert_eq(v_row.estado_emision, 'emitido', 'caso 5: estado final estado_emision');
  perform pg_temp.assert_eq(v_row.estado_pago, 'pagado', 'caso 5: estado final estado_pago');
end $$;

do $$
declare
  v_ids bigint[];
  v_detalles text[];
begin
  perform pg_temp.assert_eq(
    (select count(*) from public.bloqueo_cambios where bloqueo_id = 9201), 4::bigint,
    'caso 5: cantidad total de historiales tras los 5 casos'
  );
  select array_agg(id order by id), array_agg(detalle order by id)
    into v_ids, v_detalles
    from public.bloqueo_cambios where bloqueo_id = 9201;

  -- Registro 3 (el primero de este caso): solo cambió estado_pago.
  perform pg_temp.assert_eq(
    v_detalles[3], 'Estado de pago: Pendiente → Pagado', 'caso 5: detalle del 1er cambio (solo estado_pago)'
  );
  -- Registro 4 (el segundo de este caso): solo cambió modalidad_emision —
  -- estado_emision/estado_pago ya estaban en 'emitido'/'pagado', no se
  -- repiten en el detalle aunque se reenviaron con el mismo valor.
  perform pg_temp.assert_eq(
    v_detalles[4], 'Modalidad de emisión: Serie → Grupo', 'caso 5: detalle del 2do cambio (solo modalidad)'
  );
end $$;

do $$
begin
  raise notice 'TODAS LAS PRUEBAS PASARON: test_control_bloqueo_atomico.sql (5 casos)';
end $$;

rollback;
