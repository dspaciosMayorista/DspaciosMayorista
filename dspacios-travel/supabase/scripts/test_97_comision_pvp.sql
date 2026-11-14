-- ───────────────────────────────────────────────────────────────
-- PRUEBAS #97 · comisión B2B de un contrato manual PVP (RPC 205 `registrar_comision_b2b_reserva`).
-- SOLO base LOCAL desechable con 001–283. Una transacción que termina en ROLLBACK.
--   psql -h localhost -U supabase_admin -d <base> -f test_97_comision_pvp.sql
-- Cualquier fila con resultado distinto de 'OK' es un fallo.
-- ───────────────────────────────────────────────────────────────
begin;
create temp table _r (n serial, caso text, resultado text) on commit drop;

create function pg_temp.como(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v_n bigint; v_res text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  if p_uid is not null then execute 'set local role authenticated'; end if;
  begin
    execute p_sql; get diagnostics v_n = row_count; v_res := 'filas=' || v_n;
  exception when others then v_res := 'error: ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_res;
end $$;
create function pg_temp.chk(p_caso text, p_obtenido text, p_esperado text) returns void language sql as $$
  insert into _r(caso, resultado) values (p_caso, case when p_obtenido ilike p_esperado then 'OK'
    else 'FALLA: obtuve [' || coalesce(p_obtenido, 'NULL') || '], esperaba [' || p_esperado || ']' end);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000097001', 't97-venta-may@x.test'),
  ('00000000-0000-0000-0000-000000097002', 't97-admin-may@x.test'),
  ('00000000-0000-0000-0000-000000097003', 't97-venta-min@x.test'),
  ('00000000-0000-0000-0000-000000097004', 't97-agencia-otra@x.test');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-0000-0000-000000097001', 't97-venta-may@x.test', 'T97 Asesor',   'venta',          true, 'mayorista'),
  ('00000000-0000-0000-0000-000000097002', 't97-admin-may@x.test', 'T97 Admin',    'administracion', true, 'mayorista'),
  ('00000000-0000-0000-0000-000000097003', 't97-venta-min@x.test', 'T97 VentaMin', 'venta',          true, 'minorista'),
  ('00000000-0000-0000-0000-000000097004', 't97-agencia-otra@x.test', 'T97 Agencia otra', 'agencia',  true, 'mayorista')
on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;

-- Aliados: agencia con % propio, freelance sin % (cae al parámetro o al 11 %), y una agencia distinta.
insert into public.aliados (id, nombre, tipo, pct_comision, nit) values
  (970001, 'T97 Agencia Uno',  'agencia',   0.10, '900970001'),
  (970002, 'T97 Freelance Dos', 'freelance', null, '900970002'),
  (970003, 'T97 Agencia Tres', 'agencia',   0.08, '900970003');

-- Contratos recién creados (financiero_estado = pendiente, como los deja crearContrato en manual PVP).
insert into public.ventas (numero_contrato, cliente, tenant, asesor, precio_venta, impuesto, estado, financiero_estado,
                           tipo_asesor, aliado_id, canal, modo_compra, comision_b2b, comision_estado) values
  ('DTM-9701', 'C', 'mayorista', 'T97 Asesor', 1000000, 200000, 'activo', 'pendiente', 'agencia',   970001, 'B2B', 'comisionable', 80000, 'pendiente'),
  ('DTM-9702', 'C', 'mayorista', 'T97 Asesor', 1000000, 200000, 'activo', 'pendiente', 'agencia',   970001, 'B2B', 'comisionable', 80000, 'pendiente'),
  ('DTM-9703', 'C', 'mayorista', 'T97 Asesor', 1000000, 0,      'activo', 'pendiente', 'freelance', 970002, 'B2B', 'comisionable', 110000, 'pendiente'),
  ('DTM-9704', 'C', 'mayorista', 'T97 Asesor', 1000000, 1000000,'activo', 'pendiente', 'agencia',   970001, 'B2B', 'comisionable', 0, 'pendiente'),
  ('DTM-9705', 'C', 'mayorista', 'T97 Asesor', 1000000, 200000, 'activo', 'completo',  'agencia',   970001, 'B2B', 'comisionable', 80000, 'pendiente'),
  ('DTM-9706', 'C', 'mayorista', 'T97 Asesor', 1000000, 200000, 'activo', 'pendiente', 'agencia',   970001, 'B2B', 'comisionable', 80000, 'pendiente'),
  ('DTM-9707', 'C', 'mayorista', 'T97 Asesor', 1000000, 200000, 'activo', 'pendiente', 'agencia',   970001, 'B2B', 'comisionable', 80000, 'pendiente'),
  ('DTM-9708', 'C', 'mayorista', 'T97 Asesor', 1000000, 200000, 'activo', 'pendiente', 'agencia',   970001, 'B2B', 'comisionable', 80000, 'pendiente'),
  ('DTM-9710', 'C', 'mayorista', 'T97 Asesor', 1000000, 200000, 'activo', 'pendiente', 'agencia',   970001, 'B2B', 'comisionable', 1, 'pendiente'),
  ('DTM-9709', 'C', 'mayorista', 'T97 Asesor', 1000000, 200000, 'activo', 'pendiente', 'freelance', 970001, 'B2B', 'comisionable', 80000, 'pendiente');
-- Contrato "viejo": quedó pendiente hace 10 minutos (la ventana de creación ya cerró).
update public.ventas set financiero_actualizado_en = now() - interval '10 minutes' where numero_contrato = 'DTM-9706';

-- 1) Comisión correcta: base = PVP − BNC, % del aliado, pendiente, beneficiario = ALIADO (no el asesor).
select pg_temp.chk('1 asesor registra: devuelve id',
  pg_temp.como('00000000-0000-0000-0000-000000097001', $$select public.registrar_comision_b2b_reserva('DTM-9701', 970001)$$), 'filas=1');
