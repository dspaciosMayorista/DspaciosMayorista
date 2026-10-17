-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBA 213 · lista fija de destinos + destino fijo de programas.
-- Base LOCAL DESECHABLE con el esquema vigente (001–212, SIN la 211) y la 213 YA aplicada
-- (la aplica test_213_migracion.sh, que además prueba históricos, preflight/postcheck,
-- idempotencia y carreras). Esta parte corre en una transacción que TERMINA EN ROLLBACK.
-- Uso: psql -v ON_ERROR_STOP=1 -f test_213_programa_destino_fijo.sql
-- ───────────────────────────────────────────────────────────────────────────
begin;

create function pg_temp.esperar(p_nombre text, p_ok boolean) returns void language plpgsql as $$
begin
  if not p_ok then raise exception 'FALLO: %', p_nombre; end if;
  raise notice 'OK    %', p_nombre;
end $$;

create function pg_temp.sqlstate_de(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'sin-error';
exception when others then return sqlstate;
end $$;

do $$
declare
  uo uuid := gen_random_uuid();   -- operaciones
  ug uuid := gen_random_uuid();   -- gerencia
  uv uuid := gen_random_uuid();   -- venta
  ua uuid := gen_random_uuid();   -- agencia (B2B)
  p1 bigint; p2 bigint; p3 bigint;
  d_peru bigint; d_brasil bigint; d_otro bigint; d_prov bigint;
  n int;
  e text;
begin
  insert into auth.users (id, email) values (uo, 't213_op@x.test'), (ug, 't213_ger@x.test'), (uv, 't213_venta@x.test'), (ua, 't213_ag@x.test');
  insert into public.usuarios (id, email, nombre, rol) values
    (uo, 't213_op@x.test', 'Op', 'operaciones'), (ug, 't213_ger@x.test', 'Ger', 'gerencia'),
    (uv, 't213_venta@x.test', 'Venta', 'venta'), (ua, 't213_ag@x.test', 'Ag', 'agencia')
    on conflict (id) do nothing;
  update public.usuarios set activo = true, rol = case id when uo then 'operaciones' when ug then 'gerencia' when uv then 'venta' else 'agencia' end::rol_usuario
   where id in (uo, ug, uv, ua);
  insert into public.programas (nombre, publicado) values ('__t213_a__', true), ('__t213_b__', true), ('__t213_c__', false);
  select min(id) into p1 from public.programas where nombre = '__t213_a__';
  select min(id) into p2 from public.programas where nombre = '__t213_b__';
  select min(id) into p3 from public.programas where nombre = '__t213_c__';

  -- ── T1 · programas nuevos/históricos quedan SIN destino (no se asigna nada solo) ──
  perform pg_temp.esperar('T1 programas sin destino por defecto',
    (select count(*) from public.programas where id in (p1, p2, p3) and destino_fijo_id is null) = 3);

  -- ── T2 · permisos de la lista ──────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uo::text, true);
  set local role authenticated;
  insert into public.programa_destinos_fijos (nombre) values ('Perú') returning id into d_peru;
  insert into public.programa_destinos_fijos (nombre) values ('Brasil') returning id into d_brasil;
  reset role;
  perform pg_temp.esperar('T2 operaciones crea destinos', d_peru is not null and d_brasil is not null);

  perform set_config('request.jwt.claims', json_build_object('sub', ug, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', ug::text, true);
  set local role authenticated;
  insert into public.programa_destinos_fijos (nombre) values ('Caribe') returning id into d_otro;
  update public.programa_destinos_fijos set nombre = 'Caribe y Antillas', updated_at = now() where id = d_otro;
  get diagnostics n = row_count;
  reset role;
  perform pg_temp.esperar('T2 gerencia crea y edita', n = 1 and (select nombre from public.programa_destinos_fijos where id = d_otro) = 'Caribe y Antillas');

  for e in select unnest(array['venta', 'agencia']) loop
    perform set_config('request.jwt.claims', json_build_object('sub', case e when 'venta' then uv else ua end, 'role', 'authenticated')::text, true),
            set_config('request.jwt.claim.sub', (case e when 'venta' then uv else ua end)::text, true);
    set local role authenticated;
    declare r text; filas int;
    begin
      begin
        insert into public.programa_destinos_fijos (nombre) values ('Intruso');
        r := 'sin-error';
      exception when others then r := sqlstate;
      end;
      update public.programa_destinos_fijos set nombre = 'Hackeado' where id = d_peru;
      get diagnostics filas = row_count;
      delete from public.programa_destinos_fijos where id = d_brasil;
      reset role;
      perform pg_temp.esperar('T2 rol ' || e || ' NO inserta (RLS 42501)', r = '42501');
      perform pg_temp.esperar('T2 rol ' || e || ' NO edita (0 filas)', filas = 0 and (select nombre from public.programa_destinos_fijos where id = d_peru) = 'Perú');
      perform pg_temp.esperar('T2 rol ' || e || ' NO borra (0 filas)', exists (select 1 from public.programa_destinos_fijos where id = d_brasil));
    end;
  end loop;

  set local role anon;
  n := (select count(*) from public.programa_destinos_fijos);
  begin
    insert into public.programa_destinos_fijos (nombre) values ('Anon');
    e := 'sin-error';
  exception when others then e := sqlstate;
  end;
  reset role;
  perform pg_temp.esperar('T2 anon LEE la lista (para el filtro público)', n >= 3);
  perform pg_temp.esperar('T2 anon NO escribe (privilegio, 42501)', e = '42501');

  -- ── T3 · duplicados y formato ──────────────────────────────────────────────
  foreach e in array array['perú', ' PERU', 'Peru', 'PERÚ'] loop
    perform pg_temp.esperar('T3 duplicado «' || e || '» → 23505 (la CHECK de recorte puede saltar antes: 23514)',
      pg_temp.sqlstate_de(format('insert into public.programa_destinos_fijos (nombre) values (%L)', e)) in ('23505', '23514'));
  end loop;
  perform pg_temp.esperar('T3 duplicado sin espacios sobrantes → 23505', pg_temp.sqlstate_de($q$insert into public.programa_destinos_fijos (nombre) values ('PERU')$q$) = '23505');
  perform pg_temp.esperar('T3 duplicado con espacios internos repetidos → 23505',
    pg_temp.sqlstate_de($q$insert into public.programa_destinos_fijos (nombre) values ('Costa  Caribe')$q$) = 'sin-error'
    and pg_temp.sqlstate_de($q$insert into public.programa_destinos_fijos (nombre) values ('costa caribe')$q$) = '23505');
  perform pg_temp.esperar('T3 nombre distinto pero parecido (Brasil / Brasilia) sí entra',
    pg_temp.sqlstate_de($q$insert into public.programa_destinos_fijos (nombre) values ('Brasilia')$q$) = 'sin-error');
  perform pg_temp.esperar('T3 rechaza vacío, con espacios en los bordes y de más de 80',
    pg_temp.sqlstate_de($q$insert into public.programa_destinos_fijos (nombre) values ('')$q$) = '23514'
    and pg_temp.sqlstate_de($q$insert into public.programa_destinos_fijos (nombre) values (' Con borde ')$q$) = '23514'
    and pg_temp.sqlstate_de(format('insert into public.programa_destinos_fijos (nombre) values (%L)', repeat('x', 81))) = '23514'
    and pg_temp.sqlstate_de(format('insert into public.programa_destinos_fijos (nombre) values (%L)', repeat('y', 80))) = 'sin-error');
  perform pg_temp.esperar('T3 renombrar a un nombre existente → 23505',
    pg_temp.sqlstate_de(format('update public.programa_destinos_fijos set nombre = %L where id = %s', 'brasil', d_peru)) = '23505');

  -- ── T4 · asignación: varios programas con el mismo destino ─────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uo::text, true);
  set local role authenticated;
  update public.programas set destino_fijo_id = d_brasil where id in (p1, p2);
  get diagnostics n = row_count;
  reset role;
  perform pg_temp.esperar('T4 dos programas comparten el mismo destino', n = 2 and (select count(*) from public.programas where destino_fijo_id = d_brasil) = 2);
  perform pg_temp.esperar('T4 el tercero sigue sin destino (nada se deduce)', (select destino_fijo_id from public.programas where id = p3) is null);
  perform pg_temp.esperar('T4 destino inexistente → 23503', pg_temp.sqlstate_de(format('update public.programas set destino_fijo_id = 999999999 where id = %s', p3)) = '23503');

  perform set_config('request.jwt.claims', json_build_object('sub', uv, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uv::text, true);
  set local role authenticated;
  update public.programas set destino_fijo_id = d_peru where id = p3;
  get diagnostics n = row_count;
  reset role;
  perform pg_temp.esperar('T4 rol venta NO asigna destinos (RLS de programas)', n = 0 and (select destino_fijo_id from public.programas where id = p3) is null);

  -- ── T5 · borrar un valor asignado NO es posible; uno libre sí ─────────────
  perform pg_temp.esperar('T5 borrar un destino asignado → 23503 (RESTRICT)',
    pg_temp.sqlstate_de(format('delete from public.programa_destinos_fijos where id = %s', d_brasil)) = '23503');
  perform pg_temp.esperar('T5 el destino y sus asignaciones siguen', (select count(*) from public.programas where destino_fijo_id = d_brasil) = 2);
  perform pg_temp.esperar('T5 borrar un destino libre funciona', pg_temp.sqlstate_de(format('delete from public.programa_destinos_fijos where id = %s', d_otro)) = 'sin-error');
  perform pg_temp.esperar('T5 tras quitarle el destino a todos, sí se puede borrar',
    (select pg_temp.sqlstate_de(format('update public.programas set destino_fijo_id = null where destino_fijo_id = %s', d_brasil))) = 'sin-error'
    and pg_temp.sqlstate_de(format('delete from public.programa_destinos_fijos where id = %s', d_brasil)) = 'sin-error');

  -- ── T6 · lectura pública de programas con su destino (lo que usa el tarifario) ──
  update public.programas set destino_fijo_id = d_peru where id = p1;
  set local role anon;
  n := (select count(*) from public.programas p join public.programa_destinos_fijos d on d.id = p.destino_fijo_id where p.id = p1 and d.nombre = 'Perú');
  reset role;
  perform pg_temp.esperar('T6 anon puede leer programa + destino (join del tarifario)', n = 1);

  -- ── T8 · destino PROVISIONAL «Por clasificar» (marca es_provisional, no el nombre) ──
  perform pg_temp.esperar('T8 un destino normal NO es provisional por defecto',
    (select not es_provisional from public.programa_destinos_fijos where id = d_peru));
  insert into public.programa_destinos_fijos (nombre, es_provisional) values ('Por clasificar', true) returning id into d_prov;
  perform pg_temp.esperar('T8 se crea el provisional con la marca', (select es_provisional from public.programa_destinos_fijos where id = d_prov));
  perform pg_temp.esperar('T8 a lo sumo UN provisional (índice único parcial) → 23505',
    pg_temp.sqlstate_de($q$insert into public.programa_destinos_fijos (nombre, es_provisional) values ('Otro provisional', true)$q$) = '23505');
  perform pg_temp.esperar('T8 un destino REAL con el mismo nombre que el provisional no entra (clave de nombre) → 23505',
    pg_temp.sqlstate_de($q$insert into public.programa_destinos_fijos (nombre) values ('POR CLASIFICAR')$q$) = '23505');
  update public.programa_destinos_fijos set nombre = 'Pendientes' where id = d_prov;
  perform pg_temp.esperar('T8 renombrar el provisional NO le quita la marca (se identifica por la marca, no por el nombre)',
    (select es_provisional from public.programa_destinos_fijos where id = d_prov));
  perform pg_temp.esperar('T8 y un destino real que se llame «Por clasificar» (tras renombrar el provisional) NO es provisional',
    pg_temp.sqlstate_de($q$insert into public.programa_destinos_fijos (nombre) values ('Por clasificar')$q$) = 'sin-error'
    and (select count(*) from public.programa_destinos_fijos where es_provisional) = 1
    and (select not es_provisional from public.programa_destinos_fijos where nombre = 'Por clasificar'));
  update public.programas set destino_fijo_id = d_prov where id = p1;
  perform pg_temp.esperar('T8 el provisional con programas asignados no se borra → 23503',
    pg_temp.sqlstate_de(format('delete from public.programa_destinos_fijos where id = %s', d_prov)) = '23503');
  update public.programas set destino_fijo_id = d_peru where id = p1;
  perform pg_temp.esperar('T8 flujo provisional → destino real: el programa se reasigna y el provisional queda libre',
    (select destino_fijo_id from public.programas where id = p1) = d_peru
    and pg_temp.sqlstate_de(format('delete from public.programa_destinos_fijos where id = %s', d_prov)) = 'sin-error');
  perform set_config('request.jwt.claims', json_build_object('sub', uv, 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', uv::text, true);
  set local role authenticated;
  begin
    insert into public.programa_destinos_fijos (nombre, es_provisional) values ('Intruso provisional', true);
    e := 'sin-error';
  exception when others then e := sqlstate;
  end;
  reset role;
  perform pg_temp.esperar('T8 rol venta NO puede crear un provisional (RLS 42501)', e = '42501');

  -- ── T7 · no se tocó ruta ni alojamiento (212) ─────────────────────────────
  perform pg_temp.esperar('T7 programa_ciudades.alojamiento_previsto de la 212 sigue', exists (
    select 1 from information_schema.columns where table_name = 'programa_ciudades' and column_name = 'alojamiento_previsto'));
  perform pg_temp.esperar('T7 reemplazar_ruta_programa de la 212 sigue', to_regprocedure('public.reemplazar_ruta_programa(bigint,jsonb)') is not null);

  raise notice 'TEST 213 SQL: TODO OK';
end $$;

rollback;
