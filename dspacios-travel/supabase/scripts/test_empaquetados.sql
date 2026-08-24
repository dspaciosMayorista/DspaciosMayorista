-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA AUTO-VERIFICABLE — Empaquetados (migraciones 155/156/158)
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
--   A. Migración 155→158: el CHECK de bloqueos_vuelo.modalidad_emision pasó
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
--   L. actualizar_control_empaquetado() y acceso_ventas_vuelo_sistema() —
--      cierre de EXECUTE de `anon` (ronda posterior, mismo hallazgo de la
--      consulta preventiva de producción que corrigió actualizar_control_
--      bloqueo() en las migraciones 155/158): simula el escenario real de
--      Supabase (GRANT explícito previo a `anon`, no solo ausencia de
--      default privileges locales), re-aplica el revoke/grant tal cual lo
--      escribe la migración 156, y confirma con has_function_privilege que
--      el ACL final queda anon=false/authenticated=true/PUBLIC=false para
--      AMBAS funciones — más la llamada directa de `anon` (permission
--      denied) y que `authenticated` sigue sujeto a RLS (EXECUTE no salta
--      las policies de las tablas subyacentes).
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

-- control_vuelo, tenant 'mayorista' — el rol con el gap reportado (hallazgo 2):
-- entra al módulo Vuelos pero no tenía SELECT sobre ventas.
insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999', 'control-emp@test.com');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('99999999-9999-9999-9999-999999999999', 'control-emp@test.com', 'Control Vuelo Empaquetados', 'control_vuelo', true, 'mayorista')
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;

-- ═════════════════════════════════════════════════════════════════════════
-- A. Migración 155→158: modalidad_emision terminó cerrada a serie/grupo
-- ═════════════════════════════════════════════════════════════════════════
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'bloqueos_vuelo_modalidad_emision_check';
  perform pg_temp.assert_eq(
    v_def, $c$CHECK ((modalidad_emision = ANY (ARRAY['serie'::text, 'grupo'::text])))$c$,
    'A: el CHECK de modalidad_emision debe quedar cerrado a serie/grupo tras la 158'
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

-- ═════════════════════════════════════════════════════════════════════════
-- G. CHECK de origen excluyente (defecto 1, "ORIGEN DOBLE" — revisión de
--    la ronda posterior al PR #268): ni `tarifario_resultado` ni `ventas`
--    pueden tener bloqueo_id/bloqueo_ref_id Y empaquetado_id/empaquetado_ref_id
--    a la vez. Última línea de defensa a nivel de BD — el discriminante de
--    `lib/reservar/origen.ts` ya lo impide en la aplicación, pero el CHECK
--    protege contra cualquier insert que no pase por ahí (ej. un script,
--    una migración de datos futura, un bug nuevo).
-- ═════════════════════════════════════════════════════════════════════════
insert into public.armado_paquetes (id, nombre, tipo) overriding system value values (9310, 'Paquete test G', 'bloqueo')
  on conflict (id) do nothing;
insert into public.bloqueos_vuelo (id, record, fecha_ida, cupos_total, tarifa_para_empaquetar, fecha_devolucion) overriding system value
  values (9310, 'TESTG1', current_date + 10, 1, 100000, current_date + 5)
  on conflict (id) do nothing;
insert into public.empaquetados (id, fecha_ida) overriding system value values (9310, current_date + 10)
  on conflict (id) do nothing;

do $$
declare v_lanzo boolean := false;
begin
  begin
    insert into public.tarifario_resultado (paquete_id, modulo, bloqueo_id, empaquetado_id)
    values (9310, 'bloqueo', 9310, 9310);
  exception when check_violation then v_lanzo := true;
  end;
  perform pg_temp.assert_eq(v_lanzo, true, 'G1: tarifario_resultado con bloqueo_id Y empaquetado_id a la vez debe RECHAZARSE');
end $$;

do $$
declare v_lanzo boolean := false;
begin
  begin
    insert into public.ventas (numero_contrato, cliente, bloqueo_ref_id, empaquetado_ref_id)
    values ('99-9998', 'Cliente prueba G', 9310, 9310);
  exception when check_violation then v_lanzo := true;
  end;
  perform pg_temp.assert_eq(v_lanzo, true, 'G2: ventas con bloqueo_ref_id Y empaquetado_ref_id a la vez debe RECHAZARSE');
end $$;

-- Confirma que CADA UNO por separado sí es válido (el CHECK no bloquea el
-- uso normal, solo la combinación de los dos).
do $$
begin
  insert into public.ventas (numero_contrato, cliente, empaquetado_ref_id) values ('99-9997', 'Cliente prueba G3', 9310);
  insert into public.ventas (numero_contrato, cliente, bloqueo_ref_id) values ('99-9996', 'Cliente prueba G4', 9310);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- H. Trazabilidad venta → empaquetado (defecto 4): la vista `ventas_basica`
--    (por la que navega el rol `venta`) expone `empaquetado_ref_id` para que
--    la pantalla del contrato pueda enlazar al Empaquetado de origen.
-- ═════════════════════════════════════════════════════════════════════════
do $$
declare v_ref bigint;
begin
  select empaquetado_ref_id into v_ref from public.ventas where numero_contrato = '99-9997';
  perform pg_temp.assert_eq(v_ref, 9310::bigint, 'H1: ventas.empaquetado_ref_id debe guardar el id del empaquetado de origen');
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','88888888-8888-8888-8888-888888888888','role','authenticated')::text, true);

do $$
declare v_ref bigint;
begin
  select empaquetado_ref_id into v_ref from public.ventas_basica where numero_contrato = '99-9997';
  perform pg_temp.assert_eq(v_ref, 9310::bigint, 'H2: ventas_basica (por la que navega el rol venta) debe exponer empaquetado_ref_id');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- ═════════════════════════════════════════════════════════════════════════
-- I. ventas_vuelo_sistema — RLS por rol y aislamiento ESTRICTO entre tenants
--    (revisión posterior al PR #268, hallazgo 2 "LISTA UNIFICADA Y RLS" +
--    ronda siguiente, hallazgo 1 "AISLAMIENTO DE GERENCIA"). La primera
--    versión de esta vista usaba `puede_ver_tenant()` — que le da a
--    `gerencia` alcance GLOBAL, igual que al resto del sistema — pero para
--    ESTA vista puntual se pidió que `gerencia` quede acotada a SU tenant,
--    igual que administracion/operaciones/control_vuelo, y que SOLO
--    `superadmin` conserve alcance global. La vista ahora usa
--    `acceso_ventas_vuelo_sistema()`, una función DEDICADA — `puede_ver_
--    tenant()` en sí NUNCA se tocó (sigue dando alcance global a `gerencia`
--    en todo el resto del sistema, sin cambios).
--
--    Matriz COMPLETA por rol, contra los mismos 3 fixtures de `ventas`:
--    superadmin (global) · gerencia mayorista/minorista (solo su tenant,
--    el caso central de este hallazgo) · administracion (solo su tenant) ·
--    operaciones (solo su tenant) · control_vuelo (solo su tenant, el gap
--    original de la ronda anterior) · venta (excluido, 0 filas) · usuario
--    INACTIVO (0 filas, aunque su rol guardado SÍ tendría acceso) · perfil
--    AUSENTE (0 filas) · anon (0 filas o rechazado antes de RLS).
-- ═════════════════════════════════════════════════════════════════════════
insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete) values
  ('99-9992', 'Cliente dinámico mayorista', 'mayorista', 'dinamico'),
  ('99-9991', 'Cliente dinámico minorista', 'minorista', 'dinamico');
insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete, empaquetado_ref_id) values
  ('99-9990', 'Cliente empaquetado mayorista', 'mayorista', 'bloqueo', 9310);

