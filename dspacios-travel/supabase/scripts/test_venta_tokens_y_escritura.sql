-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA COMPLETA del rol `venta`  ·  asume las migraciones 147 + 148
-- Correr en el editor SQL de Supabase. Termina en ROLLBACK: no deja rastro.
-- ─────────────────────────────────────────────────────────────────────────
--
-- REGLA QUE VERIFICA
--   `venta` VE la información comercial básica de TODOS los contratos de su
--   agencia, pero pasajeros, adjuntos, archivos, tokens, el documento del
--   titular, el record del vuelo y CUALQUIER escritura quedan limitados a sus
--   contratos PROPIOS.
--
-- QUÉ CUBRE (lo ejecuta, no solo lo enuncia)
--   · Las CUATRO operaciones — SELECT, INSERT, UPDATE, DELETE — sobre las OCHO
--     tablas hijas del contrato, en un contrato propio y en uno ajeno de la
--     misma agencia.
--   · Las CUATRO operaciones sobre los archivos en `storage.objects`, propios
--     y ajenos.
--   · Columnas enmascaradas de `ventas_basica`: share_token, cliente_documento,
--     cliente_direccion y asesor_firma_cc.
--   · `soy_asesor_del_contrato`, que es la ENTRADA de la decisión de solo
--     lectura de la ficha del contrato: true en el propio, false en el ajeno.
--   · Abonos con mínimo privilegio: fila completa solo en el contrato propio,
--     únicamente el TOTAL (vista `abonos_resumen`) en el de un colega, nada de
--     otra agencia, y ninguna escritura.
--   · Aislamiento por agencia (tenant) y bloqueo del usuario desactivado.
--   · Que un rol administrativo sigue teniendo acceso completo — incluida la
--     ESCRITURA en contratos que no gestiona (si no, la prueba pasaría igual
--     con el modo solo lectura aplicado a todo el mundo).
--
-- POR QUÉ CREA SUS PROPIOS DATOS
--   Una prueba que depende de que existan ciertos contratos puede pasar "por
--   vacío": si el asesor no tiene contratos ajenos, no leer nada ajeno no
--   prueba nada. Aquí los fixtures se CREAN dentro de la transacción (contrato
--   propio, ajeno del mismo tenant, y uno de otro tenant), así siempre hay algo
--   que proteger. Todo se revierte con el ROLLBACK final.
--
-- SI FALTA UN FIXTURE QUE NO SE PUEDE FABRICAR (un usuario `venta` activo, un
-- usuario administrativo), la prueba CORTA con excepción en vez de reportar OK.
--
-- FUNCIONA EN LAS DOS FASES DEL DESPLIEGUE
--   El cierre de `contrato_vuelos` se parte en dos migraciones (148 aditiva,
--   149 de cierre) para no dejar ventana de caída. La prueba DETECTA en cuál de
--   las dos fases está —mirando si la policy de lectura todavía incluye a
--   `venta`— y ajusta lo que exige:
--     · fase 148 (código nuevo desplegado, 149 sin correr): la app tiene que
--       funcionar con las vistas, y el PNR ajeno ya no se ve por la vista
--       aunque la tabla base siga abierta;
--     · fase 149 (cierre corrido): además, el PNR ajeno tampoco se alcanza
--       leyendo la tabla base directamente.
--   Se imprime la fase detectada como primera fila del resultado.
--
-- DÓNDE SE EJECUTÓ
--   Sobre un PostgreSQL 16 local con las migraciones aplicadas en orden, en las
--   DOS fases: con la 148 corrida (117/117) y después de correr la 149
--   (117/117). Falta correrla en Supabase, que es el único lugar donde
--   `storage.objects` es el real y donde hay datos de producción.
-- ─────────────────────────────────────────────────────────────────────────

begin;

create temp table _res (n int, caso text, esperado text, obtenido text, ok boolean) on commit drop;

