-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA AUTO-VERIFICABLE — Empaquetados (migraciones 155/156/157)
--
-- Corre contra una base local construida replayando supabase/migrations/
-- (ver el stub de auth/storage usado en este repo para pruebas locales). DE
-- SOLO LECTURA: termina en ROLLBACK, no deja fixtures.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/scripts/test_empaquetados.sql <conn>
--
-- Cada caso es una ASERCIÓN real (pg_temp.assert_eq, mismo helper que
-- test_control_bloqueo_atomico.sql): si el resultado no es el esperado, el
-- script aborta con RAISE EXCEPTION y psql sale con código distinto de cero.
--
-- Cobertura (responde directamente a los 9 defectos de la revisión de PR #268):
--   A. Migración 155→157: el CHECK de bloqueos_vuelo.modalidad_emision pasó
--      por individual+serie+grupo (transición) y terminó en solo serie/grupo
--      (cierre) — se verifica el estado FINAL del constraint.
--   B. CHECK de empaquetados: tarifas negativas, fecha_regreso < fecha_ida,
--      compra_fin < compra_inicio — los tres deben RECHAZARSE (defecto 6).
--   C. actualizar_control_empaquetado(): atomicidad (rollback si falla el
--      historial), preserva NULL en estado_emision/estado_pago si no se
--      tocan (defecto 7), rechazado para un rol sin permiso de escritura
--      (venta lee, no escribe), nota sin cambio de estado, dos cambios
--      consecutivos con detalle antes→después real (mismo patrón que
--      actualizar_control_bloqueo).
--   D. Borrado seguro (defecto 4): un empaquetado vinculado a un paquete NO
--      se puede borrar (ON DELETE RESTRICT) — falla con el error de FK de
--      Postgres; desvinculado, sí se borra.
--   E. Falso éxito (defecto 5): un UPDATE de `empaquetados` con un rol SIN
--      permiso de escritura (venta) afecta CERO filas — la base fáctica de
--      la que depende `.select("id").maybeSingle()` en la Server Action
--      para no reportar éxito ante 0 filas afectadas.
--   F. Inactivo futuro vs activo (defecto 3): un empaquetado con
--      activo=false y fecha_ida futura NO debe aparecer en el filtro
--      "activo=true AND no pasado" que usa /dashboard/vuelos (page.tsx).
-- ─────────────────────────────────────────────────────────────────────────

begin;

create function pg_temp.assert_eq(actual anyelement, expected anyelement, etiqueta text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'ASSERT FALLÓ (%): esperado=%, obtuvo=%', etiqueta, expected, actual;
  end if;
end;
$$;

-- ── Fixtures: usuarios de prueba (operaciones puede escribir, venta solo lee) ──
insert into auth.users (id, email) values ('77777777-7777-7777-7777-777777777777', 'op-emp@test.com');
insert into public.usuarios (id, email, nombre, rol, activo) values
  ('77777777-7777-7777-7777-777777777777', 'op-emp@test.com', 'Operaciones Empaquetados', 'operaciones', true)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo;

insert into auth.users (id, email) values ('88888888-8888-8888-8888-888888888888', 'venta-emp@test.com');
insert into public.usuarios (id, email, nombre, rol, activo) values
  ('88888888-8888-8888-8888-888888888888', 'venta-emp@test.com', 'Venta Empaquetados', 'venta', true)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo;

-- ═════════════════════════════════════════════════════════════════════════
-- A. Migración 155→157: modalidad_emision terminó cerrada a serie/grupo
-- ═════════════════════════════════════════════════════════════════════════
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'bloqueos_vuelo_modalidad_emision_check';
  perform pg_temp.assert_eq(
    v_def, $c$CHECK ((modalidad_emision = ANY (ARRAY['serie'::text, 'grupo'::text])))$c$,
    'A: el CHECK de modalidad_emision debe quedar cerrado a serie/grupo tras la 157'
  );
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- B. CHECK de empaquetados — tarifas/fechas inválidas se RECHAZAN
-- ═════════════════════════════════════════════════════════════════════════
do $$
declare v_lanzo boolean;
begin
  v_lanzo := false;
  begin
    insert into public.empaquetados (fecha_ida, tarifa_proveedor) values ('2026-09-01', -1);
  exception when check_violation then v_lanzo := true;
  end;
  perform pg_temp.assert_eq(v_lanzo, true, 'B1: tarifa_proveedor negativa debe rechazarse');

  v_lanzo := false;
  begin
    insert into public.empaquetados (fecha_ida, fecha_regreso) values ('2026-09-10', '2026-09-01');
  exception when check_violation then v_lanzo := true;
  end;
  perform pg_temp.assert_eq(v_lanzo, true, 'B2: fecha_regreso < fecha_ida debe rechazarse');

  v_lanzo := false;
  begin
    insert into public.empaquetados (fecha_ida, compra_inicio, compra_fin) values ('2026-09-10', '2026-06-01', '2026-05-01');
  exception when check_violation then v_lanzo := true;
  end;
  perform pg_temp.assert_eq(v_lanzo, true, 'B3: compra_fin < compra_inicio debe rechazarse');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- C. actualizar_control_empaquetado(): atomicidad, NULL preservado, RLS
-- ═════════════════════════════════════════════════════════════════════════
insert into public.empaquetados (id, fecha_ida, record, estado_emision, estado_pago)
  overriding system value
  values (9301, '2026-10-01', null, null, null);

-- C1: editar SOLO record — estado_emision/estado_pago (NULL) NO se tocan.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','77777777-7777-7777-7777-777777777777','role','authenticated')::text, true);

select public.actualizar_control_empaquetado(9301::bigint, 'ABC999', null, null, null);

reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare v_row record;
begin
  select record, estado_emision, estado_pago into v_row from public.empaquetados where id = 9301;
  perform pg_temp.assert_eq(v_row.record, 'ABC999', 'C1: record debe haber cambiado');
  perform pg_temp.assert_eq(v_row.estado_emision, null::text, 'C1: estado_emision debe SEGUIR null (defecto 7 — nunca se fuerza a pendiente)');
  perform pg_temp.assert_eq(v_row.estado_pago, null::text, 'C1: estado_pago debe SEGUIR null');
  perform pg_temp.assert_eq(
    (select count(*) from public.empaquetado_cambios where empaquetado_id = 9301), 1::bigint, 'C1: un historial'
  );
end $$;

-- C2: fallo forzado del INSERT del historial → rollback COMPLETO del UPDATE.
create or replace function pg_temp._forzar_fallo_emp() returns trigger
language plpgsql as $$
begin
  if new.nota = 'FORZAR_FALLO_TEST' then raise exception 'Fallo forzado por la prueba'; end if;
  return new;
end;
$$;
create trigger _trg_forzar_fallo_emp before insert on public.empaquetado_cambios
  for each row execute function pg_temp._forzar_fallo_emp();

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','77777777-7777-7777-7777-777777777777','role','authenticated')::text, true);

do $$
declare v_lanzo boolean := false; v_msg text;
begin
  begin
    perform public.actualizar_control_empaquetado(9301::bigint, 'ZZZ111', 'emitido', 'pagado', 'FORZAR_FALLO_TEST');
  exception when others then
    v_lanzo := true;
    get stacked diagnostics v_msg = message_text;
    if v_msg is distinct from 'Fallo forzado por la prueba' then
      raise exception 'ASSERT FALLÓ (C2): mensaje inesperado %', v_msg;
    end if;
  end;
  if not v_lanzo then raise exception 'ASSERT FALLÓ (C2): debía propagar la excepción forzada'; end if;
end $$;

reset role;
select set_config('request.jwt.claims', null, true);
drop trigger _trg_forzar_fallo_emp on public.empaquetado_cambios;

do $$
declare v_row record;
begin
  -- Ni record ni los estados debían cambiar — el UPDATE se revirtió con el INSERT fallido.
  select record, estado_emision, estado_pago into v_row from public.empaquetados where id = 9301;
  perform pg_temp.assert_eq(v_row.record, 'ABC999', 'C2: record NO debía cambiar (rollback)');
  perform pg_temp.assert_eq(v_row.estado_emision, null::text, 'C2: estado_emision NO debía cambiar (rollback)');
  perform pg_temp.assert_eq(
    (select count(*) from public.empaquetado_cambios where empaquetado_id = 9301), 1::bigint,
    'C2: el intento fallido NO debía quedar registrado'
  );
end $$;

-- C3: rol SIN permiso de escritura (venta lee empaquetados, no escribe).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','88888888-8888-8888-8888-888888888888','role','authenticated')::text, true);

do $$
declare v_lanzo boolean := false; v_msg text;
begin
  begin
    perform public.actualizar_control_empaquetado(9301::bigint, 'INTENTO', 'emitido', 'pagado', '');
  exception when others then
    v_lanzo := true;
    get stacked diagnostics v_msg = message_text;
  end;
  if not v_lanzo then raise exception 'ASSERT FALLÓ (C3): venta sin permiso debía ser rechazada'; end if;
  perform pg_temp.assert_eq(v_msg, 'Empaquetado no encontrado o sin permiso para verlo.', 'C3: mensaje de rechazo');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare v_row record;
begin
  select record, estado_emision into v_row from public.empaquetados where id = 9301;
  perform pg_temp.assert_eq(v_row.record, 'ABC999', 'C3: record NO debía cambiar');
  perform pg_temp.assert_eq(v_row.estado_emision, null::text, 'C3: estado_emision NO debía cambiar');
end $$;

-- C4: nota SIN cambio de estado → solo se registra la nota, detalle null.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','77777777-7777-7777-7777-777777777777','role','authenticated')::text, true);

select public.actualizar_control_empaquetado(9301::bigint, 'ABC999', null, null, 'Solo una nota');

reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare v_hist record;
begin
  perform pg_temp.assert_eq(
    (select count(*) from public.empaquetado_cambios where empaquetado_id = 9301), 2::bigint, 'C4: dos historiales'
  );
  select detalle, nota into v_hist from public.empaquetado_cambios where empaquetado_id = 9301 order by id desc limit 1;
  perform pg_temp.assert_eq(v_hist.detalle, null::text, 'C4: detalle debe quedar null (nada cambió)');
  perform pg_temp.assert_eq(v_hist.nota, 'Solo una nota', 'C4: nota tal cual');
end $$;

-- C5: round-trip NULL→valor→NULL — estado_emision puede volver a "Por confirmar"
-- explícitamente (no es un valor que solo se pueda subir, nunca bajar).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','77777777-7777-7777-7777-777777777777','role','authenticated')::text, true);

select public.actualizar_control_empaquetado(9301::bigint, 'ABC999', 'emitido', null, '');
select public.actualizar_control_empaquetado(9301::bigint, 'ABC999', null, null, '');

reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare v_row record;
begin
  select estado_emision into v_row from public.empaquetados where id = 9301;
  perform pg_temp.assert_eq(v_row.estado_emision, null::text, 'C5: estado_emision debe poder volver a null explícitamente');
  perform pg_temp.assert_eq(
    (select count(*) from public.empaquetado_cambios where empaquetado_id = 9301), 4::bigint, 'C5: cuatro historiales en total'
  );
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- D. Borrado seguro — vinculado a un paquete NO se puede borrar (RESTRICT)
-- ═════════════════════════════════════════════════════════════════════════
insert into public.armado_paquetes (id, nombre, tipo) overriding system value values (9302, 'Paquete test D', 'bloqueo');
insert into public.armado_empaquetados (paquete_id, empaquetado_id) values (9302, 9301);

do $$
declare v_lanzo boolean := false;
begin
  begin
    delete from public.empaquetados where id = 9301;
  exception when foreign_key_violation then v_lanzo := true;
  end;
  perform pg_temp.assert_eq(v_lanzo, true, 'D1: borrar un empaquetado vinculado debe fallar por FK (ON DELETE RESTRICT)');
end $$;

delete from public.armado_empaquetados where paquete_id = 9302 and empaquetado_id = 9301;

do $$
declare v_afectadas bigint;
begin
  delete from public.empaquetados where id = 9301;
  get diagnostics v_afectadas = row_count;
  perform pg_temp.assert_eq(v_afectadas, 1::bigint, 'D2: desvinculado, el borrado debe afectar exactamente 1 fila');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- E. Falso éxito — UPDATE con rol sin permiso de escritura afecta 0 filas
-- ═════════════════════════════════════════════════════════════════════════
insert into public.empaquetados (id, fecha_ida, notas) overriding system value values (9303, '2026-11-01', 'original');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','88888888-8888-8888-8888-888888888888','role','authenticated')::text, true);

do $$
declare v_afectadas bigint;
begin
  update public.empaquetados set notas = 'intento de venta' where id = 9303;
  get diagnostics v_afectadas = row_count;
  perform pg_temp.assert_eq(v_afectadas, 0::bigint,
    'E: un UPDATE de venta (sin policy de escritura) debe afectar 0 filas — la base de la que depende .select("id").maybeSingle() en actualizarEmpaquetado para NO reportar éxito falso');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare v_notas text;
begin
  select notas into v_notas from public.empaquetados where id = 9303;
  perform pg_temp.assert_eq(v_notas, 'original', 'E: las notas no debían cambiar tras el intento de venta');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- F. Inactivo futuro NO debe aparecer como activo (defecto 3)
-- ═════════════════════════════════════════════════════════════════════════
insert into public.empaquetados (id, fecha_ida, activo) overriding system value values
  (9304, current_date + 30, true),   -- activo, futuro → SÍ debe aparecer como activo
  (9305, current_date + 30, false),  -- inactivo, futuro → NO debe aparecer como activo
  (9306, current_date - 30, true);   -- activo, pasado → NO debe aparecer como activo (histórico)

do $$
declare v_activos bigint[];
begin
  -- Mismo filtro que app/(dashboard)/dashboard/vuelos/page.tsx: activo=true AND fecha_ida >= hoy.
  select array_agg(id order by id) into v_activos
    from public.empaquetados
   where id in (9304, 9305, 9306) and activo and fecha_ida >= current_date;
  perform pg_temp.assert_eq(v_activos, array[9304]::bigint[],
    'F: solo el empaquetado activo y futuro (9304) debe pasar el filtro "activos" — 9305 (inactivo-futuro) y 9306 (pasado) deben quedar fuera');
end $$;

do $$
begin
  raise notice 'TODAS LAS PRUEBAS PASARON: test_empaquetados.sql (secciones A-F)';
end $$;

rollback;