-- Fixtures de rol adicionales para la matriz (operaciones/venta/control_vuelo
-- ya existen más arriba en este script, con tenant 'mayorista').
insert into auth.users (id, email) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'superadmin-emp@test.com');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'superadmin-emp@test.com', 'Superadmin Empaquetados', 'superadmin', true, 'mayorista')
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;

insert into auth.users (id, email) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'gerencia-may-emp@test.com');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'gerencia-may-emp@test.com', 'Gerencia Mayorista Empaquetados', 'gerencia', true, 'mayorista')
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;

-- El caso CENTRAL de este hallazgo: gerencia de la OTRA agencia. Con
-- puede_ver_tenant() (versión anterior de la vista) esta usuaria vería LOS
-- 3 fixtures (alcance global) — con acceso_ventas_vuelo_sistema() debe ver
-- SOLO el suyo (99-9991).
insert into auth.users (id, email) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gerencia-min-emp@test.com');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gerencia-min-emp@test.com', 'Gerencia Minorista Empaquetados', 'gerencia', true, 'minorista')
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;

insert into auth.users (id, email) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin-emp@test.com');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin-emp@test.com', 'Administracion Empaquetados', 'administracion', true, 'mayorista')
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;

-- Usuario INACTIVO: rol con acceso normal (gerencia, tenant mayorista) pero
-- activo=false — por migración 140, mi_rol() no devuelve rol si activo es
-- false, así que debe dar CERO filas sin importar qué rol tenga guardado.
insert into auth.users (id, email) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'inactivo-emp@test.com');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'inactivo-emp@test.com', 'Inactivo Empaquetados', 'gerencia', false, 'mayorista')
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;

-- Perfil AUSENTE: `auth.uid()` en este stub lee el claim `sub` del JWT
-- directamente (request.jwt.claims), sin depender de ninguna fila en
-- auth.users ni en public.usuarios — así que ni siquiera hace falta
-- insertar en auth.users: un UUID fresco, nunca usado en ningún lado, ya
-- reproduce "perfil ausente" tal cual.

create function pg_temp.assert_ventas_vuelo_sistema(p_uid text, p_esperado text[], p_etiqueta text)
returns void language plpgsql as $$
declare v_contratos text[];
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  select array_agg(numero_contrato order by numero_contrato) into v_contratos
    from public.ventas_vuelo_sistema
   where numero_contrato in ('99-9992', '99-9991', '99-9990');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_contratos is distinct from p_esperado then
    raise exception 'ASSERT FALLÓ (%): esperado=%, obtuvo=%', p_etiqueta, p_esperado, v_contratos;
  end if;
end;
$$;

-- superadmin: alcance GLOBAL — ve los 3 fixtures, de AMBOS tenants.
select pg_temp.assert_ventas_vuelo_sistema(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', array['99-9990','99-9991','99-9992']::text[],
  'I1: superadmin debe ver los 3 fixtures (alcance global, sin comparar tenant)'
);

