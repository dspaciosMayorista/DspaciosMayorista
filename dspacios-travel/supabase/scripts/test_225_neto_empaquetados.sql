-- ─────────────────────────────────────────────────────────────────────────
-- BATERÍA SQL · hotfix 225 (netos de `empaquetados` por rol).
-- SOLO bases desechables (CI o local); nunca una base remota. Corre en UNA transacción que termina en ROLLBACK.
--
-- Uso:  psql -X -q -v ON_ERROR_STOP=1 -f test_225_neto_empaquetados.sql   (base con 001-225)
-- Cierre esperado: "TEST 225 SQL: TODO OK".
--
-- DOS CONDICIONES, como test_columnas_financieras.sql (144):
--   (1) ningún rol sin acceso financiero lee `tarifa_proveedor` por NINGÚN camino: tabla base, vista, join
--       con armado_empaquetados, historial (empaquetado_cambios), RPC de control ni funciones;
--   (2) `venta` SÍ alcanza las filas que necesita (la vista) y `control_vuelo` sigue leyendo y editando la
--       tabla base. Sin (2), (1) la cumple trivialmente quien no ve nada: la sección Z lo exige.
--
--   B  tabla base por rol: quién lee `tarifa_proveedor` (esperado: 5 roles financieros/operativos; no venta)
--   V  vista `empaquetados_basica` por rol: quién la alcanza y que NO trae columnas de costo
--   C  otros caminos al neto: join, historial, RPC, funciones, vistas, tarifario_resultado
--   R  regresión de los flujos de empaquetados: editor (control_vuelo/operaciones), control de emisión,
--      lectura de vigencia de la reserva (venta por la vista)
--   W  escritura: venta no inserta, actualiza ni borra
--   Z  conclusión: las pruebas fueron concluyentes (no vacías)
-- ─────────────────────────────────────────────────────────────────────────
begin;

create schema t225;
create table t225.res (nombre text, ok boolean, detalle text);

create function t225.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t225.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre;
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

create function t225.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000225' || case p_k
    when 'super' then '001' when 'gere' then '002' when 'admi' then '003' when 'oper' then '004'
    when 'ctrl' then '005' when 'vent' then '006' when 'vini' then '007' when 'agen' then '008'
    when 'free' then '009' when 'clie' then '010' else '999' end)::uuid
$$;

-- Ejecuta UNA consulta que devuelve un solo texto, como el usuario `p_k` (NULL = sin sesión) con el rol de
-- Postgres `p_rol` (la API usa authenticated/anon). Devuelve el texto o 'ERR <sqlstate>'. Subtransacción:
-- si falla, se deshace lo del intento. `set local role` es imprescindible: el editor SQL corre como
-- superusuario y un superusuario SE SALTA la RLS.
create function t225.q(p_sql text, p_k text, p_rol text default 'authenticated') returns text
language plpgsql as $$
declare v_res text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_k is null then '' else json_build_object('sub', t225.u(p_k), 'role', p_rol)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(t225.u(p_k)::text, ''), true);
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

-- ── Usuarios de prueba: uno por rol (+ un venta INACTIVO) ───────────────────────────────
insert into auth.users (id, email)
select t225.u(k), 'c225-' || k || '@x.test' from unnest(array['super','gere','admi','oper','ctrl','vent','vini','agen','free','clie']) k
on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t225.u(v.k), 'c225-' || v.k || '@x.test', 'C225 ' || v.k, v.r::rol_usuario, v.a, 'mayorista'
from (values ('super','superadmin',true), ('gere','gerencia',true), ('admi','administracion',true), ('oper','operaciones',true),
             ('ctrl','control_vuelo',true), ('vent','venta',true), ('vini','venta',false),
             ('agen','agencia',true), ('free','freelance',true), ('clie','cliente_final',true)) v(k, r, a)
on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;

-- ── Fixtures: dos empaquetados con importes RECONOCIBLES (123456.78 y 99999) ─────────────────
-- Base desechable: se parte de la tabla vacía DENTRO de esta transacción (termina en ROLLBACK) para que los
-- conteos por rol sean exactos aunque otra fase haya dejado filas.
delete from public.empaquetado_cambios;
delete from public.empaquetados;
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (96010, 'T225 DESTINO', 'CTG', 'Colombia', true);
insert into public.empaquetados
  (id, record, aerolinea, ruta, fecha_ida, fecha_regreso, destino_id, tarifa_proveedor, tarifa_para_empaquetar, fee_infante,
   compra_inicio, compra_fin, estado_emision, estado_pago, notas, activo)
