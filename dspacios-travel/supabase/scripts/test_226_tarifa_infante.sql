-- ─────────────────────────────────────────────────────────────────────────
-- BATERÍA SQL · 226 (tarifa de infante). SOLO bases desechables (CI o local); nunca una base remota.
-- Corre en UNA transacción que termina en ROLLBACK.
--
-- Uso:  psql -X -q -v ON_ERROR_STOP=1 -f test_226_tarifa_infante.sql   (base con 001-226)
-- Cierre esperado: "TEST 226 SQL: TODO OK".
--
--   A  columnas y CHECK (fee_infante, precio_infante, precio_pvp_menor2): negativos rechazados, NULL permitido
--   B  crear_bloqueo acepta fee_infante (RPC atómica, AUT-1) y rechaza lo inválido
--   C  publicar_tarifario_resultado persiste precio_pvp_menor2 (y acepta payloads viejos sin la clave)
--   D  vistas: tarifario_resultado_publicable expone la columna; tarifario_resumen.precio_infante = precio del menor de 2 años
--   E  invalidación: cambiar fee_infante (bloqueo, empaquetado) o precio_infante (servicio, temporada) marca el paquete pendiente;
--      repetir el mismo precio_infante del servicio NO invalida; un paquete ajeno no se toca
--   F  ACL / roles: venta y anon no publican ni crean bloqueos; la API no ejecuta las funciones de trigger
--   G  nada congelado se toca: ventas, abonos y cuentas por pagar de un contrato DTM-9226 quedan idénticos
--   Z  conclusión: las pruebas fueron concluyentes (conteos de las propias fixtures, no literales)
-- ─────────────────────────────────────────────────────────────────────────
begin;

create schema t226;
create table t226.res (nombre text, ok boolean, detalle text);

create function t226.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t226.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre;
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

create function t226.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000226' || case p_k
    when 'super' then '001' when 'gere' then '002' when 'admi' then '003' when 'oper' then '004'
    when 'ctrl' then '005' when 'vent' then '006' when 'agen' then '008' else '999' end)::uuid
$$;

-- Ejecuta UNA consulta que devuelve un solo texto como el usuario `p_k` (NULL = sin sesión) con el rol de Postgres
-- `p_rol` (la API usa authenticated/anon). Devuelve el texto o 'ERR <sqlstate>'. `set local role` es imprescindible:
-- un superusuario SE SALTA la RLS.
create function t226.q(p_sql text, p_k text, p_rol text default 'authenticated') returns text
language plpgsql as $$
declare v_res text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_k is null then '' else json_build_object('sub', t226.u(p_k), 'role', p_rol)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(t226.u(p_k)::text, ''), true);
    execute format('set local role %I', p_rol);
    execute p_sql into v_res;
  exception when others then
    v_res := 'ERR ' || sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_res;
end $$;

-- ── Usuarios de prueba: uno por rol ─────────────────────────────────────────────────────────
insert into auth.users (id, email)
select t226.u(k), 'c226-' || k || '@x.test' from unnest(array['super','gere','admi','oper','ctrl','vent','agen']) k
on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t226.u(v.k), 'c226-' || v.k || '@x.test', 'C226 ' || v.k, v.r::rol_usuario, true, 'mayorista'
from (values ('super','superadmin'), ('gere','gerencia'), ('admi','administracion'), ('oper','operaciones'),
             ('ctrl','control_vuelo'), ('vent','venta'), ('agen','agencia')) v(k, r)
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (226010, 'T226 DESTINO', 'CTG', 'Colombia', true);

insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id) values
  (226301, 'T226 paquete activo', 'bloqueo', true, 226010),
  (226302, 'T226 paquete viejo (filas sin la columna nueva)', 'bloqueo', true, 226010);
select setval(pg_get_serial_sequence('public.armado_paquetes', 'id'), greatest((select max(id) from public.armado_paquetes), 226302));