-- Catálogo de las ocho tablas hijas: cómo se inserta una fila de prueba en
-- cada una, qué columna se puede modificar, y qué debe ver `venta`.
--
--   ve_propio / ve_ajeno = filas que el asesor debe poder SELECCIONAR.
--     contrato_vuelos    → 0/0 en la TABLA BASE: desde la 148 `venta` no la lee
--                          (tiene el record); entra por `contrato_vuelos_basica`,
--                          que se prueba aparte.
--     contrato_servicios → 0/0: tiene el costo neto del proveedor (146/147).
--     pasajeros/adjuntos/vouchers → 1/0: solo el contrato propio.
--
--   afirma_escritura_propia = si se EXIGE que el UPDATE/DELETE propio afecte
--     filas. Va en false justo para las dos tablas sin policy de SELECT: en
--     PostgreSQL un `update ... where` necesita leer la fila, así que sin
--     SELECT tampoco puede ubicarla para modificarla. La operación igual se
--     ejecuta y se reporta el resultado, pero no se afirma un valor esperado
--     porque ninguna pantalla de `venta` hace ese UPDATE (el editor de
--     contenido del contrato es exclusivo de superadmin, y al reservar los
--     vuelos se insertan con service-role).
create temp table _tablas (
  orden int, tabla text, cols text, vals text, col_update text,
  ve_propio int, ve_ajeno int, afirma_escritura_propia boolean
) on commit drop;

-- '@C@' se reemplaza por el número de contrato ya escapado.
insert into _tablas values
  (1, 'contrato_hoteles',   '(numero_contrato, nombre)',
      '(@C@, ''HOTEL PRUEBA'')', 'nombre', 1, 1, true),
  (2, 'contrato_vuelos',    '(numero_contrato, aerolinea, record)',
      '(@C@, ''AV'', ''PNRXYZ'')', 'aerolinea', 0, 0, false),
  (3, 'contrato_items',     '(numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino)',
      '(@C@, ''ITEM PRUEBA'', 1, 0, 100, 0)', 'descripcion', 1, 1, true),
  (4, 'contrato_servicios', '(numero_contrato, tipo, descripcion, costo)',
      '(@C@, ''otro'', ''SERVICIO PRUEBA'', 555)', 'descripcion', 0, 0, false),
  (5, 'contrato_pasajeros', '(numero_contrato, nombre, identificacion, fecha_nacimiento)',
      '(@C@, ''PASAJERO PRUEBA'', ''999'', ''1990-01-01'')', 'nombre', 1, 0, true),
  (6, 'contrato_adjuntos',  '(numero_contrato, tipo, nombre, path)',
      '(@C@, ''cedula'', ''cedula.pdf'', @C@ || ''/cedula-1.pdf'')', 'nombre', 1, 0, true),
  (7, 'vouchers',           '(numero_contrato, tipo, contenido)',
      '(@C@, ''hotel'', ''{"secreto":"si"}''::jsonb)', 'tipo', 1, 0, true),
  -- `cuotas.fecha_limite` es NOT NULL: sin ella el fixture reventaba y la
  -- prueba de esta tabla nunca llegaba a correr.
  (8, 'cuotas',             '(numero_contrato, orden, tipo, fecha_limite, monto)',
      '(@C@, 1, ''abono'', current_date + 30, 500)', 'tipo', 1, 1, true);

do $$
declare
  v_uid      uuid;
  v_nombre   text;
  adm_uid    uuid;
  inact_uid  uuid;
  v_tenant   text;
  otro_ten   text;
  c_propio   text := '__TEST_PROPIO__';
  c_ajeno    text := '__TEST_AJENO__';
  c_otroten  text := '__TEST_OTROTEN__';
  doc_full   text := '1234567890';
  n          bigint;
  s          text;
  k          int := 0;
  r          record;
  c          text;
  esperado_n bigint;
  qual_vuelos text;
  fase       text;