values
  (96001, 'T225A1', 'AEROTEST', 'BOG - CTG - BOG', current_date + 40, current_date + 44, 96010, 123456.78, 150000, 55555,
   current_date - 5, current_date + 30, 'pendiente', 'pagado', 'neto 123456 negociado', true),
  (96002, null, 'AEROTEST', 'BOG - SMR - BOG', current_date + 50, current_date + 54, null, 99999, 120000, 0,
   null, null, null, null, null, false);
select setval(pg_get_serial_sequence('public.empaquetados', 'id'), greatest((select max(id) from public.empaquetados), 96002));

insert into public.empaquetado_cambios (empaquetado_id, detalle, nota, registrado_por)
values (96001, 'Record: (vacio) a T225A1', 'creado en la prueba', 'T225');

insert into public.armado_paquetes (id, nombre, destino_id) values (96301, 'T225 paquete', 96010);
insert into public.armado_empaquetados (paquete_id, empaquetado_id) values (96301, 96001);
select setval(pg_get_serial_sequence('public.armado_paquetes', 'id'), greatest((select max(id) from public.armado_paquetes), 96301));

-- ═ B · tabla base por rol ══════════════════════════════════════════════════════════
-- Esperado: cuántas filas con `tarifa_proveedor` lee cada rol (2 = ambas, 0 = ninguna).
do $$
declare r record; v_res text;
begin
  for r in select * from (values
    ('super',(select count(*)::text from public.empaquetados)), ('gere',(select count(*)::text from public.empaquetados)), ('admi',(select count(*)::text from public.empaquetados)), ('oper',(select count(*)::text from public.empaquetados)), ('ctrl',(select count(*)::text from public.empaquetados)),
    ('vent','0'), ('vini','0'), ('agen','0'), ('free','0'), ('clie','0')) v(k, esperado) loop
    v_res := t225.q('select count(*)::text from public.empaquetados where tarifa_proveedor is not null', r.k);
    perform t225.afirma('B tabla base · ' || r.k || ' lee ' || r.esperado || ' fila(s) con tarifa_proveedor',
      v_res = r.esperado or (r.esperado = '0' and v_res like 'ERR%'), 'obtenido=' || v_res);
  end loop;
  -- Sin sesión (anon): 0 filas o permiso denegado.
  v_res := t225.q('select count(*)::text from public.empaquetados where tarifa_proveedor is not null', null, 'anon');
  perform t225.afirma('B tabla base · anon no lee', v_res = '0' or v_res like 'ERR%', 'obtenido=' || v_res);
  -- Pedir `select *` (como GET /rest/v1/empaquetados?select=*) tampoco le da nada a venta.
  v_res := t225.q('select count(*)::text from (select * from public.empaquetados) s', 'vent');
  perform t225.afirma('B tabla base · venta con select * recibe 0 filas', v_res = '0' or v_res like 'ERR%', 'obtenido=' || v_res);
end $$;

-- ═ V · vista empaquetados_basica por rol ═══════════════════════════════════════════
do $$
declare r record; v_res text;
begin
  for r in select * from (values
    ('super',(select count(*)::text from public.empaquetados)), ('gere',(select count(*)::text from public.empaquetados)), ('admi',(select count(*)::text from public.empaquetados)), ('oper',(select count(*)::text from public.empaquetados)), ('ctrl',(select count(*)::text from public.empaquetados)), ('vent',(select count(*)::text from public.empaquetados)),
    ('vini','0'), ('agen','0'), ('free','0'), ('clie','0')) v(k, esperado) loop
    v_res := t225.q('select count(*)::text from public.empaquetados_basica', r.k);
    perform t225.afirma('V vista · ' || r.k || ' alcanza ' || r.esperado || ' fila(s)', v_res = r.esperado, 'obtenido=' || v_res);
  end loop;
  v_res := t225.q('select count(*)::text from public.empaquetados_basica', null, 'anon');
  perform t225.afirma('V vista · anon sin permiso', v_res like 'ERR%', 'obtenido=' || v_res);

  -- La vista NO tiene ninguna columna de costo: pedirla falla para TODOS los roles (incluido superadmin).
  for r in select k from unnest(array['super','gere','admi','oper','ctrl','vent']) k loop
    v_res := t225.q('select tarifa_proveedor::text from public.empaquetados_basica limit 1', r.k);
    perform t225.afirma('V vista · ' || r.k || ' no puede pedir tarifa_proveedor', v_res = 'ERR 42703', 'obtenido=' || v_res);
  end loop;
  -- Catálogo (como dueño, sin depender de privilegios del rol): 21 columnas y ninguna de costo.
  v_res := (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'empaquetados_basica');
  perform t225.afirma('V vista · expone exactamente 21 columnas (lista cerrada)', v_res = '21', 'obtenido=' || v_res);
  v_res := (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'empaquetados_basica'
              and column_name in ('tarifa_proveedor','fee_infante','tarifa_para_empaquetar','estado_pago','notas'));
  perform t225.afirma('V vista · ninguna de sus columnas es de costo', v_res = '0', 'obtenido=' || v_res);
  -- Lo que SÍ necesita la reserva: vigencia por id.
  v_res := t225.q('select activo::text || ''|'' || (compra_fin is not null)::text from public.empaquetados_basica where id = 96001', 'vent');
  perform t225.afirma('V vista · venta lee activo/compra de un empaquetado por id (lo que usa computarReserva)', v_res = 'true|true', 'obtenido=' || v_res);
  v_res := t225.q('select count(*)::text from public.empaquetados_basica where id = 96002 and activo = false', 'vent');
  perform t225.afirma('V vista · venta ve que el empaquetado 96002 está inactivo', v_res = '1', 'obtenido=' || v_res);
