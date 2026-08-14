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
--   · Aislamiento por agencia (tenant) y bloqueo del usuario desactivado.
--   · Que un rol administrativo sigue teniendo acceso completo (si no, la
--     prueba pasaría cerrándole el paso a todo el mundo).
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
-- DÓNDE SE EJECUTÓ
--   Se corrió sobre un PostgreSQL 16 local con las 148 migraciones aplicadas en
--   orden: las 92 comprobaciones pasaron. Falta correrla en Supabase, que es el
--   único lugar donde `storage.objects` es el real y donde hay datos de
--   producción; ahí debe dar el mismo resultado.
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
begin
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

  -- Archivos en Storage: uno de cada contrato.
  insert into storage.objects (bucket_id, name) values
    ('contratos', c_ajeno  || '/cedula-1.pdf'),
    ('contratos', c_propio || '/cedula-1.pdf');

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
