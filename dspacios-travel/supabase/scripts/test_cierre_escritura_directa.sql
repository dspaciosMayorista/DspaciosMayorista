-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBAS · migración 199 (fase C: cierre de la escritura directa de
-- `sillas` y `bloqueos_vuelo`). SOLO base LOCAL o DESECHABLE, con 192 y
-- 194–199 aplicadas. Crea usuarios, records y contratos sintéticos y termina
-- en ROLLBACK: no deja nada. Se detiene en el primer fallo.
--
-- Cada capa se prueba POR SEPARADO, porque un rechazo de una no demuestra la
-- otra (y una policy que devuelve 0 filas no demuestra la guarda):
--   1. privilegio de tabla: INSERT/DELETE/TRUNCATE revocados → "permission denied";
--   2. policy (AUT-1): UPDATE de otra agencia/rol → 0 filas (se mide como policy);
--   3. trigger: con el privilegio y una policy permisiva CONCEDIDOS dentro de
--      la transacción, cada escritura prohibida tiene que fallar con
--      'GUARDA_ESCRITURA'. Si el trigger no existiera, esas escrituras pasarían.
-- Además: todo lo permitido sigue funcionando (grupo D en sillas sin contrato,
-- resto del record, control del bloqueo, carga masiva), los exentos (dueño de
-- las funciones, service_role) siguen escribiendo, y un fallo a mitad de una
-- sentencia no deja cambios parciales.
-- Uso: psql -v ON_ERROR_STOP=1 -f test_cierre_escritura_directa.sql
-- ───────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP 1
begin;

create function pg_temp.ok(p boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p, false) then raise exception 'FALLO: %', p_msg; end if;
  raise notice 'OK   %', p_msg;
end $$;
create function pg_temp.falla(p_sql text, p_patron text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_patron in sqlerrm) > 0 then raise notice 'OK   % → «%»', p_msg, sqlerrm; return; end if;
    raise exception 'FALLO: % → error inesperado «%» (se esperaba «%»)', p_msg, sqlerrm, p_patron;
  end;
  raise exception 'FALLO: % → no falló (se esperaba «%»)', p_msg, p_patron;
