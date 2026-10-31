-- ─────────────────────────────────────────────────────────────────────
-- BATERÍA SQL · 258 (composición publicada). SOLO bases desechables; nunca remota. Una transacción que termina en ROLLBACK.
-- Requisito: base con 001-256 y la 258 aplicada. Cierre esperado: "TEST 258: TODO OK".
--   A  estructura: tabla con RLS y sin acceso directo para anon/authenticated; función solo para authenticated
--   B  registrar con la generación publicada y vigente: escribe; reemplaza lo anterior; un arreglo vacío limpia
--   C  una generación distinta (vieja o inexistente) devuelve false y NO pisa la evidencia
--   D  una publicación nueva sin registrar deja la evidencia con la generación vieja (la reserva la rechaza: fallo cerrado)
--   E  rol sin permiso (venta) falla; entrada no arreglo falla; acceso directo de authenticated a la tabla falla
-- ─────────────────────────────────────────────────────────────────────
begin;

create schema t258;
create table t258.res (nombre text, ok boolean, detalle text);

create function t258.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t258.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    % [%]', p_nombre, left(coalesce(p_detalle, ''), 110);
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

create function t258.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000258' || case p_k when 'oper' then '004' when 'vent' then '006' else '999' end)::uuid
$$;

create function t258.q(p_sql text, p_k text) returns text
language plpgsql as $$
declare v_res text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', t258.u(p_k), 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', t258.u(p_k)::text, true);
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

insert into auth.users (id, email) select t258.u(k), 'c258-' || k || '@x.test' from unnest(array['oper','vent']) k on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t258.u(v.k), 'c258-' || v.k || '@x.test', 'C258 ' || v.k, v.r::rol_usuario, true, 'mayorista'
from (values ('oper','operaciones'), ('vent','venta')) v(k, r)
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;

insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (258010, 'T258 DESTINO', 'CTG', 'Colombia', true);
insert into public.hoteles (id, destino_id, nombre) values (258020, 258010, 'T258 hotel');
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id) values (258301, 'T258 paquete', 'dinamico', true, 258010);

create table t258.last (paq bigint, rev bigint);
create function t258.token(p_paq bigint) returns bigint language plpgsql as $$
declare v text;
begin
  v := t258.q(format('select generacion::text || ''|'' || revision_capturada::text from public.iniciar_generacion_tarifario(%s)', p_paq), 'oper');
  delete from t258.last where paq = p_paq;
  insert into t258.last values (p_paq, split_part(v, '|', 2)::bigint);
  return split_part(v, '|', 1)::bigint;
end $$;
create function t258.pub(p_paq bigint, p_gen bigint) returns text language plpgsql as $$
begin
  return t258.q(format('select public.publicar_tarifario_resultado(%s, %s, %s, ''COP'', %L::jsonb)::text', p_paq, p_gen, (select rev from t258.last where paq = p_paq),
    jsonb_build_array(jsonb_build_object('modulo', 'porcion_terrestre', 'hotel_id', 258020, 'hotel_nombre', 'T258 hotel', 'categoria', 'STD', 'regimen', 'PC', 'acomodacion', 'doble',
                                         'noches', 3, 'precio_pvp', 1000, 'procedencia_mixta', false))::text), 'oper');
end $$;
create function t258.reg(p_gen bigint, p_filas jsonb, p_k text default 'oper') returns text language plpgsql as $$
begin
  return t258.q(format('select public.registrar_composicion_publicada(258301, %s, 1::smallint, %L::jsonb)::text', p_gen, p_filas::text), p_k);
end $$;

