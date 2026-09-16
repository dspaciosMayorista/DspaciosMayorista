-- Postcheck 179. Corre DESPUÉS de aplicar la migración 179.
--
-- ⚠️ Paso 3 de 4 del orden OBLIGATORIO de despliegue — ver la cabecera de
-- 20260601000179_tarifa_hotel_precio_final_autoritativo.sql. Las migraciones
-- 177/178 YA están aplicadas remotamente; este script solo valida la 179.
--
-- Las secciones 1-4 son de solo lectura. Las secciones 5, 6 y 7 (mutantes)
-- usan SIEMPRE una fila/hotel_id/usuario REAL Y EXISTENTE — nunca un id
-- inventado (violaría la FK de todas formas; la única excepción es el `sub`
-- ficticio de 7b, que a propósito NO existe en `usuarios`, para probar el
-- rechazo). Cada sección corre dentro de su PROPIA transacción que termina en
-- `rollback` — ningún dato ni configuración de sesión queda modificado.
--   · 5: mutantes del CHECK sobre una fila real (sin invocar el RPC).
--   · 6: atomicidad REAL del RPC, bajo una sesión AUTENTICADA con rol
--     PERMITIDO simulada como lo hace PostgREST (nunca como el superusuario
--     que corre este script, que nunca pasa por el candado de rol) — un
--     lote con una fila inválida debe abortar TODO, ids y conteo intactos.
--   · 7: rechazo de sesiones NO autorizadas, en DOS variantes (usuario real
--     con rol sin permiso, y usuario inexistente/mi_rol()=NULL) — SEPARADO
--     de la prueba de atomicidad de la sección 6, nunca se acepta un
--     rechazo por autorización como si fuera la prueba de la fila inválida.

-- 1) Las columnas deben existir: precio_final_autoritativo boolean not null
--    default false, temporada_base text nullable.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'tarifa_hotel'
  and column_name in ('precio_final_autoritativo', 'temporada_base')
order by column_name;
-- Esperado: 2 filas — precio_final_autoritativo (boolean, NO, default false),
-- temporada_base (text, YES, default null).

-- 2) Ninguna fila existente quedó marcada como precio final autoritativo
--    (sin backfill — solo código nuevo, desplegado DESPUÉS, puede marcar
--    filas al regenerar tarifas Dubai).
select count(*) as filas_marcadas_precio_final
from public.tarifa_hotel
where precio_final_autoritativo;
-- Esperado: 0 (inmediatamente después de correr la migración).

-- 3) El CHECK biconditional existe, ligado a `tarifa_hotel` (`conrelid`).
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.tarifa_hotel'::regclass
  and conname = 'tarifa_hotel_temporada_base_solo_si_final_check';
-- Esperado: 1 fila, definición debe contener "= precio_final_autoritativo"
-- (la forma biconditional, no solo "or").

-- 4) El RPC transaccional existe, es SECURITY DEFINER, y solo `authenticated`
--    tiene EXECUTE (ni `anon` ni `public`).
select p.proname, p.prosecdef as es_security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_puede,
       has_function_privilege('anon', p.oid, 'execute') as anon_puede
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname = 'reemplazar_tarifas_hotel_calculadora';
-- Esperado: 1 fila, es_security_definer = true, authenticated_puede = true,
-- anon_puede = false.

-- 5) Pruebas MUTANTES del CHECK biconditional sobre una fila REAL, dentro de
--    una transacción que termina en ROLLBACK.
begin;

do $$
declare
  v_id bigint;
