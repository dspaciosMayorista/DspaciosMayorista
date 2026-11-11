-- ───────────────────────────────────────────────────────────────
-- PRUEBAS #97 · invariante del ciclo: un contrato PENDIENTE solo tiene PLAN (nunca comisión exigible) con el interruptor en CUALQUIER posición.
-- SOLO base LOCAL desechable con 001–285 + 287 + 288 (#75) + 286 (#97). Una transacción que termina en ROLLBACK.
--   psql -h localhost -U supabase_admin -d <base> -v ciclo=false -f test_97_ciclo_apagado.sql     (interruptor APAGADO)
--   psql -h localhost -U supabase_admin -d <base> -v ciclo=true  -f test_97_ciclo_apagado.sql     (interruptor ENCENDIDO)
-- Los dos juegos deben dar lo mismo en pendiente / NETO, y distinto solo en lo histórico (confirmado/activo al nacer). Cualquier fila distinta de 'OK' es un fallo.
-- ───────────────────────────────────────────────────────────────
begin;
create temp table _r (n serial, caso text, resultado text) on commit drop;
create function pg_temp.como(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v_n bigint; v_res text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  if p_uid is not null then execute 'set local role authenticated'; end if;
  begin execute p_sql; get diagnostics v_n = row_count; v_res := 'filas=' || v_n;
  exception when others then v_res := 'error: ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_res;
end $$;
create function pg_temp.chk(p_caso text, p_obtenido text, p_esperado text) returns void language sql as $$
  insert into _r(caso, resultado) values (p_caso, case when p_obtenido ilike p_esperado then 'OK' else 'FALLA: obtuve [' || coalesce(p_obtenido, 'NULL') || '], esperaba [' || p_esperado || ']' end);
$$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000097001', 't97c-venta@x.test'), ('00000000-0000-0000-0000-000000097002', 't97c-admin@x.test');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-0000-0000-000000097001', 't97c-venta@x.test', 'T97C Asesor', 'venta', true, 'mayorista'),
  ('00000000-0000-0000-0000-000000097002', 't97c-admin@x.test', 'T97C Admin', 'administracion', true, 'mayorista')
on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
insert into public.aliados (id, nombre, tipo, pct_comision, nit) values (970001, 'T97C Agencia', 'agencia', 0.10, '900970001');

-- Interruptor bajo prueba (dentro de la transacción: se deshace).
update p97_priv.ciclo set activo = :ciclo;
select pg_temp.chk('0 posición del interruptor', p97_priv.ciclo_activo()::text, :'ciclo');

insert into public.ventas (numero_contrato, cliente, tenant, asesor, precio_venta, impuesto, estado, financiero_estado, tipo_asesor, aliado_id, canal, modo_compra, comision_b2b, comision_estado) values
  ('DTM-9801', 'C', 'mayorista', 'T97C Asesor', 1000000, 200000, 'pendiente', 'pendiente', 'agencia', 970001, 'B2B', 'comisionable', 80000, 'pendiente'),   -- pendiente PVP
  ('DTM-9802', 'C', 'mayorista', 'T97C Asesor', 1000000, 200000, 'confirmado', 'pendiente', 'agencia', 970001, 'B2B', 'comisionable', 80000, 'pendiente'),  -- nace confirmado
  ('DTM-9803', 'C', 'mayorista', 'T97C Asesor', 1100000, 200000, 'pendiente', 'pendiente', 'agencia', 970001, 'B2B', 'neta',         100000, 'pendiente'),  -- pendiente NETO
  ('DTM-9804', 'C', 'mayorista', 'T97C Asesor', 1000000, 200000, 'activo',     'pendiente', 'agencia', 970001, 'B2B', 'comisionable', 80000, 'pendiente'),  -- nace activo (histórico)
  ('DTM-9805', 'C', 'mayorista', 'T97C Asesor', 1000000, 200000, 'pendiente', 'pendiente', 'agencia', 970001, 'B2B', 'comisionable', 80000, 'pendiente');   -- para alternar el interruptor

create function pg_temp.reg(p_n text) returns text language sql as $$ select pg_temp.como('00000000-0000-0000-0000-000000097001', format('select public.registrar_comision_b2b_reserva(%L, 970001)', p_n)) $$;
create function pg_temp.exigibles(p_n text) returns text language sql as $$
  select count(*) filter (where not descontada_en_precio)::text || '/' || count(*) filter (where descontada_en_precio)::text from public.aliados_b2b where numero_contrato = p_n $$;
create function pg_temp.planes(p_n text) returns text language sql as $$
  select count(*)::text from public.comision_plan c join public.ventas v on v.contrato_uid = c.contrato_uid where v.numero_contrato = p_n $$;
create function pg_temp.confirmar(p_n text) returns text language sql as $$
  select pg_temp.como('00000000-0000-0000-0000-000000097002', format($q$update public.ventas set financiero_estado = 'completo' where numero_contrato = %L$q$, p_n))
      || '|' || pg_temp.como('00000000-0000-0000-0000-000000097002', format('select public.confirmar_venta(%L)', p_n)) $$;

-- A) PENDIENTE PVP: con el interruptor que sea, solo PLAN; ninguna fila exigible hasta confirmar.
select pg_temp.chk('A1 pendiente registra', pg_temp.reg('DTM-9801'), 'filas=1');
select pg_temp.chk('A2 pendiente: 1 plan', pg_temp.planes('DTM-9801'), '1');
select pg_temp.chk('A3 pendiente: 0 filas exigibles y 0 descontadas', pg_temp.exigibles('DTM-9801'), '0/0');
select pg_temp.chk('A4 materializar directo sobre pendiente no hace nada (no hay ruta forzada)', coalesce((select p97_priv.materializar('DTM-9801', false)::text), 'null'), 'null');
select pg_temp.chk('A5 el gancho público tampoco materializa un pendiente', coalesce((select public.materializar_comision_b2b('DTM-9801')::text), 'null'), 'null');
select pg_temp.chk('A6 sigue sin fila exigible', pg_temp.exigibles('DTM-9801'), '0/0');
select pg_temp.chk('A7 no existe la firma antigua con p_forzar', (select count(*)::text from pg_proc where proname = 'materializar' and pronamespace = 'p97_priv'::regnamespace and pronargs = 3), '0');
select pg_temp.confirmar('DTM-9801');
select pg_temp.chk('A8 confirmado por el gancho único de #75: UNA fila exigible con plan_id', (select count(*)::text || '/' || count(plan_id)::text from public.aliados_b2b where numero_contrato = 'DTM-9801'), '1/1');
select pg_temp.chk('A9 reintento de materializar: idempotente (sigue 1 fila)', (select public.materializar_comision_b2b('DTM-9801') is not null)::text || '|' || (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9801'), 'true|1');

-- B) Nace CONFIRMADO / activo (tratamiento histórico): confirmado → plan + fila en el acto; activo igual con ciclo ON; con ciclo OFF, la fila directa de siempre.
select pg_temp.chk('B1 confirmado al nacer registra', pg_temp.reg('DTM-9802'), 'filas=1');
select pg_temp.chk('B2 confirmado al nacer: fila exigible creada', (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9802' and not descontada_en_precio), '1');
select pg_temp.chk('B3 estado activo al nacer registra', pg_temp.reg('DTM-9804'), 'filas=1');
select pg_temp.chk('B4 estado activo al nacer: fila exigible creada', (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9804' and not descontada_en_precio), '1');
select pg_temp.chk('B5 estado activo histórico: plan solo con ciclo encendido', pg_temp.planes('DTM-9804'), case when :ciclo then '1' else '0' end);

-- C) NETO pendiente: queda REGISTRADO el descuento (fila descontada, pagada) sin plan ni comisión por pagar, con el interruptor que sea.
select pg_temp.chk('C1 NETO registra', pg_temp.reg('DTM-9803'), 'filas=1');
select pg_temp.chk('C2 NETO: 0 exigibles / 1 descontada', pg_temp.exigibles('DTM-9803'), '0/1');
select pg_temp.chk('C3 NETO: estado pagada y sin plan', (select estado from public.aliados_b2b where numero_contrato = 'DTM-9803') || '|' || pg_temp.planes('DTM-9803'), 'pagada|0');
select pg_temp.chk('C4 NETO: ningún pago adicional (cero abonos de comisión)', (select count(*)::text from public.comision_b2b_pagos g join public.aliados_b2b b on b.id = g.aliado_b2b_id where b.numero_contrato = 'DTM-9803'), '0');
select pg_temp.confirmar('DTM-9803');
select pg_temp.chk('C5 NETO al confirmar: sigue 1 fila descontada, sin fila nueva ni plan', pg_temp.exigibles('DTM-9803') || '|' || pg_temp.planes('DTM-9803'), '0/1|0');

-- D) Alternar el interruptor NO materializa ni cambia estados: el pendiente conserva su plan; solo la confirmación crea la fila.
update p97_priv.ciclo set activo = true;
select pg_temp.chk('D1 pendiente se registra con el ciclo ENCENDIDO', pg_temp.reg('DTM-9805'), 'filas=1');
update p97_priv.ciclo set activo = false;
select pg_temp.chk('D2 apagar no materializa: 1 plan, 0 filas', pg_temp.planes('DTM-9805') || '|' || pg_temp.exigibles('DTM-9805'), '1|0/0');
select pg_temp.chk('D3 apagar no cambia el estado comercial', (select estado from public.ventas where numero_contrato = 'DTM-9805'), 'pendiente');
select pg_temp.confirmar('DTM-9805');
select pg_temp.chk('D4 confirmar con el ciclo APAGADO materializa UNA vez', (select count(*)::text || '/' || count(plan_id)::text from public.aliados_b2b where numero_contrato = 'DTM-9805'), '1/1');
update p97_priv.ciclo set activo = true;
select pg_temp.chk('D5 encender de nuevo no duplica', (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9805'), '1');

select n, caso, resultado from _r order by n;
select 'FALLAS: ' || count(*) filter (where resultado <> 'OK') || ' de ' || count(*) from _r;
rollback;