end $$;
-- Filas afectadas por una sentencia (para distinguir "0 filas por policy" de un error).
create function pg_temp.filas(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin execute p_sql; get diagnostics n = row_count; return n; end $$;
create function pg_temp.como(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true)
$$;
create temp table usr (k text primary key, id uuid);
create temp table fx (k text primary key, id bigint);
create temp table res (k text primary key, r jsonb);
grant select on usr, fx to public;
grant select, insert on res to public;
create function pg_temp.fx(p text) returns bigint language sql stable as $$ select id from fx where k = p $$;
-- Cambia de "quién escribe": un usuario sintético (JWT authenticated), anon,
-- service_role o el dueño (postgres). RESET ROLE siempre está permitido.
create function pg_temp.ser(p text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if p = 'anon' then
    set local role anon;
  elsif p = 'service_role' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role;
  elsif p <> 'postgres' then
    perform pg_temp.como((select id from usr where k = p));
    set local role authenticated;
  end if;
end $$;

-- ── Precondición ───────────────────────────────────────────────────────────
select pg_temp.ok(to_regprocedure('public._sillas_guarda_escritura()') is not null
  and to_regprocedure('public._bloqueos_guarda_cupos()') is not null, 'la 199 está aplicada');

-- service_role: en Supabase tiene todos los privilegios de tabla en public (y la
-- 199 no se los quita). La copia local no los trae: se simulan aquí.
grant select, insert, update, delete on public.sillas, public.bloqueos_vuelo to service_role;

-- ── Usuarios sintéticos ────────────────────────────────────────────────────
insert into usr values
  ('sup',    '00000000-0000-0000-0000-000000c99001'),
  ('adm',    '00000000-0000-0000-0000-000000c99002'),
  ('ger',    '00000000-0000-0000-0000-000000c99003'),
  ('ope',    '00000000-0000-0000-0000-000000c99004'),
  ('cv',     '00000000-0000-0000-0000-000000c99005'),
  ('supmin', '00000000-0000-0000-0000-000000c99006'),
  ('opmin',  '00000000-0000-0000-0000-000000c99007'),
  ('venta',  '00000000-0000-0000-0000-000000c99008'),
  ('inact',  '00000000-0000-0000-0000-000000c99009');
insert into auth.users (id, email) select id, 'c199-' || k || '@local.test' from usr;
update public.usuarios u set rol = v.rol::public.rol_usuario, tenant = v.tenant, activo = v.activo, nombre = 'C199 ' || v.k
  from (values ('sup', 'superadmin', 'mayorista', true), ('adm', 'administracion', 'mayorista', true),
               ('ger', 'gerencia', 'mayorista', true), ('ope', 'operaciones', 'mayorista', true),
               ('cv', 'control_vuelo', 'mayorista', true), ('supmin', 'superadmin', 'minorista', true),
               ('opmin', 'operaciones', 'minorista', true), ('venta', 'venta', 'mayorista', true),
               ('inact', 'control_vuelo', 'mayorista', false)) v(k, rol, tenant, activo)
 where u.id = (select id from usr where usr.k = v.k);

-- ── Records y sillas ───────────────────────────────────────────────────────
-- CEY: 1 libre · 2 libre con pasajero de carga masiva · 3 con contrato · 4 con
-- contrato manual · 5 en_plazo con contrato pendiente · 6 retirada (no cuenta).
-- CEX: mismo destino/proveedor/tarifa, 4 libres (destino de traslados y mover).
-- CED: record vacío que se puede eliminar.
insert into public.destinos (nombre) values ('C199 DESTINO'), ('C199 DESTINO 2');
insert into public.proveedores (nombre) values ('C199 PROVEEDOR');
insert into fx select 'd1', id from public.destinos where nombre = 'C199 DESTINO';
insert into fx select 'd2', id from public.destinos where nombre = 'C199 DESTINO 2';
insert into fx select 'p1', id from public.proveedores where nombre = 'C199 PROVEEDOR';
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total, modalidad_emision,
                                   vuelo_ida, hora_salida_ida, hora_llegada_ida) values
  ('CEY001', pg_temp.fx('d1'), pg_temp.fx('p1'), current_date + 40, 300000, 5, 'serie', 'CE100', '08:00', '10:00'),
  ('CEX001', pg_temp.fx('d1'), pg_temp.fx('p1'), current_date + 40, 300000, 4, 'serie', 'CE100', '08:00', '10:00'),
  ('CED001', pg_temp.fx('d1'), pg_temp.fx('p1'), current_date + 40, 300000, 0, 'serie', null, null, null);
insert into fx select 'Y', id from public.bloqueos_vuelo where record = 'CEY001';
insert into fx select 'X', id from public.bloqueos_vuelo where record = 'CEX001';
insert into fx select 'D', id from public.bloqueos_vuelo where record = 'CED001';
insert into public.sillas (bloqueo_id, numero_silla, estado)
  select pg_temp.fx('Y'), g, 'disponible'::public.estado_silla from generate_series(1, 6) g
  union all select pg_temp.fx('X'), g, 'disponible' from generate_series(1, 4) g;
-- Ids de las sillas, tomados como dueño: un rol sin lectura (inactivo, anon)
-- no podría resolverlos y la prueba mediría otra cosa.
create temp table sid as select b.record as rec, s.numero_silla as n, s.id
  from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record in ('CEY001', 'CEX001');
grant select on sid to public;
create function pg_temp.silla(p_rec text, p_n integer) returns bigint language sql stable as $$
  select id from sid where rec = p_rec and n = p_n $$;
insert into public.ventas (numero_contrato, cliente, tenant, estado, financiero_estado, bloqueo_ref_id) values
  ('DTM-9801', 'c199', 'mayorista', 'confirmado', 'completo', pg_temp.fx('Y')),
  ('DTM-9802', 'c199', 'mayorista', 'pendiente', 'completo', pg_temp.fx('Y'));
update public.sillas set pasajero_nombres = 'CARGA', numero_doc = '200' where id = pg_temp.silla('CEY001', 2);
update public.sillas set estado = 'confirmada', numero_contrato = 'DTM-9801', pasajero_nombres = 'ANA', numero_doc = '301' where id = pg_temp.silla('CEY001', 3);
update public.sillas set estado = 'confirmada', contrato_manual = 'EXT-199', pasajero_nombres = 'BEA', numero_doc = '401' where id = pg_temp.silla('CEY001', 4);
update public.sillas set estado = 'en_plazo', numero_contrato = 'DTM-9802', pasajero_nombres = 'CAR', numero_doc = '501', plazo = current_date + 3 where id = pg_temp.silla('CEY001', 5);
update public.sillas set estado = 'retirada' where id = pg_temp.silla('CEY001', 6);
insert into public.contrato_vuelos (numero_contrato, record, direccion) values ('DTM-9801', 'CEY001', 'ida');

-- ═══ 0. Catálogo ═══════════════════════════════════════════════════════════
select pg_temp.ok((select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                    where not t.tgisinternal and t.tgenabled = 'O' and not p.prosecdef
                      and ((t.tgrelid = 'public.sillas'::regclass and t.tgname in ('sillas_guarda_escritura', 'sillas_guarda_truncate'))
                        or (t.tgrelid = 'public.bloqueos_vuelo'::regclass and t.tgname in ('bloqueos_guarda_cupos', 'bloqueos_guarda_truncate')))) = 4,
  'catálogo: 4 triggers habilitados con función SECURITY INVOKER');
select pg_temp.ok((select bool_and((t.tgtype & 2) = 2 and (t.tgtype & 1) = 1 and (t.tgtype & 28) = 28) from pg_trigger t
                    where t.tgname in ('sillas_guarda_escritura', 'bloqueos_guarda_cupos')),
  'catálogo: las guardas de fila son BEFORE, FOR EACH ROW, en INSERT/UPDATE/DELETE');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.sillas', 'INSERT')
  and not has_table_privilege('authenticated', 'public.sillas', 'DELETE')
  and not has_table_privilege('authenticated', 'public.sillas', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.bloqueos_vuelo', 'INSERT')
  and not has_table_privilege('authenticated', 'public.bloqueos_vuelo', 'DELETE')
  and not has_table_privilege('authenticated', 'public.bloqueos_vuelo', 'TRUNCATE')
  and has_table_privilege('authenticated', 'public.sillas', 'UPDATE')
  and has_table_privilege('authenticated', 'public.bloqueos_vuelo', 'UPDATE'),
  'privilegios authenticated: sin INSERT/DELETE/TRUNCATE; UPDATE conservado (grupo D y resto del record)');
select pg_temp.ok(not has_table_privilege('anon', 'public.sillas', 'INSERT') and not has_table_privilege('anon', 'public.sillas', 'UPDATE')
  and not has_table_privilege('anon', 'public.sillas', 'DELETE') and not has_table_privilege('anon', 'public.bloqueos_vuelo', 'INSERT')
  and not has_table_privilege('anon', 'public.bloqueos_vuelo', 'UPDATE') and not has_table_privilege('anon', 'public.bloqueos_vuelo', 'DELETE'),
  'privilegios anon: ninguna escritura');
select pg_temp.ok((select count(*) from pg_policies where schemaname = 'public' and tablename in ('sillas', 'bloqueos_vuelo') and cmd in ('ALL', 'INSERT', 'DELETE')) = 0
  and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('sillas', 'bloqueos_vuelo') and cmd = 'UPDATE'
        and qual like '%mi_tenant()%mayorista%' and with_check like '%mi_tenant()%mayorista%') = 2,
  'policies: sin FOR ALL/INSERT/DELETE; una FOR UPDATE con AUT-1 por tabla');