-- gerencia mayorista: SOLO su tenant — nunca 99-9991 (minorista).
select pg_temp.assert_ventas_vuelo_sistema(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', array['99-9990','99-9992']::text[],
  'I2: gerencia (tenant mayorista) debe ver SOLO su tenant — NUNCA 99-9991 (minorista). Con puede_ver_tenant() (versión anterior) habría visto los 3 — este es el caso CENTRAL del hallazgo'
);

-- gerencia minorista: el espejo de la I2 — SOLO 99-9991, nunca los 2 de mayorista.
select pg_temp.assert_ventas_vuelo_sistema(
  'cccccccc-cccc-cccc-cccc-cccccccccccc', array['99-9991']::text[],
  'I3: gerencia (tenant minorista) debe ver SOLO su tenant — NUNCA 99-9990/99-9992 (mayorista)'
);

-- administracion: mismo criterio que gerencia (solo su tenant, nunca global).
select pg_temp.assert_ventas_vuelo_sistema(
  'dddddddd-dddd-dddd-dddd-dddddddddddd', array['99-9990','99-9992']::text[],
  'I4: administracion (tenant mayorista) debe ver SOLO su tenant'
);

-- operaciones: mismo criterio (fixture 'op-emp', ya creado más arriba, tenant mayorista).
select pg_temp.assert_ventas_vuelo_sistema(
  '77777777-7777-7777-7777-777777777777', array['99-9990','99-9992']::text[],
  'I5: operaciones (tenant mayorista) debe ver SOLO su tenant'
);

-- control_vuelo: el gap ORIGINAL reportado en la ronda anterior — sigue viendo su tenant.
select pg_temp.assert_ventas_vuelo_sistema(
  '99999999-9999-9999-9999-999999999999', array['99-9990','99-9992']::text[],
  'I6: control_vuelo (tenant mayorista) debe ver 99-9992 (dinámico) y 99-9990 (empaquetado_ref_id) — NUNCA 99-9991 (minorista)'
);

-- venta: excluido a propósito del set de roles — 0 filas.
select pg_temp.assert_ventas_vuelo_sistema(
  '88888888-8888-8888-8888-888888888888', null::text[],
  'I7: venta NO debe ver NINGUNA fila — excluido a propósito del set de roles (no entra al módulo Vuelos)'
);

-- usuario INACTIVO (rol gerencia, activo=false): 0 filas — mi_rol() no
-- devuelve rol si activo=false (migración 140), así que ninguna rama del
-- OR de acceso_ventas_vuelo_sistema() puede ser verdadera.
select pg_temp.assert_ventas_vuelo_sistema(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', null::text[],
  'I8: usuario inactivo (rol gerencia guardado, activo=false) debe ver 0 filas'
);

-- perfil AUSENTE (UUID nunca insertado en usuarios ni en auth.users): 0
-- filas — mi_rol() debe devolver NULL, nunca colar un rol por accidente.
select pg_temp.assert_ventas_vuelo_sistema(
  'ffffffff-ffff-ffff-ffff-ffffffffffff', null::text[],
  'I9: perfil ausente (sin fila en public.usuarios) debe ver 0 filas'
);

-- Origen calculado correcto (independiente de la matriz de roles — se
-- verifica una vez, impersonando control_vuelo).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','99999999-9999-9999-9999-999999999999','role','authenticated')::text, true);

do $$
declare v_origen text;
begin
  select origen into v_origen from public.ventas_vuelo_sistema where numero_contrato = '99-9990';
  perform pg_temp.assert_eq(v_origen, 'empaquetado'::text, 'I10: el origen calculado debe ser ''empaquetado'' cuando empaquetado_ref_id no es null');
  select origen into v_origen from public.ventas_vuelo_sistema where numero_contrato = '99-9992';
  perform pg_temp.assert_eq(v_origen, 'dinamico'::text, 'I11: el origen calculado debe ser ''dinamico'' para tipo_paquete=''dinamico'' sin empaquetado_ref_id');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- Ningún rol (incl. control_vuelo) debe alcanzar precio_venta/cliente/costo
-- — ni siquiera pidiéndolo directo por PostgREST: la vista no tiene esas
-- columnas, así que no hay `select *` que las devuelva por accidente.
do $$
declare v_cols bigint;
begin
  select count(*) into v_cols
    from information_schema.columns
   where table_name = 'ventas_vuelo_sistema'
     and column_name in ('cliente', 'precio_venta', 'costo_hotel', 'costo_aereo', 'comision_b2b', 'cliente_documento', 'cliente_telefono', 'cliente_email');
  perform pg_temp.assert_eq(v_cols, 0::bigint, 'I12: ventas_vuelo_sistema no debe tener NINGUNA columna financiera/PII');
end $$;

-- anon: sin JWT, rol de Postgres 'anon' (sin GRANT sobre la vista — solo se
-- otorgó a 'authenticated'). Debe dar 0 filas, ya sea porque la consulta
-- vacía o porque Postgres la rechaza ANTES de evaluar RLS (permission
-- denied) — cualquiera de los dos casos es 0 filas alcanzables.
set local role anon;
select set_config('request.jwt.claims', '{}', true);