-- A · estructura
select t258.afirma('A1 tabla con RLS activa', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.tarifario_composicion_publicada')), false));
select t258.afirma('A2 anon/authenticated sin acceso directo a la tabla',
  not has_table_privilege('anon', 'public.tarifario_composicion_publicada', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.tarifario_composicion_publicada', 'select,insert,update,delete'));
select t258.afirma('A3 función: anon sin EXECUTE, authenticated con EXECUTE',
  not has_function_privilege('anon', 'public.registrar_composicion_publicada(bigint,bigint,smallint,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.registrar_composicion_publicada(bigint,bigint,smallint,jsonb)', 'execute'));

-- B · registrar con la generación publicada y vigente
do $$
declare g bigint; v_res text; v_n int; v_s jsonb; v_gen bigint;
begin
  g := t258.token(258301);
  perform t258.pub(258301, g);
  v_res := t258.reg(g, '[{"fecha_ida":"2030-01-10","servicios_incluidos":[50,112]},{"fecha_ida":"2030-02-10","servicios_incluidos":[]}]'::jsonb);
  select count(*), min(generacion) into v_n, v_gen from public.tarifario_composicion_publicada where paquete_id = 258301;
  perform t258.afirma('B1 registra una fila por fecha con la generación publicada', v_res = 'true' and v_n = 2 and v_gen = g, coalesce(v_res, '') || ' / ' || v_n);
  select servicios_incluidos into v_s from public.tarifario_composicion_publicada where paquete_id = 258301 and fecha_ida = date '2030-01-10';
  perform t258.afirma('B2 guarda los ids de los incluidos horneados', v_s = '[50,112]'::jsonb, v_s::text);

  v_res := t258.reg(g, '[{"fecha_ida":"2030-03-10","servicios_incluidos":[50]}]'::jsonb);
  select count(*) into v_n from public.tarifario_composicion_publicada where paquete_id = 258301;
  perform t258.afirma('B3 registrar de nuevo REEMPLAZA todo (no queda evidencia de fechas anteriores)', v_res = 'true' and v_n = 1 and exists (select 1 from public.tarifario_composicion_publicada where paquete_id = 258301 and fecha_ida = date '2030-03-10'), v_n::text);

  v_res := t258.reg(g, '[]'::jsonb);
  select count(*) into v_n from public.tarifario_composicion_publicada where paquete_id = 258301;
  perform t258.afirma('B4 un arreglo vacío limpia la evidencia', v_res = 'true' and v_n = 0, v_n::text);
end $$;

-- C · generación que no es la vigente
do $$
declare g bigint; v_res text; v_n int;
begin
  g := t258.token(258301);
  perform t258.pub(258301, g);
  perform t258.reg(g, '[{"fecha_ida":"2030-01-10","servicios_incluidos":[50]}]'::jsonb);
  v_res := t258.reg(g - 1, '[{"fecha_ida":"2031-01-10","servicios_incluidos":[999]}]'::jsonb);
  select count(*) into v_n from public.tarifario_composicion_publicada where paquete_id = 258301 and fecha_ida = date '2031-01-10';
  perform t258.afirma('C1 generación vieja: false y no escribe', v_res = 'false' and v_n = 0, coalesce(v_res, '') || ' / ' || v_n);
  v_res := t258.reg(g + 100, '[{"fecha_ida":"2031-01-10","servicios_incluidos":[999]}]'::jsonb);
  select count(*) into v_n from public.tarifario_composicion_publicada where paquete_id = 258301 and fecha_ida = date '2031-01-10';
  perform t258.afirma('C2 generación inexistente: false y no escribe', v_res = 'false' and v_n = 0, coalesce(v_res, ''));
  select count(*) into v_n from public.tarifario_composicion_publicada where paquete_id = 258301 and fecha_ida = date '2030-01-10';
  perform t258.afirma('C3 la evidencia válida anterior sobrevive a los intentos rechazados', v_n = 1, v_n::text);
end $$;

-- D · publicación nueva sin registrar: la evidencia queda con la generación vieja (fallo cerrado en la reserva)
do $$
declare g1 bigint; g2 bigint; v_gen bigint; v_pub bigint;
begin
  g1 := t258.token(258301); perform t258.pub(258301, g1);
  perform t258.reg(g1, '[{"fecha_ida":"2030-01-10","servicios_incluidos":[50]}]'::jsonb);
  g2 := t258.token(258301); perform t258.pub(258301, g2);
  select generacion into v_gen from public.tarifario_composicion_publicada where paquete_id = 258301 and fecha_ida = date '2030-01-10';
  select tarifario_generacion_publicada into v_pub from public.armado_paquetes where id = 258301;
  perform t258.afirma('D1 tras republicar sin registrar, la evidencia es de la generación anterior (≠ publicada → la reserva rechaza)', v_gen = g1 and v_pub = g2 and v_gen <> v_pub, v_gen || ' vs ' || v_pub);
end $$;

-- E · permisos y entradas inválidas
do $$
declare g bigint; v_res text;
begin
  g := t258.token(258301); perform t258.pub(258301, g);
  v_res := t258.reg(g, '[]'::jsonb, 'vent');
  perform t258.afirma('E1 rol venta no puede registrar', v_res like 'ERR%rol sin permiso%', v_res);
  v_res := t258.q(format('select public.registrar_composicion_publicada(258301, %s, 1::smallint, ''{"a":1}''::jsonb)::text', g), 'oper');
  perform t258.afirma('E2 p_filas que no es arreglo falla', v_res like 'ERR%arreglo%', v_res);
  v_res := t258.q('select count(*)::text from public.tarifario_composicion_publicada', 'oper');
  perform t258.afirma('E3 authenticated no lee la tabla directamente', v_res like 'ERR%', v_res);
end $$;

-- Cierre
do $$
declare v_fallos int := (select count(*) from t258.res where not ok);
begin
  raise notice '── % comprobaciones, % fallo(s)', (select count(*) from t258.res), v_fallos;
  if v_fallos = 0 then raise notice 'TEST 258: TODO OK'; else raise notice 'TEST 258: FALLA (% comprobaciones)', v_fallos; end if;
end $$;

rollback;