-- Cobertura: toda columna de `sillas` está clasificada. Si se agrega una nueva,
-- esta prueba obliga a decidir en qué grupo va (y la guarda ya la rechaza, ver §6).
select pg_temp.ok(not exists (
  select 1 from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'sillas'
     and c.column_name <> all (array[
       'id', 'bloqueo_id', 'numero_silla', 'created_at',                        -- E
       'estado', 'numero_contrato', 'contrato_manual',                          -- V
       'pasajero_nombres', 'pasajero_apellidos', 'tipo_doc', 'numero_doc', 'nacimiento', 'asesor', 'agencia',
       'hotel', 'acomodacion', 'plazo', 'inf_nombres', 'inf_apellidos', 'inf_tipo_doc', 'inf_numero',
       'inf_nacimiento', 'responsable_menor', 'updated_at'])),                 -- D
  'cobertura: todas las columnas de sillas están en E, V o D');

-- ═══ 1. Capa de PRIVILEGIO (sin conceder nada) ═════════════════════════════
do $$
declare r text;
begin
  foreach r in array array['sup', 'adm', 'ger', 'ope', 'cv', 'supmin', 'opmin', 'venta', 'inact', 'anon'] loop
    perform pg_temp.ser(r);
    perform pg_temp.falla(format('insert into public.sillas (bloqueo_id, numero_silla, estado) values (%s, 99, %L)', pg_temp.fx('Y'), 'disponible'),
      'permission denied for table sillas', r || ': INSERT de silla (privilegio)');
    perform pg_temp.falla(format('delete from public.sillas where id = %s', pg_temp.silla('CEY001', 1)),
      'permission denied for table sillas', r || ': DELETE de silla (privilegio)');
    perform pg_temp.falla('delete from public.sillas', 'permission denied for table sillas', r || ': DELETE sin WHERE de sillas (privilegio)');
    perform pg_temp.falla('truncate public.sillas', 'permission denied for table sillas', r || ': TRUNCATE de sillas (privilegio)');
    perform pg_temp.falla($q$insert into public.bloqueos_vuelo (record, cupos_total) values ('CEZZZ', 0)$q$,
      'permission denied for table bloqueos_vuelo', r || ': INSERT de record (privilegio)');
    perform pg_temp.falla(format('delete from public.bloqueos_vuelo where id = %s', pg_temp.fx('D')),
      'permission denied for table bloqueos_vuelo', r || ': DELETE de record (privilegio)');
    perform pg_temp.falla('delete from public.bloqueos_vuelo', 'permission denied for table bloqueos_vuelo', r || ': DELETE sin WHERE de records (privilegio)');
  end loop;
  perform pg_temp.ser('anon');
  perform pg_temp.falla(format('update public.sillas set pasajero_nombres = %L where id = %s', 'X', pg_temp.silla('CEY001', 1)),
    'permission denied for table sillas', 'anon: UPDATE de silla (privilegio)');
  perform pg_temp.falla(format('update public.bloqueos_vuelo set notas = %L where id = %s', 'X', pg_temp.fx('Y')),
    'permission denied for table bloqueos_vuelo', 'anon: UPDATE de record (privilegio)');
  perform pg_temp.ser('postgres');