do $$
declare v_n bigint := -1;
begin
  begin
    select count(*) into v_n
      from public.ventas_vuelo_sistema
     where numero_contrato in ('99-9992', '99-9991', '99-9990');
  exception when insufficient_privilege then
    v_n := 0;
  end;
  perform pg_temp.assert_eq(v_n, 0::bigint, 'I13: anon debe ver 0 filas (select vacío, o rechazado con permission denied antes de RLS)');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- ═════════════════════════════════════════════════════════════════════════
-- J. ventas_vuelo_sistema — detalle aéreo desde contrato_vuelos, UNA fila
--    por contrato, sin inventar datos, sin mezclar contratos (ronda
--    siguiente, hallazgo 1 "CONECTAR CONTRATO_VUELOS CON LA LISTA").
--    Reutiliza los fixtures de `ventas` de la sección I: 99-9992 (dinámico,
--    mayorista), 99-9990 (empaquetado_ref_id, mayorista), 99-9991 (dinámico,
--    minorista — SIN contrato_vuelos, prueba el caso "histórico sin
--    tramos"). Se agrega 99-9989 (dinámico, mayorista) para probar que dos
--    contratos nunca se mezclan.
-- ═════════════════════════════════════════════════════════════════════════
insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete) values
  ('99-9989', 'Cliente dinámico mayorista 2', 'mayorista', 'dinamico');

-- 99-9992: contrato dinámico FUTURO con tramos ida/regreso reales (lo que
-- inserta el paso 7 de reservar/actions.ts, origen.tipo === "salida") — MÁS
-- un tercer tramo 'ida' con `orden` mayor, simulando una anomalía de datos
-- (nunca debería ocurrir en un contrato normal), para probar que la vista
-- sigue devolviendo EXACTAMENTE una fila por contrato (J2) tomando siempre
-- el de menor `orden`.
insert into public.contrato_vuelos (numero_contrato, aerolinea, record, direccion, origen_codigo, destino_codigo, numero_vuelo, hora_salida, hora_llegada, fecha_salida, orden) values
  ('99-9992', 'JetSMART', 'ABC123', 'ida',     'MDE', 'CTG', 'JA101', '08:00', '09:00', current_date + 10, 0),
  ('99-9992', 'JetSMART', 'ABC123', 'regreso', 'CTG', 'MDE', 'JA102', '18:00', '19:00', current_date + 13, 1),
  ('99-9992', 'JetSMART', 'ZZZ999', 'ida',     'BOG', 'PEI', 'XX000', '00:00', '00:00', current_date + 99, 9);

-- 99-9990: contrato reservado desde un Empaquetado — SOLO tramo de ida (caso
-- real: un empaquetado one-way), SIN record todavía (no se ha comprado/
-- emitido) — prueba que `record` sale NULL cuando de verdad no existe, y que
-- `ruta`/`vuelo_regreso` no inventan un tramo de regreso que no hay.
insert into public.contrato_vuelos (numero_contrato, aerolinea, record, direccion, origen_codigo, destino_codigo, numero_vuelo, hora_salida, hora_llegada, fecha_salida, orden) values
  ('99-9990', 'Wingo', null, 'ida', 'MDE', 'SMR', 'WJ55', '07:00', '08:15', current_date + 5, 0);

-- 99-9989: OTRO contrato dinámico, mismo tenant que 99-9992 — con un
-- vuelo/ruta DISTINTO, para confirmar que la vista nunca cruza tramos entre
-- dos contratos (J5).
insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion, origen_codigo, destino_codigo, numero_vuelo, hora_salida, hora_llegada, fecha_salida, orden) values
  ('99-9989', 'Avianca', 'ida', 'BOG', 'CTG', 'LA999', '10:00', '11:00', current_date + 20, 0);

-- 99-9991 (minorista, de la sección I) NO recibe contrato_vuelos — queda tal
-- cual para representar "histórico sin tramos" (J4).

-- La vista exige sesión impersonada (acceso_ventas_vuelo_sistema() lee
-- mi_rol()/mi_tenant(), que a su vez leen request.jwt.claims) — sin esto
-- devuelve 0 filas incluso corriendo como superusuario, porque el filtro
-- vive en el propio `where` de la vista, no en RLS de la tabla base. J1-J6
-- corren impersonando `superadmin` (alcance global, fixture de la sección I)
-- para poder inspeccionar los 3 contratos sin filtrar por tenant.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated')::text, true);

do $$
declare v_row record;
begin
  select * into v_row from public.ventas_vuelo_sistema where numero_contrato = '99-9992';
  perform pg_temp.assert_eq(v_row.vuelo_ida, 'JA101'::text, 'J1: 99-9992 — vuelo_ida debe salir del tramo con menor orden (JA101), nunca del tramo anómalo (XX000)');
  perform pg_temp.assert_eq(v_row.vuelo_regreso, 'JA102'::text, 'J1: 99-9992 — vuelo_regreso correcto');
  perform pg_temp.assert_eq(v_row.record, 'ABC123'::text, 'J1: 99-9992 — record real (contrato_vuelos.record), no un dato inventado');
  perform pg_temp.assert_eq(v_row.origen_codigo, 'MDE'::text, 'J1: 99-9992 — origen_codigo del tramo de ida');
  perform pg_temp.assert_eq(v_row.destino_codigo, 'CTG'::text, 'J1: 99-9992 — destino_codigo del tramo de ida');
  perform pg_temp.assert_eq(v_row.ruta, 'MDE - CTG - MDE'::text, 'J1: 99-9992 — ruta construida DETERMINÍSTICAMENTE (ida + regreso), formato igual a bloqueos_vuelo.ruta');
  perform pg_temp.assert_eq(v_row.hora_salida_ida, '08:00'::text, 'J1: 99-9992 — hora_salida_ida');
  perform pg_temp.assert_eq(v_row.hora_llegada_reg, '19:00'::text, 'J1: 99-9992 — hora_llegada_reg');