insert into public.servicios_adicionales (id, nombre, precio_persona) values (226401, 'T226 tour', 100000);
insert into public.servicio_temporadas (id, servicio_id, nombre, precio_persona) values (226411, 226401, 'ALTA T226', 120000);
insert into public.armado_servicios (paquete_id, servicio_id) values (226301, 226401);

insert into public.empaquetados (id, record, aerolinea, ruta, fecha_ida, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo)
values (226501, 'T226E1', 'AEROTEST', 'BOG - CTG - BOG', current_date + 40, 100000, 120000, 10, true);
insert into public.armado_empaquetados (paquete_id, empaquetado_id) values (226301, 226501);

-- Bloqueo creado por la RPC real (sin la columna: nace en 0), enlazado al paquete.
do $$
declare v_res text; v_id bigint;
begin
  v_res := t226.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't226a', 'modalidad_emision', 'serie',
            'tarifa_para_empaquetar', 200000, 'fecha_ida', '2030-01-10', 'fecha_regreso', '2030-01-13', 'ruta', 'BOG - CTG - BOG'), 2))->>'id'$q$, 'super');
  v_id := nullif(v_res, '')::bigint;
  insert into public.armado_vuelos (paquete_id, bloqueo_id) values (226301, v_id);
exception when others then
  raise notice 'FALLO setup bloqueo: % (%)', sqlerrm, v_res;
  insert into t226.res values ('setup bloqueo', false, coalesce(v_res, sqlerrm));
end $$;

-- ═ A · columnas y CHECK ═══════════════════════════════════════════════════════════════════
do $$
declare v_id bigint := (select id from public.bloqueos_vuelo where record = 'T226A');
begin
  perform t226.afirma('A1 bloqueo creado sin fee_infante nace en 0 (not null default 0)',
    (select fee_infante from public.bloqueos_vuelo where id = v_id) = 0, 'id=' || coalesce(v_id::text, '<null>'));
  begin
    update public.bloqueos_vuelo set fee_infante = -1 where id = v_id;
    perform t226.afirma('A2 fee_infante negativo rechazado', false, 'aceptó -1');
  exception when check_violation then
    perform t226.afirma('A2 fee_infante negativo rechazado (check_violation)', true);
  end;
  begin
    update public.bloqueos_vuelo set fee_infante = null where id = v_id;
    perform t226.afirma('A3 fee_infante NULL rechazado (not null)', false, 'aceptó NULL');
  exception when not_null_violation then
    perform t226.afirma('A3 fee_infante NULL rechazado (not_null_violation)', true);
  end;
  begin
    update public.servicios_adicionales set precio_infante = -5 where id = 226401;
    perform t226.afirma('A4 precio_infante negativo rechazado', false, 'aceptó -5');
  exception when check_violation then
    perform t226.afirma('A4 precio_infante negativo rechazado (check_violation)', true);
  end;
  update public.servicios_adicionales set precio_infante = 0 where id = 226401;
  perform t226.afirma('A5 precio_infante = 0 (gratis) se guarda y es distinto de NULL',
    (select precio_infante is not null and precio_infante = 0 from public.servicios_adicionales where id = 226401));
  update public.servicios_adicionales set precio_infante = null where id = 226401;
  perform t226.afirma('A6 precio_infante NULL (sin configurar) se guarda',
    (select precio_infante is null from public.servicios_adicionales where id = 226401));
  begin
    update public.servicio_temporadas set precio_infante = -1 where id = 226411;
    perform t226.afirma('A7 precio_infante de temporada negativo rechazado', false, 'aceptó -1');
  exception when check_violation then
    perform t226.afirma('A7 precio_infante de temporada negativo rechazado (check_violation)', true);
  end;
end $$;