begin
  select id into v_id from public.tarifa_hotel limit 1;

  if v_id is null then
    raise notice 'AVISO: tarifa_hotel no tiene NINGUNA fila — las pruebas mutantes del CHECK NO se pudieron ejecutar. Esto NO confirma que el CHECK funciona: vuelve a correr este postcheck cuando exista al menos una fila real de tarifa_hotel.';
    return;
  end if;

  raise notice 'Usando tarifa_hotel.id = % para las pruebas mutantes del CHECK (se revierte con ROLLBACK al final del script).', v_id;

  -- 5a) temporada_base poblado con precio_final_autoritativo = false debe rechazarse.
  begin
    update public.tarifa_hotel set precio_final_autoritativo = false, temporada_base = 'BAJA' where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó temporada_base sin precio_final_autoritativo sin que el CHECK lo rechazara.';
  exception when check_violation then
    raise notice 'OK: el CHECK rechazó correctamente temporada_base poblado con precio_final_autoritativo = false.';
  end;

  -- 5b) precio_final_autoritativo = true SIN temporada_base — el CHECK
  --     original (primera versión de esta migración) aceptaba esto; el
  --     biconditional FORTALECIDO debe rechazarlo.
  begin
    update public.tarifa_hotel set precio_final_autoritativo = true, temporada_base = null where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó precio_final_autoritativo=true sin temporada_base sin que el CHECK (fortalecido) lo rechazara.';
  exception when check_violation then
    raise notice 'OK: el CHECK (fortalecido, biconditional) rechazó correctamente precio_final_autoritativo=true con temporada_base=null.';
  end;

  -- 5c) precio_final_autoritativo = true CON temporada_base SÍ debe aceptarse.
  update public.tarifa_hotel set precio_final_autoritativo = true, temporada_base = 'BAJA' where id = v_id;
  if not found then
    raise exception 'FALLO POSTCHECK: el UPDATE (true + temporada_base) no afectó ninguna fila (tarifa_hotel.id = % ya no existe).', v_id;
  end if;
  raise notice 'OK: el UPDATE con precio_final_autoritativo = true y temporada_base poblado se aceptó sobre tarifa_hotel.id = %.', v_id;

  -- 5d) precio_final_autoritativo = false con temporada_base NULL (estado
  --     legacy/base) SÍ debe aceptarse — vuelve al default.
  update public.tarifa_hotel set precio_final_autoritativo = false, temporada_base = null where id = v_id;
  if not found then
    raise exception 'FALLO POSTCHECK: el UPDATE (false + null) no afectó ninguna fila (tarifa_hotel.id = % ya no existe).', v_id;
  end if;
  raise notice 'OK: el UPDATE con precio_final_autoritativo = false y temporada_base = null se aceptó sobre tarifa_hotel.id = %.', v_id;
end $$;

rollback;
-- ⚠️ ROLLBACK: ninguno de los UPDATE de la sección 5 queda persistido.

-- 6) Prueba de ATOMICIDAD REAL del RPC bajo un CONTEXTO AUTENTICADO con rol
--    PERMITIDO — no basta con llamarlo como el superusuario que corre este
--    script: eso nunca pasó por el candado de rol (`mi_rol()` depende de
--    `auth.uid()`, que en una sesión de superusuario/SQL editor sin JWT
--    devuelve NULL). Se simula la sesión igual que lo hace PostgREST
--    (`request.jwt.claims` con el `sub` de un usuario REAL y activo de
--    `usuarios` con rol permitido, más `set local role authenticated`), se
--    confirma que `mi_rol()` resuelve al rol esperado BAJO ESE CONTEXTO, y
--    SOLO ENTONCES se manda el lote con una fila inválida. Si el RPC
--    rechazara por autorización, la prueba de abajo lo detecta explícitamente
--    (no se acepta un error de autorización como si fuera la prueba de la
--    fila inválida — son dos aserciones DISTINTAS).
--    Usa un hotel_id real (el mismo que ya tiene filas de tarifa_hotel).
begin;

do $$
declare
  v_usuario_id    uuid;
  v_rol           text;
  v_hotel_id      bigint;
  v_ids_antes     bigint[];
  v_ids_despues   bigint[];
  v_count_antes   integer;
  v_count_despues integer;
  v_filas_lote    jsonb;
  v_resultado     jsonb;
  v_abortado_por_check boolean := false;
  v_sqlstate      text;
  v_mensaje       text;
