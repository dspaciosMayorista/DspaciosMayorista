-- ───────────────────────────────────────────────────────────────
-- #97 · EVALUACIÓN de la opción A para el paquete negociado (NO implementada en la app):
-- el contrato nace financiero_estado='pendiente', se registra la comisión con la RPC 205 y el cierre
-- (registrar_financiero_contrato) ocurre DESPUÉS de copiar los costos negociados. SOLO base local con 001–280.
--   psql -h localhost -U supabase_admin -d <base> -f test_97_negociado_A.sql     (una transacción, termina en ROLLBACK)
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
  execute 'reset role'; perform set_config('request.jwt.claims', '', true); return v_res;
end $$;
create function pg_temp.chk(p_caso text, p_obtenido text, p_esperado text) returns void language sql as $$
  insert into _r(caso, resultado) values (p_caso, case when p_obtenido ilike p_esperado then 'OK'
    else 'FALLA: obtuve [' || coalesce(p_obtenido, 'NULL') || '], esperaba [' || p_esperado || ']' end);
$$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000097201', 't97n@x.test');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000097201', 't97n@x.test', 'T97N', 'venta', true, 'mayorista')
  on conflict (id) do update set rol='venta', activo=true, tenant='mayorista';
insert into public.aliados (id, nombre, tipo, pct_comision, nit) values (970201, 'T97N Agencia', 'agencia', 0.10, '900970201');

-- Tres contratos negociados B2B PVP "pendiente" (como los dejaría la opción A al insertar la venta).
insert into public.ventas (numero_contrato, cliente, tenant, asesor, tipo_paquete, precio_venta, impuesto, estado, financiero_estado, tipo_asesor, aliado_id, canal,
                           modo_compra, comision_b2b, comision_estado, costo_hotel, costo_aereo) values
  ('DTM-9751','C','mayorista','T97N','bloqueo',1000000,200000,'activo','pendiente','agencia',970201,'B2B','comisionable',80000,'pendiente',0,0),
  ('DTM-9752','C','mayorista','T97N','bloqueo',1000000,200000,'activo','pendiente','agencia',970201,'B2B','comisionable',80000,'pendiente',0,0),
  ('DTM-9753','C','mayorista','T97N','bloqueo',1000000,200000,'activo','pendiente','agencia',970201,'B2B','comisionable',80000,'pendiente',0,0);

-- N1 camino feliz: comisión → copia de costos → cierre con {} (los costos ya copiados se CONSERVAN) → completo.
select pg_temp.chk('N1 comisión sobre contrato negociado pendiente',
  pg_temp.como('00000000-0000-0000-0000-000000097201', $$select public.registrar_comision_b2b_reserva('DTM-9751', 970201)$$), 'filas=1');
update public.ventas set costo_hotel = 400000, costo_aereo = 300000 where numero_contrato = 'DTM-9751';
select pg_temp.chk('N1a cierre con costos vacíos DESPUÉS de copiar: la RPC escribe (no era ya_completo)',
  coalesce(public.registrar_financiero_contrato('DTM-9751','mayorista','{}'::jsonb,'[]'::jsonb) ->> 'ya_completo', 'null'), 'null');
select pg_temp.chk('N1b estado final y costos',
  (select financiero_estado || '|' || costo_hotel::numeric(15,0) || '|' || costo_aereo::numeric(15,0) from public.ventas where numero_contrato='DTM-9751'), 'completo|400000|300000');
select pg_temp.chk('N1c segundo cierre es no-op (ya_completo)',
  (public.registrar_financiero_contrato('DTM-9751','mayorista','{}'::jsonb,'[]'::jsonb) ->> 'ya_completo'), 'true');

-- N2 el riesgo que señalas: cerrar con {} ANTES de copiar los costos deja el contrato 'completo' con costos en 0.
select pg_temp.chk('N2 cierre anticipado',
  (select (public.registrar_financiero_contrato('DTM-9752','mayorista','{}'::jsonb,'[]'::jsonb))::text is not null)::text, 'true');
select pg_temp.chk('N2a ⚠ queda COMPLETO con costos en 0 (por eso el cierre solo va tras copiar los costos)',
  (select financiero_estado || '|' || costo_hotel::numeric(15,0) from public.ventas where numero_contrato='DTM-9752'), 'completo|0');

-- N3 caída entre la comisión y el cierre: sigue PENDIENTE (detectable) y no admite abonos.
select pg_temp.chk('N3 contrato pendiente no admite abonos',
  pg_temp.como(null, $$insert into public.abonos (numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, tenant) values ('DTM-9753','C',current_date,1000,'efectivo','mayorista')$$), 'error:%');
-- N4 sin payload persistido, la reconciliación REVIERTE: contrato y comisión desaparecen.
select pg_temp.chk('N4 sin intención durable (no hay payload)',
  (select count(*)::text from public.contrato_financiero_pendiente where numero_contrato='DTM-9753'), '0');
select pg_temp.chk('N4a comisión antes de revertir',
  pg_temp.como('00000000-0000-0000-0000-000000097201', $$select public.registrar_comision_b2b_reserva('DTM-9753', 970201)$$), 'filas=1');
select pg_temp.chk('N4b revertir_contrato_incompleto responde', (select (public.revertir_contrato_incompleto('DTM-9753','mayorista'))::text is not null)::text, 'true');
select pg_temp.chk('N4c queda 0 contrato / 0 comisión',
  (select (select count(*) from public.ventas where numero_contrato='DTM-9753')::text || '/' || (select count(*) from public.aliados_b2b where numero_contrato='DTM-9753')::text), '0/0');
-- N4d la reversión LIBERA las sillas del bloqueo del contrato revertido.
insert into public.bloqueos_vuelo (record) values ('T97REC');
insert into public.ventas (numero_contrato, cliente, tenant, asesor, tipo_paquete, precio_venta, estado, financiero_estado, canal) values ('DTM-9754','C','mayorista','T97N','bloqueo',1000000,'activo','pendiente','B2C');
insert into public.sillas (bloqueo_id, numero_silla, estado, numero_contrato)
  select id, 1, 'en_plazo', 'DTM-9754' from public.bloqueos_vuelo where record = 'T97REC';
select public.revertir_contrato_incompleto('DTM-9754','mayorista') as _x;
select pg_temp.chk('N4d revertir un negociado pendiente libera su silla',
  (select estado || '/' || coalesce(numero_contrato,'null') from public.sillas where bloqueo_id = (select id from public.bloqueos_vuelo where record='T97REC') and numero_silla = 1), 'disponible/null');
-- N5 un contrato ya cerrado (completo) no se revierte: la reversión respeta la garantía K15.
select pg_temp.chk('N5 revertir un contrato ya completo no lo borra',
  (select (public.revertir_contrato_incompleto('DTM-9751','mayorista'))::text || '|' || (select count(*) from public.ventas where numero_contrato='DTM-9751')::text), '%|1');

select n, caso, resultado from _r order by n;
select 'VEREDICTO', case when exists (select 1 from _r where resultado <> 'OK') then 'HAY FALLAS' else 'TODO OK (' || (select count(*) from _r) || ')' end;
rollback;
