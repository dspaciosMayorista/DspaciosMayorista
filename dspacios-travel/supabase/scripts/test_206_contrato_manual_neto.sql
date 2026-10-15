-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBAS · #30 contrato manual NETO (migración 206, supabase/migrations/
-- 20260601000206_contrato_manual_neto.sql). SOLO base LOCAL desechable (Docker) con la 205
-- y la 206 aplicadas; nunca en remoto.
--
-- Una sola transacción que termina en ROLLBACK: usuarios, aliados y contratos
-- propios (DTM-93xx / MIN-00-93xx). Suplanta cada rol con request.jwt.claims +
-- `set local role` (el mecanismo de PostgREST). Correr como superusuario:
--   psql -h localhost -U supabase_admin -d <base> -f test_206_contrato_manual_neto.sql
-- Cualquier fila con resultado distinto de 'OK' es un fallo.
-- ─────────────────────────────────────────────────────────────────────────
begin;

create temp table _r (n serial, caso text, resultado text) on commit drop;

-- Ejecuta p_sql como p_uid con el rol de base p_rol (null = superusuario).
create function pg_temp.como_rol(p_uid uuid, p_rol text, p_sql text) returns text language plpgsql as $$
declare v_n bigint; v_res text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', coalesce(p_rol, 'authenticated'))::text end, true);
  if p_rol is not null then execute format('set local role %I', p_rol); end if;
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    v_res := 'filas=' || v_n;
  exception when others then
    v_res := 'error: ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_res;
end $$;
create function pg_temp.como(p_uid uuid, p_sql text) returns text language sql as $$
  select pg_temp.como_rol(p_uid, case when p_uid is null then null else 'authenticated' end, p_sql);
$$;
create function pg_temp.chk(p_caso text, p_obtenido text, p_esperado text) returns void language sql as $$
  insert into _r(caso, resultado)
  values (p_caso, case when p_obtenido ilike p_esperado then 'OK'
                       else 'FALLA: obtuve [' || coalesce(p_obtenido, 'NULL') || '], esperaba [' || p_esperado || ']' end);
$$;
create function pg_temp.neto(p_uid uuid, p_num text, p_aliado bigint, p_com numeric) returns text language sql as $$
  select pg_temp.como(p_uid, format('select public.aplicar_neto_contrato_manual(%L, %s, %s)', p_num, coalesce(p_aliado::text, 'null'), coalesce(p_com::text, 'null')));
$$;
-- Estado de un contrato: precio|modo|comision|estado|filas aliados_b2b.
create function pg_temp.estado(p_num text) returns text language sql as $$
  select v.precio_venta::numeric(15,0) || '|' || coalesce(v.modo_compra, '-') || '|' || coalesce(v.comision_b2b::numeric(15,0)::text, '-')
         || '|' || coalesce(v.comision_estado, '-') || '|' || (select count(*) from public.aliados_b2b b where b.numero_contrato = p_num)
    from public.ventas v where v.numero_contrato = p_num;
$$;

-- ── Usuarios ─────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000030001', 't30-super@x.test'),
  ('00000000-0000-0000-0000-000000030002', 't30-admin-may@x.test'),
  ('00000000-0000-0000-0000-000000030003', 't30-admin-min@x.test'),
  ('00000000-0000-0000-0000-000000030004', 't30-ops-may@x.test'),
  ('00000000-0000-0000-0000-000000030005', 't30-venta-may@x.test'),
  ('00000000-0000-0000-0000-000000030006', 't30-venta-otro@x.test'),
  ('00000000-0000-0000-0000-000000030007', 't30-inactivo@x.test'),
  ('00000000-0000-0000-0000-000000030008', 't30-agencia@x.test'),
  ('00000000-0000-0000-0000-000000030009', 't30-control@x.test'),
  ('00000000-0000-0000-0000-000000030010', 't30-gerencia-min@x.test');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-0000-0000-000000030001', 't30-super@x.test',      'T30 Super',     'superadmin',     true,  'mayorista'),
  ('00000000-0000-0000-0000-000000030002', 't30-admin-may@x.test',  'T30 AdmMay',    'administracion', true,  'mayorista'),
  ('00000000-0000-0000-0000-000000030003', 't30-admin-min@x.test',  'T30 AdmMin',    'administracion', true,  'minorista'),
  ('00000000-0000-0000-0000-000000030004', 't30-ops-may@x.test',    'T30 OpsMay',    'operaciones',    true,  'mayorista'),
  ('00000000-0000-0000-0000-000000030005', 't30-venta-may@x.test',  'T30 VentaMay',  'venta',          true,  'mayorista'),
  ('00000000-0000-0000-0000-000000030006', 't30-venta-otro@x.test', 'T30 VentaOtro', 'venta',          true,  'mayorista'),
  ('00000000-0000-0000-0000-000000030007', 't30-inactivo@x.test',   'T30 Inactivo',  'administracion', false, 'mayorista'),
  ('00000000-0000-0000-0000-000000030008', 't30-agencia@x.test',    'T30 Agencia',   'agencia',        true,  'mayorista'),
  ('00000000-0000-0000-0000-000000030009', 't30-control@x.test',    'T30 Control',   'control_vuelo',  true,  'mayorista'),
  ('00000000-0000-0000-0000-000000030010', 't30-gerencia-min@x.test','T30 GerMin',   'gerencia',       true,  'minorista')