select pg_temp.chk('1a base 800000 = PVP − BNC, pct 0.10, comisión 80000',
  (select base_comision || '/' || pct_comision || '/' || round(base_comision * pct_comision) from public.aliados_b2b where numero_contrato = 'DTM-9701'), '800000.00/0.1000/80000');
select pg_temp.chk('1b beneficiario = aliado del catálogo, no el asesor',
  (select aliado || '|' || aliado_id || '|' || tipo_aliado from public.aliados_b2b where numero_contrato = 'DTM-9701'), 'T97 Agencia Uno|970001|agencia');
select pg_temp.chk('1c estado pendiente, no descontada, base explícita, sin recobro',
  (select estado || '|' || descontada_en_precio || '|' || base_explicita || '|' || recobro_total from public.aliados_b2b where numero_contrato = 'DTM-9701'), 'pendiente|false|true|0.00');
select pg_temp.chk('1d la venta sigue cobrando el PVP completo (modo comisionable, precio intacto)',
  (select coalesce(modo_compra, 'null') || '|' || precio_venta from public.ventas where numero_contrato = 'DTM-9701'), 'comisionable|1000000.00');

-- 2) Segundo intento sobre el MISMO contrato (garantía por contrato, no por reintento de creación).
select pg_temp.chk('2 segundo registro del mismo contrato se rechaza (23505)',
  pg_temp.como('00000000-0000-0000-0000-000000097001', $$select public.registrar_comision_b2b_reserva('DTM-9701', 970001)$$), 'error: El contrato DTM-9701 ya tiene comisión B2B%');
select pg_temp.chk('2a sigue UNA sola fila', (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9701'), '1');

-- 3) Freelance sin % propio: parámetro general o 11 %; nunca cero.
select pg_temp.chk('3 freelance sin %: registra',
  pg_temp.como('00000000-0000-0000-0000-000000097001', $$select public.registrar_comision_b2b_reserva('DTM-9703', 970002)$$), 'filas=1');
select pg_temp.chk('3a origen del %: ' || coalesce((select valor::text from public.parametros_tributarios where parametro = 'COMISION_FREELANCE'), 'sin parámetro → 0.11'),
  (select pct_comision::text from public.aliados_b2b where numero_contrato = 'DTM-9703'),
  coalesce((select to_char(valor::numeric, 'FM0.0000') from public.parametros_tributarios where parametro = 'COMISION_FREELANCE'), '0.1100'));

-- 4) BNC = PVP → base 0 → comisión 0 (explícita, no se asume otro valor).
select pg_temp.chk('4 BNC = PVP: registra con base 0',
  pg_temp.como('00000000-0000-0000-0000-000000097001', $$select public.registrar_comision_b2b_reserva('DTM-9704', 970001)$$), 'filas=1');