end $$;

-- ═══ 2. Capa de POLICY (AUT-1 y roles): 0 filas, medido como policy ════════
-- Esto NO prueba la guarda (la guarda se prueba en §3 y §4 con la policy a favor).
do $$
declare r text; n integer;
begin
  foreach r in array array['opmin', 'venta', 'inact'] loop
    perform pg_temp.ser(r);
    n := pg_temp.filas(format('update public.sillas set pasajero_apellidos = %L where id = %s', 'POL', pg_temp.silla('CEY001', 1)));
    perform pg_temp.ok(n = 0, r || ': UPDATE de datos de una silla libre → 0 filas (policy AUT-1/rol)');
    n := pg_temp.filas(format('update public.bloqueos_vuelo set notas = %L where id = %s', 'POL', pg_temp.fx('Y')));
    perform pg_temp.ok(n = 0, r || ': UPDATE del record → 0 filas (policy AUT-1/rol)');
  end loop;
  perform pg_temp.ser('postgres');
end $$;
select pg_temp.ok((select pasajero_apellidos from public.sillas where id = pg_temp.silla('CEY001', 1)) is null
  and (select notas from public.bloqueos_vuelo where id = pg_temp.fx('Y')) is null, 'policy: nada cambió');

-- ═══ 3. Capa de TRIGGER con la policy a favor (roles de vuelos de mayorista) ═
-- Aquí la policy deja pasar: si la escritura falla, es la guarda.
do $$
declare r text; c text;
begin
  foreach r in array array['sup', 'adm', 'ger', 'ope', 'cv', 'supmin'] loop
    perform pg_temp.ser(r);
    -- E y V en una silla libre
    foreach c in array array[
        format('bloqueo_id = %s', pg_temp.fx('X')), 'numero_silla = 77', 'id = id + 100000', $q$created_at = now() - interval '1 day'$q$,
        $q$estado = 'confirmada'$q$, $q$estado = 'devuelta'$q$, $q$estado = 'retirada'$q$, $q$numero_contrato = 'DTM-9801'$q$,
        $q$contrato_manual = 'EXT-NUEVO'$q$] loop
      perform pg_temp.falla(format('update public.sillas set %s where id = %s', c, pg_temp.silla('CEY001', 1)),
        'GUARDA_ESCRITURA', r || ': silla libre, ' || c);
    end loop;
    -- quitar contrato / manual / liberar por la API
    perform pg_temp.falla(format('update public.sillas set numero_contrato = null, estado = %L where id = %s', 'disponible', pg_temp.silla('CEY001', 3)),
      'GUARDA_ESCRITURA', r || ': quitar contrato y liberar');
    perform pg_temp.falla(format('update public.sillas set contrato_manual = null where id = %s', pg_temp.silla('CEY001', 4)),
      'GUARDA_ESCRITURA', r || ': quitar contrato manual');
    -- D en sillas con contrato (DIR-2)
    perform pg_temp.falla(format('update public.sillas set pasajero_nombres = %L where id = %s', 'OTRO', pg_temp.silla('CEY001', 3)),
      'tiene contrato', r || ': datos de una silla con contrato');
    perform pg_temp.falla(format('update public.sillas set numero_doc = %L where id = %s', '9', pg_temp.silla('CEY001', 4)),
      'tiene contrato', r || ': datos de una silla con contrato manual');
    perform pg_temp.falla(format('update public.sillas set updated_at = now() + interval %L where id = %s', '1 hour', pg_temp.silla('CEY001', 5)),
      'tiene contrato', r || ': solo updated_at en una silla con contrato');
    -- retirada: nada
    perform pg_temp.falla(format('update public.sillas set pasajero_nombres = %L where id = %s', 'X', pg_temp.silla('CEY001', 6)),
      'está retirada', r || ': datos de una silla retirada');
    -- record: cupos_total e id
    perform pg_temp.falla(format('update public.bloqueos_vuelo set cupos_total = cupos_total + 5 where id = %s', pg_temp.fx('Y')),
      'GUARDA_ESCRITURA', r || ': cupos_total + 5');
    perform pg_temp.falla(format('update public.bloqueos_vuelo set cupos_total = cupos_total - 1 where id = %s', pg_temp.fx('Y')),
      'GUARDA_ESCRITURA', r || ': cupos_total - 1');
    perform pg_temp.falla(format('update public.bloqueos_vuelo set id = id + 100000 where id = %s', pg_temp.fx('Y')),
      'GUARDA_ESCRITURA', r || ': id del record');
  end loop;
  perform pg_temp.ser('postgres');
