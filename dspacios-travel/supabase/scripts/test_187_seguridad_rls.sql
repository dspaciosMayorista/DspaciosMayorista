-- ─────────────────────────────────────────────────────────────────────────
-- AUDITORÍA DE SEGURIDAD · buscar_pasajero_por_documento (migración 187)
-- correr en el editor SQL de Supabase, DESPUÉS de aplicar la 187.
--
-- Por qué existe este archivo aparte de test_187_busqueda_pasajero.sql:
-- `buscar_pasajero_por_documento` es SECURITY DEFINER y hace `join
-- public.ventas` — eso bypasea a propósito la RLS de `ventas` (mismo
-- mecanismo que ya usan `puede_ver_contrato`/`_autorizado_escribir_
-- pasajeros`). El aislamiento real depende de que `mi_rol()`/`auth.uid()`
-- (que leen la GUC de sesión `request.jwt.claims`) sigan resolviendo al
-- usuario REAL que invocó la función, incluso DENTRO de una cadena de
-- llamadas SECURITY DEFINER — y de que las condiciones explícitas del WHERE
-- (`puede_ver_contrato` + `soy_asesor_del_contrato`) hagan lo que dicen que
-- hacen. Nada de esto se presupone aquí: se prueba en vivo, impersonando
-- cada rol con `set_config('request.jwt.claims', ...)` (el MISMO mecanismo
-- que usa PostgREST en producción) y observando qué devuelve la función.
--
-- 100% AUTO-CONTENIDO: crea su propio asesor, sus propios 3 contratos (dos
-- tenants distintos + un contrato "ajeno" del mismo tenant) y usa un usuario
-- YA EXISTENTE de la base (cualquiera — se le cambia el rol/tenant/nombre
-- TEMPORALMENTE con UPDATE, dentro de esta misma transacción) para
-- impersonar cada escenario. Por eso NINGÚN escenario crítico se reporta
-- como OMITIDO por falta de datos "de casualidad" en esta base — la única
-- excepción real es una base con CERO usuarios en `public.usuarios`, un
-- caso que se detecta explícitamente y hace fallar el resumen (no se puede
-- probar aislamiento por rol sin al menos un usuario a quien impersonar).
--
-- Es de solo lectura sobre los datos reales: todo lo que inserta/actualiza
-- vive dentro de esta transacción y se descarta con ROLLBACK al final — el
-- usuario "prestado" queda exactamente como estaba.
--
-- Escenarios:
--   1) Identidad propagada DIRECTO (sanity check del propio mecanismo de
--      impersonación: mi_rol() sin pasar por la función bajo prueba).
--   2) Identidad propagada A TRAVÉS de la función SECURITY DEFINER: `venta`
--      asignado a un contrato ve EXACTAMENTE ese contrato — prueba en vivo
--      de que auth.uid()/mi_rol() no se pierden ni se genericalizan dentro
--      de la cadena SECURITY DEFINER.
--   3) `venta` — contrato PROPIO (misma agencia, asesor asignado) → SÍ ve.
--   4) `venta` — contrato AJENO, MISMA agencia, otro asesor → NO ve
--      (aislamiento "por contrato propio").
--   5) `venta` — contrato de la OTRA agencia → NO ve. Esto es aislamiento
--      por AGENCIA ASIGNADA (`usuarios.tenant`, columna fija del usuario en
--      su perfil) — NO "agencia activa": ese término es el del selector
--      `TenantSwitcher` (cookie de UI, exclusivo de `superadmin`, ver
--      CLAUDE.md sección "Multitenant"); `venta` ni tiene ese selector.
--   6) `superadmin` → ve LAS DOS agencias, SIEMPRE — ver la nota de
--      DECISIÓN DE PERMISOS más abajo (⚠️).
--   7) `gerencia` → ve LAS DOS agencias, SIEMPRE — misma nota.
--   8) `administracion`/`operaciones` de la agencia A → ve A, NO ve B.
--   9) `administracion`/`operaciones` de la agencia B → ve B, NO ve A
--      (simétrico — confirma que no está "hardcodeado" a una agencia).
--  10) Usuario interno DESACTIVADO (activo=false) → excepción explícita
--      (antes de esta revisión, un `not in` desnudo dejaba pasar a un
--      usuario inactivo SIN excepción — sin fuga de datos, porque el WHERE
--      también fallaba cerrado, pero con un mensaje ausente; corregido en
--      la propia migración 187).
--  11) Usuario externo ACTIVO (rol 'agencia'/'freelance'/'cliente_final')
--      → excepción explícita, ANTES de tocar contrato_pasajeros/ventas.
--  12) Sin sesión (rol `anon`, sin JWT) → excepción (permiso denegado por
--      el GRANT, ni siquiera entra al cuerpo de la función).
--
-- LECTURA DEL RESULTADO: cualquier fila cuyo `resultado` EMPIECE por 'FALLA'
-- hace fallar el resumen (chequeo con `like 'FALLA%'`, nunca igualdad
-- exacta). 'OMITIDO' nunca cuenta como aprobado.
--
-- ⚠️ DECISIÓN DE PERMISOS ACTUAL (documentada, NO cambiada aquí — ver el
-- pendiente al final de este comentario):
-- `superadmin` y `gerencia` encuentran pasajeros de LAS DOS agencias con
-- esta búsqueda, SIEMPRE — incluso si en el dashboard tienen seleccionada
-- una sola "agencia activa" (cookie de `TenantSwitcher`, ver CLAUDE.md).
-- Esto NO es un bug de esta migración: es el mismo comportamiento que ya
-- tiene `puede_ver_contrato()` desde la migración 144 —
-- `mi_rol() in ('superadmin','gerencia')` le da acceso a TODO tenant sin
-- mirar `puede_ver_tenant()` en absoluto, y esa función tampoco lee la
-- cookie de `TenantSwitcher` en ningún punto: esa cookie es un filtro de
-- UI para listados (qué tenant se ve por defecto en pantallas como
-- `/dashboard/ventas`), NUNCA una condición que la RLS o los RPC SECURITY
-- DEFINER evalúen. `buscar_pasajero_por_documento` hereda exactamente ese
-- mismo criterio (reutiliza `puede_ver_contrato`) — no inventa uno nuevo ni
-- lo reduce. `administracion`/`operaciones`/`venta` SÍ quedan acotados a su
-- `usuarios.tenant` fijo, sin excepción.
--
-- Si el comportamiento ESPERADO del selector "agencia activa" es que un
-- superadmin/gerencia con una sola agencia seleccionada NO deba encontrar
-- pasajeros de la otra agencia en ESTA búsqueda puntual — sería un cambio
-- de criterio respecto al patrón ya establecido en el resto del sistema, y
-- exigiría decidir de dónde sale ese contexto de "agencia activa" dentro de
-- un RPC SECURITY DEFINER (hoy no hay ninguna cookie ni GUC de sesión que
-- lo transporte hasta la base — `mi_tenant()` lee `usuarios.tenant`, no la
-- cookie). Esta migración NO tomó esa decisión por su cuenta: los
-- escenarios 6/7 de abajo prueban y documentan el comportamiento VIGENTE
-- (heredado, consistente con el resto del sistema), no lo cambian. Si se
-- decide que debe ser distinto, es un cambio de diseño en
-- `buscar_pasajero_por_documento` (y potencialmente en `puede_ver_contrato`
-- mismo, que lo comparten muchas otras piezas) — pendiente de decisión del
-- dueño antes de tocar el RPC.
--
-- ✅ DECISIÓN APROBADA POR EL DUEÑO: mantener el criterio heredado. Los
-- escenarios 6/7 de abajo (superadmin/gerencia ven las DOS agencias) NO son
-- un defecto a corregir — son el comportamiento esperado, y así deben
-- seguir pasando. `venta` (escenarios 3/4/5) sigue acotado a sus propios
-- contratos, sin excepción.
-- ─────────────────────────────────────────────────────────────────────────