end $$;

-- ═ C · otros caminos al neto ═══════════════════════════════════════════════════════
do $$
declare r record; v_res text;
begin
  -- Join con armado_empaquetados (el embed de PostgREST): venta no pasa por la tabla base.
  for r in select k from unnest(array['vent','vini','agen','free','clie']) k loop
    v_res := t225.q('select count(*)::text from public.armado_empaquetados ae join public.empaquetados e on e.id = ae.empaquetado_id where e.tarifa_proveedor is not null', r.k);
    perform t225.afirma('C join · ' || r.k || ' no alcanza costos por armado_empaquetados', v_res = '0' or v_res like 'ERR%', 'obtenido=' || v_res);
  end loop;
  -- Historial: lo alcanza venta (policy intacta) pero NO contiene importes de costo.
  v_res := t225.q('select count(*)::text from public.empaquetado_cambios', 'vent');
  perform t225.afirma('C historial · la policy de empaquetado_cambios sigue como estaba (venta lee su historial)', v_res = (select count(*)::text from public.empaquetado_cambios), 'obtenido=' || v_res);
  v_res := t225.q('select count(*)::text from public.empaquetado_cambios where coalesce(detalle, '''') || coalesce(nota, '''') ~ ''(123456|99999|55555|tarifa|neto)''', 'vent');
  perform t225.afirma('C historial · venta no encuentra importes ni la palabra neto en empaquetado_cambios', v_res = '0', 'obtenido=' || v_res);
  -- RPC de control: sin lectura de la tabla base, venta no puede ni invocarla con efecto.
  v_res := t225.q('select ''ok'' from (select public.actualizar_control_empaquetado(96001, ''ZZ225'', ''emitido'', ''pagado'', ''venta intenta'')) s', 'vent');
  perform t225.afirma('C RPC · venta no puede usar actualizar_control_empaquetado', v_res like 'ERR%', 'obtenido=' || v_res);
  v_res := t225.q('select ''ok'' from (select public.actualizar_control_empaquetado(96001, ''ZZ225'', ''emitido'', ''pagado'', ''anon intenta'')) s', null, 'anon');
  perform t225.afirma('C RPC · anon no puede usar actualizar_control_empaquetado', v_res like 'ERR%', 'obtenido=' || v_res);
  perform t225.afirma('C RPC · el intento de venta no cambió el record',
    (select record from public.empaquetados where id = 96001) = 'T225A1', null);
  -- Funciones: ninguna SECURITY DEFINER menciona tarifa_proveedor, ninguna devuelve empaquetados ni la columna.
  v_res := (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosecdef and p.prosrc ilike '%tarifa_proveedor%');
  perform t225.afirma('C funciones · ninguna SECURITY DEFINER lee tarifa_proveedor', v_res = '0', 'obtenido=' || v_res);
  v_res := (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and (p.prorettype = 'public.empaquetados'::regtype
                    or pg_get_function_result(p.oid) ilike '%tarifa_proveedor%'
                    or coalesce(array_to_string(p.proargnames, ','), '') ilike '%tarifa_proveedor%'));
  perform t225.afirma('C funciones · ninguna devuelve filas de empaquetados ni la columna', v_res = '0', 'obtenido=' || v_res);
  -- Vistas: solo la tabla base misma la nombra; tarifario_resultado(_publicable) no guarda el neto.
  v_res := (select count(*)::text from pg_views where schemaname = 'public' and definition ilike '%tarifa_proveedor%');
  perform t225.afirma('C vistas · ninguna vista de public menciona tarifa_proveedor', v_res = '0', 'obtenido=' || v_res);
  v_res := (select count(*)::text from information_schema.columns
             where table_schema = 'public' and table_name in ('tarifario_resultado', 'tarifario_resultado_publicable', 'tarifario_resumen', 'ventas_vuelo_sistema')
               and column_name in ('tarifa_proveedor', 'fee_infante'));
  perform t225.afirma('C vistas · tarifario_resultado(_publicable)/resumen y ventas_vuelo_sistema no guardan el neto', v_res = '0', 'obtenido=' || v_res);