-- ═ B · crear_bloqueo con fee_infante ═══════════════════════════════════════════════════════
do $$
declare v_res text; v_fee numeric;
begin
  v_res := t226.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't226b', 'modalidad_emision', 'grupo', 'fee_infante', 12345.5), 1))->>'id'$q$, 'super');
  select fee_infante into v_fee from public.bloqueos_vuelo where record = 'T226B';
  perform t226.afirma('B1 crear_bloqueo guarda fee_infante = 12345.5', v_fee = 12345.5, 'res=' || coalesce(v_res, '<null>') || ' fee=' || coalesce(v_fee::text, '<null>'));
  v_res := t226.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't226c', 'modalidad_emision', 'grupo', 'fee_infante', ''), 1))->>'id'$q$, 'super');
  perform t226.afirma('B2 fee_infante vacío = 0', (select fee_infante from public.bloqueos_vuelo where record = 'T226C') = 0, 'res=' || coalesce(v_res, '<null>'));
  v_res := t226.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't226d', 'modalidad_emision', 'grupo', 'fee_infante', -3), 1))->>'id'$q$, 'super');
  perform t226.afirma('B3 fee_infante negativo no crea el record (23514)', v_res = 'ERR 23514' and not exists (select 1 from public.bloqueos_vuelo where record = 'T226D'), 'res=' || coalesce(v_res, '<null>'));
  v_res := t226.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't226e', 'modalidad_emision', 'grupo', 'fee_infante', 'abc'), 1))->>'id'$q$, 'super');
  perform t226.afirma('B4 fee_infante no numérico no crea el record', v_res like 'ERR%' and not exists (select 1 from public.bloqueos_vuelo where record = 'T226E'), 'res=' || coalesce(v_res, '<null>'));
  v_res := t226.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't226f', 'modalidad_emision', 'grupo', 'fee_infante', 5), 1))->>'id'$q$, 'vent');
  perform t226.afirma('B5 venta no crea bloqueos (AUT-1)', v_res like 'ERR%' and not exists (select 1 from public.bloqueos_vuelo where record = 'T226F'), 'res=' || coalesce(v_res, '<null>'));
  v_res := t226.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't226g', 'modalidad_emision', 'grupo'), 1))->>'id'$q$, null, 'anon');
  perform t226.afirma('B6 anon no ejecuta crear_bloqueo', v_res like 'ERR%' and not exists (select 1 from public.bloqueos_vuelo where record = 'T226G'), 'res=' || coalesce(v_res, '<null>'));
  perform t226.afirma('B7 crear_bloqueo conserva las sillas atómicas (2 sillas del bloqueo T226A)',
    (select count(*) from public.sillas s join public.bloqueos_vuelo b on b.id = s.bloqueo_id where b.record = 'T226A') = 2);
end $$;

-- ═ C · publicar_tarifario_resultado persiste precio_pvp_menor2 ═══════════════════════════════
create function t226.publicar(p_paquete bigint, p_filas jsonb, p_k text default 'oper') returns text
language plpgsql as $$
declare v_gen bigint; v_rev bigint;
begin
  select tarifario_generacion, tarifario_revision_fuente into v_gen, v_rev from public.armado_paquetes where id = p_paquete;
  return t226.q(format('select public.publicar_tarifario_resultado(%s, %s, %s, %L, %L::jsonb)::text', p_paquete, v_gen, v_rev, 'COP', p_filas::text), p_k);
end $$;

