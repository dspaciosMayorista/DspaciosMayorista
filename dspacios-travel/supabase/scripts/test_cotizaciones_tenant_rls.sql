-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBAS RLS · aislamiento por tenant de `cotizaciones`/`cotizacion_servicios`
-- Correr DESPUÉS de la migración 154 (cierre). Se pega en el editor SQL de
-- Supabase. Termina en ROLLBACK: los dos fixtures de prueba (una cotización
-- 'TEST-MAY' y otra 'TEST-MIN', cada una con un servicio) y el toggle
-- temporal de `activo` sobre un usuario real desaparecen solos.
--
-- No crea usuarios ficticios (mismo criterio que `test_rls_por_rol.sql`):
-- usa usuarios REALES ya existentes, elegidos por rol/tenant, y solo
-- alterna `activo` temporalmente (con SAVEPOINT) para la prueba de usuario
-- inactivo. Si production todavía no tiene un usuario interno de minorista
-- o un superadmin, esas pruebas puntuales se SALTAN (se informa, nunca se
-- inventa un usuario) — el resto sí corre igual.
--
-- CÓMO SE LEE: cada bloque termina con un `raise notice 'OK: ...'` si pasa,
-- o `raise exception` si falla — un fallo aborta el script entero (no hay
-- forma de "seguir de largo" un caso roto). Al final, un resumen cuenta
-- cuántas pruebas corrieron vs. se saltaron.
-- ─────────────────────────────────────────────────────────────────────────

begin;

do $$
declare
  u_may       record;  -- usuario interno real de mayorista (no superadmin)
  u_min       record;  -- usuario interno real de minorista (no superadmin)
  u_super     record;  -- superadmin real
  id_may      bigint;  -- cotización de prueba, tenant=mayorista
  id_min      bigint;  -- cotización de prueba, tenant=minorista
  serv_may    bigint;
  serv_min    bigint;
  v_count     bigint;
  v_afectadas bigint;
  v_pruebas   int := 0;
  v_saltadas  int := 0;
  v_err       text;