end $$;

-- ═══ 4. Capa de TRIGGER con privilegio y policy CONCEDIDOS a todos ═════════
-- Simula que alguien vuelve a dar INSERT/DELETE/TRUNCATE o una policy abierta:
-- la guarda tiene que rechazar igual, para authenticated (cualquier rol) y anon.
savepoint capa_trigger;
grant insert, update, delete, truncate on public.sillas, public.bloqueos_vuelo to authenticated, anon;
create policy zz_c199_todo_s on public.sillas for all to authenticated, anon using (true) with check (true);
create policy zz_c199_todo_b on public.bloqueos_vuelo for all to authenticated, anon using (true) with check (true);
-- Sin FK que apunten a estas tablas (solo dentro del savepoint), un TRUNCATE
-- llega al trigger: con FK, Postgres lo rechazaría antes por la referencia o
-- por el privilegio de las tablas en cascada, y eso no probaría la guarda.
do $$
declare r record;
begin
  for r in select conrelid::regclass as t, conname from pg_constraint
            where contype = 'f' and confrelid in ('public.sillas'::regclass, 'public.bloqueos_vuelo'::regclass) loop
    execute format('alter table %s drop constraint %I', r.t, r.conname);
  end loop;
end $$;
create temp table cuenta0 as select (select count(*) from public.sillas) s, (select count(*) from public.bloqueos_vuelo) b;
grant select on cuenta0 to public;
do $$
declare r text;
begin
  foreach r in array array['cv', 'opmin', 'venta', 'inact', 'anon'] loop
    perform pg_temp.ser(r);
    perform pg_temp.falla(format('insert into public.sillas (bloqueo_id, numero_silla, estado) values (%s, 99, %L)', pg_temp.fx('Y'), 'disponible'),
      'GUARDA_ESCRITURA', r || ' (privilegio concedido): INSERT de silla');
    perform pg_temp.falla(format('delete from public.sillas where id = %s', pg_temp.silla('CEY001', 1)),
      'GUARDA_ESCRITURA', r || ' (privilegio concedido): DELETE de silla');
    perform pg_temp.falla('delete from public.sillas', 'GUARDA_ESCRITURA', r || ' (privilegio concedido): DELETE sin WHERE de sillas');
    perform pg_temp.falla('truncate public.sillas', 'GUARDA_ESCRITURA', r || ' (privilegio concedido): TRUNCATE de sillas');
    perform pg_temp.falla(format('update public.sillas set estado = %L, numero_contrato = %L where id = %s', 'confirmada', 'DTM-9801', pg_temp.silla('CEY001', 1)),
      'GUARDA_ESCRITURA', r || ' (policy abierta): vincular contrato');
    perform pg_temp.falla($q$insert into public.bloqueos_vuelo (record, cupos_total) values ('CEZZZ', 0)$q$,
      'GUARDA_ESCRITURA', r || ' (privilegio concedido): INSERT de record con 0 cupos');
    perform pg_temp.falla(format('delete from public.bloqueos_vuelo where id = %s', pg_temp.fx('D')),
      'GUARDA_ESCRITURA', r || ' (privilegio concedido): DELETE de record');
    perform pg_temp.falla('delete from public.bloqueos_vuelo', 'GUARDA_ESCRITURA', r || ' (privilegio concedido): DELETE sin WHERE de records');
    perform pg_temp.falla('truncate public.bloqueos_vuelo', 'GUARDA_ESCRITURA', r || ' (privilegio concedido): TRUNCATE de records');
    perform pg_temp.falla(format('update public.bloqueos_vuelo set cupos_total = 50 where id = %s', pg_temp.fx('Y')),
      'GUARDA_ESCRITURA', r || ' (policy abierta): cupos_total');
  end loop;
  perform pg_temp.ser('postgres');
end $$;
select pg_temp.ok((select s from cuenta0) = (select count(*) from public.sillas)
  and (select b from cuenta0) = (select count(*) from public.bloqueos_vuelo), 'capa trigger: ninguna fila creada ni borrada');
reset role;
rollback to savepoint capa_trigger;
select pg_temp.ok(not has_table_privilege('authenticated', 'public.sillas', 'INSERT')
  and not exists (select 1 from pg_policies where policyname like 'zz_c199%'), 'capa trigger: privilegios y policies de prueba retirados');