do $$
declare v_res text; n_menor2 integer; v_infante numeric; v_serv numeric; v_hab numeric;
begin
  -- Paquete NUEVO: habitación adulta (sin menor2), infante (con menor2), servicio por persona sin precio de infante (NULL).
  v_res := t226.publicar(226301, jsonb_build_array(
    jsonb_build_object('modulo', 'bloqueo', 'categoria', 'ESTANDAR', 'regimen', 'PC', 'acomodacion', 'doble', 'noches', 3,
                       'fecha_ida', '2030-01-10', 'fecha_regreso', '2030-01-13', 'base_comisionable', 1000, 'impuesto', 0, 'precio_pvp', 1730000),
    jsonb_build_object('modulo', 'bloqueo', 'categoria', 'ESTANDAR', 'regimen', 'PC', 'acomodacion', 'infante', 'noches', 3,
                       'fecha_ida', '2030-01-10', 'fecha_regreso', '2030-01-13', 'base_comisionable', 1000, 'impuesto', 0,
                       'precio_pvp', 1305000, 'precio_pvp_menor2', 155000),
    jsonb_build_object('modulo', 'servicios', 'servicio_id', 226401, 'servicio_nombre', 'T226 tour', 'tipo_tarifa', 'persona',
                       'base_comisionable', 100000, 'impuesto', 0, 'precio_pvp', 100000)), 'oper');
  perform t226.afirma('C1 operaciones publica un snapshot con precio_pvp_menor2', v_res = 'true', 'res=' || coalesce(v_res, '<null>'));
  select precio_pvp_menor2 into v_infante from public.tarifario_resultado where paquete_id = 226301 and acomodacion = 'infante';
  select precio_pvp_menor2 into v_hab from public.tarifario_resultado where paquete_id = 226301 and acomodacion = 'doble';
  select precio_pvp_menor2 into v_serv from public.tarifario_resultado where paquete_id = 226301 and modulo = 'servicios';
  perform t226.afirma('C2 el infante guarda 155000 en precio_pvp_menor2', v_infante = 155000, 'obtenido=' || coalesce(v_infante::text, '<null>'));
  perform t226.afirma('C3 la habitación adulta queda con precio_pvp_menor2 NULL', v_hab is null and exists (select 1 from public.tarifario_resultado where paquete_id = 226301 and acomodacion = 'doble'));
  perform t226.afirma('C4 el servicio sin precio de infante queda NULL (paga como adulto)', v_serv is null and exists (select 1 from public.tarifario_resultado where paquete_id = 226301 and modulo = 'servicios'));
  perform t226.afirma('C5 el precio_pvp de adulto NO se alteró (1305000 en la fila infante)',
    (select precio_pvp from public.tarifario_resultado where paquete_id = 226301 and acomodacion = 'infante') = 1305000);

  -- Payload VIEJO (sin la clave): se acepta y la columna queda NULL.
  v_res := t226.publicar(226302, jsonb_build_array(
    jsonb_build_object('modulo', 'bloqueo', 'categoria', 'ESTANDAR', 'regimen', 'PC', 'acomodacion', 'infante', 'noches', 3,
                       'fecha_ida', '2030-01-10', 'fecha_regreso', '2030-01-13', 'base_comisionable', 1000, 'impuesto', 0, 'precio_pvp', 1305000)), 'oper');
  perform t226.afirma('C6 un payload sin precio_pvp_menor2 (código anterior) se publica', v_res = 'true', 'res=' || coalesce(v_res, '<null>'));
  perform t226.afirma('C7 ...y deja la columna NULL',
    (select precio_pvp_menor2 from public.tarifario_resultado where paquete_id = 226302 and acomodacion = 'infante') is null
    and exists (select 1 from public.tarifario_resultado where paquete_id = 226302 and acomodacion = 'infante'));

  -- Un valor negativo hace fallar la publicación SIN borrar el snapshot anterior.
  select count(*) into n_menor2 from public.tarifario_resultado where paquete_id = 226301;
  v_res := t226.publicar(226301, jsonb_build_array(
    jsonb_build_object('modulo', 'bloqueo', 'categoria', 'X', 'regimen', 'PC', 'acomodacion', 'infante', 'precio_pvp', 1, 'precio_pvp_menor2', -5)), 'oper');
  perform t226.afirma('C8 precio_pvp_menor2 negativo no se publica y el snapshot anterior sobrevive',
    v_res like 'ERR%' and (select count(*) from public.tarifario_resultado where paquete_id = 226301) = n_menor2, 'res=' || coalesce(v_res, '<null>'));
  -- Roles sin permiso.
  v_res := t226.publicar(226301, '[]'::jsonb, 'vent');
  perform t226.afirma('C9 venta no publica (rol sin permiso)', v_res like 'ERR%', 'res=' || coalesce(v_res, '<null>'));
  v_res := t226.q('select public.publicar_tarifario_resultado(226301, 1, 1, ''COP'', ''[]''::jsonb)::text', null, 'anon');
  perform t226.afirma('C10 anon no ejecuta el publicador', v_res like 'ERR%', 'res=' || coalesce(v_res, '<null>'));