begin
  -- ── Elegir usuarios reales ────────────────────────────────────────────
  select id, email, tenant into u_may from public.usuarios
   where activo and rol in ('administracion','operaciones','venta','gerencia') and tenant = 'mayorista'
   order by email limit 1;
  select id, email, tenant into u_min from public.usuarios
   where activo and rol in ('administracion','operaciones','venta','gerencia') and tenant = 'minorista'
   order by email limit 1;
  select id, email into u_super from public.usuarios
   where activo and rol = 'superadmin' order by email limit 1;

  if u_may.id is null then
    raise exception 'No hay ningún usuario interno activo de mayorista para probar — no se puede continuar (se necesita al menos uno).';
  end if;

  -- ── Fixtures: dos cotizaciones de prueba, una por tenant, cada una con
  -- un servicio. `numero_contrato` queda NULL a propósito (no hace falta
  -- un contrato real para estas pruebas de RLS). ────────────────────────
  insert into public.cotizaciones (codigo, tipo, estado, cliente, tenant)
    values ('TEST-RLS-MAY', 'manual', 'abierta', 'TEST fixture — no es un cliente real', 'mayorista')
    returning id into id_may;
  insert into public.cotizaciones (codigo, tipo, estado, cliente, tenant)
    values ('TEST-RLS-MIN', 'manual', 'abierta', 'TEST fixture — no es un cliente real', 'minorista')
    returning id into id_min;
  insert into public.cotizacion_servicios (cotizacion_id, tipo_servicio, nombre_servicio, costo_neto, valor)
    values (id_may, 'otro', 'TEST', 1000, 1300) returning id into serv_may;
  insert into public.cotizacion_servicios (cotizacion_id, tipo_servicio, nombre_servicio, costo_neto, valor)
    values (id_min, 'otro', 'TEST', 1000, 1300) returning id into serv_min;

  -- ══ 1. Usuario mayorista NO lee cotizaciones/servicios de minorista ══
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_may.id, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.cotizaciones where id in (id_may, id_min);
  if v_count <> 1 then
    reset role; perform set_config('request.jwt.claims', null, true);
    raise exception 'FALLÓ (1): usuario mayorista debería ver exactamente 1 de las 2 cotizaciones de prueba (la suya), vio %', v_count;
  end if;
  select count(*) into v_count from public.cotizacion_servicios where id in (serv_may, serv_min);
  reset role; perform set_config('request.jwt.claims', null, true);
  if v_count <> 1 then
    raise exception 'FALLÓ (1b): usuario mayorista debería ver exactamente 1 de los 2 servicios de prueba (el suyo), vio %', v_count;
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (1): usuario mayorista (%) no lee la cotización/servicio de minorista.', u_may.email;

  -- ══ 2. Usuario minorista NO lee cotizaciones/servicios de mayorista ══
  if u_min.id is null then
    v_saltadas := v_saltadas + 1;
    raise notice 'SALTADA (2): no hay usuario interno activo de minorista en esta base para probar.';
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', u_min.id, 'role', 'authenticated')::text, true);
    select count(*) into v_count from public.cotizaciones where id in (id_may, id_min);
    if v_count <> 1 then
      reset role; perform set_config('request.jwt.claims', null, true);
      raise exception 'FALLÓ (2): usuario minorista debería ver exactamente 1 de las 2 cotizaciones de prueba (la suya), vio %', v_count;
    end if;
    select count(*) into v_count from public.cotizacion_servicios where id in (serv_may, serv_min);
    reset role; perform set_config('request.jwt.claims', null, true);
    if v_count <> 1 then
      raise exception 'FALLÓ (2b): usuario minorista debería ver exactamente 1 de los 2 servicios de prueba (el suyo), vio %', v_count;
    end if;
    v_pruebas := v_pruebas + 1;
    raise notice 'OK (2): usuario minorista (%) no lee la cotización/servicio de mayorista.', u_min.email;
  end if;

  -- ══ 3. INSERT cruzado rechazado (mayorista intenta insertar en minorista) ══
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', u_may.id, 'role', 'authenticated')::text, true);
    insert into public.cotizaciones (codigo, tipo, estado, cliente, tenant)
      values ('TEST-RLS-INSERT-CRUZADO', 'manual', 'abierta', 'no debería insertarse', 'minorista');
    reset role; perform set_config('request.jwt.claims', null, true);
    raise exception 'FALLÓ (3): el INSERT cruzado (mayorista → minorista) NO fue rechazado.';
  exception
    when insufficient_privilege then
      reset role; perform set_config('request.jwt.claims', null, true);
      v_pruebas := v_pruebas + 1;
      raise notice 'OK (3): INSERT cruzado (mayorista → minorista) rechazado por RLS.';
  end;

  -- ══ 4. UPDATE cruzado rechazado (mayorista intenta tocar la de minorista) ══
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_may.id, 'role', 'authenticated')::text, true);
  update public.cotizaciones set vigencia_hasta = current_date + 1 where id = id_min;
  get diagnostics v_afectadas = row_count;
  reset role; perform set_config('request.jwt.claims', null, true);
  if v_afectadas <> 0 then
    raise exception 'FALLÓ (4): el UPDATE cruzado (mayorista sobre fila de minorista) afectó % filas, debía afectar 0.', v_afectadas;
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (4): UPDATE cruzado (mayorista sobre fila de minorista) no afecta ninguna fila.';

  -- ══ 5. DELETE cruzado rechazado ══
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_may.id, 'role', 'authenticated')::text, true);
  delete from public.cotizacion_servicios where id = serv_min;
  get diagnostics v_afectadas = row_count;
  reset role; perform set_config('request.jwt.claims', null, true);
  if v_afectadas <> 0 then
    raise exception 'FALLÓ (5): el DELETE cruzado (mayorista sobre servicio de minorista) afectó % filas, debía afectar 0.', v_afectadas;
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (5): DELETE cruzado (mayorista sobre servicio de minorista) no afecta ninguna fila.';

  -- ══ 6. Cambio de tenant rechazado (incluso sobre la fila PROPIA) ══
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', u_may.id, 'role', 'authenticated')::text, true);
    update public.cotizaciones set tenant = 'minorista' where id = id_may;
    reset role; perform set_config('request.jwt.claims', null, true);
    raise exception 'FALLÓ (6): se pudo cambiar el tenant de una cotización propia — el trigger no lo bloqueó.';
  exception
    when others then
      get stacked diagnostics v_err = message_text;
      reset role; perform set_config('request.jwt.claims', null, true);
      if v_err like 'No se puede cambiar el tenant%' then
        v_pruebas := v_pruebas + 1;
        raise notice 'OK (6): cambio de tenant rechazado por el trigger (%).', v_err;
      else
        raise exception 'FALLÓ (6): el UPDATE de tenant falló, pero con un error inesperado: %', v_err;
      end if;
  end;

  -- ══ 7. Usuario inactivo rechazado ══
  update public.usuarios set activo = false where id = u_may.id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_may.id, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.cotizaciones where id = id_may;
  reset role; perform set_config('request.jwt.claims', null, true);
  update public.usuarios set activo = true where id = u_may.id;  -- restaurar YA, antes de seguir
  if v_count <> 0 then
    raise exception 'FALLÓ (7): un usuario desactivado todavía ve su propia cotización de prueba (mi_rol() no lo está bloqueando).';
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (7): usuario desactivado no ve ninguna cotización, ni siquiera la de su propio tenant.';

  -- ══ 8. Superadmin funciona según diseño (alcance global) ══
  if u_super.id is null then
    v_saltadas := v_saltadas + 1;
    raise notice 'SALTADA (8): no hay superadmin activo en esta base para probar.';
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', u_super.id, 'role', 'authenticated')::text, true);
    select count(*) into v_count from public.cotizaciones where id in (id_may, id_min);
    reset role; perform set_config('request.jwt.claims', null, true);
    if v_count <> 2 then
      raise exception 'FALLÓ (8): superadmin debería ver las 2 cotizaciones de prueba (alcance global), vio %', v_count;
    end if;
    v_pruebas := v_pruebas + 1;
    raise notice 'OK (8): superadmin (%) conserva alcance global — ve ambas agencias.', u_super.email;
  end if;

  -- ══ 9. Acceso anónimo devuelve 0 ══
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{}', true);
    select count(*) into v_count from public.cotizaciones where id in (id_may, id_min);
    reset role; perform set_config('request.jwt.claims', null, true);
    if v_count <> 0 then
      raise exception 'FALLÓ (9): el rol anon ve % de las cotizaciones de prueba — debería ver 0.', v_count;
    end if;
    v_pruebas := v_pruebas + 1;
    raise notice 'OK (9): acceso anónimo devuelve 0 filas.';
  exception
    when insufficient_privilege then
      reset role; perform set_config('request.jwt.claims', null, true);
      v_pruebas := v_pruebas + 1;
      raise notice 'OK (9): acceso anónimo bloqueado incluso antes de RLS (permission denied) — 0 filas alcanzables de cualquier forma.';
  end;

  -- ══ 10. cotizacion_servicios no queda con MÁS alcance que su padre ══
  -- Ya lo prueban (1)/(2) (el servicio de la otra agencia no se ve), pero
  -- esto lo hace explícito: comparar visibilidad del servicio contra la de
  -- su cotización padre, para el mismo usuario.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_may.id, 'role', 'authenticated')::text, true);
  select
    (select count(*) from public.cotizaciones where id = id_min) as ve_padre,
    (select count(*) from public.cotizacion_servicios where id = serv_min) as ve_hijo
  into v_count, v_afectadas;
  reset role; perform set_config('request.jwt.claims', null, true);
  if v_afectadas > v_count then
    raise exception 'FALLÓ (10): cotizacion_servicios quedó con MÁS alcance que su padre (ve_padre=%, ve_hijo=%).', v_count, v_afectadas;
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (10): cotizacion_servicios nunca alcanza más que su cotización padre.';

  -- ══ 11. Prueba negativa: la policy VIEJA (solo por rol) SÍ habría dejado
  -- pasar el cruce que la NUEVA rechaza. No se revierte la policy real (sería
  -- riesgoso incluso dentro de una transacción); se evalúa el MISMO
  -- predicado que tenía "cotizaciones: interno" (mi_rol() in (...), sin
  -- tenant) contra la fila cruzada, para demostrar que por sí solo sí
  -- habría dado permiso. ══
  declare
    v_hubiera_pasado boolean;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', u_may.id, 'role', 'authenticated')::text, true);
    select public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta') into v_hubiera_pasado;
    reset role; perform set_config('request.jwt.claims', null, true);
    if not v_hubiera_pasado then
      raise exception 'FALLÓ (11): el predicado de la policy vieja no se pudo evaluar (mi_rol() no resolvió para este usuario) — revisar el usuario elegido.';
    end if;
    v_pruebas := v_pruebas + 1;
    raise notice 'OK (11): confirmado — el predicado de la policy ANTERIOR ("cotizaciones: interno", solo mi_rol() in (...), SIN tenant) evalúa TRUE para % contra la fila de la OTRA agencia; la única razón por la que (3)/(4)/(5) rechazan hoy es el `and puede_ver_tenant(tenant)` agregado en la 154.', u_may.email;
  end;

  -- ── Limpieza de fixtures (además del ROLLBACK final, por si esto se
  -- llegara a correr fuera de una transacción envolvente) ──────────────
  delete from public.cotizacion_servicios where id in (serv_may, serv_min);
  delete from public.cotizaciones where id in (id_may, id_min);

  raise notice '─────────────────────────────────────────────────────────';
  raise notice 'RESUMEN: % pruebas OK, % saltadas por falta de usuario real de esa categoría.', v_pruebas, v_saltadas;
end $$;

rollback;