-- ═══ 5. PERMITIDO (escritores legítimos con sesión) ════════════════════════
do $$
declare r text; n integer;
begin
  foreach r in array array['sup', 'adm', 'ger', 'ope', 'cv', 'supmin'] loop
    perform pg_temp.ser(r);
    n := pg_temp.filas(format($q$update public.sillas set pasajero_nombres = %L, pasajero_apellidos = 'P', tipo_doc = 'CC', numero_doc = '1%s',
        nacimiento = date '1990-01-01', asesor = 'A', agencia = 'AG', hotel = 'H', acomodacion = 'doble', plazo = current_date + 2,
        inf_nombres = 'I', inf_apellidos = 'J', inf_tipo_doc = 'RC', inf_numero = '2', inf_nacimiento = date '2025-01-01',
        responsable_menor = 'R', updated_at = now() where id = %s$q$, 'PAX-' || r, r, pg_temp.silla('CEY001', 1)));
    perform pg_temp.ok(n = 1, r || ': las 16 columnas de datos + updated_at de una silla libre (1 fila)');
    -- PostgREST puede mandar columnas protegidas con el MISMO valor: no es un cambio.
    n := pg_temp.filas(format('update public.sillas set estado = estado, numero_contrato = numero_contrato, contrato_manual = contrato_manual, bloqueo_id = bloqueo_id, pasajero_nombres = %L where id = %s',
        'MISMO-' || r, pg_temp.silla('CEY001', 1)));
    perform pg_temp.ok(n = 1, r || ': columnas protegidas con el mismo valor + datos (1 fila)');
    -- actualizarBloqueo / registrarCambioOperacional: todo menos cupos
    n := pg_temp.filas(format($q$update public.bloqueos_vuelo set record = 'CEY001', aerolinea = 'AV', ruta = 'BOG-CTG', origen = 'BOG',
        tarifa_neta = 310000, vuelo_ida = 'CE101', fecha_ida = current_date + 41, hora_salida_ida = '09:00', hora_llegada_ida = '11:00',
        vuelo_regreso = 'CE102', fecha_regreso = current_date + 45, hora_salida_reg = '12:00', hora_llegada_reg = '14:00',
        tarifa_para_empaquetar = 320000, fecha_devolucion = current_date + 20, notas = %L, cupos_total = cupos_total where id = %s$q$,
        'nota ' || r, pg_temp.fx('Y')));
    perform pg_temp.ok(n = 1, r || ': editar el record (vuelos, fechas, tarifas, notas; cupos con el mismo valor)');
  end loop;
  -- Control del bloqueo (función INVOKER que depende de la policy de UPDATE)
  perform pg_temp.ser('cv');
  perform public.actualizar_control_bloqueo(pg_temp.fx('Y'), 'grupo', 'emitido', 'pagado', 'c199');
  perform pg_temp.ser('opmin');
  perform pg_temp.falla(format($q$select public.actualizar_control_bloqueo(%s, 'serie', 'pendiente', 'pendiente', 'x')$q$, pg_temp.fx('Y')),
    'permiso', 'opmin: control del bloqueo rechazado (AUT-1 en la policy de UPDATE)');
  perform pg_temp.ser('postgres');
end $$;
select pg_temp.ok((select modalidad_emision = 'grupo' and estado_emision = 'emitido' and estado_pago = 'pagado' and cupos_total = 5
                     from public.bloqueos_vuelo where id = pg_temp.fx('Y')), 'control del bloqueo guardado por un rol de mayorista; cupos intactos');
-- Y vuelve a los mismos datos de vuelo y tarifa que X (para mover/trasladar en §8).
update public.bloqueos_vuelo y set (tarifa_neta, fecha_ida, fecha_regreso, ruta, origen, aerolinea, vuelo_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, hora_salida_reg, hora_llegada_reg)
  = (select tarifa_neta, fecha_ida, fecha_regreso, ruta, origen, aerolinea, vuelo_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, hora_salida_reg, hora_llegada_reg from public.bloqueos_vuelo x where x.id = pg_temp.fx('X')) where y.id = pg_temp.fx('Y');

-- Carga masiva de pasajeros (cargarPasajerosMasivo): elige sillas libres sin
-- pasajero ni contrato y escribe solo datos. Se replica su consulta.
do $$
declare v_ids bigint[]; v_id bigint; n integer;
begin
  perform pg_temp.ser('cv');
  select array_agg(id order by numero_silla) into v_ids from (
    select id, numero_silla from public.sillas
     where bloqueo_id = pg_temp.fx('X') and estado in ('disponible', 'cambio_entrante') and pasajero_nombres is null
       and numero_contrato is null and contrato_manual is null
     order by numero_silla limit 2) t;
  foreach v_id in array v_ids loop
    n := pg_temp.filas(format($q$update public.sillas set pasajero_nombres = 'MASIVO', pasajero_apellidos = 'M', tipo_doc = 'CC',
        numero_doc = %L, nacimiento = date '1980-05-05', updated_at = now() where id = %s$q$, 'M' || v_id, v_id));
    perform pg_temp.ok(n = 1, format('carga masiva: silla %s (1 fila)', v_id));
  end loop;
  perform pg_temp.ser('postgres');
end $$;
select pg_temp.ok((select count(*) from public.sillas where bloqueo_id = pg_temp.fx('X') and pasajero_nombres = 'MASIVO') = 2,
  'carga masiva: 2 pasajeros cargados en sillas libres');

