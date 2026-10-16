-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBA 212 · reemplazo ATÓMICO de programa_ciudades + alojamiento_previsto.
-- Base LOCAL DESECHABLE con el esquema vigente (001–210, SIN la 211). Aplica la 212
-- dos veces (idempotencia) y corre todo lo demás en una transacción que TERMINA EN
-- ROLLBACK. Las carreras de dos sesiones reales están en test_212_carrera.sh.
-- Uso (desde supabase/scripts/): psql -v ON_ERROR_STOP=1 -f test_212_programa_ruta_alojamiento.sql
-- ───────────────────────────────────────────────────────────────────────────
\i ../migrations/20260601000212_programa_ruta_alojamiento.sql
\i ../migrations/20260601000212_programa_ruta_alojamiento.sql

begin;

create function pg_temp.foto(p bigint) returns text language sql as $$
  select coalesce(string_agg(id || ':' || orden || ':' || nombre || ':' || coalesce(alojamiento_previsto, '~') || ':' || noches, ' | ' order by orden, id), '(vacía)')
    from public.programa_ciudades where programa_id = p
$$;
create function pg_temp.esperar(p_nombre text, p_ok boolean) returns void language plpgsql as $$
begin
  if not p_ok then raise exception 'FALLO: %', p_nombre; end if;
  raise notice 'OK    %', p_nombre;
end $$;

do $$
declare
  pid bigint;
  uo uuid := gen_random_uuid();   -- operaciones (puede escribir)
  uv uuid := gen_random_uuid();   -- venta (RLS no le deja escribir)
  un uuid := gen_random_uuid();   -- autenticado sin fila en usuarios (mi_rol() = null)
  antes text;
  despues text;
  n int;
  err text;
  sqlstate_ text;
  c200 text := repeat('x', 201);