end $$;

do $$
declare v_n bigint;
begin
  select count(*) into v_n from public.ventas_vuelo_sistema where numero_contrato = '99-9992';
  perform pg_temp.assert_eq(v_n, 1::bigint, 'J2: ventas_vuelo_sistema debe devolver EXACTAMENTE una fila para 99-9992, aunque tenga 3 filas en contrato_vuelos (2 tramos reales + 1 anómalo)');
end $$;

do $$
declare v_row record;
begin
  select * into v_row from public.ventas_vuelo_sistema where numero_contrato = '99-9990';
  perform pg_temp.assert_eq(v_row.vuelo_ida, 'WJ55'::text, 'J3: 99-9990 (origen empaquetado_ref_id) — vuelo_ida correcto');
  perform pg_temp.assert_eq(v_row.vuelo_regreso, null::text, 'J3: 99-9990 — vuelo_regreso NULL (one-way real, nunca se inventa un tramo de regreso)');
  perform pg_temp.assert_eq(v_row.ruta, 'MDE - SMR'::text, 'J3: 99-9990 — ruta de un solo tramo (sin el tercer segmento del regreso, porque no existe)');
  perform pg_temp.assert_eq(v_row.record, null::text, 'J3: 99-9990 — record NULL (no se ha comprado/emitido), nunca inventado');
end $$;

do $$
declare v_row record;
begin
  select * into v_row from public.ventas_vuelo_sistema where numero_contrato = '99-9991';
  perform pg_temp.assert_eq(v_row.vuelo_ida, null::text, 'J4: 99-9991 (sin contrato_vuelos, "histórico sin tramos") — vuelo_ida NULL');
  perform pg_temp.assert_eq(v_row.ruta, null::text, 'J4: 99-9991 — ruta NULL');
  perform pg_temp.assert_eq(v_row.record, null::text, 'J4: 99-9991 — record NULL');
  perform pg_temp.assert_eq(v_row.origen_codigo, null::text, 'J4: 99-9991 — origen_codigo NULL, nunca inventado');
end $$;

do $$
declare v_row record;
begin
  select * into v_row from public.ventas_vuelo_sistema where numero_contrato = '99-9989';
  perform pg_temp.assert_eq(v_row.vuelo_ida, 'LA999'::text, 'J5: 99-9989 — vuelo_ida propio (LA999), nunca el de 99-9992 (JA101) ni el de 99-9990 (WJ55) — dos contratos nunca se mezclan');
  perform pg_temp.assert_eq(v_row.origen_codigo, 'BOG'::text, 'J5: 99-9989 — origen_codigo propio, no cruzado con otro contrato');
end $$;

-- J6: el set de columnas de la vista es EXACTAMENTE el esperado — ni de más
-- (fuga de PII/financiero, o de columnas internas de contrato_vuelos como
-- `id`/`servicios`/`orden`) ni de menos (campo pedido que faltara).
-- ⚠️ Ampliado en la migración 157 (editor operativo de vuelos del contrato):
-- estado_emision/estado_pago/cxp_aereas_total/cxp_aereas_pagadas — ninguna
-- es PII ni un valor monetario (dos son un estado derivado, dos son conteos).
do $$
declare v_cols text[];
begin
  select array_agg(column_name order by column_name) into v_cols
    from information_schema.columns
   where table_name = 'ventas_vuelo_sistema';
  perform pg_temp.assert_eq(
    v_cols,
    array[
      'aerolinea','cxp_aereas_pagadas','cxp_aereas_total','destino_codigo','empaquetado_ref_id',
      'estado_emision','estado_pago','fecha_regreso','fecha_salida',
      'hora_llegada_ida','hora_llegada_reg','hora_salida_ida','hora_salida_reg',
      'numero_contrato','origen','origen_codigo','record','ruta','tenant','tipo_paquete',
      'vuelo_fecha_ida','vuelo_fecha_regreso','vuelo_ida','vuelo_regreso'
    ]::text[],
    'J6: el set de columnas de la vista debe ser EXACTAMENTE el esperado — nada de PII/financiero, nada de columnas internas de contrato_vuelos sin filtrar (migración 157 agrega estado_emision/estado_pago/cxp_aereas_total/cxp_aereas_pagadas)'
  );
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- control_vuelo (mayorista) también debe ver el detalle aéreo completo de
-- SU tenant a través de la vista (no solo superadmin) — confirma que el
-- join lateral funciona igual sin importar qué rol evalúa acceso_ventas_vuelo_sistema().
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','99999999-9999-9999-9999-999999999999','role','authenticated')::text, true);

do $$
declare v_row record;
begin
  select * into v_row from public.ventas_vuelo_sistema where numero_contrato = '99-9992';
  perform pg_temp.assert_eq(v_row.vuelo_ida, 'JA101'::text, 'J7: control_vuelo (mayorista) debe ver el vuelo_ida real de 99-9992 (su tenant)');
end $$;

