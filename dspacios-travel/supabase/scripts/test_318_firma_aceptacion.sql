-- ════════════════════════════════════════════════════════════════════════════
-- PRUEBAS SQL · #98 (migración 318). Firma del aliado + aceptación electrónica de una versión congelada, con las RPC REALES y los permisos reales.
-- SOLO base desechable (copia del esquema real con la 318 aplicada). Una transacción; termina en ROLLBACK.
-- Uso:  psql -v ON_ERROR_STOP=1 -f test_318_firma_aceptacion.sql <base>      (la salida: una fila por control; sin FALLO = correcto)
-- ESTADO DE EVIDENCIA: escrita, NO ejecutada (el motor de Docker estaba caído al preparar la entrega). No citarla como evidencia hasta correrla.
-- Valores esperados escritos a mano: versiones 1, 2 (nunca 3 al repetir); una sola firma vigente; 3 firmas en total tras 2 reemplazos.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;
create temp table r318 (n serial, control text, observado text, esperado text, estado text) on commit drop;
grant all on r318 to public;
create or replace function pg_temp.chk(p_control text, p_obs text, p_esp text) returns void language plpgsql as $$
begin insert into r318 (control, observado, esperado, estado) values (p_control, p_obs, p_esp, case when p_obs is not distinct from p_esp then 'OK' else 'FALLO' end); end $$;
-- Ejecuta un SQL que DEBE fallar y devuelve el SQLSTATE (o 'sin error').
create or replace function pg_temp.falla(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'sin error'; exception when others then return sqlstate; end $$;

do $$
declare
  a bigint; b bigint; u uuid := gen_random_uuid(); h1 text := repeat('a', 64); h2 text := repeat('b', 64); s1 text := repeat('1', 64); s2 text := repeat('2', 64); s3 text := repeat('3', 64);
  j jsonb; snap1 jsonb; snap2 jsonb; n int;
begin
  insert into public.aliados (nombre) values ('Aliado A 318') returning id into a;
  insert into public.aliados (nombre) values ('Aliado B 318') returning id into b;
  snap1 := jsonb_build_object('v', 1, 'clave', 'ab:31', 'aliado', jsonb_build_object('id', a), 'detalle', jsonb_build_object('totalPagar', 427200));
  snap2 := jsonb_build_object('v', 1, 'clave', 'ab:31', 'aliado', jsonb_build_object('id', a), 'detalle', jsonb_build_object('totalPagar', 432000));

  -- Firma: registrar, repetir (idempotente), reemplazar (una sola vigente, la anterior se conserva)
  j := public.registrar_firma_aliado(a, a || '/uno.png', s1, 'image/png', 100, u);
  perform pg_temp.chk('registrar firma: ok y no repetida', (j ->> 'ok') || '/' || (j ->> 'repetida'), 'true/false');
  j := public.registrar_firma_aliado(a, a || '/dos.png', s1, 'image/png', 100, u);
  perform pg_temp.chk('registrar la MISMA imagen: repetida, sin fila nueva', (j ->> 'repetida') || '/' || (select count(*) from public.aliado_firmas where aliado_id = a), 'true/1');
  perform public.registrar_firma_aliado(a, a || '/tres.png', s2, 'image/png', 100, u);
  perform pg_temp.chk('reemplazar: 2 filas, 1 vigente', (select count(*) || '/' || count(*) filter (where vigente) from public.aliado_firmas where aliado_id = a), '2/1');
  j := public.registrar_firma_aliado(-1, 'x', s3, 'image/png', 100, u);
  perform pg_temp.chk('firma para un aliado inexistente', j ->> 'codigo', 'sin_aliado');

  -- Aceptación
  j := public.aceptar_cuenta_cobro('ab:31', b, jsonb_set(snap1, '{aliado,id}', to_jsonb(b)), h1, u);
  perform pg_temp.chk('aliado SIN firma no acepta', j ->> 'codigo', 'sin_firma');
  j := public.aceptar_cuenta_cobro('ab:31', a, snap1, h1, u);
  perform pg_temp.chk('v1', (j ->> 'ok') || '/' || (j ->> 'version') || '/' || (j ->> 'repetida'), 'true/1/false');
  j := public.aceptar_cuenta_cobro('ab:31', a, snap1, h1, u);
  perform pg_temp.chk('repetir el mismo contenido: idempotente', (j ->> 'version') || '/' || (j ->> 'repetida') || '/' || (select count(*) from public.cuenta_cobro_aceptaciones where clave = 'ab:31'), '1/true/1');
  perform public.registrar_firma_aliado(a, a || '/cuatro.png', s3, 'image/png', 100, u);
  j := public.aceptar_cuenta_cobro('ab:31', a, snap2, h2, u);
  perform pg_temp.chk('contenido distinto: v2 (la v1 sigue)', (j ->> 'version') || '/' || (select count(*) from public.cuenta_cobro_aceptaciones where clave = 'ab:31'), '2/2');
  perform pg_temp.chk('cada versión conserva la firma con la que se aceptó', (select string_agg(firma_sha256, ',' order by version) from public.cuenta_cobro_aceptaciones where clave = 'ab:31'), s2 || ',' || s3);
  j := public.aceptar_cuenta_cobro('ab:31', a, snap1, h1, u);
  perform pg_temp.chk('volver al contenido de la v1 la reconoce (no crea v3)', (j ->> 'version') || '/' || (j ->> 'repetida'), '1/true');

  -- Datos inconsistentes
  perform pg_temp.chk('clave distinta a la del snapshot', public.aceptar_cuenta_cobro('ab:99', a, snap1, h1, u) ->> 'codigo', 'datos');
  perform pg_temp.chk('aliado distinto al del snapshot', public.aceptar_cuenta_cobro('ab:31', b, snap1, h1, u) ->> 'codigo', 'datos');
  perform pg_temp.chk('hash mal formado', public.aceptar_cuenta_cobro('ab:31', a, snap1, 'xyz', u) ->> 'codigo', 'datos');
  perform pg_temp.chk('clave mal formada', public.aceptar_cuenta_cobro('31', a, snap1, h1, u) ->> 'codigo', 'datos');
  perform pg_temp.chk('sin usuario', public.aceptar_cuenta_cobro('ab:31', a, snap1, h1, null) ->> 'codigo', 'datos');

  -- Inmutabilidad
  perform pg_temp.chk('UPDATE de una aceptación', pg_temp.falla('update public.cuenta_cobro_aceptaciones set snapshot_hash = repeat(''c'', 64)'), 'P0001');
  perform pg_temp.chk('DELETE de una aceptación', pg_temp.falla('delete from public.cuenta_cobro_aceptaciones'), 'P0001');
  perform pg_temp.chk('UPDATE del contenido de una firma', pg_temp.falla('update public.aliado_firmas set sha256 = repeat(''d'', 64)'), 'P0001');
  perform pg_temp.chk('DELETE de una firma', pg_temp.falla('delete from public.aliado_firmas'), 'P0001');
  perform pg_temp.chk('reactivar una firma retirada', pg_temp.falla('update public.aliado_firmas set vigente = true where not vigente'), 'P0001');
  perform pg_temp.chk('dos firmas vigentes de un aliado (índice único parcial)', pg_temp.falla('insert into public.aliado_firmas (aliado_id, storage_path, sha256, mime, bytes) select ' || a || ', ''z'', repeat(''e'', 64), ''image/png'', 5'), '23505');
  perform pg_temp.chk('firma con mime no permitido', pg_temp.falla('insert into public.aliado_firmas (aliado_id, storage_path, sha256, mime, bytes, vigente) values (' || b || ', ''z'', repeat(''e'', 64), ''image/svg+xml'', 5, false)'), '23514');
  perform pg_temp.chk('firma de más de 512 KB', pg_temp.falla('insert into public.aliado_firmas (aliado_id, storage_path, sha256, mime, bytes, vigente) values (' || b || ', ''z'', repeat(''e'', 64), ''image/png'', 524289, false)'), '23514');
  -- La aceptación referencia una firma: no se puede borrar la ficha del aliado ni la firma (evidencia)
  perform pg_temp.chk('borrar un aliado con firmas/aceptaciones', pg_temp.falla('delete from public.aliados where id = ' || a), '23503');

  -- Auditoría: cada escritura dejó huella
  select count(*) into n from public.auditoria where tabla in ('aliado_firmas', 'cuenta_cobro_aceptaciones');
  -- 3 altas de firma + 2 retiros de vigencia + 2 aceptaciones = 7 (los intentos rechazados se revierten con su subtransacción).
  perform pg_temp.chk('auditoría registró firmas y aceptaciones (>= 7 filas)', (n >= 7)::text, 'true');
end $$;

-- Permisos reales por rol (la sesión del navegador es `authenticated`/`anon`; solo `service_role` llega a estas tablas y RPC)
do $$
declare
  r text; i int; v text[]; sqls text[] := array[
    'select 1 from public.aliado_firmas limit 1',
    'select 1 from public.cuenta_cobro_aceptaciones limit 1',
    'insert into public.cuenta_cobro_aceptaciones (clave, aliado_id, version, snapshot, snapshot_hash, firma_id, firma_sha256, aceptada_por) values (''ab:1'', 1, 1, ''{}'', repeat(''a'', 64), 1, ''x'', gen_random_uuid())',
    'select public.aceptar_cuenta_cobro(''ab:1'', 1, ''{}''::jsonb, repeat(''a'', 64), gen_random_uuid())',
    'select public.registrar_firma_aliado(1, ''x'', repeat(''a'', 64), ''image/png'', 1, gen_random_uuid())'];
  nombres text[] := array['SELECT firmas', 'SELECT aceptaciones', 'INSERT aceptaciones', 'EXECUTE aceptar_cuenta_cobro', 'EXECUTE registrar_firma_aliado'];
  sr text;
begin
  -- Se ejecuta bajo el rol y SIN helpers de pg_temp (un rol de cliente no los alcanza); los resultados se anotan después de volver al rol de la sesión.
  foreach r in array array['anon', 'authenticated'] loop
    v := array[]::text[];
    execute format('set local role %I', r);
    for i in 1 .. array_length(sqls, 1) loop
      begin execute sqls[i]; v := v || 'sin error'; exception when others then v := v || sqlstate; end;
    end loop;
    reset role;
    for i in 1 .. array_length(sqls, 1) loop perform pg_temp.chk(r || ': ' || nombres[i], v[i], '42501'); end loop;
  end loop;
  set local role service_role;
  begin execute 'select count(*) from public.cuenta_cobro_aceptaciones'; sr := 'sin error'; exception when others then sr := sqlstate; end;
  reset role;
  perform pg_temp.chk('service_role: SELECT aceptaciones', sr, 'sin error');
  perform pg_temp.chk('bucket aliado-firmas privado, 512 KB, png/jpg', (select concat_ws('/', public::text, file_size_limit::text, array_to_string(allowed_mime_types, ',')) from storage.buckets where id = 'aliado-firmas'), 'false/524288/image/png,image/jpeg');
end $$;

select n, control, observado, esperado, estado from r318 order by n;
select count(*) filter (where estado = 'FALLO') as fallos, count(*) as controles from r318;
rollback;