end $$;

-- ═ D · vistas ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_res text;
begin
  -- Publicable: el paquete 226301 está activo y su snapshot publicable.
  perform t226.afirma('D0 el snapshot de 226301 quedó publicable (precondición)',
    (select tarifario_snapshot_publicable and activo from public.armado_paquetes where id = 226301));
  v_res := t226.q('select precio_pvp_menor2::text from public.tarifario_resultado_publicable where paquete_id = 226301 and acomodacion = ''infante''', null, 'anon');
  perform t226.afirma('D1 anon lee precio_pvp_menor2 por la vista publicable', v_res = '155000.00', 'obtenido=' || coalesce(v_res, '<null>'));
  v_res := t226.q('select precio_pvp_menor2::text from public.tarifario_resultado_publicable where paquete_id = 226301 and acomodacion = ''infante''', 'vent');
  perform t226.afirma('D2 venta lee precio_pvp_menor2 por la vista publicable', v_res = '155000.00', 'obtenido=' || coalesce(v_res, '<null>'));
  v_res := t226.q('select count(*)::text from public.tarifario_resultado_publicable where paquete_id = 226301', 'agen');
  perform t226.afirma('D3 la vista sigue entregando las filas del paquete publicable (3 filas, mismas de antes)',
    v_res = (select count(*)::text from public.tarifario_resultado where paquete_id = 226301), 'obtenido=' || coalesce(v_res, '<null>'));
  -- Resumen: precio_infante = precio del menor de 2 años; sin la columna (filas viejas) cae a precio_pvp.
  v_res := t226.q('select precio_infante::text from public.tarifario_resumen where paquete_id = 226301 and categoria = ''ESTANDAR''', null, 'anon');
  perform t226.afirma('D4 tarifario_resumen.precio_infante = precio del menor de 2 años (155000)', v_res = '155000.00', 'obtenido=' || coalesce(v_res, '<null>'));
  v_res := t226.q('select precio_infante::text from public.tarifario_resumen where paquete_id = 226302', null, 'anon');
  perform t226.afirma('D5 filas publicadas antes de la 226: precio_infante cae a precio_pvp (1305000)', v_res = '1305000.00', 'obtenido=' || coalesce(v_res, '<null>'));
  -- Un paquete inactivo no se ve por la vista (autorización intacta).
  update public.armado_paquetes set activo = false where id = 226302;
  v_res := t226.q('select count(*)::text from public.tarifario_resultado_publicable where paquete_id = 226302', null, 'anon');
  perform t226.afirma('D6 un paquete desactivado deja de verse por la vista (la 226 no abre nada)', v_res = '0', 'obtenido=' || coalesce(v_res, '<null>'));
  update public.armado_paquetes set activo = true where id = 226302;
  -- Sin escritura por la API.
  v_res := t226.q($q$update public.tarifario_resultado set precio_pvp_menor2 = 1 where paquete_id = 226301 returning 'x'$q$, 'vent');
  perform t226.afirma('D7 venta no escribe tarifario_resultado (precio_pvp_menor2 sigue en 155000)',
    (select precio_pvp_menor2 from public.tarifario_resultado where paquete_id = 226301 and acomodacion = 'infante') = 155000, 'res=' || coalesce(v_res, '<null>'));
  -- Las vistas públicas exponen precio_pvp_menor2 / precio_infante (precios de VENTA) y NINGUNA columna de costo.
  -- (information_schema.columns incluye vistas: aquí se consultan a propósito, por nombre de vista.)
  perform t226.afirma('D8 las vistas públicas exponen los precios de venta del menor de 2 años',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado_publicable' and column_name = 'precio_pvp_menor2')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resumen' and column_name = 'precio_infante'));
  perform t226.afirma('D9 las vistas públicas NO exponen ninguna columna de costo (tarifa_proveedor, tarifa_neta, fee_infante, neto_*, costo_*)',
    not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name in ('tarifario_resultado_publicable', 'tarifario_resumen')
                   and (column_name in ('tarifa_proveedor', 'tarifa_neta', 'tarifa_para_empaquetar', 'fee_infante', 'recargo_neto')
                        or column_name like 'neto_%' or column_name like 'costo%'))
    and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado_publicable') > 0);
