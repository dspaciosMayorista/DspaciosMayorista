-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBAS RLS · aislamiento por tenant de `cotizaciones`/`cotizacion_servicios`
-- Correr DESPUÉS de la migración 154 (cierre). Se pega en el editor SQL de
-- Supabase. Termina en ROLLBACK: TODO lo que crea (usuarios fixture,
-- cotizaciones/servicios fixture) desaparece solo — no depende de, ni toca,
-- ninguna cuenta o fila real.
--
-- ⚠️ REESCRITURA (revisión de PR #267, punto 5) — reemplaza la versión
-- anterior, que tenía tres problemas:
--   1. Usaba usuarios REALES elegidos por SELECT — si la base no tenía un
--      usuario de minorista o un superadmin, esas pruebas se SALTABAN
--      ("SALTADA") y el resumen igual se podía leer como "aprobado".
--   2. No probaba `gerencia` — exactamente el rol que la revisión encontró
--      con alcance global no deseado si la migración 154 hubiera usado el
--      `puede_ver_tenant()` genérico (mi_rol() in ('superadmin','gerencia')
--      or mi_tenant()=t) en vez del `puede_ver_tenant_cotizacion()` nuevo
--      (solo superadmin es global). Ver prueba 5 más abajo.
--   3. La prueba de "usuario inactivo" alteraba `activo` de un usuario REAL
--      con un UPDATE (aunque restaurado de inmediato) — un error a mitad de
--      camino habría dejado esa cuenta desactivada.
--
-- Ahora TODO corre sobre usuarios FIXTURE, creados dentro de esta misma
-- transacción (insert en `auth.users` + ajuste de rol/tenant/activo en
-- `public.usuarios` — el trigger `on_auth_user_created` ya crea la fila
-- base). `auth.uid()` en Supabase lee el claim `sub` del JWT simulado
-- (`request.jwt.claims`), no la tabla `auth.users` en sí — así que ni
-- siquiera hace falta esa fila para el caso "perfil ausente" (prueba 8): ahí
-- se usa un UUID que no existe en ningún lado.
--
-- CERO PRUEBAS SALTADAS: cada prueba de este archivo corre siempre, sin
-- condicionales de "si existe tal usuario". Si algo indispensable no se
-- puede crear (p. ej. el INSERT en `auth.users` falla por un esquema de Auth
-- distinto al esperado), el script ABORTA con excepción — nunca se reporta
-- como aprobado a medias.
--
-- CÓMO SE LEE: cada bloque termina con `raise notice 'OK: ...'` si pasa, o
-- `raise exception` si falla — un fallo aborta el script entero. Al final,
-- un resumen cuenta cuántas pruebas corrieron (debe ser el total fijo, sin
-- restarle nada por "saltadas": esta versión no las tiene).
-- ─────────────────────────────────────────────────────────────────────────

begin;

-- ── Helpers de sesión (schema pg_temp: viven solo esta transacción/sesión,
-- desaparecen con el ROLLBACK final igual que todo lo demás). ─────────────
create function pg_temp.fx_login(p_id uuid) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.fx_logout() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', null, true);
end $$;

do $$
declare
  -- Fixture users: UUID fresco por cada uno, nunca ligado a una cuenta real.
  fx_may       uuid := gen_random_uuid();  -- interno, rol venta, mayorista, activo
  fx_min       uuid := gen_random_uuid();  -- interno, rol venta, minorista, activo
  fx_ger_may   uuid := gen_random_uuid();  -- gerencia, mayorista, activo — clave para la prueba 5
  fx_ger_min   uuid := gen_random_uuid();  -- gerencia, minorista, activo — clave para la prueba 5
  fx_super     uuid := gen_random_uuid();  -- superadmin, activo
  fx_inactivo  uuid := gen_random_uuid();  -- rol venta, mayorista, activo=false
  fx_fantasma  uuid := gen_random_uuid();  -- NUNCA insertado en ningún lado: "perfil ausente"

  id_may      bigint;  -- cotización fixture, tenant=mayorista
  id_min      bigint;  -- cotización fixture, tenant=minorista
  serv_may    bigint;
  serv_min    bigint;
  v_count     bigint;
  v_afectadas bigint;
  v_hubiera   boolean;  -- lo que habría decidido puede_ver_tenant() (genérico)
  v_real    boolean;  -- lo que decide puede_ver_tenant_cotizacion() (el que sí usan las policies)
  v_pruebas   int := 0;
  v_err       text;
begin
  -- ── Crear los 6 usuarios fixture (auth.users dispara handle_new_user(),
  -- que ya crea la fila base en public.usuarios; después se ajusta rol/
  -- tenant/activo exactos). Emails claramente marcados como fixture, con
  -- dominio .invalid (reservado por RFC 2606, no puede colisionar con un
  -- dominio real) para que nunca puedan chocar con una cuenta real. ───────
  insert into auth.users (id, email) values
    (fx_may,      'fx-rls-may@dspacios-test.invalid'),
    (fx_min,      'fx-rls-min@dspacios-test.invalid'),
    (fx_ger_may,  'fx-rls-ger-may@dspacios-test.invalid'),
    (fx_ger_min,  'fx-rls-ger-min@dspacios-test.invalid'),
    (fx_super,    'fx-rls-super@dspacios-test.invalid'),
    (fx_inactivo, 'fx-rls-inactivo@dspacios-test.invalid');

  update public.usuarios set rol = 'venta',     tenant = 'mayorista', activo = true  where id = fx_may;
  update public.usuarios set rol = 'venta',     tenant = 'minorista', activo = true  where id = fx_min;
  update public.usuarios set rol = 'gerencia',  tenant = 'mayorista', activo = true  where id = fx_ger_may;
  update public.usuarios set rol = 'gerencia',  tenant = 'minorista', activo = true  where id = fx_ger_min;
  update public.usuarios set rol = 'superadmin',tenant = 'mayorista', activo = true  where id = fx_super;
  update public.usuarios set rol = 'venta',     tenant = 'mayorista', activo = false where id = fx_inactivo;

  if (select count(*) from public.usuarios where id in (fx_may, fx_min, fx_ger_may, fx_ger_min, fx_super, fx_inactivo)) <> 6 then
    raise exception 'No se pudieron crear los 6 usuarios fixture — revisar el trigger on_auth_user_created / el esquema de auth.users de este proyecto.';
  end if;

  -- ── Fixtures: dos cotizaciones de prueba, una por tenant, cada una con
  -- un servicio. `numero_contrato` queda NULL a propósito. ───────────────
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

  -- ══ 1. Usuario mayorista: SELECT solo ve su cotización/servicio ══
  perform pg_temp.fx_login(fx_may);
  select count(*) into v_count from public.cotizaciones where id in (id_may, id_min);
  if v_count <> 1 then
    perform pg_temp.fx_logout();
    raise exception 'FALLÓ (1): usuario mayorista debería ver exactamente 1 de las 2 cotizaciones fixture, vio %', v_count;
  end if;
  select count(*) into v_count from public.cotizacion_servicios where id in (serv_may, serv_min);
  perform pg_temp.fx_logout();
  if v_count <> 1 then
    raise exception 'FALLÓ (1b): usuario mayorista debería ver exactamente 1 de los 2 servicios fixture, vio %', v_count;
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (1): usuario interno de mayorista no lee la cotización/servicio de minorista.';

  -- ══ 2. Usuario minorista: SELECT solo ve su cotización/servicio ══
  perform pg_temp.fx_login(fx_min);
  select count(*) into v_count from public.cotizaciones where id in (id_may, id_min);
  if v_count <> 1 then
    perform pg_temp.fx_logout();
    raise exception 'FALLÓ (2): usuario minorista debería ver exactamente 1 de las 2 cotizaciones fixture, vio %', v_count;
  end if;
  select count(*) into v_count from public.cotizacion_servicios where id in (serv_may, serv_min);
  perform pg_temp.fx_logout();
  if v_count <> 1 then
    raise exception 'FALLÓ (2b): usuario minorista debería ver exactamente 1 de los 2 servicios fixture, vio %', v_count;
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (2): usuario interno de minorista no lee la cotización/servicio de mayorista.';

  -- ══ 3. GERENCIA (defecto corregido — revisión de PR #267, punto 1):
  -- gerencia de mayorista NO ve la cotización/servicio de minorista, y
  -- viceversa. Antes de la corrección, la migración 154 iba a usar
  -- `puede_ver_tenant()` (alcance global para superadmin Y gerencia) — con
  -- eso, este bloque habría fallado. ══
  perform pg_temp.fx_login(fx_ger_may);
  select count(*) into v_count from public.cotizaciones where id in (id_may, id_min);
  if v_count <> 1 then
    perform pg_temp.fx_logout();
    raise exception 'FALLÓ (3a): gerencia de mayorista debería ver exactamente 1 de las 2 cotizaciones fixture (alcance acotado a SU tenant, no global), vio %', v_count;
  end if;
  select count(*) into v_count from public.cotizacion_servicios where id in (serv_may, serv_min);
  perform pg_temp.fx_logout();
  if v_count <> 1 then
    raise exception 'FALLÓ (3b): gerencia de mayorista debería ver exactamente 1 de los 2 servicios fixture, vio %', v_count;
  end if;
  perform pg_temp.fx_login(fx_ger_min);
  select count(*) into v_count from public.cotizaciones where id in (id_may, id_min);
  perform pg_temp.fx_logout();
  if v_count <> 1 then
    raise exception 'FALLÓ (3c): gerencia de minorista debería ver exactamente 1 de las 2 cotizaciones fixture (alcance acotado a SU tenant, no global), vio %', v_count;
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (3): gerencia queda tan acotada a su propio tenant como cualquier otro rol interno — NO tiene el alcance global de puede_ver_tenant().';

  -- ══ 4. INSERT cruzado rechazado (mayorista intenta insertar en minorista) ══
  begin
    perform pg_temp.fx_login(fx_may);
    insert into public.cotizaciones (codigo, tipo, estado, cliente, tenant)
      values ('TEST-RLS-INSERT-CRUZADO', 'manual', 'abierta', 'no debería insertarse', 'minorista');
    perform pg_temp.fx_logout();
    raise exception 'FALLÓ (4): el INSERT cruzado (mayorista → minorista) NO fue rechazado.';
  exception
    when insufficient_privilege then
      perform pg_temp.fx_logout();
      v_pruebas := v_pruebas + 1;
      raise notice 'OK (4): INSERT cruzado (mayorista → minorista) rechazado por RLS.';
  end;

  -- ══ 4b. INSERT cruzado rechazado también para gerencia ══
  begin
    perform pg_temp.fx_login(fx_ger_may);
    insert into public.cotizaciones (codigo, tipo, estado, cliente, tenant)
      values ('TEST-RLS-INSERT-CRUZADO-GER', 'manual', 'abierta', 'no debería insertarse', 'minorista');
    perform pg_temp.fx_logout();
    raise exception 'FALLÓ (4b): el INSERT cruzado de gerencia (mayorista → minorista) NO fue rechazado.';
  exception
    when insufficient_privilege then
      perform pg_temp.fx_logout();
      v_pruebas := v_pruebas + 1;
      raise notice 'OK (4b): INSERT cruzado de gerencia (mayorista → minorista) rechazado por RLS.';
  end;

  -- ══ 5. UPDATE cruzado rechazado (mayorista intenta tocar la de minorista) ══
  perform pg_temp.fx_login(fx_may);
  update public.cotizaciones set vigencia_hasta = current_date + 1 where id = id_min;
  get diagnostics v_afectadas = row_count;
  perform pg_temp.fx_logout();
  if v_afectadas <> 0 then
    raise exception 'FALLÓ (5): el UPDATE cruzado (mayorista sobre fila de minorista) afectó % filas, debía afectar 0.', v_afectadas;
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (5): UPDATE cruzado (mayorista sobre fila de minorista) no afecta ninguna fila.';

  -- ══ 5b. UPDATE cruzado rechazado también para gerencia (de minorista sobre la de mayorista) ══
  perform pg_temp.fx_login(fx_ger_min);
  update public.cotizaciones set vigencia_hasta = current_date + 1 where id = id_may;
  get diagnostics v_afectadas = row_count;
  perform pg_temp.fx_logout();
  if v_afectadas <> 0 then
    raise exception 'FALLÓ (5b): el UPDATE cruzado de gerencia (minorista sobre fila de mayorista) afectó % filas, debía afectar 0.', v_afectadas;
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (5b): UPDATE cruzado de gerencia (minorista sobre fila de mayorista) no afecta ninguna fila.';

  -- ══ 6. DELETE cruzado rechazado, en AMBAS tablas (padre e hijo) ══
  perform pg_temp.fx_login(fx_may);
  delete from public.cotizacion_servicios where id = serv_min;
  get diagnostics v_afectadas = row_count;
  if v_afectadas <> 0 then
    perform pg_temp.fx_logout();
    raise exception 'FALLÓ (6a): el DELETE cruzado (mayorista sobre servicio de minorista) afectó % filas, debía afectar 0.', v_afectadas;
  end if;
  delete from public.cotizaciones where id = id_min;
  get diagnostics v_afectadas = row_count;
  perform pg_temp.fx_logout();
  if v_afectadas <> 0 then
    raise exception 'FALLÓ (6b): el DELETE cruzado (mayorista sobre cotización de minorista) afectó % filas, debía afectar 0.', v_afectadas;
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (6): DELETE cruzado no afecta ninguna fila, ni en cotizaciones ni en cotizacion_servicios.';

  -- ══ 7. Cambio de tenant rechazado (incluso sobre la fila PROPIA, incluso para superadmin) ══
  begin
    perform pg_temp.fx_login(fx_may);
    update public.cotizaciones set tenant = 'minorista' where id = id_may;
    perform pg_temp.fx_logout();
    raise exception 'FALLÓ (7a): se pudo cambiar el tenant de una cotización propia — el trigger no lo bloqueó.';
  exception
    when others then
      get stacked diagnostics v_err = message_text;
      perform pg_temp.fx_logout();
      if v_err not like 'No se puede cambiar el tenant%' then
        raise exception 'FALLÓ (7a): el UPDATE de tenant falló, pero con un error inesperado: %', v_err;
      end if;
  end;
  begin
    perform pg_temp.fx_login(fx_super);
    update public.cotizaciones set tenant = 'minorista' where id = id_may;
    perform pg_temp.fx_logout();
    raise exception 'FALLÓ (7b): superadmin pudo cambiar el tenant de una cotización — el trigger debe bloquear a TODOS los roles.';
  exception
    when others then
      get stacked diagnostics v_err = message_text;
      perform pg_temp.fx_logout();
      if v_err not like 'No se puede cambiar el tenant%' then
        raise exception 'FALLÓ (7b): el UPDATE de tenant (superadmin) falló, pero con un error inesperado: %', v_err;
      end if;
  end;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (7): el trigger bloquea el cambio de tenant para cualquier rol, incluido superadmin.';

  -- ══ 8. Usuario inactivo (fixture, nunca una cuenta real) rechazado en SELECT e INSERT ══
  perform pg_temp.fx_login(fx_inactivo);
  select count(*) into v_count from public.cotizaciones where id = id_may;
  perform pg_temp.fx_logout();
  if v_count <> 0 then
    raise exception 'FALLÓ (8a): un usuario desactivado ve una cotización de su propio tenant (mi_rol() no lo está bloqueando).';
  end if;
  begin
    perform pg_temp.fx_login(fx_inactivo);
    insert into public.cotizaciones (codigo, tipo, estado, cliente, tenant)
      values ('TEST-RLS-INSERT-INACTIVO', 'manual', 'abierta', 'no debería insertarse', 'mayorista');
    perform pg_temp.fx_logout();
    raise exception 'FALLÓ (8b): un usuario desactivado pudo insertar una cotización.';
  exception
    when insufficient_privilege then
      perform pg_temp.fx_logout();
  end;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (8): usuario desactivado (fixture) no ve ni puede insertar ninguna cotización.';

  -- ══ 9. Perfil ausente (UUID que no existe en usuarios NI en auth.users)
  -- rechazado en SELECT e INSERT — mismo criterio que resolverContextoCotizacion()
  -- en el código de la aplicación (falla cerrado si no hay perfil). ══
  perform pg_temp.fx_login(fx_fantasma);
  select count(*) into v_count from public.cotizaciones where id = id_may;
  perform pg_temp.fx_logout();
  if v_count <> 0 then
    raise exception 'FALLÓ (9a): un usuario sin perfil en public.usuarios ve una cotización — mi_rol() debería devolver NULL.';
  end if;
  begin
    perform pg_temp.fx_login(fx_fantasma);
    insert into public.cotizaciones (codigo, tipo, estado, cliente, tenant)
      values ('TEST-RLS-INSERT-FANTASMA', 'manual', 'abierta', 'no debería insertarse', 'mayorista');
    perform pg_temp.fx_logout();
    raise exception 'FALLÓ (9b): un usuario sin perfil pudo insertar una cotización.';
  exception
    when insufficient_privilege then
      perform pg_temp.fx_logout();
  end;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (9): un JWT sin fila en public.usuarios (perfil ausente) no ve ni puede insertar ninguna cotización.';

  -- ══ 10. Superadmin conserva alcance global (SELECT en ambos tenants) ══
  perform pg_temp.fx_login(fx_super);
  select count(*) into v_count from public.cotizaciones where id in (id_may, id_min);
  perform pg_temp.fx_logout();
  if v_count <> 2 then
    raise exception 'FALLÓ (10): superadmin debería ver las 2 cotizaciones fixture (alcance global), vio %', v_count;
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (10): superadmin conserva alcance global — ve ambas agencias.';

  -- ══ 11. Acceso anónimo devuelve 0 (o es rechazado antes de RLS) ══
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{}', true);
    select count(*) into v_count from public.cotizaciones where id in (id_may, id_min);
    reset role; perform set_config('request.jwt.claims', null, true);
    if v_count <> 0 then
      raise exception 'FALLÓ (11): el rol anon ve % de las cotizaciones fixture — debería ver 0.', v_count;
    end if;
    v_pruebas := v_pruebas + 1;
    raise notice 'OK (11): acceso anónimo devuelve 0 filas.';
  exception
    when insufficient_privilege then
      reset role; perform set_config('request.jwt.claims', null, true);
      v_pruebas := v_pruebas + 1;
      raise notice 'OK (11): acceso anónimo bloqueado incluso antes de RLS (permission denied) — 0 filas alcanzables de cualquier forma.';
  end;

  -- ══ 12. cotizacion_servicios no queda con MÁS alcance que su padre ══
  perform pg_temp.fx_login(fx_may);
  select
    (select count(*) from public.cotizaciones where id = id_min) as ve_padre,
    (select count(*) from public.cotizacion_servicios where id = serv_min) as ve_hijo
  into v_count, v_afectadas;
  perform pg_temp.fx_logout();
  if v_afectadas > v_count then
    raise exception 'FALLÓ (12): cotizacion_servicios quedó con MÁS alcance que su padre (ve_padre=%, ve_hijo=%).', v_count, v_afectadas;
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (12): cotizacion_servicios nunca alcanza más que su cotización padre.';

  -- ══ 13. INSERT/UPDATE cruzado rechazado en cotizacion_servicios (hijo) ══
  begin
    perform pg_temp.fx_login(fx_may);
    insert into public.cotizacion_servicios (cotizacion_id, tipo_servicio, nombre_servicio, costo_neto, valor)
      values (id_min, 'otro', 'TEST cruzado', 1000, 1300);
    perform pg_temp.fx_logout();
    raise exception 'FALLÓ (13a): se pudo insertar un servicio en la cotización de minorista desde una sesión de mayorista.';
  exception
    when insufficient_privilege then
      perform pg_temp.fx_logout();
  end;
  perform pg_temp.fx_login(fx_may);
  update public.cotizacion_servicios set valor = 999999 where id = serv_min;
  get diagnostics v_afectadas = row_count;
  perform pg_temp.fx_logout();
  if v_afectadas <> 0 then
    raise exception 'FALLÓ (13b): el UPDATE cruzado sobre cotizacion_servicios de minorista afectó % filas, debía afectar 0.', v_afectadas;
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (13): INSERT/UPDATE cruzados sobre cotizacion_servicios (hijo) rechazados igual que en el padre.';

  -- ══ 14. Prueba negativa: demuestra que el helper GENÉRICO `puede_ver_tenant()`
  -- (el de la migración 107, usado por ~10 tablas más) SÍ le habría dado a
  -- gerencia alcance global sobre la fila de la OTRA agencia — exactamente
  -- el defecto que este archivo corrige al NO usar ese helper para
  -- `cotizaciones`, sino el `puede_ver_tenant_cotizacion()` nuevo. ══
  perform pg_temp.fx_login(fx_ger_min);
  select public.puede_ver_tenant('mayorista') into v_hubiera;
  select public.puede_ver_tenant_cotizacion('mayorista') into v_real;
  perform pg_temp.fx_logout();
  if not v_hubiera then
    raise exception 'FALLÓ (14): no se pudo evaluar puede_ver_tenant() para gerencia — revisar la sesión fixture.';
  end if;
  if v_real then
    raise exception 'FALLÓ (14): puede_ver_tenant_cotizacion(''mayorista'') evaluó TRUE para gerencia de minorista — debería ser FALSE (acotado a su propio tenant).';
  end if;
  v_pruebas := v_pruebas + 1;
  raise notice 'OK (14): confirmado — puede_ver_tenant(''mayorista'') evalúa TRUE para gerencia de minorista (alcance global, el criterio de las otras ~10 tablas); puede_ver_tenant_cotizacion(''mayorista'') es la función que SÍ usan las policies de cotizaciones, y acota a gerencia a su propio tenant (prueba 3).';

  -- ── Limpieza explícita de fixtures (además del ROLLBACK final, por si
  -- esto se llegara a correr fuera de una transacción envolvente) ────────
  delete from public.cotizacion_servicios where cotizacion_id in (id_may, id_min);
  delete from public.cotizaciones where id in (id_may, id_min);
  delete from public.usuarios where id in (fx_may, fx_min, fx_ger_may, fx_ger_min, fx_super, fx_inactivo);
  delete from auth.users where id in (fx_may, fx_min, fx_ger_may, fx_ger_min, fx_super, fx_inactivo);

  raise notice '─────────────────────────────────────────────────────────';
  raise notice 'RESUMEN: % pruebas OK. CERO saltadas (esta versión no tiene condicionales de "si existe tal usuario") — todas corren siempre sobre fixtures propios.', v_pruebas;
  -- 16 bloques incrementan v_pruebas: 1, 2, 3, 4, 4b, 5, 5b, 6, 7, 8, 9, 10,
  -- 11, 12, 13, 14 (4b/5b son sub-pruebas de gerencia dentro de los bloques
  -- de INSERT/UPDATE cruzado). Fijo a propósito: si un bloque futuro deja de
  -- incrementar v_pruebas (p. ej. porque una excepción lo saltó en silencio),
  -- este conteo deja de cuadrar y el script aborta en vez de reportarse OK.
  if v_pruebas <> 16 then
    raise exception 'RESUMEN INCONSISTENTE: se esperaban 16 pruebas OK, se contaron %. Revisar si algún bloque no incrementó v_pruebas.', v_pruebas;
  end if;
end $$;

rollback;
