-- Prueba de comportamiento de la migración 182
-- (tarifario_bloqueo_publicable). Ejecutar SOLO en Postgres local/desechable
-- después de aplicar la migración — termina en ROLLBACK, no persiste nada
-- (destinos/hoteles/armado_paquetes/tarifario_resultado/usuarios sintéticos
-- Y los `auth.users` sintéticos se deshacen con el `rollback;` final — no
-- hace falta ningún `delete` manual).
--
-- psql -d <base-local> -v ON_ERROR_STOP=1 \
--   -f supabase/scripts/test_182_tarifario_bloqueo_publicable.sql
--
-- ⚠️ Segunda ronda de auditoría, hallazgo 2 ("pruebas 11-19 se podían omitir
-- en silencio") — CORREGIDO: la versión anterior de este script dependía de
-- que YA existiera un usuario interno activo en la base; si no existía,
-- imprimía un AVISO y el bloque de pruebas 11-19 se saltaba por completo,
-- pero el mensaje final seguía siendo "TODAS LAS PRUEBAS TERMINARON EN OK" —
-- un entorno sin ese usuario previo podía "pasar" la batería sin haber
-- probado NADA del acceso por rol. Ahora:
--   · el usuario INTERNO y el usuario EXTERNO son ambos SINTÉTICOS, creados
--     dentro de esta misma transacción — ninguna prueba depende de datos
--     preexistentes;
--   · si por algún motivo la creación del usuario interno sintético fallara
--     (constraint inesperado, FK rota, etc.), el `insert`/`update` fallan con
--     una excepción real de Postgres que aborta TODO el script — nunca hay
--     una rama "si no se pudo, sáltate esto" que permita llegar al mensaje
--     final de éxito sin haber corrido las pruebas;
--   · no existe ningún `raise notice` de aviso-y-sigue para estas pruebas:
--     cada aserción usa `raise exception` en caso de fallo, igual que el
--     resto de la batería — el mensaje final de éxito solo se imprime si
--     TODAS las sentencias anteriores del bloque `do $$ ... $$` ejecutaron
--     sin abortar.
--
-- Cubre las reglas obligatorias de la Fase 2 Y los hallazgos de las DOS
-- rondas de auditoría (P1-a bypass directo, P1-b paquetes inactivos
-- existentes, P2 security_barrier, más los 3 de la segunda ronda: grant de
-- service_role, pruebas nunca omitidas, y el acceso real de service_role
-- verificado con una consulta, no solo con un grant de catálogo):
--   1. snapshot_publicable=false oculta el snapshot completo del paquete.
--   2. Un cambio aditivo que conserva publicable=true sigue mostrando el
--      snapshot anterior.
--   3. tarifario_estado='recalculando' con publicable=true NO oculta nada.
--   4. Publicación exitosa reactiva solo si el paquete está activo.
--   P1-a. anon/authenticated externo NO pueden leer tarifario_resultado
--         directo por paquete_id bloqueado — la tabla base también filtra,
--         no solo la vista. Un rol interno autorizado SÍ puede (diagnóstico).
--   P1-b. activo=false + snapshot_publicable=true (el DEFAULT de la 181 sin
--         trigger que lo corrija) queda oculto TANTO en la vista como en el
--         acceso directo a la tabla para anon/authenticated externo.
--   P2.   la vista tiene security_barrier=true.
--   service_role. tiene SELECT explícito sobre la vista (segunda ronda,
--         hallazgo 1) y el filtro de la vista se aplica también a él —
--         verificado con una consulta REAL bajo `set local role
--         service_role`, no solo revisando el catálogo de grants.
--   9. Bernalo no aplica aquí (no toca tarifario_resultado) — cubierto por
--      inspección de código en las pruebas de wiring TypeScript.

begin;

do $$
declare
  v_destino_id       bigint;
  v_hotel_id         bigint;
  v_paquete_pub      bigint; -- publicable = true,  activo = true
  v_paquete_bloq     bigint; -- publicable = false, activo = true
  v_paquete_recalc   bigint; -- publicable = true,  activo = true, estado = 'recalculando'
  v_paquete_inactivo bigint; -- publicable = true (DEFAULT sin corregir),  activo = false  ⚠️ P1-b
  v_count            bigint;
  v_count_resumen    bigint;
  v_usuario_interno  uuid;
  v_usuario_externo  uuid;
begin
  raise notice '── SETUP: 4 paquetes sintéticos con distintos estados de publicabilidad/actividad ──';

  insert into public.destinos (nombre) values ('__test_182_destino__')
    returning id into v_destino_id;
  insert into public.hoteles (destino_id, nombre) values (v_destino_id, '__test_182_hotel__')
    returning id into v_hotel_id;

  insert into public.armado_paquetes (nombre, tipo, activo, destino_id, tarifario_snapshot_publicable, tarifario_estado)
    values ('__test_182_paquete_publicable__', 'porcion_terrestre', true, v_destino_id, true, 'listo')
    returning id into v_paquete_pub;
  insert into public.armado_paquetes (nombre, tipo, activo, destino_id, tarifario_snapshot_publicable, tarifario_estado)
    values ('__test_182_paquete_bloqueado__', 'porcion_terrestre', true, v_destino_id, false, 'fallido')
    returning id into v_paquete_bloq;
  insert into public.armado_paquetes (nombre, tipo, activo, destino_id, tarifario_snapshot_publicable, tarifario_estado)
    values ('__test_182_paquete_recalculando__', 'porcion_terrestre', true, v_destino_id, true, 'recalculando')
    returning id into v_paquete_recalc;
  -- ⚠️ P1-b: simula el caso REAL que motivó la primera ronda de auditoría —
  -- `tarifario_snapshot_publicable` nace en `true` (DEFAULT de la 181) y
  -- nunca se corrige porque nadie volvió a hacer un UPDATE que disparara el
  -- trigger de invalidación. Para reproducir el estado desincronizado
  -- (`activo=false` PERO `snapshot_publicable=true`) hay que forzarlo en DOS
  -- pasos: el primer UPDATE (activo=false) SÍ dispara el trigger de la 181 y
  -- deja publicable=false correctamente — el segundo UPDATE fuerza de vuelta
  -- publicable=true para simular que esa corrección nunca ocurrió.
  insert into public.armado_paquetes (nombre, tipo, activo, destino_id, tarifario_snapshot_publicable, tarifario_estado)
    values ('__test_182_paquete_inactivo_snapshot_true__', 'porcion_terrestre', true, v_destino_id, true, 'listo')
    returning id into v_paquete_inactivo;
  update public.armado_paquetes set activo = false where id = v_paquete_inactivo;
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_inactivo;

  insert into public.tarifario_resultado (
    paquete_id, paquete_nombre, paquete_activo, modulo, hotel_id, hotel_nombre,
    destino_id, destino_nombre, categoria, regimen, acomodacion, precio_pvp, moneda
  ) values
    (v_paquete_pub, '__test_182_paquete_publicable__', true, 'porcion_terrestre', v_hotel_id, '__test_182_hotel__',
      v_destino_id, '__test_182_destino__', 'ESTANDAR', 'PC', 'sencilla', 100000, 'COP'),
    (v_paquete_bloq, '__test_182_paquete_bloqueado__', true, 'porcion_terrestre', v_hotel_id, '__test_182_hotel__',
      v_destino_id, '__test_182_destino__', 'ESTANDAR', 'PC', 'sencilla', 100000, 'COP'),
    (v_paquete_recalc, '__test_182_paquete_recalculando__', true, 'porcion_terrestre', v_hotel_id, '__test_182_hotel__',
      v_destino_id, '__test_182_destino__', 'ESTANDAR', 'PC', 'sencilla', 100000, 'COP'),
    (v_paquete_inactivo, '__test_182_paquete_inactivo_snapshot_true__', true, 'porcion_terrestre', v_hotel_id, '__test_182_hotel__',
      v_destino_id, '__test_182_destino__', 'ESTANDAR', 'PC', 'sencilla', 100000, 'COP');

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 1: publicable=true + activo=true — la fila aparece en tarifario_resultado_publicable ──';
  -------------------------------------------------------------------------
  select count(*) into v_count from public.tarifario_resultado_publicable where paquete_id = v_paquete_pub;
  if v_count <> 1 then
    raise exception 'FALLO 1: paquete publicable y activo debía tener 1 fila visible en la vista, hay %', v_count;
  end if;
  raise notice 'OK 1: paquete publicable y activo visible en tarifario_resultado_publicable.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 2 (regla 1): publicable=false — la fila NO aparece en tarifario_resultado_publicable ──';
  -------------------------------------------------------------------------
  select count(*) into v_count from public.tarifario_resultado_publicable where paquete_id = v_paquete_bloq;
  if v_count <> 0 then
    raise exception 'FALLO 2: paquete bloqueado NO debía tener filas visibles en la vista, hay %', v_count;
  end if;
  raise notice 'OK 2: paquete bloqueado (snapshot_publicable=false) queda oculto por completo en la vista.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 3 (P1-b, auditoría): activo=false CON snapshot_publicable=true (desincronizado a propósito) — la vista lo oculta igual ──';
  -------------------------------------------------------------------------
  select count(*) into v_count from public.tarifario_resultado_publicable where paquete_id = v_paquete_inactivo;
  if v_count <> 0 then
    raise exception 'FALLO 3: paquete inactivo con snapshot_publicable=true (desincronizado) NO debía tener filas visibles en la vista, hay %. La vista debe exigir activo=true POR SU CUENTA, no confiar en snapshot_publicable.', v_count;
  end if;
  raise notice 'OK 3: paquete inactivo con snapshot_publicable=true desincronizado queda oculto — la vista exige activo=true independientemente.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 4 (regla 3): tarifario_estado=recalculando CON publicable=true — la fila SIGUE visible ──';
  -------------------------------------------------------------------------
  select count(*) into v_count from public.tarifario_resultado_publicable where paquete_id = v_paquete_recalc;
  if v_count <> 1 then
    raise exception 'FALLO 4: recalculando con publicable=true debía seguir mostrando el snapshot anterior, hay %', v_count;
  end if;
  raise notice 'OK 4: tarifario_estado=recalculando por sí solo NO oculta nada mientras publicable=true y activo=true.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 5 (regla 2): cambio aditivo (nueva fila, snapshot sigue publicable) — el snapshot anterior sigue visible junto a la nueva ──';
  -------------------------------------------------------------------------
  insert into public.tarifario_resultado (
    paquete_id, paquete_nombre, paquete_activo, modulo, hotel_id, hotel_nombre,
    destino_id, destino_nombre, categoria, regimen, acomodacion, precio_pvp, moneda
  ) values (
    v_paquete_pub, '__test_182_paquete_publicable__', true, 'porcion_terrestre', v_hotel_id, '__test_182_hotel__',
    v_destino_id, '__test_182_destino__', 'ESTANDAR', 'PC', 'doble', 150000, 'COP'
  );
  -- El INSERT de arriba disparó tarifario_trg_bump_armado_directo (bloquea
  -- siempre, migración 181) — se fuerza de vuelta a publicable=true para
  -- simular el caso "cambio aditivo que CONSERVA publicable=true".
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_pub;
  select count(*) into v_count from public.tarifario_resultado_publicable where paquete_id = v_paquete_pub;
  if v_count <> 2 then
    raise exception 'FALLO 5: con publicable=true se esperaban las 2 filas (la anterior + la nueva), hay %', v_count;
  end if;
  raise notice 'OK 5: con publicable=true, tanto el snapshot anterior como el aditivo nuevo siguen visibles (2 filas).';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 6 (regla 4, simulada): re-publicación exitosa con paquete activo -> vuelve a ser visible ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set tarifario_snapshot_publicable = true, tarifario_estado = 'listo' where id = v_paquete_bloq;
  select count(*) into v_count from public.tarifario_resultado_publicable where paquete_id = v_paquete_bloq;
  if v_count <> 1 then
    raise exception 'FALLO 6: tras marcar publicable=true (simulando una publicación exitosa) el snapshot debía volver a verse, hay %', v_count;
  end if;
  raise notice 'OK 6: una publicación posterior (publicable=true, activo=true) vuelve a habilitar la lectura de la nueva versión.';
  update public.armado_paquetes set tarifario_snapshot_publicable = false, tarifario_estado = 'fallido' where id = v_paquete_bloq; -- restaura

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 7 (regla 4, paquete inactivo): activo=false -> queda oculto aunque nadie haya tocado publicable a mano ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set activo = false where id = v_paquete_pub;
  select count(*) into v_count from public.tarifario_resultado_publicable where paquete_id = v_paquete_pub;
  if v_count <> 0 then
    raise exception 'FALLO 7: paquete desactivado debía quedar oculto en la vista publicable, hay % filas', v_count;
  end if;
  raise notice 'OK 7: paquete inactivo permanece oculto (el trigger de la 181 ya puso publicable=false; la vista además exige activo=true por su cuenta).';
  -- Restaura en DOS pasos (nunca uno): reactivar `activo` es un cambio REAL
  -- que el trigger de la 181 detecta y usa para volver a poner
  -- snapshot_publicable=false DESPUÉS de este UPDATE — si se intentara
  -- restaurar snapshot_publicable=true en la MISMA sentencia, el trigger lo
  -- pisaría de todos modos (corre AFTER, en su propio UPDATE).
  update public.armado_paquetes set activo = true where id = v_paquete_pub;
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_pub;

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 8: tarifario_resumen (vista de Tier 1) hereda el mismo bloqueo ──';
  -------------------------------------------------------------------------
  select count(*) into v_count_resumen from public.tarifario_resumen where paquete_id = v_paquete_bloq;
  if v_count_resumen <> 0 then
    raise exception 'FALLO 8: tarifario_resumen no debía traer ninguna fila del paquete bloqueado, hay %', v_count_resumen;
  end if;
  select count(*) into v_count_resumen from public.tarifario_resumen where paquete_id = v_paquete_inactivo;
  if v_count_resumen <> 0 then
    raise exception 'FALLO 8: tarifario_resumen no debía traer ninguna fila del paquete inactivo (P1-b), hay %', v_count_resumen;
  end if;
  select count(*) into v_count_resumen from public.tarifario_resumen where paquete_id = v_paquete_pub;
  if v_count_resumen <> 1 then
    raise exception 'FALLO 8: tarifario_resumen debía traer 1 fila resumida del paquete publicable, hay %', v_count_resumen;
  end if;
  raise notice 'OK 8: tarifario_resumen hereda el bloqueo (0 filas del bloqueado, 0 del inactivo desincronizado, 1 fila resumida del publicable).';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 9: tarifario_resultado_publicable expone EXACTAMENTE las mismas columnas que tarifario_resultado (select r.*) ──';
  -------------------------------------------------------------------------
  declare
    v_count_base  bigint;
    v_count_vista bigint;
  begin
    select count(*) into v_count_base
      from information_schema.columns
      where table_schema = 'public' and table_name = 'tarifario_resultado';
    select count(*) into v_count_vista
      from information_schema.columns
      where table_schema = 'public' and table_name = 'tarifario_resultado_publicable';
    if v_count_vista <> v_count_base then
      raise exception 'FALLO 9: la vista publicable debía tener EXACTAMENTE las mismas % columnas que tarifario_resultado, tiene %', v_count_base, v_count_vista;
    end if;
    raise notice 'OK 9: tarifario_resultado_publicable expone el mismo número de columnas que tarifario_resultado (% columnas) — ninguna columna de armado_paquetes se filtró.', v_count_base;
  end;

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 10 (P2, auditoría): la vista tiene security_barrier=true ──';
  -------------------------------------------------------------------------
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tarifario_resultado_publicable'
      and c.reloptions::text ilike '%security_barrier=true%'
  ) then
    raise exception 'FALLO 10: tarifario_resultado_publicable debía tener security_barrier=true.';
  end if;
  raise notice 'OK 10: tarifario_resultado_publicable tiene security_barrier=true.';

  -------------------------------------------------------------------------
  raise notice '── SETUP POR ROL: usuario INTERNO y EXTERNO, ambos SINTÉTICOS, creados dentro de esta transacción (segunda ronda de auditoría, hallazgo 2 — nunca dependen de datos preexistentes; si algo aquí falla, el script aborta, nunca se salta) ──';
  -------------------------------------------------------------------------
  insert into auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role
  ) values (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
    '__test182_interno@example.com', crypt('test1234', gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'
  ) returning id into v_usuario_interno;
  -- El trigger de la migración 001 crea la fila espejo en public.usuarios con
  -- el rol default 'venta' — se corrige a 'superadmin' explícitamente. Si
  -- este UPDATE no afecta ninguna fila (el trigger no corrió, o la tabla
  -- cambió de forma inesperada), `get diagnostics` lo detecta y aborta con
  -- una excepción real — nunca una omisión silenciosa.
  update public.usuarios set rol = 'superadmin', activo = true where id = v_usuario_interno;
  if not found then
    raise exception 'FALLO SETUP: no se pudo preparar el usuario interno sintético (% ) — la fila espejo en public.usuarios no existe. Sin este usuario, las pruebas 11-22 no pueden certificar el acceso por rol; el script aborta en vez de omitirlas.', v_usuario_interno;
  end if;

  insert into auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role
  ) values (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
    '__test182_externo@example.com', crypt('test1234', gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'
  ) returning id into v_usuario_externo;
  update public.usuarios set rol = 'agencia', activo = true where id = v_usuario_externo;
  if not found then
    raise exception 'FALLO SETUP: no se pudo preparar el usuario externo sintético (%) — la fila espejo en public.usuarios no existe.', v_usuario_externo;
  end if;

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 11 (P1-a): anon leyendo tarifario_resultado DIRECTO por paquete_id BLOQUEADO -> 0 filas ──';
  -------------------------------------------------------------------------
  reset role;
  perform set_config('request.jwt.claims', '', true); -- anon no lleva claims
  execute 'set local role anon';
  select count(*) into v_count from public.tarifario_resultado where paquete_id = v_paquete_bloq;
  if v_count <> 0 then
    raise exception 'FALLO 11: anon leyendo tarifario_resultado DIRECTO por un paquete bloqueado debía obtener 0 filas (bypass de la tabla base), obtuvo %', v_count;
  end if;
  raise notice 'OK 11: anon consultando tarifario_resultado directo por un paquete bloqueado obtiene 0 filas.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 12 (P1-b): anon leyendo tarifario_resultado DIRECTO por el paquete INACTIVO con snapshot_publicable=true desincronizado -> 0 filas ──';
  -------------------------------------------------------------------------
  select count(*) into v_count from public.tarifario_resultado where paquete_id = v_paquete_inactivo;
  if v_count <> 0 then
    raise exception 'FALLO 12: anon leyendo tarifario_resultado directo por el paquete inactivo (snapshot_publicable=true desincronizado) debía obtener 0 filas, obtuvo %. La policy debe exigir activo=true, no confiar solo en snapshot_publicable.', v_count;
  end if;
  raise notice 'OK 12: anon consultando tarifario_resultado directo por el paquete inactivo desincronizado obtiene 0 filas — la policy exige activo=true por su cuenta.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 13: anon leyendo tarifario_resultado DIRECTO por el paquete PUBLICABLE -> sí ve filas (no se rompió el acceso público legítimo) ──';
  -------------------------------------------------------------------------
  select count(*) into v_count from public.tarifario_resultado where paquete_id = v_paquete_pub;
  if v_count <> 2 then
    raise exception 'FALLO 13: anon leyendo tarifario_resultado directo por el paquete publicable debía obtener 2 filas, obtuvo %', v_count;
  end if;
  raise notice 'OK 13: anon SÍ puede leer tarifario_resultado directo de un paquete publicable y activo (2 filas) — el acceso público legítimo no se rompió.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 14 (P1-a): authenticated EXTERNO (rol=agencia, no interno) leyendo tarifario_resultado DIRECTO por paquete BLOQUEADO -> 0 filas ──';
  -------------------------------------------------------------------------
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_usuario_externo::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if coalesce(public.mi_rol()::text, '<null>') <> 'agencia' then
    raise exception 'FALLO SETUP 14: mi_rol() no resolvió al externo esperado (agencia), obtuvo %', coalesce(public.mi_rol()::text, '<null>');
  end if;
  select count(*) into v_count from public.tarifario_resultado where paquete_id = v_paquete_bloq;
  if v_count <> 0 then
    raise exception 'FALLO 14: authenticated externo (agencia) leyendo tarifario_resultado directo por un paquete bloqueado debía obtener 0 filas, obtuvo %', v_count;
  end if;
  raise notice 'OK 14: authenticated externo (rol=agencia, no interno) consultando tarifario_resultado directo por un paquete bloqueado obtiene 0 filas.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 15 (P1-b): authenticated EXTERNO leyendo tarifario_resultado DIRECTO por el paquete inactivo desincronizado -> 0 filas ──';
  -------------------------------------------------------------------------
  select count(*) into v_count from public.tarifario_resultado where paquete_id = v_paquete_inactivo;
  if v_count <> 0 then
    raise exception 'FALLO 15: authenticated externo leyendo tarifario_resultado directo por el paquete inactivo desincronizado debía obtener 0 filas, obtuvo %', v_count;
  end if;
  raise notice 'OK 15: authenticated externo consultando el paquete inactivo desincronizado obtiene 0 filas.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 16: authenticated EXTERNO leyendo tarifario_resultado_publicable (la VISTA) por el paquete BLOQUEADO -> 0 filas ──';
  -------------------------------------------------------------------------
  select count(*) into v_count from public.tarifario_resultado_publicable where paquete_id = v_paquete_bloq;
  if v_count <> 0 then
    raise exception 'FALLO 16: la vista publicable debía ocultar el paquete bloqueado también bajo authenticated externo, obtuvo %', v_count;
  end if;
  raise notice 'OK 16: la vista publicable oculta el paquete bloqueado bajo authenticated externo.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 17 (P1-a, "diagnóstico interno preservado"): usuario INTERNO sintético (superadmin) leyendo tarifario_resultado DIRECTO por paquete BLOQUEADO -> SÍ ve la fila ──';
  -------------------------------------------------------------------------
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_usuario_interno::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if coalesce(public.mi_rol()::text, '<null>') <> 'superadmin' then
    raise exception 'FALLO SETUP 17: mi_rol() no resolvió al interno sintético esperado (superadmin), obtuvo %', coalesce(public.mi_rol()::text, '<null>');
  end if;
  select count(*) into v_count from public.tarifario_resultado where paquete_id = v_paquete_bloq;
  if v_count <> 1 then
    raise exception 'FALLO 17: un usuario interno autorizado (superadmin) debía poder leer tarifario_resultado directo de un paquete bloqueado (diagnóstico), obtuvo % filas', v_count;
  end if;
  raise notice 'OK 17: usuario interno sintético (rol=superadmin) SÍ puede leer tarifario_resultado directo de un paquete bloqueado — diagnóstico preservado.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 18 (P1-b, diagnóstico interno): usuario INTERNO leyendo tarifario_resultado DIRECTO por el paquete inactivo desincronizado -> SÍ ve la fila ──';
  -------------------------------------------------------------------------
  select count(*) into v_count from public.tarifario_resultado where paquete_id = v_paquete_inactivo;
  if v_count <> 1 then
    raise exception 'FALLO 18: un usuario interno autorizado debía poder leer tarifario_resultado directo del paquete inactivo desincronizado (diagnóstico), obtuvo % filas', v_count;
  end if;
  raise notice 'OK 18: usuario interno autorizado SÍ puede leer el paquete inactivo desincronizado directo — diagnóstico preservado.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 19 ("la vista oculta incluso para consultas internas"): usuario INTERNO leyendo tarifario_resultado_publicable (la VISTA) por el paquete BLOQUEADO -> 0 filas, aunque la TABLA sí se lo mostrara en la prueba 17 ──';
  -------------------------------------------------------------------------
  select count(*) into v_count from public.tarifario_resultado_publicable where paquete_id = v_paquete_bloq;
  if v_count <> 0 then
    raise exception 'FALLO 19: la vista publicable debía ocultar el paquete bloqueado incluso bajo un rol interno (la vista no distingue rol, siempre filtra), obtuvo %', v_count;
  end if;
  select count(*) into v_count from public.tarifario_resultado_publicable where paquete_id = v_paquete_inactivo;
  if v_count <> 0 then
    raise exception 'FALLO 19: la vista publicable debía ocultar el paquete inactivo desincronizado incluso bajo un rol interno, obtuvo %', v_count;
  end if;
  raise notice 'OK 19: la vista publicable oculta paquetes bloqueados/inactivos SIEMPRE, incluso bajo un rol interno que sí puede verlos en la tabla cruda (la vista es la única fuente segura para servir el tarifario en vivo).';

  -------------------------------------------------------------------------
  raise notice '── PRUEBAS 20-22 (segunda ronda de auditoría, hallazgo 1 — service_role): consulta REAL bajo SET LOCAL ROLE service_role sobre la vista, no solo un grant de catálogo ──';
  -------------------------------------------------------------------------
  reset role;
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role service_role';

  -- Prueba 20: paquete publicable y activo -> visible.
  select count(*) into v_count from public.tarifario_resultado_publicable where paquete_id = v_paquete_pub;
  if v_count <> 2 then
    raise exception 'FALLO 20: service_role consultando la vista por el paquete publicable y activo debía obtener 2 filas, obtuvo %. Si esto falla con "permission denied", falta el grant explícito de SELECT a service_role sobre la vista.', v_count;
  end if;
  raise notice 'OK 20: service_role SÍ puede leer tarifario_resultado_publicable de un paquete publicable y activo (2 filas) — el grant explícito de SELECT funciona.';

  -- Prueba 21: snapshot_publicable=false -> oculto incluso para service_role.
  select count(*) into v_count from public.tarifario_resultado_publicable where paquete_id = v_paquete_bloq;
  if v_count <> 0 then
    raise exception 'FALLO 21: service_role NO debía poder recuperar por la vista un paquete bloqueado (snapshot_publicable=false), obtuvo % filas.', v_count;
  end if;
  raise notice 'OK 21: service_role consultando la vista por el paquete bloqueado obtiene 0 filas — el filtro de la vista se aplica también a service_role.';

  -- Prueba 22: activo=false aunque snapshot_publicable=true (P1-b) -> oculto
  -- también para service_role.
  select count(*) into v_count from public.tarifario_resultado_publicable where paquete_id = v_paquete_inactivo;
  if v_count <> 0 then
    raise exception 'FALLO 22: service_role NO debía poder recuperar por la vista el paquete inactivo desincronizado (activo=false, snapshot_publicable=true), obtuvo % filas.', v_count;
  end if;
  raise notice 'OK 22: service_role consultando la vista por el paquete inactivo desincronizado obtiene 0 filas — ni service_role puede saltarse el filtro de activo=true.';

  reset role;

  raise notice '── TODAS LAS PRUEBAS (1-22) EJECUTARON Y TERMINARON EN OK — ninguna se omitió ──';
end $$;

rollback;
-- ⚠️ ROLLBACK: ninguna fila sintética (destinos/hoteles/armado_paquetes/
-- tarifario_resultado/usuarios/auth.users, incluidos los usuarios interno y
-- externo sintéticos de las pruebas 11-22) queda persistida.