do $$
declare v_n bigint;
begin
  select count(*) into v_n from public.ventas_vuelo_sistema where numero_contrato = '99-9991';
  perform pg_temp.assert_eq(v_n, 0::bigint, 'J8: control_vuelo (mayorista) NO debe ver 99-9991 (minorista) — aislamiento de tenant se conserva con las columnas nuevas');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- ═════════════════════════════════════════════════════════════════════════
-- K. acceso_ventas_vuelo_sistema() — EXECUTE revocado de PUBLIC (ronda
--    siguiente, hallazgo 2 "FUNCIÓN SECURITY DEFINER"). Tres demostraciones
--    pedidas explícitamente: (1) anon no puede invocarla como RPC directo;
--    (2) authenticated no obtiene datos fuera de su rol/tenant (la función
--    en sí respeta el límite, aunque SÍ pueda invocarla); (3) la vista sigue
--    funcionando para los roles autorizados (no se rompió nada con el revoke).
-- ═════════════════════════════════════════════════════════════════════════

-- K1: anon — ni siquiera puede EJECUTAR la función (permission denied),
-- nunca llega a evaluar su lógica interna.
set local role anon;
select set_config('request.jwt.claims', '{}', true);

do $$
declare v_lanzo boolean := false;
begin
  begin
    perform public.acceso_ventas_vuelo_sistema('mayorista');
  exception when insufficient_privilege then
    v_lanzo := true;
  end;
  perform pg_temp.assert_eq(v_lanzo, true, 'K1: anon debe recibir permission denied al invocar acceso_ventas_vuelo_sistema() directo — EXECUTE revocado de PUBLIC');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- K2: authenticated SÍ puede invocarla (EXECUTE otorgado explícitamente),
-- pero la función en sí nunca devuelve `true` fuera del tenant/rol correcto
-- — invocada DIRECTO (no a través de la vista), gerencia mayorista debe dar
-- true para 'mayorista' y false para 'minorista'.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','role','authenticated')::text, true);

do $$
declare v_may boolean; v_min boolean;
begin
  select public.acceso_ventas_vuelo_sistema('mayorista') into v_may;
  select public.acceso_ventas_vuelo_sistema('minorista') into v_min;
  perform pg_temp.assert_eq(v_may, true, 'K2: gerencia mayorista invocando la función DIRECTO para su propio tenant debe dar true');
  perform pg_temp.assert_eq(v_min, false, 'K2: gerencia mayorista invocando la función DIRECTO para el OTRO tenant debe dar false — nunca obtiene acceso fuera de su tenant, ni siquiera por RPC directo');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- K3: la vista SIGUE funcionando para los roles autorizados después del
-- revoke — reconfirma un caso ya probado en la sección I, esta vez con el
-- EXECUTE de PUBLIC ya revocado, para probar que el `grant ... to
-- authenticated` explícito es suficiente y nada se rompió.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','role','authenticated')::text, true);

do $$
declare v_contratos text[];
begin
  select array_agg(numero_contrato order by numero_contrato) into v_contratos
    from public.ventas_vuelo_sistema
   where numero_contrato in ('99-9992', '99-9991', '99-9990', '99-9989');
  perform pg_temp.assert_eq(
    v_contratos, array['99-9989','99-9990','99-9992']::text[],
    'K3: gerencia mayorista sigue viendo su tenant a través de la vista (99-9989/99-9990/99-9992) tras revocar EXECUTE de PUBLIC en la función'
  );
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- ═════════════════════════════════════════════════════════════════════════
-- L. actualizar_control_empaquetado() y acceso_ventas_vuelo_sistema() —
--    cierre de EXECUTE de `anon` (ronda posterior, misma consulta preventiva
--    de producción que reveló `anon EXECUTE = true` sobre actualizar_control_
--    bloqueo() pese al `revoke ... from public` de la migración 152 — el
--    revoke solo alcanza a PUBLIC, nunca a `anon`, porque Supabase otorga
--    EXECUTE DIRECTO a `anon`/`authenticated` sobre TODA función nueva vía
--    `ALTER DEFAULT PRIVILEGES` de proyecto, independiente de PUBLIC).
--
--    ⚠️ Este local NO reproduce ese mecanismo de Supabase (no hay ningún
--    `ALTER DEFAULT PRIVILEGES` configurado en esta base de pruebas) — así
--    que si solo se verificara el ACL tal cual quedó tras correr la
--    migración 156 una vez, la prueba pasaría incluso si el `revoke ...
--    from anon` NUNCA se hubiera escrito (porque local jamás le otorgó nada
--    a `anon` para empezar). Para no depender de eso, L1 primero SIMULA el
--    escenario real de producción — un GRANT EXECUTE explícito y previo a
--    `anon`/PUBLIC, como el que deja `ALTER DEFAULT PRIVILEGES` de Supabase
--    — y L2 recién ahí re-aplica el `revoke`/`grant` EXACTO de la migración
--    156. Solo entonces las aserciones de L3-L7 prueban algo real: que el
--    revoke SÍ retira un EXECUTE que de verdad existía, no que confirma una
--    ausencia que el harness local nunca iba a crear por sí solo.
-- ═════════════════════════════════════════════════════════════════════════

-- L1: simula el ALTER DEFAULT PRIVILEGES de Supabase — GRANT EXECUTE previo
-- y explícito a anon (y a PUBLIC, para no dejar ninguna duda) sobre AMBAS
-- funciones, como si acabaran de crearse en un proyecto real de Supabase.
grant execute on function public.actualizar_control_empaquetado(bigint, text, text, text, text) to anon, public;
grant execute on function public.acceso_ventas_vuelo_sistema(text) to anon, public;

