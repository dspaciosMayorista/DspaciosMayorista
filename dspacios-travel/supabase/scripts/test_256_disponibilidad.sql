-- ─────────────────────────────────────────────────────────────────────────────
-- BATERÍA SQL · 256 (disponibilidad por fecha/salida). SOLO bases desechables; nunca remota. Una transacción que termina en ROLLBACK.
-- Requisito: base con 001-255 y la 256 aplicada. Cierre esperado: "TEST 256: TODO OK".
--   A  publicar con tramos de fecha en un servicio opcional (parcial), sin tramos (null = todas las fechas) y con valor no arreglo
--   B  publicar el conjunto VACÍO reemplaza lo publicado antes (paquete sin oferta vendible) y deja el estado «listo»
--   C  diagnóstico: se guarda solo para la generación vigente, lo borra la publicación siguiente, rol sin permiso falla
--   D  publicación repetida con el mismo token: sin duplicados; con token viejo: false y no toca nada
--   E  fallo de CHECK a mitad del lote (tramos en una fila que no es de servicios): el snapshot anterior sobrevive
--   F  la vista publicable expone fechas_disponibles solo con el paquete activo y listo
-- ─────────────────────────────────────────────────────────────────────────────
begin;

create schema t256;
create table t256.res (nombre text, ok boolean, detalle text);

create function t256.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t256.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    % [%]', p_nombre, left(coalesce(p_detalle, ''), 110);
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

create function t256.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000256' || case p_k when 'oper' then '004' when 'vent' then '006' else '999' end)::uuid
$$;

-- Ejecuta UNA consulta que devuelve un texto como el usuario p_k con el rol de Postgres 'authenticated'; devuelve el texto o 'ERR <sqlstate> <mensaje>'.
create function t256.q(p_sql text, p_k text) returns text
language plpgsql as $$
declare v_res text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', t256.u(p_k), 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', t256.u(p_k)::text, true);
    execute 'set local role authenticated';
    execute p_sql into v_res;
  exception when others then
    v_res := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_res;
end $$;

insert into auth.users (id, email) select t256.u(k), 'c256-' || k || '@x.test' from unnest(array['oper','vent']) k on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t256.u(v.k), 'c256-' || v.k || '@x.test', 'C256 ' || v.k, v.r::rol_usuario, true, 'mayorista'
from (values ('oper','operaciones'), ('vent','venta')) v(k, r)
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;

insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (256010, 'T256 DESTINO', 'CTG', 'Colombia', true);
insert into public.hoteles (id, destino_id, nombre) values (256020, 256010, 'T256 hotel');
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id) values (256301, 'T256 paquete', 'porcion_terrestre', true, 256010);
insert into public.servicios_adicionales (id, nombre, precio_persona) values (256401, 'T256 tour', 100000);

-- Token vigente (como operaciones): 'generacion' INICIA una generación nueva (una sola llamada) y guarda la revisión; 'revision_capturada' devuelve la guardada.
create table t256.last (paq bigint, rev bigint);
create function t256.token(p_paq bigint, p_que text) returns bigint language plpgsql as $$
declare v text;
begin
  if p_que = 'revision_capturada' then return (select rev from t256.last where paq = p_paq); end if;
  v := t256.q(format('select generacion::text || ''|'' || revision_capturada::text from public.iniciar_generacion_tarifario(%s)', p_paq), 'oper');
  delete from t256.last where paq = p_paq;
  insert into t256.last values (p_paq, split_part(v, '|', 2)::bigint);
  return split_part(v, '|', 1)::bigint;
end $$;

create function t256.pub(p_paq bigint, p_gen bigint, p_rev bigint, p_filas jsonb, p_k text default 'oper') returns text language plpgsql as $$
begin
  return t256.q(format('select public.publicar_tarifario_resultado(%s, %s, %s, ''COP'', %L::jsonb)::text', p_paq, p_gen, p_rev, p_filas::text), p_k);
end $$;

create function t256.fila_hotel(p_pvp numeric) returns jsonb language sql as $$
  select jsonb_build_object('modulo', 'porcion_terrestre', 'hotel_id', 256020, 'hotel_nombre', 'T256 hotel', 'categoria', 'STD', 'regimen', 'PC', 'acomodacion', 'doble',
                            'noches', 3, 'precio_pvp', p_pvp, 'procedencia_mixta', false)