end $$;

-- ═ E · invalidación del tarifario ═════════════════════════════════════════════════════════
create function t226.rev(p_paquete bigint) returns bigint language sql stable as $$
  select tarifario_revision_fuente from public.armado_paquetes where id = p_paquete
$$;

do $$
declare r0 bigint; r1 bigint; v_b bigint := (select id from public.bloqueos_vuelo where record = 'T226A');
begin
  -- Bloqueo: fee_infante
  r0 := t226.rev(226301);
  update public.bloqueos_vuelo set fee_infante = 80000 where id = v_b;
  r1 := t226.rev(226301);
  perform t226.afirma('E1 cambiar bloqueos_vuelo.fee_infante invalida el paquete enlazado', r1 > r0 and (select tarifario_estado from public.armado_paquetes where id = 226301) = 'pendiente', 'r0=' || r0 || ' r1=' || r1);
  -- Empaquetado: fee_infante
  r0 := t226.rev(226301);
  update public.empaquetados set fee_infante = 20 where id = 226501;
  perform t226.afirma('E3 cambiar empaquetados.fee_infante invalida el paquete enlazado', t226.rev(226301) > r0, 'r0=' || r0);
  -- Servicio del catálogo: precio_infante
  r0 := t226.rev(226301);
  update public.servicios_adicionales set precio_infante = 40000 where id = 226401;
  perform t226.afirma('E4 cambiar servicios_adicionales.precio_infante invalida el paquete que lo usa', t226.rev(226301) > r0, 'r0=' || r0);
  r0 := t226.rev(226301);
  update public.servicios_adicionales set precio_infante = 40000 where id = 226401;
  perform t226.afirma('E5 repetir el mismo precio_infante NO invalida (IS DISTINCT FROM)', t226.rev(226301) = r0, 'r0=' || r0 || ' ahora=' || t226.rev(226301));
  r0 := t226.rev(226301);
  update public.servicios_adicionales set precio_infante = null where id = 226401;
  perform t226.afirma('E6 volver precio_infante a NULL (sin configurar) también invalida', t226.rev(226301) > r0, 'r0=' || r0);
  -- Temporada del servicio: cualquier cambio dispara
  r0 := t226.rev(226301);
  update public.servicio_temporadas set precio_infante = 25000 where id = 226411;
  perform t226.afirma('E7 cambiar servicio_temporadas.precio_infante invalida el paquete', t226.rev(226301) > r0, 'r0=' || r0);
  -- Un paquete que NO usa ese servicio/bloqueo no se invalida
  r0 := t226.rev(226302);
  update public.servicios_adicionales set precio_infante = 1 where id = 226401;
  update public.empaquetados set fee_infante = 21 where id = 226501;
  update public.bloqueos_vuelo set fee_infante = 81000 where id = v_b;
  perform t226.afirma('E8 un paquete ajeno (226302) no se invalida por esas fuentes', t226.rev(226302) = r0, 'r0=' || r0 || ' ahora=' || t226.rev(226302));
end $$;

