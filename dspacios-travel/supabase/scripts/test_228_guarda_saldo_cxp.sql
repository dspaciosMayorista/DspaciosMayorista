-- 228 · PRUEBAS de la guarda de saldo de CxP. SOLO PARA UN PROYECTO SUPABASE AISLADO Y DESCARTABLE
-- (nunca Producción ni Preview), después de aplicar la migración 228. Lo ejecuta el dueño.
-- Todo corre dentro de una transacción que termina en ROLLBACK. Pegar en el editor SQL como postgres.
-- Cada consulta devuelve una fila: prueba | esperado | obtenido. Una fila con esperado <> obtenido es un fallo.
--
-- Requisitos: al menos un contrato en `ventas` y, para T7, un usuario activo por rol en `usuarios`.
-- Si anon no tiene privilegio INSERT sobre las tablas, T3 devolverá "permission denied" (también 42501):
-- lo importante es que los TRES casos de anon den EXACTAMENTE la misma respuesta.
-- La CARRERA (T9) necesita dos conexiones y se describe al final; no se puede automatizar en una sola.

begin;

-- Ayudante: intenta una sentencia y devuelve "sqlstate|mensaje" o "ok". No contiene importes.
create function pg_temp.intento(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || '|' || sqlerrm;
end $$;
grant execute on function pg_temp.intento(text) to public;

-- Fixture: una CxP COP de 1000 y una CxP USD de 100 sobre un contrato existente (agencia 'mayorista').
create temp table fx (clave text primary key, id bigint);
grant all on fx to public;
insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, valor_total, moneda, tenant)
  select numero_contrato, 'PRUEBA 228', 'hotel', 1000, 'COP', 'mayorista' from public.ventas order by numero_contrato limit 1;
insert into fx select 'cop', max(id) from public.cuentas_por_pagar where proveedor = 'PRUEBA 228';
insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, valor_total, moneda, tenant)
  select numero_contrato, 'PRUEBA 228 USD', 'hotel', 100, 'USD', 'mayorista' from public.ventas order by numero_contrato limit 1;
insert into fx select 'usd', max(id) from public.cuentas_por_pagar where proveedor = 'PRUEBA 228 USD';

-- T0 · C1: claims que no son JSON válido -> 'rechazado' (nunca una excepción)
select set_config('request.jwt.claims', 'esto-no-es-json', true);
select 'T0 claims invalidos' as prueba, 'rechazado' as esperado, public.cxp_origen_peticion() as obtenido;
select set_config('request.jwt.claims', '', true);

-- T1 · servicio (service_role): dentro del saldo pasa; sobre saldo + tolerancia falla
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select 'T1a servicio pago 1000' as prueba, 'ok' as esperado,
       pg_temp.intento(format('insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values (%s, current_date, 1000, 1)', (select id from fx where clave = 'cop'))) as obtenido;
select 'T1b tolerancia COP 10 (suma 1010)' as prueba, 'ok' as esperado,
       pg_temp.intento(format('insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values (%s, current_date, 10, 1)', (select id from fx where clave = 'cop'))) as obtenido;
select 'T1c excede tolerancia (1010,01)' as prueba, 'Z9601|pago_excede_saldo' as esperado,
       pg_temp.intento(format('insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values (%s, current_date, 0.01, 1)', (select id from fx where clave = 'cop'))) as obtenido;
select 'T1d la retencion tambien cuenta' as prueba, 'Z9601|retencion_excede_saldo' as esperado,
       pg_temp.intento(format('insert into public.retenciones_cxp (cuenta_por_pagar_id, valor, fecha_practica, mes_declaracion) values (%s, 5, current_date, to_char(current_date, ''YYYY-MM''))', (select id from fx where clave = 'cop'))) as obtenido;
select 'T1e importe no positivo' as prueba, 'Z9604|importe_no_positivo' as esperado,
       pg_temp.intento(format('insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values (%s, current_date, 0, 1)', (select id from fx where clave = 'usd'))) as obtenido;
select 'T1f USD: 100,10 pasa y 0,01 mas falla' as prueba, 'ok,Z9601' as esperado,
       pg_temp.intento(format('insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values (%s, current_date, 100.10, 3700)', (select id from fx where clave = 'usd')))
       || ',' || split_part(pg_temp.intento(format('insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values (%s, current_date, 0.01, 3700)', (select id from fx where clave = 'usd'))), '|', 1) as obtenido;
select 'T1g CxP inexistente (servicio)' as prueba, 'Z9606|cxp_no_disponible' as esperado,
       pg_temp.intento('insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values (-1, current_date, 1, 1)') as obtenido;

-- T2 · valor_total, moneda y reasignación
select 'T2a bajar valor_total bajo lo asignado' as prueba, 'Z9603|valor_total_menor_que_asignado' as esperado,
       pg_temp.intento(format('update public.cuentas_por_pagar set valor_total = 500 where id = %s', (select id from fx where clave = 'cop'))) as obtenido;
select 'T2b cambiar moneda con movimientos' as prueba, 'Z9602|moneda_con_movimientos' as esperado,
       pg_temp.intento(format('update public.cuentas_por_pagar set moneda = ''USD'' where id = %s', (select id from fx where clave = 'cop'))) as obtenido;