begin
  select id, rol::text into v_usuario_id, v_rol
  from public.usuarios
  where activo and rol in ('superadmin', 'gerencia', 'administracion', 'operaciones')
  limit 1;

  if v_usuario_id is null then
    raise notice 'AVISO: no hay ningún usuario ACTIVO con rol permitido (superadmin/gerencia/administracion/operaciones) en esta base — la prueba de atomicidad bajo contexto autenticado NO se pudo ejecutar de verdad. Corre este postcheck en un entorno con al menos un usuario interno activo.';
    return;
  end if;

  select hotel_id into v_hotel_id from public.tarifa_hotel group by hotel_id limit 1;
  if v_hotel_id is null then
    raise notice 'AVISO: no hay ningún hotel_id con filas en tarifa_hotel — la prueba de atomicidad del RPC NO se pudo ejecutar. Vuelve a correr este postcheck cuando exista al menos un hotel con tarifas.';
    return;
  end if;

  -- Snapshot ANTES de simular la sesión (mientras el postcheck aún corre con
  -- privilegios propios, sin depender de que la RLS bajo el rol simulado deje
  -- ver las mismas filas — es solo diagnóstico, no la prueba en sí).
  select array_agg(id order by id), count(*) into v_ids_antes, v_count_antes
  from public.tarifa_hotel where hotel_id = v_hotel_id;
  raise notice 'Usando usuario_id=% (rol=%) y hotel_id=% (% filas actuales) para la prueba de atomicidad bajo contexto autenticado.', v_usuario_id, v_rol, v_hotel_id, v_count_antes;

  -- Simula EXACTAMENTE el contexto que PostgREST arma para una sesión
  -- autenticada real (mismo mecanismo que usa auth.uid() en todo Supabase).
  perform set_config('request.jwt.claims', json_build_object('sub', v_usuario_id::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  if coalesce(public.mi_rol()::text, '<null>') <> v_rol then
    raise exception 'FALLO POSTCHECK: mi_rol() no resolvió al rol esperado bajo el contexto autenticado simulado (esperado %, obtuvo %) — la simulación no es representativa, revisar manualmente antes de confiar en el resto de esta prueba.', v_rol, coalesce(public.mi_rol()::text, '<null>');
  end if;
  raise notice 'OK: mi_rol() resolvió a "%" bajo el contexto autenticado simulado — la sesión SÍ está autorizada para el RPC, como corresponde.', v_rol;

  -- Lote con UNA fila válida y UNA inválida (precio_final_autoritativo=true
  -- sin temporada_base, viola el CHECK fortalecido) — el insert de la
  -- segunda debe abortar TODA la función, incluido el delete ya ejecutado.
  v_filas_lote := jsonb_build_array(
    jsonb_build_object(
      'tipo_habitacion', 'POSTCHECK_TEST', 'alimentacion', 'PC', 'temporada', 'POSTCHECK_TEMP',
      'neto_sencilla', 100000, 'neto_doble', 100000, 'neto_triple', 100000, 'neto_multiple', 100000,
      'neto_nino', 50000, 'neto_nino2', null, 'neto_infante', 0, 'nota_infante', null, 'notas', null,
      'edad_infante_min', null, 'edad_infante_max', null, 'edad_nino_min', null, 'edad_nino_max', null,
      'precio_final_autoritativo', false, 'temporada_base', null
    ),
    jsonb_build_object(
      'tipo_habitacion', 'POSTCHECK_TEST', 'alimentacion', 'PAM', 'temporada', 'POSTCHECK_TEMP_INVALIDA',
      'neto_sencilla', 100000, 'neto_doble', 100000, 'neto_triple', 100000, 'neto_multiple', 100000,
      'neto_nino', 50000, 'neto_nino2', null, 'neto_infante', 0, 'nota_infante', null, 'notas', null,
      'edad_infante_min', null, 'edad_infante_max', null, 'edad_nino_min', null, 'edad_nino_max', null,
      'precio_final_autoritativo', true, 'temporada_base', null -- ⚠️ inválida a propósito
    )
  );

  begin
    v_resultado := public.reemplazar_tarifas_hotel_calculadora(v_hotel_id, null, v_filas_lote);
    raise exception 'FALLO POSTCHECK: el RPC (ya confirmado autorizado) aceptó un lote con una fila inválida — debía abortar por el CHECK fortalecido.';
  exception
    when check_violation then
      v_abortado_por_check := true;
      raise notice 'OK: el RPC (bajo sesión autorizada) abortó por check_violation al encontrar la fila inválida del lote, como se esperaba.';
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_mensaje = message_text;
      -- Si el error fue de AUTORIZACIÓN ("rol sin permiso..."), esta prueba
      -- de atomicidad NO es válida — la sesión no llegó ni a intentar la fila
      -- inválida. Se distingue EXPLÍCITAMENTE del caso esperado (nunca se
      -- acepta un rechazo por auth como si fuera la prueba de la fila mala).
      if v_mensaje like '%rol sin permiso%' then
        raise exception 'FALLO POSTCHECK: el RPC rechazó por AUTORIZACIÓN (%) pese a que mi_rol() ya se confirmó como "%" arriba — esto invalida la prueba de atomicidad, no la satisface. Revisar por qué el candado de rol se disparó con una sesión ya verificada como autorizada.', v_mensaje, v_rol;
      end if;
      raise exception 'FALLO POSTCHECK: el RPC falló con un error INESPERADO (sqlstate=%, %) — se esperaba específicamente check_violation por la fila inválida.', v_sqlstate, v_mensaje;
  end;

  if not v_abortado_por_check then
    raise exception 'FALLO POSTCHECK: el bloque de la prueba de atomicidad no marcó v_abortado_por_check.';
  end if;

  -- Vuelve a privilegios propios para verificar sin depender de la RLS bajo
  -- el rol simulado (que de todas formas debería ver lo mismo, pero esta
  -- verificación es del postcheck, no de la RLS).
  reset role;

  select array_agg(id order by id), count(*) into v_ids_despues, v_count_despues
  from public.tarifa_hotel where hotel_id = v_hotel_id;

  if v_count_despues <> v_count_antes then
    raise exception 'FALLO POSTCHECK: el conteo de filas cambió tras el RPC abortado (antes %, después %) — el delete NO se revirtió.', v_count_antes, v_count_despues;
  end if;
  if v_ids_despues is distinct from v_ids_antes then
    raise exception 'FALLO POSTCHECK: los ids de las filas cambiaron tras el RPC abortado — se perdió la identidad original (antes %, después %).', v_ids_antes, v_ids_despues;
  end if;
  raise notice 'OK: tras el RPC abortado, hotel_id = % conserva EXACTAMENTE las mismas % filas, mismos ids (%) — probado bajo una sesión REALMENTE autorizada, no bajo un bypass de superusuario.', v_hotel_id, v_count_despues, v_ids_despues;

  -- Confirma también que ninguna fila "POSTCHECK_TEST" quedó a medio insertar
  -- (ni siquiera la primera, válida, del lote abortado), ni en este hotel ni
  -- en ningún otro (el CONTENIDO anterior también debe seguir intacto, no
  -- solo el conteo/ids de este hotel puntual).
  if exists (select 1 from public.tarifa_hotel where tipo_habitacion = 'POSTCHECK_TEST') then
    raise exception 'FALLO POSTCHECK: quedó una fila POSTCHECK_TEST insertada pese al abort — inserción parcial detectada.';
  end if;
  raise notice 'OK: ninguna fila del lote abortado (ni la válida ni la inválida) quedó insertada — atomicidad confirmada bajo sesión autorizada real.';
end $$;

rollback;
-- ⚠️ ROLLBACK: revierte también el `set_config`/`set local role` simulados
-- (son de alcance transaccional) además de cualquier UPDATE/INSERT/DELETE —
-- ningún dato ni configuración de sesión queda modificado.

-- 7) Prueba SEPARADA: un usuario NO autorizado es rechazado — dos variantes,
--    ninguna se confunde con la prueba de atomicidad de la sección 6 (que ya
--    corrió bajo un usuario SÍ autorizado, confirmado antes de mandar el
--    lote inválido).
begin;

do $$
declare
  v_usuario_no_permitido uuid;
  v_rol_no_permitido      text;
  v_usuario_fantasma      uuid := gen_random_uuid(); -- no existe en `usuarios`
  v_filas_minimas         jsonb := jsonb_build_array(jsonb_build_object(
    'tipo_habitacion', 'POSTCHECK_TEST', 'alimentacion', 'PC', 'temporada', 'POSTCHECK_TEMP',
    'neto_sencilla', 100000, 'neto_doble', 100000, 'neto_triple', 100000, 'neto_multiple', 100000,
    'neto_nino', null, 'neto_nino2', null, 'neto_infante', null, 'nota_infante', null, 'notas', null,
    'edad_infante_min', null, 'edad_infante_max', null, 'edad_nino_min', null, 'edad_nino_max', null,
    'precio_final_autoritativo', false, 'temporada_base', null
  ));
  v_hotel_id  bigint;
  v_rechazado boolean;
  v_mensaje   text;
begin
  select hotel_id into v_hotel_id from public.tarifa_hotel limit 1;
  if v_hotel_id is null then
    raise notice 'AVISO: no hay ningún hotel_id en tarifa_hotel — las pruebas de rechazo por autorización NO se pudieron ejecutar.';
    return;
  end if;

  -- 7a) Usuario AUTENTICADO real, pero con un rol SIN permiso de escritura
  --     (ej. 'venta', 'agencia', 'control_vuelo') — si existe alguno.
  select id, rol::text into v_usuario_no_permitido, v_rol_no_permitido
  from public.usuarios
  where activo and rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones')
  limit 1;

  if v_usuario_no_permitido is null then
    raise notice 'AVISO: no hay ningún usuario activo con rol SIN permiso en esta base — se omite 7a (usuario real no autorizado). No invalida 7b.';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', v_usuario_no_permitido::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_rechazado := false;
    begin
      perform public.reemplazar_tarifas_hotel_calculadora(v_hotel_id, null, v_filas_minimas);
    exception when others then
      get stacked diagnostics v_mensaje = message_text;
      if v_mensaje like '%rol sin permiso%' then
        v_rechazado := true;
      else
        raise exception 'FALLO POSTCHECK 7a: el RPC falló con un error INESPERADO para un usuario no autorizado (rol=%): %', v_rol_no_permitido, v_mensaje;
      end if;
    end;
    reset role;
    if not v_rechazado then
      raise exception 'FALLO POSTCHECK 7a: el RPC NO rechazó a un usuario autenticado con rol sin permiso (rol=%) — debía fallar con "rol sin permiso de escritura".', v_rol_no_permitido;
    end if;
    raise notice 'OK 7a: usuario autenticado con rol "%" (sin permiso) fue RECHAZADO por el RPC.', v_rol_no_permitido;
  end if;

  -- 7b) Usuario AUTENTICADO cuyo `sub` NO tiene fila en `usuarios` (cuenta
  --     borrada/inexistente) — exactamente el caso que exponía el defecto de
  --     `mi_rol() not in (...)` con NULL sin `coalesce()` (ver la cabecera de
  --     la migración 179). Prueba directa del fix.
  perform set_config('request.jwt.claims', json_build_object('sub', v_usuario_fantasma::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if public.mi_rol() is not null then
    raise exception 'FALLO POSTCHECK 7b: mi_rol() no devolvió NULL para un usuario inexistente (%) — la simulación no es representativa.', v_usuario_fantasma;
  end if;
  v_rechazado := false;
  begin
    perform public.reemplazar_tarifas_hotel_calculadora(v_hotel_id, null, v_filas_minimas);
  exception when others then
    get stacked diagnostics v_mensaje = message_text;
    if v_mensaje like '%rol sin permiso%' then
      v_rechazado := true;
    else
      raise exception 'FALLO POSTCHECK 7b: el RPC falló con un error INESPERADO para mi_rol()=NULL: %', v_mensaje;
    end if;
  end;
  reset role;
  if not v_rechazado then
    raise exception 'FALLO POSTCHECK 7b: el RPC NO rechazó a una sesión con mi_rol()=NULL (usuario inexistente) — regresión del defecto "NULL not in (...) nunca lanza" que corrigió esta migración.';
  end if;
  raise notice 'OK 7b: sesión con mi_rol()=NULL (usuario inexistente/borrado) fue RECHAZADA por el RPC — confirma el fix de coalesce().';

  -- Ninguna de las dos pruebas de rechazo debió insertar ni borrar nada.
  if exists (select 1 from public.tarifa_hotel where tipo_habitacion = 'POSTCHECK_TEST') then
    raise exception 'FALLO POSTCHECK 7: quedó una fila POSTCHECK_TEST insertada pese a que ambos intentos debían rechazarse por autorización.';
  end if;
  raise notice 'OK: ninguna de las dos sesiones no autorizadas dejó datos modificados.';
end $$;

rollback;
-- ⚠️ ROLLBACK: ninguna de las secciones 6/7 deja datos ni configuración de
-- sesión modificados — ambas terminan reviertiendo TODO.
