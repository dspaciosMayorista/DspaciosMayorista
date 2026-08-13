-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA COMPLETA del rol `venta`  ·  asume las migraciones 147 + 148
-- Correr en el editor SQL de Supabase. Termina en ROLLBACK: no deja rastro.
-- ─────────────────────────────────────────────────────────────────────────
--
-- REGLA QUE VERIFICA
--   `venta` VE la información comercial básica de TODOS los contratos de su
--   agencia, pero pasajeros, adjuntos, archivos, tokens, el record del vuelo y
--   CUALQUIER escritura quedan limitados a sus contratos PROPIOS.
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
-- ─────────────────────────────────────────────────────────────────────────

begin;

create temp table _res (n int, caso text, esperado text, obtenido text, ok boolean) on commit drop;

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
  n          bigint;
  t          text;
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
  insert into public.ventas (numero_contrato, cliente, tenant, asesor, precio_venta, costo_hotel)
  values
    (c_propio,  'CLIENTE PRUEBA PROPIO', v_tenant, v_nombre,          1000000, 700000),
    (c_ajeno,   'CLIENTE PRUEBA AJENO',  v_tenant, '__OTRO_ASESOR__', 2000000, 1400000),
    (c_otroten, 'CLIENTE OTRO TENANT',   otro_ten, v_nombre,          3000000, 2100000);

  -- Hijas del contrato AJENO: es sobre estas que `venta` no debe poder escribir.
  insert into public.contrato_hoteles (numero_contrato, nombre) values (c_ajeno, 'HOTEL AJENO');
  insert into public.contrato_vuelos  (numero_contrato, aerolinea, record) values (c_ajeno, 'AV', 'PNRXYZ');
  insert into public.contrato_items   (numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino)
    values (c_ajeno, 'ITEM AJENO', 1, 0, 100, 0);
  insert into public.contrato_servicios (numero_contrato, tipo, descripcion, costo)
    values (c_ajeno, 'otro', 'SERVICIO AJENO', 555);
  insert into public.contrato_pasajeros (numero_contrato, nombre, identificacion, fecha_nacimiento)
    values (c_ajeno, 'PASAJERO AJENO', '999', '1990-01-01');
  insert into public.contrato_adjuntos (numero_contrato, tipo, nombre, path)
    values (c_ajeno, 'cedula', 'cedula.pdf', c_ajeno || '/cedula-1.pdf');
  insert into public.vouchers (numero_contrato, tipo, contenido) values (c_ajeno, 'hotel', '{"secreto":"si"}'::jsonb);
  insert into public.cuotas (numero_contrato, orden, tipo, monto) values (c_ajeno, 1, 'abono', 500);
  -- Hijas del contrato PROPIO: sobre estas SÍ debe poder.
  insert into public.contrato_hoteles (numero_contrato, nombre) values (c_propio, 'HOTEL PROPIO');

  -- Archivos en Storage (el hallazgo nuevo): uno de cada contrato.
  insert into storage.objects (bucket_id, name) values
    ('contratos', c_ajeno  || '/cedula-1.pdf'),
    ('contratos', c_propio || '/cedula-1.pdf');

  ---------------------------------------------------------------------------
  -- A partir de aquí se consulta HACIÉNDOSE PASAR por cada usuario.
  -- `set local role authenticated` es imprescindible: el editor SQL corre como
  -- superusuario y un superusuario SE SALTA la RLS.
  ---------------------------------------------------------------------------

  -- 1) Ve los contratos de su agencia (que no pase por vacío)
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas_basica;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (1, 'venta VE contratos de su agencia (ventas_basica)', '> 0', n::text, n > 0);

  -- 2) Ve el AJENO de su agencia (regla de negocio: sí puede consultarlo)
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas_basica where numero_contrato = c_ajeno;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (2, 'venta VE el contrato ajeno de SU agencia', '1', n::text, n = 1);

  -- 3) NO ve otro tenant
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas_basica where numero_contrato = c_otroten;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (3, 'venta NO ve contratos de otra agencia', '0', n::text, n = 0);

  -- 4) NO lee columnas financieras
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin select count(*) into n from public.ventas where costo_hotel is not null;
  exception when others then n := 0; end;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (4, 'venta NO lee costos de `ventas`', '0', n::text, n = 0);

  -- 5) share_token de `ventas`: ajeno NO, propio SÍ
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas_basica where numero_contrato = c_ajeno and share_token is not null;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (5, 'venta NO obtiene share_token AJENO (abría /c/[token])', '0', n::text, n = 0);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas_basica where numero_contrato = c_propio and share_token is not null;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (6, 'venta SÍ obtiene share_token PROPIO', '1', n::text, n = 1);

  -- 6) vouchers ajenos: ni token ni contenido
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin select count(*) into n from public.vouchers where numero_contrato = c_ajeno;
  exception when others then n := 0; end;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (7, 'venta NO lee vouchers ajenos (token + contenido)', '0', n::text, n = 0);

  -- 7) record/PNR del vuelo ajeno
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin select count(*) into n from public.contrato_vuelos_basica where numero_contrato = c_ajeno and record is not null;
  exception when others then n := 0; end;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (8, 'venta NO obtiene el record/PNR de vuelo ajeno', '0', n::text, n = 0);

  -- 8) pasajeros y adjuntos ajenos
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.contrato_pasajeros where numero_contrato = c_ajeno;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (9, 'venta NO ve pasajeros ajenos', '0', n::text, n = 0);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.contrato_adjuntos where numero_contrato = c_ajeno;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (10, 'venta NO ve adjuntos ajenos (tabla)', '0', n::text, n = 0);

  -- 9) STORAGE: archivos del contrato ajeno (cédulas, soportes de pago)
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from storage.objects where bucket_id = 'contratos' and name like c_ajeno || '/%';
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (11, 'venta NO LEE archivos del contrato ajeno (storage)', '0', n::text, n = 0);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    delete from storage.objects where bucket_id = 'contratos' and name like c_ajeno || '/%';
    get diagnostics n = row_count;
  exception when others then n := 0; end;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (12, 'venta NO BORRA archivos del contrato ajeno (storage)', '0 filas', n::text, n = 0);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from storage.objects where bucket_id = 'contratos' and name like c_propio || '/%';
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (13, 'venta SÍ lee archivos de su contrato PROPIO (storage)', '1', n::text, n = 1);

  -- 10) ESCRITURA en hijas ajenas: UPDATE y DELETE deben dar 0 filas
  foreach t in array array['contrato_hoteles','contrato_vuelos','contrato_items','contrato_servicios','contrato_pasajeros','contrato_adjuntos','vouchers','cuotas'] loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    begin
      execute format('delete from public.%I where numero_contrato = %L', t, c_ajeno);
      get diagnostics n = row_count;
    exception when others then n := 0; end;
    reset role; perform set_config('request.jwt.claims', null, true);
    insert into _res values (14, 'venta NO borra ' || t || ' de contrato ajeno', '0 filas', n::text, n = 0);
  end loop;

  -- 11) INSERT en hija de contrato ajeno
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.contrato_hoteles (numero_contrato, nombre) values (c_ajeno, 'INTRUSO');
    n := 1;
  exception when others then n := 0; end;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (15, 'venta NO inserta en hijas de contrato ajeno', '0', n::text, n = 0);

  -- 12) …pero SÍ puede escribir sobre su contrato PROPIO
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    insert into public.contrato_hoteles (numero_contrato, nombre) values (c_propio, 'HOTEL NUEVO PROPIO');
    n := 1;
  exception when others then n := 0; end;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (16, 'venta SÍ inserta en hijas de su contrato PROPIO', '1', n::text, n = 1);

  -- 13) Usuario DESACTIVADO: ni lee ni escribe
  update public.usuarios set activo = false, tenant = v_tenant where id = inact_uid;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', inact_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas_basica;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (17, 'usuario INACTIVO no lee', '0', n::text, n = 0);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', inact_uid, 'role','authenticated')::text, true);
  begin
    insert into public.contrato_hoteles (numero_contrato, nombre) values (c_propio, 'INACTIVO');
    n := 1;
  exception when others then n := 0; end;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (18, 'usuario INACTIVO no escribe', '0', n::text, n = 0);
  update public.usuarios set activo = true where id = inact_uid;

  -- 14) Rol administrativo: sigue funcionando con normalidad
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', adm_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas where numero_contrato in (c_propio, c_ajeno);
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (19, 'rol administrativo lee `ventas` (con costos)', '2', n::text, n = 2);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', adm_uid, 'role','authenticated')::text, true);
  select count(*) into n from storage.objects where bucket_id = 'contratos' and name like c_ajeno || '/%';
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (20, 'rol administrativo lee archivos de cualquier contrato', '1', n::text, n = 1);
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