-- ═══ 6. Columna NUEVA: falla cerrada ═══════════════════════════════════════
savepoint col_nueva;
alter table public.sillas add column zz_c199_nueva text;
select pg_temp.ser('cv');
select pg_temp.falla(format('update public.sillas set zz_c199_nueva = %L where id = %s', 'x', pg_temp.silla('CEY001', 1)),
  'zz_c199_nueva', 'una columna sin clasificar queda rechazada (la guarda lista lo permitido)');
select pg_temp.ser('postgres');
rollback to savepoint col_nueva;

-- ═══ 7. Fallo a mitad de una sentencia: sin cambios parciales ══════════════
select pg_temp.ser('cv');
select pg_temp.falla(format('update public.sillas set hotel = %L where bloqueo_id = %s and numero_silla in (1, 2, 3)', 'PARCIAL', pg_temp.fx('Y')),
  'tiene contrato', 'UPDATE de 3 sillas donde una tiene contrato → falla');
select pg_temp.ser('postgres');
select pg_temp.ok((select count(*) from public.sillas where hotel = 'PARCIAL') = 0, 'rollback: ninguna de las 3 sillas quedó con el cambio (ni las libres)');

-- ═══ 8. EXENTOS: dueño de las funciones y service_role ═════════════════════
-- service_role (W8: copia de datos al reservar; confirmación y cron hasta la fase D)
select pg_temp.ser('service_role');
select pg_temp.ok(pg_temp.filas(format($q$update public.sillas set pasajero_nombres = 'ANA W8', numero_doc = '3011' where id = %s$q$,
  pg_temp.silla('CEY001', 3))) = 1, 'service_role: copia de datos a una silla con contrato (W8)');
select pg_temp.ser('postgres');

-- Funciones SECURITY DEFINER con sesión de un rol de vuelos (fase B)
select pg_temp.ser('cv');
insert into res select 'crear', public.crear_bloqueo(jsonb_build_object('record', 'CENUEVO', 'modalidad_emision', 'serie',
  'destino_id', pg_temp.fx('d1'), 'proveedor_id', pg_temp.fx('p1'), 'fecha_ida', (current_date + 40)::text, 'tarifa_neta', 300000), 3);
insert into res select 'retiro', public.retirar_cupo(pg_temp.silla('CEX001', 4), 'c199 retiro', gen_random_uuid());
insert into res select 'traslado', public.trasladar_cupos(pg_temp.fx('X'), pg_temp.fx('Y'), 1, 'c199 traslado', gen_random_uuid());
insert into res select 'estado', public.cambiar_estado_silla((select s.id from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record = 'CENUEVO' and s.numero_silla = 1), 'no_vendida', 'c199', false);
insert into res select 'manual', public.asignar_contrato_manual((select s.id from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record = 'CENUEVO' and s.numero_silla = 2), 'EXT-C199');
insert into res select 'quitar_manual', public.quitar_contrato_manual((select s.id from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record = 'CENUEVO' and s.numero_silla = 2));
insert into res select 'editar', public.editar_pasajero_silla(pg_temp.silla('CEY001', 3), jsonb_build_object('pasajero_apellidos', 'EDITADA'));
insert into res select 'liberar', public.liberar_silla(pg_temp.silla('CEY001', 4));
insert into res select 'eliminar', public.eliminar_bloqueo(pg_temp.fx('D'));
select pg_temp.ser('postgres');
select pg_temp.ok((select count(*) from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record = 'CENUEVO') = 3
  and (select cupos_total from public.bloqueos_vuelo where record = 'CENUEVO') = 3, 'crear_bloqueo: record con 3 sillas');
select pg_temp.ok((select cupos_total from public.bloqueos_vuelo where id = pg_temp.fx('Y')) = 6
  and (select cupos_total from public.bloqueos_vuelo where id = pg_temp.fx('X')) = 2, 'trasladar_cupos (X→Y) y retirar_cupo (X): cupos 6 / 2');
select pg_temp.ok((select estado::text from public.sillas where id = (select s.id from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record = 'CENUEVO' and s.numero_silla = 1)) = 'no_vendida', 'cambiar_estado_silla');
select pg_temp.ok((select contrato_manual is null and estado::text = 'disponible' from public.sillas where id = (select s.id from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record = 'CENUEVO' and s.numero_silla = 2)) and exists (select 1 from public.auditoria where tabla = 'sillas' and antes->>'id' = (select s.id from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record = 'CENUEVO' and s.numero_silla = 2)::text and despues->>'contrato_manual' = 'EXT-C199'), 'asignar y quitar contrato manual');
select pg_temp.ok((select pasajero_apellidos from public.sillas where id = pg_temp.silla('CEY001', 3)) = 'EDITADA', 'editar_pasajero_silla en una silla con contrato');
select pg_temp.ok((select contrato_manual is null and pasajero_nombres is null from public.sillas where id = pg_temp.silla('CEY001', 4)), 'liberar_silla');
select pg_temp.ok(not exists (select 1 from public.bloqueos_vuelo where id = pg_temp.fx('D')), 'eliminar_bloqueo');