$$;
create function t256.fila_srv(p_pvp numeric, p_fechas jsonb) returns jsonb language sql as $$
  select jsonb_build_object('modulo', 'servicios', 'servicio_id', 256401, 'servicio_nombre', 'T256 tour', 'tipo_tarifa', 'persona', 'precio_pvp', p_pvp, 'procedencia_mixta', false)
         || case when p_fechas is null then '{}'::jsonb else jsonb_build_object('fechas_disponibles', p_fechas) end
$$;

-- Estructura (256 aplicada)
select t256.afirma('0 columna fechas_disponibles (jsonb) en tarifario_resultado',
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'fechas_disponibles' and data_type = 'jsonb'));
select t256.afirma('0 columna tarifario_diagnostico (text) en armado_paquetes',
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'tarifario_diagnostico' and data_type = 'text'));
select t256.afirma('0 registrar_diagnostico_tarifario: anon sin EXECUTE, authenticated con EXECUTE',
  not has_function_privilege('anon', 'public.registrar_diagnostico_tarifario(bigint,bigint,text)', 'execute')
  and has_function_privilege('authenticated', 'public.registrar_diagnostico_tarifario(bigint,bigint,text)', 'execute'));

-- ═ A · tramos de fecha ══════════════════════════════════════════════════════════
do $$
declare g bigint; r bigint; v_res text; v_f jsonb;
begin
  g := t256.token(256301, 'generacion'); r := t256.token(256301, 'revision_capturada');
  v_res := t256.pub(256301, g, r, jsonb_build_array(
    t256.fila_hotel(1000),
    t256.fila_srv(50, '[{"desde":"2030-01-10","hasta":"2030-01-20"},{"desde":"2030-02-01","hasta":"2030-02-05"}]'::jsonb)));
  perform t256.afirma('A1 publica hotel + servicio con tramos', v_res = 'true', v_res);
  select fechas_disponibles into v_f from public.tarifario_resultado where paquete_id = 256301 and modulo = 'servicios';
  perform t256.afirma('A2 los tramos quedan guardados tal cual', v_f = '[{"desde":"2030-01-10","hasta":"2030-01-20"},{"desde":"2030-02-01","hasta":"2030-02-05"}]'::jsonb, v_f::text);
  perform t256.afirma('A3 la fila de hotel no lleva tramos', (select fechas_disponibles from public.tarifario_resultado where paquete_id = 256301 and modulo = 'porcion_terrestre') is null);

  g := t256.token(256301, 'generacion'); r := t256.token(256301, 'revision_capturada');
  v_res := t256.pub(256301, g, r, jsonb_build_array(t256.fila_hotel(1000), t256.fila_srv(50, null)));
  select fechas_disponibles into v_f from public.tarifario_resultado where paquete_id = 256301 and modulo = 'servicios';
  perform t256.afirma('A4 sin clave: null = todas las fechas del viaje', v_res = 'true' and v_f is null, v_res);

  g := t256.token(256301, 'generacion'); r := t256.token(256301, 'revision_capturada');
  v_res := t256.pub(256301, g, r, jsonb_build_array(t256.fila_hotel(1000), t256.fila_srv(50, '"cualquier cosa"'::jsonb)));
  select fechas_disponibles into v_f from public.tarifario_resultado where paquete_id = 256301 and modulo = 'servicios';
  perform t256.afirma('A5 un valor que no es arreglo se guarda como null (nunca texto suelto)', v_res = 'true' and v_f is null, v_res);

  g := t256.token(256301, 'generacion'); r := t256.token(256301, 'revision_capturada');
  v_res := t256.pub(256301, g, r, jsonb_build_array(t256.fila_hotel(1000), t256.fila_srv(50, '[]'::jsonb)));
  select fechas_disponibles into v_f from public.tarifario_resultado where paquete_id = 256301 and modulo = 'servicios';
  perform t256.afirma('A6 arreglo vacío = ninguna fecha (distinto de null)', v_res = 'true' and v_f = '[]'::jsonb, coalesce(v_f::text, 'null'));
end $$;