on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;

insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion) values
  (9301, 'T30 Agencia',   '930', 'agencia',   0.10, false, 0),
  (9302, 'T30 Freelance', '931', 'freelance', null, true,  0.11);
update public.usuarios set aliado_id = 9301 where id = '00000000-0000-0000-0000-000000030008';

-- Contrato manual B2B recién creado = como lo deja crearContrato hoy (PVP,
-- comisión "Por definir"): PVP 2.000.000, BNC 400.000, aliado al 10 %
-- → comisión 160.000, NETO 1.840.000.
create function pg_temp.contrato(p_num text, p_extra jsonb default '{}') returns void language plpgsql as $$
declare j jsonb := jsonb_build_object(
  'numero_contrato', p_num, 'cliente', 'C', 'tenant', 'mayorista', 'precio_venta', 2000000, 'impuesto', 400000,
  'tipo_asesor', 'agencia', 'aliado_id', 9301, 'asesor', 'T30 VentaMay', 'estado', 'activo', 'canal', 'B2B') || p_extra;
declare cols text;
begin
  -- Solo las columnas indicadas: el resto toma su default (created_at = now(),
  -- financiero_estado = 'completo', …), igual que el insert de crearContrato.
  select string_agg(quote_ident(k), ', ') into cols from jsonb_object_keys(j) k;
  execute format('insert into public.ventas (%s) select %s from jsonb_populate_record(null::public.ventas, $1)', cols, cols) using j;
end $$;

select pg_temp.contrato('DTM-9301');
select pg_temp.contrato('DTM-9302');
select pg_temp.contrato('DTM-9303', '{"asesor": "T30 VentaOtro"}');
select pg_temp.contrato('DTM-9304', jsonb_build_object('created_at', now() - interval '10 minutes'));
select pg_temp.contrato('DTM-9305', '{"tipo_asesor": "interno", "aliado_id": null, "canal": "B2C"}');
select pg_temp.contrato('DTM-9306');
select pg_temp.contrato('DTM-9307');
select pg_temp.contrato('DTM-9308');
select pg_temp.contrato('DTM-9309', '{"precio_venta": 0, "impuesto": 0}');
select pg_temp.contrato('DTM-9310');
select pg_temp.contrato('DTM-9311');
select pg_temp.contrato('DTM-9312', '{"tipo_asesor": "freelance", "aliado_id": 9302}');
select pg_temp.contrato('MIN-00-9313', '{"tenant": "minorista"}');
select pg_temp.contrato('DTM-9314');
select pg_temp.contrato('DTM-9315');