select 'T2c no se reasigna la CxP' as prueba, 'Z9605|cxp_no_se_reasigna' as esperado,
       pg_temp.intento(format('update public.cxp_pagos set cuenta_por_pagar_id = %s where cuenta_por_pagar_id = %s', (select id from fx where clave = 'usd'), (select id from fx where clave = 'cop'))) as obtenido;
select set_config('request.jwt.claims', '', true);

-- T3 · ANON: tres casos que deben responder IDÉNTICO (id inexistente / existente con exceso / existente sin exceso)
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select 'T3a anon pagos: respuestas distintas' as prueba, '1' as esperado, count(distinct r)::text as obtenido
  from (values
    (pg_temp.intento('insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values (-1, current_date, 1, 1)')),
    (pg_temp.intento(format('insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values (%s, current_date, 999999, 1)', (select id from fx where clave = 'cop')))),
    (pg_temp.intento(format('insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values (%s, current_date, 0.01, 1)', (select id from fx where clave = 'usd'))))
  ) t(r);
select 'T3b anon retenciones: respuestas distintas' as prueba, '1' as esperado, count(distinct r)::text as obtenido
  from (values
    (pg_temp.intento('insert into public.retenciones_cxp (cuenta_por_pagar_id, valor, fecha_practica, mes_declaracion) values (-1, 1, current_date, ''2026-01'')')),
    (pg_temp.intento(format('insert into public.retenciones_cxp (cuenta_por_pagar_id, valor, fecha_practica, mes_declaracion) values (%s, 999999, current_date, ''2026-01'')', (select id from fx where clave = 'cop')))),
    (pg_temp.intento(format('insert into public.retenciones_cxp (cuenta_por_pagar_id, valor, fecha_practica, mes_declaracion) values (%s, 0.01, current_date, ''2026-01'')', (select id from fx where clave = 'usd'))))
  ) t(r);
select 'T3c anon: sqlstate' as prueba, '42501' as esperado,
       split_part(pg_temp.intento(format('insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values (%s, current_date, 1, 1)', (select id from fx where clave = 'cop'))), '|', 1) as obtenido;
select set_config('request.jwt.claims', '{"role":"anon","sub":"00000000-0000-0000-0000-000000000001"}', true);
select 'T3d anon con sub (uid) tampoco entra' as prueba, 'rechazado' as esperado, public.cxp_origen_peticion() as obtenido;
reset role;
select set_config('request.jwt.claims', '', true);

-- T7 · authenticated por rol. Para cada (rol, agencia) con un usuario activo intenta 0,01 USD de pago y de retención
-- en la CxP USD ('mayorista'). 'Z9601' o 'ok' = autorizado (llegó a la guarda); '42501' = rechazado como RLS.
-- Comparar con cxp_roles_contables (cxp_pagos: administracion, gerencia, operaciones, superadmin; retenciones:
-- administracion, gerencia, superadmin) y con la agencia (superadmin y gerencia ven ambas; el resto, la suya).
create temp table res_t7 (rol text, tenant text, pago text, retencion text);
grant all on res_t7 to public;
do $$
declare
  r record; v_pago text; v_ret text; v_cxp bigint;
begin
  select id into v_cxp from fx where clave = 'usd';
  for r in select distinct on (rol, tenant) id, rol::text as rol, tenant from public.usuarios where activo order by rol, tenant, id loop
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', r.id)::text, true);
    execute 'set local role authenticated';
    v_pago := pg_temp.intento(format('insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values (%s, current_date, 0.01, 3700)', v_cxp));
    v_ret := pg_temp.intento(format('insert into public.retenciones_cxp (cuenta_por_pagar_id, valor, fecha_practica, mes_declaracion) values (%s, 0.01, current_date, ''2026-01'')', v_cxp));
    execute 'reset role';
    insert into res_t7 values (r.rol, r.tenant, split_part(v_pago, '|', 1), split_part(v_ret, '|', 1));
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $$;
select * from res_t7 order by rol, tenant;

-- Nada de esto debe persistir
rollback;

-- ═══════════════ T9 · CARRERA (dos conexiones, a mano) ═══════════════
-- Preparación (conexión A): crear una CxP COP de 1000 sin pagos y anotar su id (:id). Confirmar.
-- A: begin; insert into cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values (:id, current_date, 1000, 1);   -- NO confirmar
-- B: begin; insert into cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values (:id, current_date, 500, 1);    -- debe QUEDAR ESPERANDO
-- A: commit;
-- B: debe fallar con Z9601 pago_excede_saldo (ve el pago de A tras esperar el bloqueo). B: rollback.
-- Variante pago + retención: A = pago 1000, B = retención 500 -> Z9601 retencion_excede_saldo.
-- Variante valor_total: A inserta pago 1000 sin confirmar; B: update cuentas_por_pagar set valor_total = 100 where id = :id
--   -> espera; tras el commit de A falla con Z9603.
-- Aislamiento: begin isolation level repeatable read; insert into cxp_pagos ... -> debe fallar con Z9607.
-- Limpieza: delete from cuentas_por_pagar where id = :id;  (los pagos caen por cascade)