-- ═ C · diagnóstico ══════════════════════════════════════════════════════════════
do $$
declare g bigint; r bigint; v_res text; v_d text;
begin
  g := t256.token(256301, 'generacion'); r := t256.token(256301, 'revision_capturada');
  perform t256.pub(256301, g, r, jsonb_build_array(t256.fila_hotel(1000)));
  v_res := t256.q(format('select public.registrar_diagnostico_tarifario(256301, %s, %L)::text', g, '1 de 2 salida(s) no se publican: «X»'), 'oper');
  select tarifario_diagnostico into v_d from public.armado_paquetes where id = 256301;
  perform t256.afirma('C1 se registra para la generación publicada y vigente', v_res = 'true' and v_d like '1 de 2 salida%', coalesce(v_res, '') || ' / ' || coalesce(v_d, 'null'));

  v_res := t256.q(format('select public.registrar_diagnostico_tarifario(256301, %s, %L)::text', g - 1, 'viejo'), 'oper');
  select tarifario_diagnostico into v_d from public.armado_paquetes where id = 256301;
  perform t256.afirma('C2 una generación distinta devuelve false y no pisa', v_res = 'false' and v_d like '1 de 2 salida%', coalesce(v_res, '') || ' / ' || coalesce(v_d, 'null'));

  v_res := t256.q(format('select public.registrar_diagnostico_tarifario(256301, %s, %L)::text', g, 'x'), 'vent');
  perform t256.afirma('C3 rol venta no puede registrar', v_res like 'ERR%rol sin permiso%', v_res);

  v_res := t256.q(format('select public.registrar_diagnostico_tarifario(256301, %s, %L)::text', g, repeat('x', 5000)), 'oper');
  select tarifario_diagnostico into v_d from public.armado_paquetes where id = 256301;
  perform t256.afirma('C4 se recorta a 2000 caracteres', length(v_d) = 2000, length(v_d)::text);

  -- la siguiente publicación borra el diagnóstico anterior (jamás queda uno viejo describiendo otra publicación)
  g := t256.token(256301, 'generacion'); r := t256.token(256301, 'revision_capturada');
  v_res := t256.pub(256301, g, r, jsonb_build_array(t256.fila_hotel(1000)));
  select tarifario_diagnostico into v_d from public.armado_paquetes where id = 256301;
  perform t256.afirma('C5 una nueva publicación borra el diagnóstico', v_res = 'true' and v_d is null, coalesce(v_d, 'null'));

  v_res := t256.q(format('select public.registrar_diagnostico_tarifario(256301, %s, %L)::text', g, ''), 'oper');
  select tarifario_diagnostico into v_d from public.armado_paquetes where id = 256301;
  perform t256.afirma('C6 un texto vacío deja el diagnóstico en null', v_d is null, coalesce(v_d, 'null'));
end $$;

-- ═ D · publicación repetida y token viejo ═══════════════════════════════════════
do $$
declare g bigint; r bigint; v_res text; n1 int; n2 int;
begin
  g := t256.token(256301, 'generacion'); r := t256.token(256301, 'revision_capturada');
  v_res := t256.pub(256301, g, r, jsonb_build_array(t256.fila_hotel(1000), t256.fila_srv(50, null)));
  select count(*) into n1 from public.tarifario_resultado where paquete_id = 256301;
  v_res := t256.pub(256301, g, r, jsonb_build_array(t256.fila_hotel(1000), t256.fila_srv(50, null)));
  select count(*) into n2 from public.tarifario_resultado where paquete_id = 256301;
  perform t256.afirma('D1 publicar dos veces con el mismo token no duplica filas (reintento seguro)', v_res = 'true' and n1 = 2 and n2 = 2, n1 || '/' || n2);

  v_res := t256.pub(256301, g - 1, r, jsonb_build_array(t256.fila_hotel(777)));
  perform t256.afirma('D2 token de generación viejo: false y no toca nada', v_res = 'false' and (select count(*) from public.tarifario_resultado where paquete_id = 256301 and precio_pvp = 777) = 0, v_res);
end $$;