-- ── 1. Camino feliz ──────────────────────────────────────────────────────
select pg_temp.chk('R1 superadmin aplica NETO', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9301', 9301, 160000), 'filas=1');
select pg_temp.chk('R1 venta: precio NETO, modo neta, comisión descontada, 1 fila', pg_temp.estado('DTM-9301'), '1840000|neta|160000|descontada|1');
select pg_temp.chk('R1 evidencia: fila con PVP bruto, base, %, descontada y pagada',
  (select precio_venta::numeric(15,0) || '|' || base_comision::numeric(15,0) || '|' || pct_comision || '|' || base_explicita || '|' || descontada_en_precio || '|' || estado || '|' || aliado_id || '|' || tipo_aliado
     from public.aliados_b2b where numero_contrato = 'DTM-9301'),
  '2000000|1600000|0.1000|true|true|pagada|9301|agencia');
select pg_temp.chk('R1 la 205 reconoce la fila como descontada (no cobrable)',
  (select public.comision_b2b_descontada(b)::text from public.aliados_b2b b where numero_contrato = 'DTM-9301'), 'true');
select pg_temp.chk('R2 segunda llamada al mismo contrato', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9301', 9301, 160000), 'error: %ya tiene modalidad%');
select pg_temp.chk('R2 sin segunda fila', pg_temp.estado('DTM-9301'), '1840000|neta|160000|descontada|1');
select pg_temp.chk('R3 administración de su agencia', pg_temp.neto('00000000-0000-0000-0000-000000030002', 'DTM-9302', 9301, 160000), 'filas=1');
select pg_temp.chk('R4 venta en SU contrato', pg_temp.neto('00000000-0000-0000-0000-000000030005', 'DTM-9306', 9301, 160000), 'filas=1');
select pg_temp.chk('R5 operaciones', pg_temp.neto('00000000-0000-0000-0000-000000030004', 'DTM-9314', 9301, 160000), 'filas=1');
select pg_temp.chk('R6 freelance sin % propio usa el parámetro de su tipo',
  pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9312', 9302,
    round(1600000 * coalesce((select valor from public.parametros_tributarios where parametro = 'COMISION_FREELANCE'), 0.11))), 'filas=1');
select pg_temp.chk('R7 gerencia (cruza agencias por puede_ver_tenant)', pg_temp.neto('00000000-0000-0000-0000-000000030010', 'DTM-9315', 9301, 160000), 'filas=1');

-- ── 2. Permisos y tenant ─────────────────────────────────────────────────
select pg_temp.chk('P1 venta en contrato de un colega', pg_temp.neto('00000000-0000-0000-0000-000000030005', 'DTM-9303', 9301, 160000), 'error: Solo puedes%');
select pg_temp.chk('P2 administración de OTRA agencia', pg_temp.neto('00000000-0000-0000-0000-000000030003', 'DTM-9307', 9301, 160000), 'error: No autorizado para el contrato%');
select pg_temp.chk('P3 administración mayorista sobre contrato minorista', pg_temp.neto('00000000-0000-0000-0000-000000030002', 'MIN-00-9313', 9301, 160000), 'error: No autorizado para el contrato%');
select pg_temp.chk('P4 usuario inactivo', pg_temp.neto('00000000-0000-0000-0000-000000030007', 'DTM-9307', 9301, 160000), 'error: No autorizado para registrar%');
select pg_temp.chk('P5 aliado (rol agencia)', pg_temp.neto('00000000-0000-0000-0000-000000030008', 'DTM-9307', 9301, 160000), 'error: No autorizado para registrar%');
select pg_temp.chk('P6 control_vuelo', pg_temp.neto('00000000-0000-0000-0000-000000030009', 'DTM-9307', 9301, 160000), 'error: No autorizado para registrar%');
select pg_temp.chk('P7 anon sin permiso de ejecución',
  pg_temp.como_rol('00000000-0000-0000-0000-000000030001', 'anon', $q$select public.aplicar_neto_contrato_manual('DTM-9307', 9301, 160000)$q$), 'error: permission denied%');
select pg_temp.chk('P8 sin sesión (authenticated sin sub)',
  pg_temp.como_rol(null, 'authenticated', $q$select public.aplicar_neto_contrato_manual('DTM-9307', 9301, 160000)$q$), 'error: No autorizado para registrar%');
select pg_temp.chk('P* ningún rechazo cambió DTM-9307', pg_temp.estado('DTM-9307'), '2000000|-|-|-|0');

-- ── 3. Precondiciones ────────────────────────────────────────────────────
select pg_temp.chk('C1 contrato con más de 5 minutos (histórico)', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9304', 9301, 160000), 'error: %solo se registra al crear%');
select pg_temp.chk('C2 venta interna (B2C)', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9305', null, 160000), 'error: %no es una venta B2B%');
select pg_temp.chk('C3 aliado distinto del de la venta', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9307', 9302, 160000), 'error: El aliado no coincide%');
select pg_temp.chk('C4 comisión distinta a la que vio el asesor', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9307', 9301, 150000), 'error: %no coincide con la calculada (160000)%');
select pg_temp.chk('C4 redondeo de ±1 se acepta', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9311', 9301, 160001), 'filas=1');
insert into public.aliados_b2b (numero_contrato, tenant, aliado, tipo_aliado, aliado_id, precio_venta, base_comision, base_explicita, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado)
values ('DTM-9308', 'mayorista', 'T30 Agencia', 'agencia', 9301, 2000000, 1600000, true, 0.10, 0, 0, false, 0, 'pendiente');
select pg_temp.chk('C5 ya tiene comisión registrada ("Por definir" cargada)', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9308', 9301, 160000), 'error: %ya tiene comisión B2B%');
insert into public.abonos (numero_contrato, tenant, valor_abono, fecha_abono) values ('DTM-9310', 'mayorista', 100000, current_date);
select pg_temp.chk('C6 ya tiene abonos', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9310', 9301, 160000), 'error: %ya tiene abonos%');
select pg_temp.chk('C7 sin precio de venta', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9309', 9301, 0), 'error: %no tiene precio de venta%');
select pg_temp.chk('C8 contrato inexistente', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9399', 9301, 160000), 'error: El contrato DTM-9399 no existe%');
update public.aliados set tipo = 'freelance' where id = 9301;
select pg_temp.chk('C9 aliado de otro tipo que la venta', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9307', 9301, 160000), 'error: El aliado es de tipo freelance%');
update public.aliados set tipo = 'agencia' where id = 9301;

-- ── 4. Atomicidad: si la fila de comisión falla, el precio NO baja ───────
create function pg_temp.falla_insert() returns trigger language plpgsql as $$
begin raise exception 'fallo simulado al insertar la comisión'; end $$;
create trigger t30_falla before insert on public.aliados_b2b for each row execute function pg_temp.falla_insert();
select pg_temp.chk('A1 la inserción de la comisión falla', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9307', 9301, 160000), 'error: fallo simulado%');
select pg_temp.chk('A1 el contrato sigue en PVP "Por definir" (nunca NETO sin comisión)', pg_temp.estado('DTM-9307'), '2000000|-|-|-|0');
drop trigger t30_falla on public.aliados_b2b;
select pg_temp.chk('A2 reintento tras el fallo', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9307', 9301, 160000), 'filas=1');
select pg_temp.chk('A2 queda NETO con su comisión', pg_temp.estado('DTM-9307'), '1840000|neta|160000|descontada|1');

-- ── 5. La modalidad y los importes de un NETO no cambian por UPDATE ──────
select pg_temp.contrato('DTM-9317');
select pg_temp.chk('G1 administración no marca NETO a mano un contrato PVP',
  pg_temp.como('00000000-0000-0000-0000-000000030002', $q$update public.ventas set comision_estado = 'descontada', modo_compra = 'neta', comision_b2b = 160000, precio_venta = 1840000 where numero_contrato = 'DTM-9317'$q$), 'error: %modalidad de compra B2B%');
select pg_temp.chk('G1 el PVP quedó intacto', pg_temp.estado('DTM-9317'), '2000000|-|-|-|0');
select pg_temp.chk('G2 administración no quita la marca NETO',
  pg_temp.como('00000000-0000-0000-0000-000000030002', $q$update public.ventas set comision_estado = null, modo_compra = null where numero_contrato = 'DTM-9302'$q$), 'error: %modalidad de compra B2B%');
select pg_temp.chk('G3 administración no sube el precio de un NETO',
  pg_temp.como('00000000-0000-0000-0000-000000030002', $q$update public.ventas set precio_venta = 2000000 where numero_contrato = 'DTM-9302'$q$), 'error: %vendido en NETO%');
select pg_temp.chk('G4 ni cambia su tipo de venta',
  pg_temp.como('00000000-0000-0000-0000-000000030002', $q$update public.ventas set tipo_asesor = 'interno' where numero_contrato = 'DTM-9302'$q$), 'error: %vendido en NETO%');
select pg_temp.chk('G5 ni su impuesto (base de la comisión)',
  pg_temp.como('00000000-0000-0000-0000-000000030002', $q$update public.ventas set impuesto = 0 where numero_contrato = 'DTM-9302'$q$), 'error: %vendido en NETO%');
select pg_temp.chk('G6 service_role tampoco cambia el precio de un NETO',
  pg_temp.como_rol(null, 'service_role', $q$update public.ventas set precio_venta = 2000000 where numero_contrato = 'DTM-9302'$q$), 'error: %vendido en NETO%');
select pg_temp.chk('G* el NETO quedó intacto', pg_temp.estado('DTM-9302'), '1840000|neta|160000|descontada|1');
select pg_temp.chk('G7 en un NETO sí se editan los demás datos (cliente, estado)',
  pg_temp.como('00000000-0000-0000-0000-000000030002', $q$update public.ventas set cliente = 'Cliente Corregido', estado = 'confirmado' where numero_contrato = 'DTM-9302'$q$), 'filas=1');
select pg_temp.contrato('DTM-9316');
select pg_temp.chk('G8b PVP "Por definir": precio editable como antes',
  pg_temp.como('00000000-0000-0000-0000-000000030002', $q$update public.ventas set precio_venta = 2100000 where numero_contrato = 'DTM-9316'$q$), 'filas=1');
select pg_temp.chk('G9 el dueño de la base sí corrige a mano (editor SQL)',
  pg_temp.como(null, $q$update public.ventas set precio_venta = 1840000 where numero_contrato = 'DTM-9302'$q$), 'filas=1');
select pg_temp.chk('G10 la 205 sigue rechazando una segunda comisión en NETO',
  pg_temp.como('00000000-0000-0000-0000-000000030002',
    $q$select public.registrar_comision_b2b_manual('DTM-9302', 'T30 Agencia', '930', 'agencia', 9301, 0.05, 0, 0, false, 0)$q$), 'error: %modo neta%');

-- ── 5b. Reversión de un contrato ya en NETO (fallo posterior en la app) ──
-- La app revierte con service-role (revertir_contrato_incompleto, 171/172):
-- el contrato y su fila descontada se van JUNTOS (la 205 solo impide borrar
-- la fila NETO suelta), sin dejar ni contrato NETO sin comisión ni comisión
-- sin contrato.
select pg_temp.chk('V1 revertir un NETO recién aplicado (service_role)',
  pg_temp.como_rol(null, 'service_role', $q$select public.revertir_contrato_incompleto('DTM-9311', 'mayorista')$q$), 'filas=1');
select pg_temp.chk('V1 no queda el contrato', (select count(*)::text from public.ventas where numero_contrato = 'DTM-9311'), '0');
select pg_temp.chk('V1 ni su comisión descontada', (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9311'), '0');
select pg_temp.chk('V2 la fila NETO suelta sigue sin poder borrarse (205)',
  pg_temp.como('00000000-0000-0000-0000-000000030002', $q$delete from public.aliados_b2b where numero_contrato = 'DTM-9314'$q$), 'error: %');

-- ── 6. Regresión #38: la reserva NETO (insert + RPC de la 205) no cambia ─
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, financiero_estado, asesor)
values ('DTM-9320', 'C', 'mayorista', 1840000, 400000, 'agencia', 9301, 'neta', 160000, 'descontada', 'pendiente', 'T30 VentaMay');
select pg_temp.chk('X1 reserva NETO: registrar_comision_b2b_reserva sigue funcionando',
  pg_temp.como('00000000-0000-0000-0000-000000030005', $q$select public.registrar_comision_b2b_reserva('DTM-9320', 9301)$q$), 'filas=1');
select pg_temp.chk('X1 reserva NETO intacta', pg_temp.estado('DTM-9320'), '1840000|neta|160000|descontada|1');
select pg_temp.chk('X2 el RPC manual no se aplica sobre una reserva', pg_temp.neto('00000000-0000-0000-0000-000000030001', 'DTM-9320', 9301, 160000), 'error: %ya tiene modalidad%');

select caso, resultado from _r where resultado <> 'OK' order by n;
select case when count(*) filter (where resultado <> 'OK') = 0
            then 'TODO OK (' || count(*) || ' casos)'
            else 'FALLAS: ' || count(*) filter (where resultado <> 'OK') || ' de ' || count(*) end as resumen
  from _r;

rollback;