begin
  -- ── ¿En qué fase del despliegue estamos? ─────────────────────────────────
  select qual into qual_vuelos from pg_policies
   where schemaname = 'public' and tablename = 'contrato_vuelos'
     and policyname = 'contrato_vuelos: lectura';
  fase := case when qual_vuelos like '%venta%' then '148' else '149' end;

  -- Antes de la 149, `venta` todavía lee la tabla base `contrato_vuelos` (a
  -- propósito: el código viejo la necesita mientras termina el despliegue).
  -- Después de la 149 ya no. La prueba exige lo que corresponda a cada fase en
  -- vez de dar por hecho un estado.
  if fase = '148' then
    update _tablas set ve_propio = 1, ve_ajeno = 1, afirma_escritura_propia = true
     where tabla = 'contrato_vuelos';
  end if;
  -- ── Fixtures que NO se pueden fabricar: si faltan, la prueba no concluye ──
  select id, nombre into v_uid, v_nombre
    from public.usuarios where rol = 'venta' and activo order by id limit 1;
  if v_uid is null then
    raise exception 'FIXTURE FALTANTE: no hay usuario con rol `venta` activo. La prueba no puede concluir nada.';
  end if;

  select id into adm_uid
    from public.usuarios where rol in ('superadmin','gerencia','administracion','operaciones') and activo order by id limit 1;
  if adm_uid is null then
    raise exception 'FIXTURE FALTANTE: no hay usuario administrativo activo.';
  end if;

  select id into inact_uid from public.usuarios where id <> v_uid order by id limit 1;
  if inact_uid is null then
    raise exception 'FIXTURE FALTANTE: se necesita un segundo usuario para probar la cuenta desactivada.';
  end if;

  -- Tenant del asesor = el que tenga contratos (para que su vista no salga vacía).
  select tenant into v_tenant from public.ventas group by tenant order by count(*) desc limit 1;
  if v_tenant is null then v_tenant := 'mayorista'; end if;
  otro_ten := case when v_tenant = 'mayorista' then 'minorista' else 'mayorista' end;
  update public.usuarios set tenant = v_tenant where id in (v_uid, adm_uid);

  -- ── Fixtures fabricados (se revierten con el ROLLBACK) ───────────────────
  insert into public.ventas
    (numero_contrato, cliente, cliente_documento, cliente_direccion, asesor_firma_cc,
     tenant, asesor, precio_venta, costo_hotel)
  values
    (c_propio,  'CLIENTE PRUEBA PROPIO', doc_full, 'CALLE FALSA 123', '999888', v_tenant, v_nombre,          1000000,  700000),
    (c_ajeno,   'CLIENTE PRUEBA AJENO',  doc_full, 'CALLE FALSA 123', '999888', v_tenant, '__OTRO_ASESOR__', 2000000, 1400000),
    (c_otroten, 'CLIENTE OTRO TENANT',   doc_full, 'CALLE FALSA 123', '999888', otro_ten, v_nombre,          3000000, 2100000);

  -- Una fila de cada tabla hija en CADA contrato: sin la del propio no se
  -- podría comprobar que el asesor sí puede con lo suyo.
  for r in select * from _tablas order by orden loop
    foreach c in array array[c_propio, c_ajeno] loop
      execute format('insert into public.%I %s values %s',
                     r.tabla, r.cols, replace(r.vals, '@C@', quote_literal(c)));
    end loop;
  end loop;

  -- Un abono en cada contrato: el asesor tiene que poder consultar el saldo.
  insert into public.abonos (numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, referencia, tenant) values
    (c_propio,  'CLIENTE PRUEBA PROPIO', current_date, 400000, 'Transferencia', 'REF-PROPIA', v_tenant),
    (c_ajeno,   'CLIENTE PRUEBA AJENO',  current_date, 900000, 'Tarjeta',       'REF-AJENA',  v_tenant),
    (c_otroten, 'CLIENTE OTRO TENANT',   current_date, 700000, 'Efectivo',      'REF-OTRA',   otro_ten);

  -- Archivos en Storage: uno de cada contrato.
  insert into storage.objects (bucket_id, name) values
    ('contratos', c_ajeno  || '/cedula-1.pdf'),
    ('contratos', c_propio || '/cedula-1.pdf');

  k := k + 1;
  insert into _res values (k,
    case when fase = '148'
      then 'FASE 148 (aditiva): `venta` todavía lee la tabla base contrato_vuelos'
      else 'FASE 149 (cierre): `venta` ya NO lee la tabla base contrato_vuelos' end,
    '148 o 149', fase, true);

  ---------------------------------------------------------------------------
  -- A partir de aquí se consulta HACIÉNDOSE PASAR por cada usuario.
  -- `set local role authenticated` es imprescindible: el editor SQL corre como
  -- superusuario y un superusuario SE SALTA la RLS.
  ---------------------------------------------------------------------------

  -- ══ BLOQUE 1 · `ventas_basica`: qué contratos ve y con qué columnas ══════
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas_basica;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'venta VE contratos de su agencia (ventas_basica)', '> 0', n::text, n > 0);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas_basica where numero_contrato = c_ajeno;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'venta VE el contrato ajeno de SU agencia', '1', n::text, n = 1);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas_basica where numero_contrato = c_otroten;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'venta NO ve contratos de otra agencia', '0', n::text, n = 0);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin select count(*) into n from public.ventas where costo_hotel is not null;
  exception when others then n := 0; end;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'venta NO lee costos de `ventas`', '0', n::text, n = 0);

  -- Columnas enmascaradas: propio completo, ajeno recortado o en null.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select share_token::text into s from public.ventas_basica where numero_contrato = c_ajeno;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'share_token AJENO en null (abría /c/[token])', 'null', coalesce(s,'null'), s is null);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select share_token::text into s from public.ventas_basica where numero_contrato = c_propio;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'share_token PROPIO sí llega (botón compartir)', 'no null', coalesce(s,'null'), s is not null);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select cliente_documento into s from public.ventas_basica where numero_contrato = c_propio;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'cliente_documento PROPIO completo', doc_full, coalesce(s,'null'), s = doc_full);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select cliente_documento into s from public.ventas_basica where numero_contrato = c_ajeno;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'cliente_documento AJENO enmascarado (últimos 4)', '••••' || right(doc_full,4),
                                       coalesce(s,'null'), s = '••••' || right(doc_full,4));

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select coalesce(cliente_direccion,'') || '|' || coalesce(asesor_firma_cc,'') into s
    from public.ventas_basica where numero_contrato = c_ajeno;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'cliente_direccion y asesor_firma_cc AJENOS en null', '|', coalesce(s,'null'), s = '|');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select coalesce(cliente_direccion,'') || '|' || coalesce(asesor_firma_cc,'') into s
    from public.ventas_basica where numero_contrato = c_propio;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'cliente_direccion y asesor_firma_cc PROPIOS sí llegan (contrato imprimible)',
                                       'CALLE FALSA 123|999888', coalesce(s,'null'), s = 'CALLE FALSA 123|999888');

  -- ══ BLOQUE 2 · `contrato_vuelos_basica`: el PNR solo del contrato propio ══
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.contrato_vuelos_basica where numero_contrato = c_ajeno;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'venta VE el vuelo ajeno por la vista (itinerario)', '1', n::text, n = 1);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.contrato_vuelos_basica where numero_contrato = c_ajeno and record is not null;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'venta NO obtiene el record/PNR de vuelo ajeno', '0', n::text, n = 0);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.contrato_vuelos_basica where numero_contrato = c_propio and record is not null;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'venta SÍ obtiene el record/PNR de su vuelo PROPIO', '1', n::text, n = 1);

  -- ══ BLOQUE 2.bis · La entrada del modo SOLO LECTURA de la pantalla ══════
  -- `soy_asesor_del_contrato` es lo ÚNICO que mira la ficha del contrato para
  -- decidir si muestra los controles de gestión o el aviso de solo lectura.
  -- Probarla aquí es probar la entrada de esa decisión: si devolviera true en
  -- un contrato ajeno, la pantalla mostraría los botones (aunque la RLS
  -- siguiera rechazando la escritura).
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select public.soy_asesor_del_contrato(c_propio)::text into s;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'soy_asesor_del_contrato(PROPIO) = true → la pantalla habilita gestión', 'true', coalesce(s,'null'), s = 'true');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select public.soy_asesor_del_contrato(c_ajeno)::text into s;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'soy_asesor_del_contrato(AJENO) = false → la pantalla va en SOLO LECTURA', 'false', coalesce(s,'null'), s = 'false');

  -- Y para un rol administrativo la pantalla nunca va en solo lectura: su gate
  -- es el rol, no la propiedad. Se comprueba que sí puede escribir (bloque 6).

  -- ══ BLOQUE 2.ter · Saldo: el asesor consulta los abonos, no los registra ══
  -- Información comercial que necesita para atender ("¿cuánto debo?"), en su
  -- contrato y en el del colega que está cubriendo.
  -- PROPIO: la fila completa (necesita forma de pago y referencia para
  -- conciliar con su cliente).
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.abonos
   where numero_contrato = c_propio and forma_pago = 'Transferencia' and referencia = 'REF-PROPIA';
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'ABONOS propios: fila COMPLETA (forma de pago y referencia)', '1', n::text, n = 1);

  -- AJENO: ni una fila de la tabla. La referencia bancaria y la forma de pago
  -- del cliente de un colega no hacen falta para atender una llamada.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.abonos where numero_contrato = c_ajeno;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'ABONOS ajenos: NINGUNA fila de la tabla (sin forma de pago ni referencia)', '0', n::text, n = 0);

  -- …pero el TOTAL sí, por la vista agregada: es lo que necesita el saldo.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select coalesce(sum(total_pagado), -1) into n from public.abonos_resumen where numero_contrato = c_ajeno;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'ABONOS ajenos: solo el TOTAL por `abonos_resumen` (para el saldo)', '900000', n::text, n = 900000);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select coalesce(sum(total_pagado), 0) into n from public.abonos_resumen where numero_contrato = c_propio;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'ABONOS propios: el resumen también cuadra', '400000', n::text, n = 400000);

  -- La vista NO puede convertirse en una puerta al otro tenant.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.abonos_resumen where numero_contrato = c_otroten;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'ABONOS de OTRA agencia: ni el total (`abonos_resumen` filtra tenant)', '0', n::text, n = 0);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.abonos where numero_contrato = c_otroten;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'ABONOS de OTRA agencia: ni una fila de la tabla', '0', n::text, n = 0);

  -- El resumen del rol administrativo tiene que seguir viéndolo todo.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', adm_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.abonos where numero_contrato in (c_propio, c_ajeno) and referencia is not null;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'rol administrativo lee los abonos COMPLETOS de cualquier contrato', '2', n::text, n = 2);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.abonos (numero_contrato, cliente, fecha_abono, valor_abono, tenant)
      values (c_propio, 'X', current_date, 1, v_tenant);
    n := 1;
  exception when others then n := 0; end;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'venta NO registra abonos (ni en su propio contrato: es función contable)', '0', n::text, n = 0);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    update public.abonos set valor_abono = 1 where numero_contrato in (c_propio, c_ajeno);
    get diagnostics n = row_count;
  exception when others then n := 0; end;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'venta NO corrige abonos (tampoco los propios)', '0 filas', n::text, n = 0);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    delete from public.abonos where numero_contrato in (c_propio, c_ajeno);
    get diagnostics n = row_count;
  exception when others then n := 0; end;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'venta NO elimina abonos', '0 filas', n::text, n = 0);

  -- ══ BLOQUE 3 · Las 4 operaciones × 8 tablas hijas × propio/ajeno ═════════
  for r in select * from _tablas order by orden loop
    foreach c in array array[c_ajeno, c_propio] loop
      esperado_n := case when c = c_ajeno then r.ve_ajeno else r.ve_propio end;

      -- SELECT
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
      begin
        execute format('select count(*) from public.%I where numero_contrato = %L', r.tabla, c) into n;
      exception when others then n := -1; end;
      reset role; perform set_config('request.jwt.claims', '{}', true);
      k := k + 1;
      insert into _res values (k,
        format('SELECT %s (%s)', r.tabla, case when c = c_ajeno then 'ajeno' else 'propio' end),
        esperado_n::text, n::text, n = esperado_n);

      -- INSERT: en el ajeno debe fallar; en el propio debe pasar.
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
      begin
        execute format('insert into public.%I %s values %s',
                       r.tabla, r.cols, replace(r.vals, '@C@', quote_literal(c)));
        n := 1;
      exception when others then n := 0; end;
      reset role; perform set_config('request.jwt.claims', '{}', true);
      k := k + 1;
      if c = c_ajeno then
        insert into _res values (k, format('INSERT %s (ajeno) — debe ser RECHAZADO', r.tabla), '0', n::text, n = 0);
      else
        insert into _res values (k, format('INSERT %s (propio) — debe PERMITIRSE', r.tabla), '1', n::text, n = 1);
      end if;

      -- UPDATE
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
      begin
        execute format('update public.%I set %I = ''MODIFICADO'' where numero_contrato = %L', r.tabla, r.col_update, c);
        get diagnostics n = row_count;
      exception when others then n := 0; end;
      reset role; perform set_config('request.jwt.claims', '{}', true);
      k := k + 1;
      if c = c_ajeno then
        insert into _res values (k, format('UPDATE %s (ajeno) — debe afectar 0 filas', r.tabla), '0 filas', n::text, n = 0);
      elsif r.afirma_escritura_propia then
        insert into _res values (k, format('UPDATE %s (propio) — debe afectar filas', r.tabla), '> 0 filas', n::text, n > 0);
      else
        -- Se EJECUTA y se reporta, pero no se afirma: sin policy de SELECT el
        -- `where` no puede ubicar la fila, y ninguna pantalla de `venta` hace
        -- este UPDATE. Se deja visible para que el dato no se pierda.
        insert into _res values (k, format('UPDATE %s (propio) — INFORMATIVO, sin policy de SELECT', r.tabla),
                                 'no se afirma', n::text, true);
      end if;

      -- DELETE
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
      begin
        execute format('delete from public.%I where numero_contrato = %L', r.tabla, c);
        get diagnostics n = row_count;
      exception when others then n := 0; end;
      reset role; perform set_config('request.jwt.claims', '{}', true);
      k := k + 1;
      if c = c_ajeno then
        insert into _res values (k, format('DELETE %s (ajeno) — debe afectar 0 filas', r.tabla), '0 filas', n::text, n = 0);
      elsif r.afirma_escritura_propia then
        insert into _res values (k, format('DELETE %s (propio) — debe afectar filas', r.tabla), '> 0 filas', n::text, n > 0);
      else
        insert into _res values (k, format('DELETE %s (propio) — INFORMATIVO, sin policy de SELECT', r.tabla),
                                 'no se afirma', n::text, true);
      end if;
    end loop;
  end loop;

  -- ══ BLOQUE 4 · Las 4 operaciones sobre los ARCHIVOS (storage.objects) ════
  -- Es la puerta lateral de `contrato_adjuntos`: la tabla es el índice, el
  -- archivo (cédulas, soportes de pago) vive aquí con su propia RLS.
  foreach c in array array[c_ajeno, c_propio] loop
    -- SELECT
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    select count(*) into n from storage.objects where bucket_id = 'contratos' and name like c || '/%';
    reset role; perform set_config('request.jwt.claims', '{}', true);
    k := k + 1;
    if c = c_ajeno then
      insert into _res values (k, 'STORAGE SELECT (ajeno) — no debe ver el archivo', '0', n::text, n = 0);
    else
      insert into _res values (k, 'STORAGE SELECT (propio) — sí debe verlo', '1', n::text, n = 1);
    end if;

    -- INSERT
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    begin
      insert into storage.objects (bucket_id, name) values ('contratos', c || '/subido-por-prueba.pdf');
      n := 1;
    exception when others then n := 0; end;
    reset role; perform set_config('request.jwt.claims', '{}', true);
    k := k + 1;
    if c = c_ajeno then
      insert into _res values (k, 'STORAGE INSERT (ajeno) — debe ser RECHAZADO', '0', n::text, n = 0);
    else
      insert into _res values (k, 'STORAGE INSERT (propio) — debe PERMITIRSE', '1', n::text, n = 1);
    end if;

    -- UPDATE (reemplazar el archivo)
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    begin
      update storage.objects set updated_at = now()
        where bucket_id = 'contratos' and name like c || '/%';
      get diagnostics n = row_count;
    exception when others then n := 0; end;
    reset role; perform set_config('request.jwt.claims', '{}', true);
    k := k + 1;
    if c = c_ajeno then
      insert into _res values (k, 'STORAGE UPDATE (ajeno) — debe afectar 0 filas', '0 filas', n::text, n = 0);
    else
      insert into _res values (k, 'STORAGE UPDATE (propio) — debe afectar filas', '> 0 filas', n::text, n > 0);
    end if;

    -- DELETE
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    begin
      delete from storage.objects where bucket_id = 'contratos' and name like c || '/%';
      get diagnostics n = row_count;
    exception when others then n := 0; end;
    reset role; perform set_config('request.jwt.claims', '{}', true);
    k := k + 1;
    if c = c_ajeno then
      insert into _res values (k, 'STORAGE DELETE (ajeno) — debe afectar 0 filas', '0 filas', n::text, n = 0);
    else
      insert into _res values (k, 'STORAGE DELETE (propio) — debe afectar filas', '> 0 filas', n::text, n > 0);
    end if;
  end loop;

  -- El archivo ajeno tiene que seguir ahí después de los cuatro intentos.
  select count(*) into n from storage.objects where bucket_id = 'contratos' and name = c_ajeno || '/cedula-1.pdf';
  k := k + 1; insert into _res values (k, 'El archivo del contrato AJENO sobrevivió a los 4 intentos', '1', n::text, n = 1);

  -- ══ BLOQUE 5 · Usuario desactivado ══════════════════════════════════════
  update public.usuarios set activo = false, tenant = v_tenant where id = inact_uid;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', inact_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas_basica;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'usuario INACTIVO no lee', '0', n::text, n = 0);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', inact_uid, 'role','authenticated')::text, true);
  begin
    insert into public.contrato_hoteles (numero_contrato, nombre) values (c_propio, 'INACTIVO');
    n := 1;
  exception when others then n := 0; end;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'usuario INACTIVO no escribe', '0', n::text, n = 0);
  update public.usuarios set activo = true where id = inact_uid;

  -- ══ BLOQUE 6 · Rol administrativo: sigue funcionando con normalidad ══════
  -- Sin esto, la prueba pasaría igual si se le cerrara el paso a TODOS.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', adm_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas where numero_contrato in (c_propio, c_ajeno);
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'rol administrativo lee `ventas` (con costos)', '2', n::text, n = 2);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', adm_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.contrato_vuelos_basica where numero_contrato = c_ajeno and record is not null;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'rol administrativo sí ve el record/PNR de cualquier contrato', '1', n::text, n = 1);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', adm_uid, 'role','authenticated')::text, true);
  select cliente_documento into s from public.ventas_basica where numero_contrato = c_ajeno;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'rol administrativo ve el documento del cliente sin enmascarar', doc_full, coalesce(s,'null'), s = doc_full);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', adm_uid, 'role','authenticated')::text, true);
  select count(*) into n from storage.objects where bucket_id = 'contratos' and name like c_ajeno || '/%';
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'rol administrativo lee archivos de cualquier contrato', '1', n::text, n = 1);

  -- El administrativo ESCRIBE en cualquier contrato de su agencia, incluido uno
  -- del que no es asesor: su acceso no depende de la propiedad. Sin esto, la
  -- prueba pasaría igual si el modo solo lectura se hubiera aplicado a todos.
  for r in select * from _tablas order by orden loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm_uid, 'role','authenticated')::text, true);
    begin
      execute format('insert into public.%I %s values %s',
                     r.tabla, r.cols, replace(r.vals, '@C@', quote_literal(c_ajeno)));
      n := 1;
    exception when others then n := 0; end;
    reset role; perform set_config('request.jwt.claims', '{}', true);
    k := k + 1;
    insert into _res values (k, format('rol administrativo SÍ escribe %s de un contrato que no gestiona', r.tabla), '1', n::text, n = 1);
  end loop;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', adm_uid, 'role','authenticated')::text, true);
  begin
    insert into public.abonos (numero_contrato, cliente, fecha_abono, valor_abono, tenant)
      values (c_ajeno, 'X', current_date, 1, v_tenant);
    n := 1;
  exception when others then n := 0; end;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'rol administrativo SÍ registra abonos', '1', n::text, n = 1);

  -- ══ BLOQUE 7 · Fase del despliegue: la app nueva y el cierre del PNR ═════
  -- Se vuelven a sembrar las filas hijas: el bloque 3 las fue borrando al
  -- comprobar el DELETE propio, y aquí hay que contar filas existentes.
  for r in select * from _tablas order by orden loop
    foreach c in array array[c_propio, c_ajeno] loop
      execute format('insert into public.%I %s values %s',
                     r.tabla, r.cols, replace(r.vals, '@C@', quote_literal(c)));
    end loop;
  end loop;

  -- Antes de la 149 la app nueva ya tiene que funcionar leyendo las vistas —
  -- eso es lo que permite desplegar sin apagar nada. Después de la 149, además,
  -- el PNR ajeno tampoco se alcanza por la tabla base.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas_basica where numero_contrato in (c_propio, c_ajeno);
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'La app nueva funciona con `ventas_basica` (ambos contratos)', '2', n::text, n = 2);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  -- Se cuentan CONTRATOS alcanzados, no filas: a esta altura cada contrato
  -- puede tener varios tramos (los que sembró el bloque 6 y el resiembre).
  select count(distinct numero_contrato) into n from public.contrato_vuelos_basica
   where numero_contrato in (c_propio, c_ajeno);
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1; insert into _res values (k, 'La app nueva funciona con `contrato_vuelos_basica` (ambos contratos)', '2', n::text, n = 2);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin select count(*) into n from public.contrato_vuelos where record is not null;
  exception when others then n := -1; end;
  reset role; perform set_config('request.jwt.claims', '{}', true);
  k := k + 1;
  if fase = '149' then
    insert into _res values (k, 'FASE 149: el PNR NO se alcanza por la tabla base `contrato_vuelos`', '0', n::text, n = 0);
  else
    insert into _res values (k,
      'FASE 148: la tabla base sigue abierta A PROPÓSITO (la cierra la 149) — el PNR ajeno ya no se ve por la vista',
      '> 0', n::text, n > 0);
  end if;
end $$;

select n as "#", caso, esperado, obtenido, case when ok then 'OK' else 'FALLA' end as resultado
from _res order by ok, n;

do $$
declare n int; detalle text;
begin
  select count(*), string_agg(caso, E'\n  · ') into n, detalle from _res where not ok;
  if n > 0 then
    raise exception E'FALLAN % comprobacion(es):\n  · %', n, detalle;
  end if;
  raise notice 'OK: las % comprobaciones pasaron.', (select count(*) from _res);
end $$;

rollback;