begin
  -- ── Datos de prueba (como dueño de la base) ────────────────────────────────
  insert into auth.users (id, email) values (uo, 't212_op@x.test'), (uv, 't212_venta@x.test'), (un, 't212_sinrol@x.test');
  insert into public.usuarios (id, email, nombre, rol) values (uo, 't212_op@x.test', 'Op', 'operaciones'), (uv, 't212_venta@x.test', 'Venta', 'venta')
    on conflict (id) do update set rol = excluded.rol, activo = true;
  update public.usuarios set rol = 'operaciones', activo = true where id = uo;
  update public.usuarios set rol = 'venta', activo = true where id = uv;
  insert into public.programas (nombre) values ('__t212__') returning id into pid;
  insert into public.programa_ciudades (programa_id, orden, nombre, codigo_iata, noches, alojamiento_previsto) values
    (pid, 0, 'Río de Janeiro', 'GIG', 3, 'Hotel Copacabana 4*'),
    (pid, 1, 'LIMA', 'LIM', 2, 'Hotel Miraflores o similar'),
    (pid, 2, 'rio  de janeiro', null, 1, null);   -- ciudad repetida (otro nombre escrito, misma clave)

  -- ── T1 · como usuario con permiso: reemplazo con texto explícito ───────────
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uo::text, true);
  set local role authenticated;
  select public.reemplazar_ruta_programa(pid, '[{"nombre":"CUSCO","codigo_iata":"CUZ","noches":2,"alojamiento_previsto":"  Casa Andina  "},
     {"nombre":"LIMA","noches":1,"alojamiento_previsto":""},{"nombre":"CUSCO","noches":1}]'::jsonb) into n;
  reset role;
  perform pg_temp.esperar('T1 devuelve 3 filas insertadas', n = 3);
  perform pg_temp.esperar('T1 recorta, vacío→NULL y la 2.ª CUSCO sin clave y sin previa queda NULL',
    (select string_agg(nombre || '=' || coalesce(alojamiento_previsto, '~'), ',' order by orden) from public.programa_ciudades where programa_id = pid)
      = 'CUSCO=Casa Andina,LIMA=~,CUSCO=~');
  perform pg_temp.esperar('T1 orden contiguo 0..2', (select array_agg(orden order by orden) from public.programa_ciudades where programa_id = pid) = array[0,1,2]);

  -- ── T2 · reimportación (sin clave): conserva por nombre/orden, tildes y espacios ─
  update public.programa_ciudades set alojamiento_previsto = 'Hotel A' where programa_id = pid and orden = 0;
  update public.programa_ciudades set alojamiento_previsto = 'Hotel B' where programa_id = pid and orden = 2;
  update public.programa_ciudades set nombre = 'Río de  Janeiro' where programa_id = pid and orden = 1;  -- tilde + doble espacio
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uo::text, true);
  set local role authenticated;
  perform public.reemplazar_ruta_programa(pid, '[{"nombre":"CUSCO"},{"nombre":"RIO DE JANEIRO"},{"nombre":"CUSCO"},{"nombre":"CUSCO"},{"nombre":"BOGOTA"}]'::jsonb);
  reset role;
  perform pg_temp.esperar('T2 repetidas por orden de aparición (1.ª←Hotel A, 2.ª←Hotel B, 3.ª sin previa), tilde/espacios igualan, ciudad nueva NULL',
    (select string_agg(nombre || '=' || coalesce(alojamiento_previsto, '~'), ',' order by orden) from public.programa_ciudades where programa_id = pid)
      = 'CUSCO=Hotel A,RIO DE JANEIRO=~,CUSCO=Hotel B,CUSCO=~,BOGOTA=~');

  -- ── T3 · clave explícita en null limpia solo esa ciudad; el resto hereda ───
  update public.programa_ciudades set alojamiento_previsto = 'Hotel R' where programa_id = pid and nombre = 'RIO DE JANEIRO';
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uo::text, true);
  set local role authenticated;
  perform public.reemplazar_ruta_programa(pid, '[{"nombre":"CUSCO","alojamiento_previsto":null},{"nombre":"RIO DE JANEIRO"},{"nombre":"CUSCO"}]'::jsonb);
  reset role;
  perform pg_temp.esperar('T3 null explícito limpia; sin clave hereda',
    (select string_agg(nombre || '=' || coalesce(alojamiento_previsto, '~'), ',' order by orden) from public.programa_ciudades where programa_id = pid)
      = 'CUSCO=~,RIO DE JANEIRO=Hotel R,CUSCO=Hotel B');

  -- Estado base para las pruebas de fallo.
  update public.programa_ciudades set alojamiento_previsto = 'Conservar ' || orden where programa_id = pid;
  antes := pg_temp.foto(pid);

  -- ── T4 · INSERT fallido a mitad (2.ª fila viola el CHECK de 200): TODO intacto ─
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uo::text, true);
  set local role authenticated;
  begin
    perform public.reemplazar_ruta_programa(pid, jsonb_build_array(
      jsonb_build_object('nombre', 'NUEVA1', 'alojamiento_previsto', 'ok'),
      jsonb_build_object('nombre', 'NUEVA2', 'alojamiento_previsto', c200)));
    err := null;
  exception when others then err := sqlstate;
  end;
  reset role;
  perform pg_temp.esperar('T4 el INSERT fallido da 23514 (check_violation)', err = '23514');
  perform pg_temp.esperar('T4 la ruta y sus alojamientos (incluidos los ids) quedan EXACTAMENTE iguales', pg_temp.foto(pid) = antes);

  -- ── T5 · DELETE denegado por RLS (rol venta: el DELETE afecta 0 filas) ──────
  perform set_config('request.jwt.claims', json_build_object('sub', uv, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uv::text, true);
  set local role authenticated;
  begin
    perform public.reemplazar_ruta_programa(pid, '[{"nombre":"INTRUSA"}]'::jsonb);
    err := null;
  exception when others then err := sqlstate;
  end;
  reset role;
  perform pg_temp.esperar('T5 rol venta: aborta con 42501 (no deja la ruta a medias)', err = '42501');
  perform pg_temp.esperar('T5 la ruta queda intacta', pg_temp.foto(pid) = antes);

  -- ── T5b · autenticado sin fila en usuarios (mi_rol() null) ──────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', un, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', un::text, true);
  set local role authenticated;
  begin
    perform public.reemplazar_ruta_programa(pid, '[{"nombre":"INTRUSA"}]'::jsonb);
    err := null;
  exception when others then err := sqlstate;
  end;
  reset role;
  perform pg_temp.esperar('T5b sin rol: 42501 y ruta intacta', err = '42501' and pg_temp.foto(pid) = antes);

  -- ── T5c · sin ciudades previas y sin permiso de escritura: el INSERT lo frena la RLS ─
  declare pid2 bigint;
  begin
    insert into public.programas (nombre) values ('__t212_vacio__') returning id into pid2;
    perform set_config('request.jwt.claims', json_build_object('sub', uv, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uv::text, true);
    set local role authenticated;
    begin
      perform public.reemplazar_ruta_programa(pid2, '[{"nombre":"INTRUSA"}]'::jsonb);
      err := null;
    exception when others then err := sqlstate;
    end;
    reset role;
    perform pg_temp.esperar('T5c programa vacío + rol venta: RLS rechaza el INSERT (42501) y sigue vacío', err = '42501' and pg_temp.foto(pid2) = '(vacía)');
  end;

  -- ── T6 · entradas inválidas: error y nada cambia ───────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uo::text, true);
  set local role authenticated;
  for err in select unnest(array['{"a":1}', '[{"nombre":"  "}]', '[{"nombre":"X","noches":-1}]', '[{"nombre":"X","noches":"abc"}]', '[1]']) loop
    begin
      perform public.reemplazar_ruta_programa(pid, err::jsonb);
      sqlstate_ := 'sin-error';
    exception when others then sqlstate_ := sqlstate;
    end;
    reset role;
    perform pg_temp.esperar('T6 entrada inválida ' || err || ' → error (' || sqlstate_ || ')', sqlstate_ in ('22023', '22P02'));
    set local role authenticated;
  end loop;
  begin
    perform public.reemplazar_ruta_programa(-1, '[{"nombre":"X"}]'::jsonb);
    sqlstate_ := 'sin-error';
  exception when others then sqlstate_ := sqlstate;
  end;
  reset role;
  perform pg_temp.esperar('T6 programa inexistente → P0002', sqlstate_ = 'P0002');
  perform pg_temp.esperar('T6 la ruta sigue intacta', pg_temp.foto(pid) = antes);

  -- ── T7 · privilegios de EXECUTE ────────────────────────────────────────────
  perform pg_temp.esperar('T7 anon NO ejecuta', not has_function_privilege('anon', 'public.reemplazar_ruta_programa(bigint,jsonb)', 'execute'));
  perform pg_temp.esperar('T7 PUBLIC NO ejecuta (ni siquiera sin rol)', not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = 'public.reemplazar_ruta_programa(bigint,jsonb)'::regprocedure and a.grantee = 0));
  perform pg_temp.esperar('T7 authenticated sí ejecuta', has_function_privilege('authenticated', 'public.reemplazar_ruta_programa(bigint,jsonb)', 'execute'));
  perform pg_temp.esperar('T7 es SECURITY INVOKER', not (select prosecdef from pg_proc where oid = 'public.reemplazar_ruta_programa(bigint,jsonb)'::regprocedure));

  -- ── T8 · DELETE denegado por PRIVILEGIO (revoke delete) ─────────────────────
  revoke delete on public.programa_ciudades from authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uo::text, true);
  set local role authenticated;
  begin
    perform public.reemplazar_ruta_programa(pid, '[{"nombre":"X"}]'::jsonb);
    err := null;
  exception when others then err := sqlstate;
  end;
  reset role;
  perform pg_temp.esperar('T8 sin privilegio DELETE: 42501', err = '42501');
  perform pg_temp.esperar('T8 la ruta queda intacta', pg_temp.foto(pid) = antes);
  grant delete on public.programa_ciudades to authenticated;

  -- ── T9 · INSERT denegado por PRIVILEGIO DESPUÉS de un DELETE exitoso ────────
  revoke insert on public.programa_ciudades from authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uo::text, true);
  set local role authenticated;
  begin
    perform public.reemplazar_ruta_programa(pid, '[{"nombre":"X"}]'::jsonb);
    err := null;
  exception when others then err := sqlstate;
  end;
  reset role;
  perform pg_temp.esperar('T9 sin privilegio INSERT: 42501', err = '42501');
  perform pg_temp.esperar('T9 el DELETE previo se deshizo: ruta y alojamientos intactos', pg_temp.foto(pid) = antes);
  grant insert on public.programa_ciudades to authenticated;

  -- ── T10 · lista vacía borra la ruta (como antes) y no toca otras tablas de programa ─
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uo::text, true);
  set local role authenticated;
  perform public.reemplazar_ruta_programa(pid, '[]'::jsonb);
  reset role;
  perform pg_temp.esperar('T10 lista vacía → ruta vacía', pg_temp.foto(pid) = '(vacía)');

  -- ── T11 · programas anteriores (sin la columna poblada): siguen funcionando ─
  insert into public.programa_ciudades (programa_id, orden, nombre) values (pid, 0, 'ANTIGUA');
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uo::text, true);
  set local role authenticated;
  perform public.reemplazar_ruta_programa(pid, '[{"nombre":"antigua"},{"nombre":"NUEVA"}]'::jsonb);
  reset role;
  perform pg_temp.esperar('T11 fila previa con NULL → sigue NULL', (select count(*) from public.programa_ciudades where programa_id = pid and alojamiento_previsto is null) = 2);

  raise notice 'TEST 212 SQL: TODO OK';
end $$;

rollback;