do $$
begin
  perform pg_temp.assert_eq(
    has_function_privilege('anon', 'public.actualizar_control_empaquetado(bigint, text, text, text, text)', 'EXECUTE'),
    true, 'L1a: tras simular el GRANT de Supabase, anon SÍ debe tener EXECUTE sobre actualizar_control_empaquetado (precondición del escenario)'
  );
  perform pg_temp.assert_eq(
    has_function_privilege('anon', 'public.acceso_ventas_vuelo_sistema(text)', 'EXECUTE'),
    true, 'L1b: tras simular el GRANT de Supabase, anon SÍ debe tener EXECUTE sobre acceso_ventas_vuelo_sistema (precondición del escenario)'
  );
end $$;

-- L2: re-aplica el revoke/grant EXACTO tal cual lo escribe la migración 156
-- (copiado línea por línea de 20260601000156_empaquetados.sql) sobre el
-- estado "contaminado" que acaba de simular L1.
revoke all on function public.actualizar_control_empaquetado(bigint, text, text, text, text) from public;
revoke all on function public.actualizar_control_empaquetado(bigint, text, text, text, text) from anon;
grant execute on function public.actualizar_control_empaquetado(bigint, text, text, text, text) to authenticated;

revoke all on function public.acceso_ventas_vuelo_sistema(text) from public;
revoke all on function public.acceso_ventas_vuelo_sistema(text) from anon;
grant execute on function public.acceso_ventas_vuelo_sistema(text) to authenticated;

-- L3: ACL final — has_function_privilege para anon/authenticated/PUBLIC,
-- para AMBAS funciones. `has_function_privilege('public', ...)` consulta el
-- privilegio del pseudo-rol PUBLIC en sí (no confundir con el esquema
-- `public.` de la firma) — documentado en el manual de Postgres para las
-- funciones de inspección de privilegios.
do $$
begin
  -- actualizar_control_empaquetado(bigint, text, text, text, text)
  perform pg_temp.assert_eq(
    has_function_privilege('anon', 'public.actualizar_control_empaquetado(bigint, text, text, text, text)', 'EXECUTE'),
    false, 'L3a: actualizar_control_empaquetado — anon EXECUTE debe quedar false tras el revoke (había sido otorgado explícitamente en L1, no es una ausencia trivial)'
  );
  perform pg_temp.assert_eq(
    has_function_privilege('authenticated', 'public.actualizar_control_empaquetado(bigint, text, text, text, text)', 'EXECUTE'),
    true, 'L3b: actualizar_control_empaquetado — authenticated EXECUTE debe quedar true'
  );
  perform pg_temp.assert_eq(
    has_function_privilege('public', 'public.actualizar_control_empaquetado(bigint, text, text, text, text)', 'EXECUTE'),
    false, 'L3c: actualizar_control_empaquetado — PUBLIC (el pseudo-rol) no debe tener EXECUTE propio'
  );

  -- acceso_ventas_vuelo_sistema(text)
  perform pg_temp.assert_eq(
    has_function_privilege('anon', 'public.acceso_ventas_vuelo_sistema(text)', 'EXECUTE'),
    false, 'L3d: acceso_ventas_vuelo_sistema — anon EXECUTE debe quedar false tras el revoke (había sido otorgado explícitamente en L1, no es una ausencia trivial)'
  );
  perform pg_temp.assert_eq(
    has_function_privilege('authenticated', 'public.acceso_ventas_vuelo_sistema(text)', 'EXECUTE'),
    true, 'L3e: acceso_ventas_vuelo_sistema — authenticated EXECUTE debe quedar true'
  );
  perform pg_temp.assert_eq(
    has_function_privilege('public', 'public.acceso_ventas_vuelo_sistema(text)', 'EXECUTE'),
    false, 'L3f: acceso_ventas_vuelo_sistema — PUBLIC (el pseudo-rol) no debe tener EXECUTE propio'
  );
end $$;

-- L4: anon — llamada DIRECTA a actualizar_control_empaquetado() debe dar
-- permission denied, nunca llegar a evaluar la lógica interna de la función.
-- Usa deliberadamente el id 9301 (ya borrado en D2, sección D) — si el
-- rechazo fuera por "no encontrado" en vez de por falta de EXECUTE, el
-- SQLSTATE sería distinto (P0001, no insufficient_privilege); usar un id
-- inexistente prueba que Postgres nunca llega a ejecutar el cuerpo de la
-- función, se detiene en el chequeo de privilegios antes de evaluar nada.
set local role anon;
select set_config('request.jwt.claims', '{}', true);

do $$
declare v_lanzo boolean := false;
begin
  begin
    perform public.actualizar_control_empaquetado(9301::bigint, 'NUNCA', 'emitido', 'pagado', 'anon — no debe llegar a ejecutarse');
  exception when insufficient_privilege then
    v_lanzo := true;
  end;
  perform pg_temp.assert_eq(v_lanzo, true, 'L4: anon debe recibir permission denied al invocar actualizar_control_empaquetado() directo — EXECUTE revocado');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- L5: anon — llamada DIRECTA a acceso_ventas_vuelo_sistema() debe dar