end $$;

-- ═ R · regresión de los flujos de empaquetados ═════════════════════════════════════
do $$
declare v_res text; v_n0 bigint;
begin
  -- Editor de vuelos (formularios Nuevo/Editar): control_vuelo y operaciones crean y editan el neto.
  v_res := t225.q('with x as (insert into public.empaquetados (id, fecha_ida, tarifa_proveedor) values (96010, current_date + 60, 777.5) returning 1) select count(*)::text from x', 'ctrl');
  perform t225.afirma('R editor · control_vuelo crea un empaquetado con neto', v_res = '1', 'obtenido=' || v_res);
  v_res := t225.q('select tarifa_proveedor::text from public.empaquetados where id = 96010', 'ctrl');
  perform t225.afirma('R editor · control_vuelo relee el neto que acaba de guardar (el formulario Editar lo necesita)', v_res = '777.50', 'obtenido=' || v_res);
  v_res := t225.q('with x as (update public.empaquetados set tarifa_proveedor = 888.25 where id = 96010 returning 1) select count(*)::text from x', 'ctrl');
  perform t225.afirma('R editor · control_vuelo edita el neto', v_res = '1', 'obtenido=' || v_res);
  v_res := t225.q('with x as (update public.empaquetados set tarifa_proveedor = 111.11 where id = 96010 returning 1) select count(*)::text from x', 'oper');
  perform t225.afirma('R editor · operaciones edita el neto', v_res = '1', 'obtenido=' || v_res);
  v_res := t225.q('with x as (update public.empaquetados set fee_infante = 10 where id = 96010 returning 1) select count(*)::text from x', 'admi');
  perform t225.afirma('R editor · administración edita', v_res = '1', 'obtenido=' || v_res);
  -- Control de emisión: control_vuelo usa la RPC (INVOKER; necesita SELECT ... FOR UPDATE sobre la tabla base).
  v_n0 := (select count(*) from public.empaquetado_cambios where empaquetado_id = 96001);
  v_res := t225.q('select ''ok'' from (select public.actualizar_control_empaquetado(96001, ''T225OK'', ''emitido'', ''pagado'', ''emitido en la prueba'')) s', 'ctrl');
  perform t225.afirma('R control · control_vuelo actualiza record y emisión con la RPC', v_res = 'ok', 'obtenido=' || v_res);
  perform t225.afirma('R control · el cambio quedó (record) y el historial registró la entrada',
    (select record from public.empaquetados where id = 96001) = 'T225OK'
    and (select count(*) from public.empaquetado_cambios where empaquetado_id = 96001) = v_n0 + 1, null);
  v_res := t225.q('select ''ok'' from (select public.actualizar_control_empaquetado(96001, ''T225OP'', ''emitido'', ''pagado'', ''operaciones'')) s', 'oper');
  perform t225.afirma('R control · operaciones también actualiza el control', v_res = 'ok', 'obtenido=' || v_res);
  -- Tras editar el neto, el historial sigue sin importes.
  v_res := t225.q('select count(*)::text from public.empaquetado_cambios where coalesce(detalle, '''') || coalesce(nota, '''') ~ ''(777|888|111|123456|tarifa|neto)''', 'vent');
  perform t225.afirma('R historial · editar el neto no deja importes en empaquetado_cambios', v_res = '0', 'obtenido=' || v_res);
  -- Reserva de Bloqueo/Sistema: venta lee la vigencia por la vista; el vínculo del armado lo hacen los internos.
  v_res := t225.q('select count(*)::text from public.empaquetados_basica where id = 96001 and activo and compra_inicio <= current_date and compra_fin >= current_date', 'vent');
  perform t225.afirma('R reserva · venta valida activo y ventana de compra del empaquetado por la vista', v_res = '1', 'obtenido=' || v_res);
  v_res := t225.q('select count(*)::text from public.armado_empaquetados', 'oper');
  perform t225.afirma('R armado · operaciones sigue leyendo armado_empaquetados', v_res = '1', 'obtenido=' || v_res);
  -- control_vuelo conserva el listado del inventario (vuelos/page.tsx `select *`).
  v_res := t225.q('select count(*)::text from (select * from public.empaquetados) s', 'ctrl');
  perform t225.afirma('R inventario · control_vuelo sigue leyendo el listado completo (select *)', v_res = (select count(*)::text from public.empaquetados), 'obtenido=' || v_res);