select pg_temp.chk('4a base 0',
  (select base_comision::text from public.aliados_b2b where numero_contrato = 'DTM-9704'), '0.00');

-- 5) Protección financiero_estado intacta: contrato completo o fuera de ventana se rechaza.
select pg_temp.chk('5 contrato ya completo: se rechaza',
  pg_temp.como('00000000-0000-0000-0000-000000097001', $$select public.registrar_comision_b2b_reserva('DTM-9705', 970001)$$), 'error: La comisión de reserva solo se registra mientras se crea%');
select pg_temp.chk('5a contrato pendiente de hace 10 min: se rechaza',
  pg_temp.como('00000000-0000-0000-0000-000000097001', $$select public.registrar_comision_b2b_reserva('DTM-9706', 970001)$$), 'error: La comisión de reserva solo se registra mientras se crea%');

-- 6) Aliado distinto al de la venta, tipo que no coincide, tenant ajeno, aliado externo ajeno.
select pg_temp.chk('6 aliado distinto al de la venta',
  pg_temp.como('00000000-0000-0000-0000-000000097002', $$select public.registrar_comision_b2b_reserva('DTM-9707', 970003)$$), 'error: El aliado no coincide%');
select pg_temp.chk('6a tipo de aliado ≠ tipo de venta',
  pg_temp.como('00000000-0000-0000-0000-000000097002', $$select public.registrar_comision_b2b_reserva('DTM-9709', 970001)$$), 'error: El aliado es de tipo%');
select pg_temp.chk('6b asesor de OTRA agencia no registra en contrato ajeno',
  pg_temp.como('00000000-0000-0000-0000-000000097003', $$select public.registrar_comision_b2b_reserva('DTM-9707', 970001)$$), 'error: No autorizado%');
select pg_temp.chk('6c aliado externo solo registra la comisión de SU ficha',
  pg_temp.como('00000000-0000-0000-0000-000000097004', $$select public.registrar_comision_b2b_reserva('DTM-9707', 970001)$$), 'error: Un aliado solo registra%');
select pg_temp.chk('6d sin sesión no registra',
  pg_temp.como(null, $$select public.registrar_comision_b2b_reserva('DTM-9707', 970001)$$), 'error: No autorizado%');

-- 7) Reversión: si el flujo falla después, revertir_contrato_incompleto borra la comisión y el contrato.
select pg_temp.chk('7 registra y luego revierte (service_role)',
  pg_temp.como('00000000-0000-0000-0000-000000097001', $$select public.registrar_comision_b2b_reserva('DTM-9708', 970001)$$), 'filas=1');
select pg_temp.chk('7a revertir deja 0 comisiones y 0 contrato',
  (select (public.revertir_contrato_incompleto('DTM-9708', 'mayorista')::text)), '%');
select pg_temp.chk('7b sin huérfanos',
  (select (select count(*) from public.aliados_b2b where numero_contrato = 'DTM-9708')::text || '/' ||
          (select count(*) from public.ventas where numero_contrato = 'DTM-9708')::text), '0/0');

-- 8) La venta declara una comisión distinta a la calculada: la base la rechaza (no confía en el valor guardado).
select pg_temp.chk('8 comisión de la venta ≠ calculada: se rechaza',
  pg_temp.como('00000000-0000-0000-0000-000000097001', $$select public.registrar_comision_b2b_reserva('DTM-9710', 970001)$$), 'error: La comisión de la venta%no coincide%');

select n, caso, resultado from _r order by n;
select 'VEREDICTO', case when exists (select 1 from _r where resultado <> 'OK') then 'HAY FALLAS' else 'TODO OK (' || (select count(*) from _r) || ')' end;
rollback;