-- mover_pasajero en los dos modos (silla con contrato DTM-9801): con su cupo
-- de Y a X (X no tiene libres), y de vuelta solo los datos a la silla libre
-- que Y recibió por el traslado.
select pg_temp.ser('cv');
insert into res select 'mover_cupo', public.mover_pasajero(pg_temp.silla('CEY001', 3), pg_temp.fx('X'), 'con_cupo', false, 'c199 mover', gen_random_uuid());
select pg_temp.ser('postgres');
select pg_temp.ok((select count(*) from public.sillas where bloqueo_id = pg_temp.fx('X') and numero_contrato = 'DTM-9801') = 1
  and (select cupos_total from public.bloqueos_vuelo where id = pg_temp.fx('X')) = 3,
  'mover_pasajero con_cupo: el pasajero y su cupo pasaron a X');
select pg_temp.ser('cv');
insert into res select 'mover_datos', public.mover_pasajero(
  (select id from public.sillas where bloqueo_id = pg_temp.fx('X') and numero_contrato = 'DTM-9801'), pg_temp.fx('Y'), 'solo_datos', false, 'c199 vuelve', gen_random_uuid());
select pg_temp.ser('postgres');
select pg_temp.ok((select count(*) from public.sillas where bloqueo_id = pg_temp.fx('Y') and numero_contrato = 'DTM-9801') = 1
  and (select cupos_total from public.bloqueos_vuelo where id = pg_temp.fx('X')) = 3,
  'mover_pasajero solo_datos: el pasajero volvió a Y; los cupos no cambian');

-- Confirmación (W7, INVOKER + DEFINER) y cron (service_role)
select pg_temp.ser('sup');
insert into res select 'confirmar', public.confirmar_venta('DTM-9802');
select pg_temp.ser('postgres');
select pg_temp.ok((select estado::text from public.sillas where numero_contrato = 'DTM-9802') = 'confirmada', 'confirmar_venta: silla en_plazo → confirmada');
update public.ventas set estado = 'pendiente', plazo = (now() at time zone 'America/Bogota')::date - 1 where numero_contrato = 'DTM-9802';
update public.sillas set estado = 'en_plazo', plazo = current_date - 1 where numero_contrato = 'DTM-9802';
select pg_temp.ser('service_role');
insert into res select 'vencidas', public.liberar_vencidas((now() at time zone 'America/Bogota')::date);
select pg_temp.ser('postgres');
select pg_temp.ok(not exists (select 1 from public.sillas where numero_contrato = 'DTM-9802'), 'liberar_vencidas (service_role): soltó la silla vencida');

-- Escritores dinámicos (execute format) del dueño: renumerar contrato y fusionar destino
select pg_temp.ser('sup');
select public.fn_renumerar_contrato('DTM-9801', 'DTM-9809');
select public.fn_fusionar_destino(pg_temp.fx('d2'), pg_temp.fx('d1'));
select pg_temp.ser('postgres');
select pg_temp.ok(exists (select 1 from public.sillas where numero_contrato = 'DTM-9809'), 'fn_renumerar_contrato: sillas.numero_contrato actualizado (dinámico)');
update public.bloqueos_vuelo set destino_id = pg_temp.fx('d1') where record = 'CENUEVO';
insert into public.destinos (nombre) values ('C199 DESTINO 3');
insert into fx select 'd3', id from public.destinos where nombre = 'C199 DESTINO 3';
update public.bloqueos_vuelo set destino_id = pg_temp.fx('d3') where record = 'CENUEVO';
select pg_temp.ser('sup');
select public.fn_fusionar_destino(pg_temp.fx('d3'), pg_temp.fx('d1'));
select pg_temp.ser('postgres');
select pg_temp.ok((select destino_id from public.bloqueos_vuelo where record = 'CENUEVO') = pg_temp.fx('d1'),
  'fn_fusionar_destino: bloqueos_vuelo.destino_id re-apuntado (dinámico)');

-- Núcleo de reservas: función privada SECURITY DEFINER (la llaman
-- crear_pasajeros_contrato*/guardar_pasajeros_contrato). Se invoca como su
-- dueño, que es exactamente el contexto en que corre dentro de esas funciones.
update public.ventas set estado = 'pendiente' where numero_contrato = 'DTM-9802';
insert into res select 'nucleo', to_jsonb(t) from public._ajustar_sillas_bloqueo_nucleo('DTM-9802', pg_temp.fx('X'), 1) t;
select pg_temp.ok((select count(*) from public.sillas where numero_contrato = 'DTM-9802' and bloqueo_id = pg_temp.fx('X')) = 1,
  'núcleo de reservas (_ajustar_sillas_bloqueo_nucleo): asignó 1 silla');

rollback;
\echo 'TODAS LAS PRUEBAS PASARON (y se revirtieron)'