-- ═ F · ACL ══════════════════════════════════════════════════════════════════════════════════
do $$
declare v_res text;
begin
  perform t226.afirma('F1 anon no ejecuta publicar_tarifario_resultado ni crear_bloqueo',
    not has_function_privilege('anon', 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.crear_bloqueo(jsonb, integer)', 'EXECUTE'));
  perform t226.afirma('F2 authenticated sí las ejecuta (la autorización real es el rol interno)',
    has_function_privilege('authenticated', 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.crear_bloqueo(jsonb, integer)', 'EXECUTE'));
  v_res := t226.q('select public.tarifario_trg_bump_por_bloqueo()::text', 'oper');
  perform t226.afirma('F3 la API no ejecuta las funciones de trigger', v_res like 'ERR%', 'res=' || coalesce(v_res, '<null>'));
  v_res := t226.q('select public.tarifario_invalidar(array[226301]::bigint[], true)::text', 'oper');
  perform t226.afirma('F4 la API no ejecuta tarifario_invalidar', v_res like 'ERR%', 'res=' || coalesce(v_res, '<null>'));
end $$;

-- ═ G · lo congelado no se toca ═════════════════════════════════════════════════════════════
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta) values ('DTM-9226', 'Cliente prueba 226', 'mayorista', 4765000);
insert into public.abonos (numero_contrato, tenant, valor_abono, fecha_abono) values ('DTM-9226', 'mayorista', 1000000, current_date);
insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, servicio, valor_total) values ('DTM-9226', 'mayorista', 'hotel', 'Hotel T226', 860000);
do $$
declare v_antes text; v_despues text;
begin
  v_antes := (select md5(string_agg(x, '|' order by x) ) from (
    select v::text as x from public.ventas v where numero_contrato = 'DTM-9226'
    union all select a::text from public.abonos a where numero_contrato = 'DTM-9226'
    union all select c::text from public.cuentas_por_pagar c where numero_contrato = 'DTM-9226') s);
  -- Todas las operaciones de la 226 sobre fuentes (no tocan estas tablas).
  update public.bloqueos_vuelo set fee_infante = 99 where record = 'T226A';
  update public.servicios_adicionales set precio_infante = 7 where id = 226401;
  perform t226.publicar(226301, '[]'::jsonb, 'oper');
  v_despues := (select md5(string_agg(x, '|' order by x) ) from (
    select v::text as x from public.ventas v where numero_contrato = 'DTM-9226'
    union all select a::text from public.abonos a where numero_contrato = 'DTM-9226'
    union all select c::text from public.cuentas_por_pagar c where numero_contrato = 'DTM-9226') s);
  perform t226.afirma('G1 ventas, abonos y cuentas por pagar del contrato DTM-9226 quedan idénticos', v_antes is not null and v_antes = v_despues, 'antes=' || coalesce(v_antes, '<null>') || ' despues=' || coalesce(v_despues, '<null>'));
end $$;

-- ═ Z · conclusión ═════════════════════════════════════════════════════════════════════════
do $$
declare n_total integer; n_fallos integer; n_a integer; n_b integer; n_c integer; n_d integer; n_e integer; n_f integer; n_g integer;
begin
  select count(*), count(*) filter (where not ok),
         count(*) filter (where nombre like 'A%'), count(*) filter (where nombre like 'B%'), count(*) filter (where nombre like 'C%'),
         count(*) filter (where nombre like 'D%'), count(*) filter (where nombre like 'E%'), count(*) filter (where nombre like 'F%'),
         count(*) filter (where nombre like 'G%')
    into n_total, n_fallos, n_a, n_b, n_c, n_d, n_e, n_f, n_g from t226.res;
  perform t226.afirma('Z conclusiva: cada bloque corrió sus comprobaciones (A,B,C,D,E,F,G todos con al menos una)',
    least(n_a, n_b, n_c, n_d, n_e, n_f, n_g) >= 1, format('A=%s B=%s C=%s D=%s E=%s F=%s G=%s', n_a, n_b, n_c, n_d, n_e, n_f, n_g));
  select count(*), count(*) filter (where not ok) into n_total, n_fallos from t226.res;
  if n_fallos > 0 then
    raise notice 'TEST 226 SQL: % FALLO(S) de %', n_fallos, n_total;
    raise exception 'TEST 226 SQL en rojo';
  end if;
  raise notice 'TEST 226 SQL: TODO OK (% comprobaciones)', n_total;
end $$;

rollback;