begin;

create temp table _t187_sec (caso text, resultado text, detalle text) on commit drop;

-- ⚠️ CORRECCIÓN (revisión posterior): la tabla temporal la crea el rol de
-- la sesión (típicamente `postgres`/el rol del editor SQL) — por defecto
-- SOLO ese rol (el dueño) puede escribirla. La mayoría de los escenarios de
-- abajo hacen `execute 'set local role authenticated'` y ESCRIBEN el
-- resultado del escenario TODAVÍA impersonando ese rol (antes de volver con
-- `reset role`) — sin este GRANT, cada uno de esos INSERT fallaba con
-- "permission denied for table _t187_sec", la excepción se propagaba hasta
-- el `exception when others` de más afuera, y el test entero abortaba
-- después del primer escenario que impersonara un rol (perdiendo los
-- escenarios 6-12 en silencio, aunque el resumen SÍ marcaba FALLA gracias
-- al guard de filas de más abajo — pero nunca llegaba a probar nada después
-- del primero). El rol `anon` también necesita el permiso por si algún
-- escenario llegara a escribir antes de un `reset role` (hoy el de la 12 no
-- lo hace, pero conviene no depender de ese orden). Migración 187, revisión
-- posterior sobre este archivo.
grant select, insert on _t187_sec to authenticated, anon;