end $$;

-- ═ W · escritura: venta nunca escribe ═══════════════════════════════════════════════
do $$
declare v_res text;
begin
  v_res := t225.q('with x as (insert into public.empaquetados (fecha_ida, tarifa_proveedor) values (current_date, 1) returning 1) select count(*)::text from x', 'vent');
  perform t225.afirma('W venta no inserta empaquetados', v_res like 'ERR%', 'obtenido=' || v_res);
  v_res := t225.q('with x as (update public.empaquetados set tarifa_proveedor = 0 where id = 96001 returning 1) select count(*)::text from x', 'vent');
  perform t225.afirma('W venta no actualiza empaquetados', v_res = '0' or v_res like 'ERR%', 'obtenido=' || v_res);
  v_res := t225.q('with x as (delete from public.empaquetados where id = 96002 returning 1) select count(*)::text from x', 'vent');
  perform t225.afirma('W venta no borra empaquetados', v_res = '0' or v_res like 'ERR%', 'obtenido=' || v_res);
  v_res := t225.q('select count(*)::text from public.empaquetados_basica', 'vent');
  perform t225.afirma('W la vista de venta sigue entera tras sus intentos de escritura', v_res = (select count(*)::text from public.empaquetados), 'obtenido=' || v_res);
  v_res := t225.q('insert into public.empaquetados_basica (id) values (96099) returning 1::text', 'vent');
  perform t225.afirma('W la vista no admite escritura', v_res like 'ERR%', 'obtenido=' || v_res);
  perform t225.afirma('W los datos de 96001 y 96002 quedaron intactos',
    (select tarifa_proveedor from public.empaquetados where id = 96001) = 123456.78
    and (select count(*) from public.empaquetados where id = 96002) = 1, null);
end $$;

-- ═ Z · las pruebas fueron concluyentes (no vacías) ═════════════════════════════════
do $$
declare v_a text; v_b text; v_c text; v_d text; v_total text;
begin
  -- Conteo REAL de filas (como dueño, sin RLS): los bloques anteriores (R) crean filas; nada de literales.
  v_total := (select count(*)::text from public.empaquetados);
  v_a := t225.q('select count(*)::text from public.empaquetados_basica', 'vent');
  v_b := t225.q('select count(*)::text from public.empaquetados where tarifa_proveedor is not null', 'ctrl');
  v_c := t225.q('select count(*)::text from public.empaquetados_basica', 'ctrl');
  v_d := t225.q('select count(*)::text from public.empaquetados where tarifa_proveedor is not null', 'vent');
  perform t225.afirma('Z venta SÍ alcanza filas por la vista (>0) y NO por la tabla base (0): la prueba no es vacía',
    v_a::int > 0 and v_a = v_total and v_d = '0', 'vista=' || v_a || ' base=' || v_d || ' total=' || v_total);
  perform t225.afirma('Z control_vuelo SÍ alcanza filas por la tabla base y por la vista (>0)',
    v_b::int > 0 and v_c::int > 0, 'base=' || v_b || ' vista=' || v_c);
  perform t225.afirma('Z existen usuarios activos de los 9 roles de la prueba',
    (select count(*) from public.usuarios where id in (select t225.u(k) from unnest(array['super','gere','admi','oper','ctrl','vent','agen','free','clie']) k) and activo) = 9, null);
end $$;

-- ── Cierre ───────────────────────────────────────────────────────────────────────────────
do $$
declare v_mal int; v_total int;
begin
  select count(*) filter (where not ok), count(*) into v_mal, v_total from t225.res;
  if v_mal > 0 then
    raise exception 'TEST 225 SQL: % FALLO(S) de %', v_mal, v_total;
  end if;
  raise notice 'TEST 225 SQL: TODO OK (% comprobaciones)', v_total;
end $$;

rollback;