-- permission denied (reconfirma K1, esta vez bajo el escenario "hardened"
-- de L1/L2 en vez del estado tal cual dejó la migración una sola vez).
set local role anon;
select set_config('request.jwt.claims', '{}', true);

do $$
declare v_lanzo boolean := false;
begin
  begin
    perform public.acceso_ventas_vuelo_sistema('mayorista');
  exception when insufficient_privilege then
    v_lanzo := true;
  end;
  perform pg_temp.assert_eq(v_lanzo, true, 'L5: anon debe recibir permission denied al invocar acceso_ventas_vuelo_sistema() directo — EXECUTE revocado (escenario hardened de L1/L2)');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- L6: authenticated SIGUE SUJETO A RLS — el EXECUTE otorgado en L2 no salta
-- las policies de `empaquetados`/`empaquetado_cambios`. Fixture nuevo (9401,
-- 9301 ya fue borrado en D2): operaciones (con policy de escritura) sí
-- puede aplicar el cambio; venta (sin policy de escritura, aunque SÍ tiene
-- EXECUTE sobre la función) sigue rechazada con el mismo mensaje que C3.
insert into public.empaquetados (id, fecha_ida, record, estado_emision, estado_pago)
  overriding system value
  values (9401, '2026-12-01', null, null, null);

-- L6a: operaciones (rol con permiso de escritura) — el cambio SÍ se aplica.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','77777777-7777-7777-7777-777777777777','role','authenticated')::text, true);

select public.actualizar_control_empaquetado(9401::bigint, 'L6OK', 'emitido', 'pagado', 'Prueba L6a — EXECUTE + RLS autorizado');

reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare v_row record;
begin
  select record, estado_emision, estado_pago into v_row from public.empaquetados where id = 9401;
  perform pg_temp.assert_eq(v_row.record, 'L6OK'::text, 'L6a: operaciones (autorizado) debe poder aplicar el cambio pese al ACL endurecido de L1/L2');
  perform pg_temp.assert_eq(v_row.estado_emision, 'emitido'::text, 'L6a: estado_emision debe reflejar el cambio');
  perform pg_temp.assert_eq(
    (select count(*) from public.empaquetado_cambios where empaquetado_id = 9401), 1::bigint, 'L6a: un historial'
  );
end $$;

-- L6b: venta (EXECUTE sí lo tiene — el grant es a `authenticated` en
-- general — pero SIN policy de escritura sobre empaquetados/empaquetado_
-- cambios) — la RLS de la tabla sigue rechazando el UPDATE, mismo mensaje
-- que C3. Esto es lo que prueba que el EXECUTE de la función NUNCA sustituye
-- a la RLS: la función no es `security definer`, corre con el rol del
-- caller, sujeta a las mismas policies que cualquier UPDATE directo.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','88888888-8888-8888-8888-888888888888','role','authenticated')::text, true);

do $$
declare v_lanzo boolean := false; v_msg text;
begin
  begin
    perform public.actualizar_control_empaquetado(9401::bigint, 'INTENTO_L6B', 'emitido', 'pagado', '');
  exception when others then
    v_lanzo := true;
    get stacked diagnostics v_msg = message_text;
  end;
  if not v_lanzo then raise exception 'ASSERT FALLÓ (L6b): venta (con EXECUTE, sin policy de escritura) debía ser rechazada por RLS'; end if;
  perform pg_temp.assert_eq(v_msg, 'Empaquetado no encontrado o sin permiso para verlo.', 'L6b: mensaje de rechazo — RLS, no un permission denied a nivel de función (venta SÍ puede ejecutar la función, la tabla es la que la frena)');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare v_row record;
begin
  select record, estado_emision into v_row from public.empaquetados where id = 9401;
  perform pg_temp.assert_eq(v_row.record, 'L6OK'::text, 'L6b: record NO debía cambiar (RLS bloqueó el UPDATE)');
  perform pg_temp.assert_eq(v_row.estado_emision, 'emitido'::text, 'L6b: estado_emision NO debía cambiar');
  perform pg_temp.assert_eq(
    (select count(*) from public.empaquetado_cambios where empaquetado_id = 9401), 1::bigint, 'L6b: sigue en un solo historial — el intento de venta no debía registrarse'
  );
end $$;

-- L7: authenticated SIGUE SUJETO A la lógica de tenant de acceso_ventas_
-- vuelo_sistema() — reconfirma K3 (la vista sigue funcionando para roles
-- autorizados), esta vez bajo el ACL endurecido de L1/L2, para probar que
-- revocar/otorgar dos veces (una desde la migración normal, otra desde este
-- escenario simulado) es idempotente y no rompió nada funcional.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','role','authenticated')::text, true);

do $$
declare v_contratos text[];
begin
  select array_agg(numero_contrato order by numero_contrato) into v_contratos
    from public.ventas_vuelo_sistema
   where numero_contrato in ('99-9992', '99-9991', '99-9990', '99-9989');
  perform pg_temp.assert_eq(
    v_contratos, array['99-9989','99-9990','99-9992']::text[],
    'L7: gerencia mayorista sigue viendo SOLO su tenant a través de la vista tras el ACL endurecido de L1/L2 — el revoke/grant repetido no rompió el acceso legítimo'
  );
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

do $$
begin
  raise notice 'TODAS LAS PRUEBAS PASARON: test_empaquetados.sql (secciones A-L)';
end $$;

rollback;