do $$
declare
  v_actor_id      uuid;
  v_asesor_email  constant text := 'prueba187.seguridad@test.local';
  -- Formato exigido por el CHECK de la migración 160
  -- (`ventas_numero_contrato_formato_por_tenant`): mayorista SIEMPRE
  -- `^DTM-[0-9]{4,}$` (mínimo 4 dígitos, nada más que dígitos después del
  -- guion); minorista SIEMPRE con el prefijo `^MIN-` (sin exigir dígitos).
  -- Un valor fuera de ese formato hace que el INSERT de `ventas` de más
  -- abajo falle con una violación de CHECK — abortando el fixture (y, por
  -- el GRANT/manejo de excepciones de este archivo, produciendo un
  -- resultado inequívoco, nunca un falso aprobado — pero sin llegar a
  -- probar nada).
  --
  -- Sufijo NUMÉRICO derivado de fecha/hora (`clock_timestamp()`, el reloj
  -- real al momento de correr — no `now()`, que es fijo para toda la
  -- transacción) en vez de un número fijo: dos corridas de este script no
  -- pueden colisionar entre sí, ni con un `numero_contrato` real, sin
  -- depender de que nadie más elija ese mismo valor a mano.
  -- `YYYYMMDDHH24MISSUS` = solo dígitos (sin separadores), 20 caracteres —
  -- cumple de sobra el mínimo de 4 dígitos del CHECK. `v_num_a`/`v_num_c`
  -- comparten el mismo sufijo de reloj pero se distinguen con un dígito
  -- final distinto (evita depender de que dos llamadas a
  -- `clock_timestamp()` devuelvan microsegundos distintos).
  v_sufijo_ts     constant text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
  v_num_a         constant text := 'DTM-' || v_sufijo_ts || '1'; -- mayorista, asesor conocido
  v_num_b         constant text := 'MIN-' || v_sufijo_ts; -- minorista (la OTRA agencia)
  v_num_c         constant text := 'DTM-' || v_sufijo_ts || '3'; -- mayorista, MISMO tenant que A, sin asesor (ajeno)
  v_doc           constant text := '900187555';
  v_asesor_id     bigint;
  n int;
  v_ve_a boolean; v_ve_b boolean; v_ve_c boolean;
  v_rol_directo text;