-- ═ B · conjunto vacío ═══════════════════════════════════════════════════════════
do $$
declare g bigint; r bigint; v_res text; v_est text; v_err text;
begin
  perform t256.afirma('B0 hay filas publicadas antes', (select count(*) from public.tarifario_resultado where paquete_id = 256301) > 0);
  g := t256.token(256301, 'generacion'); r := t256.token(256301, 'revision_capturada');
  v_res := t256.pub(256301, g, r, '[]'::jsonb);
  select tarifario_estado, tarifario_error into v_est, v_err from public.armado_paquetes where id = 256301;
  perform t256.afirma('B1 publicar [] reemplaza TODO lo anterior (ninguna fila vieja sigue vendiendo)', v_res = 'true' and (select count(*) from public.tarifario_resultado where paquete_id = 256301) = 0, v_res);
  perform t256.afirma('B2 el paquete queda «listo» y sin error (sin oferta; el motivo va en el diagnóstico)', v_est = 'listo' and v_err is null, coalesce(v_est, '') || '/' || coalesce(v_err, 'null'));
  v_res := t256.q(format('select public.registrar_diagnostico_tarifario(256301, %s, %L)::text', g, 'Sin oferta vendible: ninguna de las 16 salida(s) tiene todos sus servicios incluidos con vigencia confirmada.'), 'oper');
  perform t256.afirma('B3 el diagnóstico de un paquete sin oferta se guarda', v_res = 'true' and (select tarifario_diagnostico from public.armado_paquetes where id = 256301) like 'Sin oferta vendible%', v_res);
end $$;

-- ═ E · atomicidad: un CHECK a mitad del lote conserva el snapshot anterior ═══════
do $$
declare g bigint; r bigint; v_res text; n_antes int; n_despues int;
begin
  g := t256.token(256301, 'generacion'); r := t256.token(256301, 'revision_capturada');
  perform t256.pub(256301, g, r, jsonb_build_array(t256.fila_hotel(1000), t256.fila_srv(50, null)));
  select count(*) into n_antes from public.tarifario_resultado where paquete_id = 256301;
  g := t256.token(256301, 'generacion'); r := t256.token(256301, 'revision_capturada');
  -- el tramo en una fila de HOTEL viola tarifario_resultado_fechas_disponibles_chk; la segunda fila nunca debe quedar publicada sola
  v_res := t256.pub(256301, g, r, jsonb_build_array(t256.fila_srv(60, null), t256.fila_hotel(2000) || '{"fechas_disponibles":[{"desde":"2030-01-01","hasta":"2030-01-02"}]}'::jsonb));
  select count(*) into n_despues from public.tarifario_resultado where paquete_id = 256301;
  perform t256.afirma('E1 el CHECK rechaza tramos en una fila que no es de servicios', v_res like 'ERR 23514%', v_res);
  perform t256.afirma('E2 el snapshot anterior sobrevive intacto', n_antes = n_despues and (select count(*) from public.tarifario_resultado where paquete_id = 256301 and precio_pvp in (60, 2000)) = 0, n_antes || '/' || n_despues);
end $$;

-- ═ F · vista publicable ═════════════════════════════════════════════════════════
do $$
declare g bigint; r bigint; v_f text;
begin
  g := t256.token(256301, 'generacion'); r := t256.token(256301, 'revision_capturada');
  perform t256.pub(256301, g, r, jsonb_build_array(t256.fila_hotel(1000), t256.fila_srv(50, '[{"desde":"2030-03-01","hasta":"2030-03-09"}]'::jsonb)));
  v_f := t256.q('select fechas_disponibles::text from public.tarifario_resultado_publicable where paquete_id = 256301 and modulo = ''servicios''', 'oper');
  perform t256.afirma('F1 la vista publicable expone fechas_disponibles', v_f = '[{"desde": "2030-03-01", "hasta": "2030-03-09"}]', v_f);
  update public.armado_paquetes set activo = false where id = 256301;
  perform t256.afirma('F2 con el paquete inactivo la vista no devuelve filas',
    (select count(*) from public.tarifario_resultado_publicable where paquete_id = 256301) = 0);
end $$;

-- Cierre
do $$
declare v_fallos int := (select count(*) from t256.res where not ok);
begin
  raise notice '── % comprobaciones, % fallo(s)', (select count(*) from t256.res), v_fallos;
  if v_fallos = 0 then raise notice 'TEST 256: TODO OK'; else raise notice 'TEST 256: FALLA (% comprobaciones)', v_fallos; end if;
end $$;

rollback;