begin
  -- ── Setup: usuario prestado + asesor + 3 contratos de prueba ────────────
  select id into v_actor_id from public.usuarios order by id limit 1;
  if v_actor_id is null then
    insert into _t187_sec values ('setup', 'FALLA', 'No hay NINGÚN usuario en public.usuarios — no se puede probar aislamiento por rol. Crear al menos un usuario y volver a correr.');
    return;
  end if;

  insert into public.asesores (nombre, email, activo) values ('Prueba 187 Seguridad', v_asesor_email, true)
    returning id into v_asesor_id;

  insert into public.ventas (numero_contrato, tenant, asesor, cliente, estado)
    values (v_num_a, 'mayorista', v_asesor_email, 'PRUEBA187', 'activo');
  insert into public.ventas (numero_contrato, tenant, asesor, cliente, estado)
    values (v_num_b, 'minorista', null, 'PRUEBA187', 'activo');
  insert into public.ventas (numero_contrato, tenant, asesor, cliente, estado)
    values (v_num_c, 'mayorista', null, 'PRUEBA187', 'activo'); -- mismo tenant que A, SIN asesor asignado → "ajeno" para venta

  insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, orden)
    values (v_num_a, 'TEST187 CONTRATO A', 'CC', v_doc, 999);
  insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, orden)
    values (v_num_b, 'TEST187 CONTRATO B', 'CC', v_doc, 999);
  insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, orden)
    values (v_num_c, 'TEST187 CONTRATO C', 'CC', v_doc, 999);

  -- ── 1/2/3/4/5) Rol `venta`, asignado como asesor SOLO del contrato A ────
  update public.usuarios set rol = 'venta', tenant = 'mayorista', activo = true, email = v_asesor_email
   where id = v_actor_id;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);

  select public.mi_rol()::text into v_rol_directo;
  insert into _t187_sec values ('1-identidad-directa', case when v_rol_directo = 'venta' then 'OK' else 'FALLA' end, 'mi_rol() directo = ' || coalesce(v_rol_directo, 'NULL') || ' (esperado venta) — sanity check del mecanismo de impersonación.');

  select
    bool_or(nombre = 'TEST187 CONTRATO A'),
    bool_or(nombre = 'TEST187 CONTRATO B'),
    bool_or(nombre = 'TEST187 CONTRATO C')
    into v_ve_a, v_ve_b, v_ve_c
    from public.buscar_pasajero_por_documento('CC', v_doc);

  insert into _t187_sec values ('2-identidad-propagada-security-definer', case when coalesce(v_ve_a, false) then 'OK' else 'FALLA' end, 'venta asignado a A debe verlo A TRAVÉS de la función SECURITY DEFINER — si esto falla, auth.uid()/mi_rol() se están perdiendo dentro de la cadena.');
  insert into _t187_sec values ('3-venta-contrato-propio', case when coalesce(v_ve_a, false) then 'OK' else 'FALLA' end, 'Debe ver su propio contrato (A).');
  insert into _t187_sec values ('4-venta-contrato-ajeno-misma-agencia', case when not coalesce(v_ve_c, false) then 'OK' else 'FALLA (FUGA)' end, 'NO debe ver un contrato de la MISMA agencia asignado a otro asesor (C).');
  insert into _t187_sec values ('5-venta-otra-agencia', case when not coalesce(v_ve_b, false) then 'OK' else 'FALLA (FUGA cross-tenant)' end, 'NO debe ver un contrato de la OTRA agencia (B), aunque el documento coincida.');

  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- ── 6) superadmin → ve las dos agencias ──────────────────────────────────
  update public.usuarios set rol = 'superadmin', tenant = 'mayorista', activo = true where id = v_actor_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
  select bool_or(nombre = 'TEST187 CONTRATO A'), bool_or(nombre = 'TEST187 CONTRATO B') into v_ve_a, v_ve_b
    from public.buscar_pasajero_por_documento('CC', v_doc);
  insert into _t187_sec values ('6-superadmin-ve-ambas-agencias', case when coalesce(v_ve_a, false) and coalesce(v_ve_b, false) then 'OK' else 'FALLA' end, format('ve_a=%s ve_b=%s (esperado true/true)', v_ve_a, v_ve_b));
  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- ── 7) gerencia → ve las dos agencias ────────────────────────────────────
  update public.usuarios set rol = 'gerencia', tenant = 'mayorista', activo = true where id = v_actor_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
  select bool_or(nombre = 'TEST187 CONTRATO A'), bool_or(nombre = 'TEST187 CONTRATO B') into v_ve_a, v_ve_b
    from public.buscar_pasajero_por_documento('CC', v_doc);
  insert into _t187_sec values ('7-gerencia-ve-ambas-agencias', case when coalesce(v_ve_a, false) and coalesce(v_ve_b, false) then 'OK' else 'FALLA' end, format('ve_a=%s ve_b=%s (esperado true/true)', v_ve_a, v_ve_b));
  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- ── 8) administracion de la agencia A → ve A, no B ───────────────────────
  update public.usuarios set rol = 'administracion', tenant = 'mayorista', activo = true where id = v_actor_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
  select bool_or(nombre = 'TEST187 CONTRATO A'), bool_or(nombre = 'TEST187 CONTRATO B') into v_ve_a, v_ve_b
    from public.buscar_pasajero_por_documento('CC', v_doc);
  insert into _t187_sec values ('8-administracion-agencia-a', case when coalesce(v_ve_a, false) and not coalesce(v_ve_b, false) then 'OK' else 'FALLA' end, format('ve_a=%s ve_b=%s (esperado true/false)', v_ve_a, v_ve_b));
  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- ── 9) operaciones de la agencia B → ve B, no A (simétrico) ──────────────
  update public.usuarios set rol = 'operaciones', tenant = 'minorista', activo = true where id = v_actor_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
  select bool_or(nombre = 'TEST187 CONTRATO A'), bool_or(nombre = 'TEST187 CONTRATO B') into v_ve_a, v_ve_b
    from public.buscar_pasajero_por_documento('CC', v_doc);
  insert into _t187_sec values ('9-operaciones-agencia-b', case when coalesce(v_ve_b, false) and not coalesce(v_ve_a, false) then 'OK' else 'FALLA' end, format('ve_a=%s ve_b=%s (esperado false/true)', v_ve_a, v_ve_b));
  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- ── 10) usuario interno DESACTIVADO → excepción explícita ────────────────
  update public.usuarios set rol = 'venta', tenant = 'mayorista', activo = false where id = v_actor_id;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
    perform * from public.buscar_pasajero_por_documento('CC', v_doc);
    reset role;
    insert into _t187_sec values ('10-usuario-inactivo', 'FALLA', 'Un usuario interno desactivado debía recibir una excepción explícita y no la recibió.');
  exception when others then
    reset role;
    insert into _t187_sec values ('10-usuario-inactivo', case when sqlerrm like '%Sin permiso%' then 'OK' else 'FALLA' end, 'Rechazado: ' || sqlerrm);
  end;
  update public.usuarios set activo = true where id = v_actor_id;

  -- ── 11) usuario externo ACTIVO (rol agencia) → excepción explícita ───────
  update public.usuarios set rol = 'agencia', tenant = 'mayorista', activo = true where id = v_actor_id;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
    perform * from public.buscar_pasajero_por_documento('CC', v_doc);
    reset role;
    insert into _t187_sec values ('11-usuario-externo-agencia', 'FALLA', 'Un rol externo (agencia) debía recibir una excepción y no la recibió.');
  exception when others then
    reset role;
    insert into _t187_sec values ('11-usuario-externo-agencia', case when sqlerrm like '%Sin permiso%' then 'OK' else 'FALLA' end, 'Rechazado: ' || sqlerrm);
  end;

  -- ── 12) sin sesión (anon) → excepción ─────────────────────────────────────
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', null, true);
    perform * from public.buscar_pasajero_por_documento('CC', v_doc);
    reset role;
    insert into _t187_sec values ('12-sin-sesion-anon', 'FALLA', 'Debía lanzar excepción (permiso denegado por el GRANT) y no la lanzó.');
  exception when others then
    reset role;
    insert into _t187_sec values ('12-sin-sesion-anon', 'OK', 'Rechazado: ' || sqlerrm);
  end;

exception when others then
  reset role;
  insert into _t187_sec values ('EXCEPCION-NO-CAPTURADA', 'FALLA', sqlerrm);
end $$;

-- Un único SELECT final — JSON con `veredicto` + `mensaje` + el detalle de
-- los 12 casos (`casos`), en vez de dos SELECTs sueltos (uno con las filas
-- crudas, otro con el texto del veredicto): más fácil de pegar en un reporte
-- y de comparar programáticamente entre corridas.
--
-- Veredicto — NUNCA "OK" por defecto. Un test que no logró correr (0 filas)
-- o que corrió solo a medias (abortó tras un escenario, GRANT insuficiente,
-- cualquier error propio no anticipado) debe leerse como FALLA/INCOMPLETO,
-- jamás como una aprobación silenciosa. El orden de los `when` importa: se
-- revisa primero "sin filas" (el caso más grave — ni siquiera el catch-all
-- de más afuera logró escribir), luego cualquier FALLA explícita, luego
-- "setup" incompleto (fixture no armable en esta base), luego un conteo de
-- filas distinto al esperado (12 escenarios — señal de que el DO block
-- abortó a mitad de camino sin que ninguna fila individual quedara marcada
-- FALLA), y solo al final OMITIDO/OK.
select jsonb_build_object(
  'veredicto',
    case
      when not exists (select 1 from _t187_sec) then 'FALLA'
      when exists (select 1 from _t187_sec where resultado like 'FALLA%') then 'FALLA'
      when exists (select 1 from _t187_sec where caso = 'setup') then 'INCOMPLETO'
      when (select count(*) from _t187_sec) <> 12 then 'INCOMPLETO'
      when exists (select 1 from _t187_sec where resultado = 'OMITIDO') then 'INCOMPLETO'
      else 'OK'
    end,
  'mensaje',
    case
      when not exists (select 1 from _t187_sec)
        then 'El test no produjo NINGÚN resultado (posible error catastrófico antes del primer INSERT, p. ej. el propio GRANT o la creación de fixtures); esto NUNCA es una aprobación.'
      when exists (select 1 from _t187_sec where resultado like 'FALLA%')
        then 'Revisar los casos con resultado FALLA en "casos". Esto es un hallazgo de seguridad, no un detalle cosmético.'
      when exists (select 1 from _t187_sec where caso = 'setup')
        then 'No se pudo armar el fixture en esta base (ver el detalle del caso "setup" en "casos"); no se probó nada.'
      when (select count(*) from _t187_sec) <> 12
        then 'Se esperaban 12 casos y se registraron ' || (select count(*)::text from _t187_sec) || '; el DO block pudo abortar a mitad de camino. Revisar el último caso en "casos".'
      when exists (select 1 from _t187_sec where resultado = 'OMITIDO')
        then 'Hay casos OMITIDOS; esto NO es una aprobación.'
      else 'Identidad propagada correctamente y aislamiento confirmado por rol/agencia/contrato propio, en los 12 casos.'
    end,
  'casos', coalesce((select jsonb_agg(jsonb_build_object('caso', caso, 'resultado', resultado, 'detalle', detalle) order by caso) from _t187_sec), '[]'::jsonb)
) as resultado_test_187_seguridad;

-- Nada de esto se conserva: los datos de prueba y el usuario "prestado"
-- quedan exactamente como estaban antes de correr este script.
rollback;
