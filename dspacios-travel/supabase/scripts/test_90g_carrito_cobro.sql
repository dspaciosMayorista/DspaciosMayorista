-- ───────────────────────────────────────────────────────────────────────────
-- BATERÍA SQL · #90 F (carrito): contratos de CARRITO cobrados en otra moneda. SOLO bases desechables con 001-235 aplicadas.
-- Corre en UNA transacción que termina en ROLLBACK. Uso: psql -X -q -v ON_ERROR_STOP=1 -f test_90g_carrito_cobro.sql   Cierre: "TEST 90G SQL: TODO OK".
-- No hay migración nueva: un contrato de carrito guarda moneda_cobro / trm_cobro / total_cobro en ventas (columnas y CHECK de la 235) y NO tiene
-- aceptación #63. Esta batería demuestra, en la base real, que los candados de la 235 dependen de las COLUMNAS (no de la aceptación #63):
--   K1-K3 la facturación se rechaza (F4451) por la RPC y por el trigger de contrato_facturacion; K4-K5 no restringen lo histórico ni la misma moneda;
--   K6 el CHECK impide un cobro en otra moneda sin total; K7 la cartera del dashboard usa la moneda y el total de cobro.
-- ───────────────────────────────────────────────────────────────────────────
begin;
create schema t90g;
create table t90g.res (nombre text, ok boolean, detalle text);

create function t90g.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void language plpgsql as $$
begin
  insert into t90g.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre; else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

-- Ejecuta UNA consulta que devuelve texto con el rol de Postgres `p_rol`.
create function t90g.q(p_sql text, p_rol text default 'service_role') returns text language plpgsql as $$
declare v text;
begin
  begin
    execute format('set local role %I', p_rol);
    execute p_sql into v;
  exception when others then v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  return v;
end $$;

create function t90g.msg(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'OK'; exception when others then return sqlstate || ' ' || sqlerrm; end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000990001', 'c90g-admin@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
values ('00000000-0000-0000-0000-000000990001', 'c90g-admin@x.test', 'C90G admin', 'administracion'::rol_usuario, true, 'mayorista')
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;

-- Contrato de CARRITO (sin aceptación #63): tipo_paquete 'carrito', como lo crea convertirCotizacionCarrito.
create function t90g.carrito(p_num text, p_mon text, p_precio numeric, p_mc text, p_trm numeric, p_total numeric, p_trm_contrato numeric default null) returns void language plpgsql as $$
begin
  insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, fecha_salida, fecha_regreso, pax, hotel, destino, precio_venta,
                             estado, financiero_estado, tipo_asesor, canal, moneda_cobro, trm_cobro, total_cobro, trm_contrato)
  values (p_num, 'mayorista', 'Cliente carrito', 'carrito', p_mon, current_date + 100, current_date + 103, 2, 'HOTEL CARRITO', 'CARTAGENA', p_precio,
          'confirmado', 'completo', 'interno', 'B2C', p_mc, p_trm, p_total, p_trm_contrato);
end $$;
create function t90g.abono(p_num text, p_valor numeric) returns void language plpgsql as $$
begin
  insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago) values (p_num, 'mayorista', p_valor, p_valor, 1, current_date, 'transferencia');
end $$;
create function t90g.facturar(p_num text, p_pvp numeric) returns text language plpgsql as $$
begin
  return t90g.q(format('select public.facturar_factura(%L, %L::uuid, ''mayorista'', %s, 0, 0)::text', p_num, '00000000-0000-0000-0000-000000990001', p_pvp), 'service_role');
end $$;
create function t90g.cartera(p_mon text) returns numeric language sql as $$
  select coalesce((select al_dia + vencida + sin_fecha from public.fn_dashboard_cartera_por_moneda('mayorista', current_date) where moneda = p_mon), 0)
$$;

do $$
declare v_r text; v_cop0 numeric; v_usd0 numeric; v_asientos bigint;
begin
  select count(*) into v_asientos from public.asientos_contables where origen like 'facturacion%';
  v_cop0 := t90g.cartera('COP'); v_usd0 := t90g.cartera('USD');

  perform t90g.carrito('DTM-770001', 'COP', 600000, 'USD', 4100, 147);                 -- COP → USD
  perform t90g.carrito('DTM-770002', 'USD', 300, 'COP', 4100, 1230000, 4000);          -- USD → COP
  perform t90g.carrito('DTM-770003', 'COP', 1000000, 'COP', null, null);               -- misma moneda, elección expresa
  perform t90g.carrito('DTM-770004', 'USD', 300, null, null, null, 4000);              -- histórico (sin elección)

  -- K1-K3 · facturación
  v_r := t90g.facturar('DTM-770001', 600000);
  perform t90g.afirma('K1 carrito COP cobrado en USD: facturar_factura se rechaza (F4451) aunque no tenga aceptación #63', v_r like 'ERR F4451 FIN_COBRO_OTRA_MONEDA%cobra en USD%oferta está en COP%', v_r);
  v_r := t90g.facturar('DTM-770002', 1200000);
  perform t90g.afirma('K2 carrito USD cobrado en COP: facturar_factura se rechaza (F4451), con cualquier importe enviado', v_r like 'ERR F4451%' and t90g.facturar('DTM-770002', 0) like 'ERR F4451%', v_r);
  v_r := t90g.msg($f$insert into public.contrato_facturacion (numero_contrato, irt, ingreso_propio, lleva_iva) values ('DTM-770001', 0, 600000, true)$f$);
  perform t90g.afirma('K3 el trigger de contrato_facturacion también lo rechaza (F4451): no hay vía directa que omita el candado', v_r like 'F4451 FIN_COBRO_OTRA_MONEDA%', v_r);
  perform t90g.afirma('K3b los rechazos no dejaron asientos de facturación ni configuración',
    (select count(*) from public.asientos_contables where origen like 'facturacion%') = v_asientos
    and not exists (select 1 from public.contrato_facturacion where numero_contrato in ('DTM-770001', 'DTM-770002')));

  -- K4-K5 · lo que NO se restringe
  v_r := t90g.facturar('DTM-770003', 1000000);
  perform t90g.afirma('K4 carrito con cobro EXPRESO en la misma moneda: la facturación no se restringe (no es F4451)', v_r not like '%F4451%', v_r);
  v_r := t90g.facturar('DTM-770004', 1200000);
  perform t90g.afirma('K5 carrito histórico (sin elección de cobro): la facturación no se restringe (no es F4451)', v_r not like '%F4451%', v_r);

  -- K6 · coherencia de columnas (ventas_cobro_chk)
  v_r := t90g.msg($f$select t90g.carrito('DTM-770005', 'COP', 600000, 'USD', 4100, null)$f$);
  perform t90g.afirma('K6a cobro en otra moneda SIN total se rechaza (CHECK)', v_r like '23514%', v_r);
  v_r := t90g.msg($f$select t90g.carrito('DTM-770006', 'COP', 600000, 'USD', null, 147)$f$);
  perform t90g.afirma('K6b cobro en otra moneda SIN TRM se rechaza (CHECK)', v_r like '23514%', v_r);
  v_r := t90g.msg($f$select t90g.carrito('DTM-770007', 'COP', 600000, 'COP', 4100, 147)$f$);
  perform t90g.afirma('K6c misma moneda CON TRM o total se rechaza (CHECK): no se convierte dos veces', v_r like '23514%', v_r);

  -- K7 · cartera del dashboard en la moneda de cobro (abonos en la moneda de cobro)
  perform t90g.abono('DTM-770001', 100);        -- 147 − 100 = 47 USD
  perform t90g.abono('DTM-770002', 1000000);    -- 1.230.000 − 1.000.000 = 230.000 COP
  perform t90g.abono('DTM-770003', 250000);     -- 750.000 COP (misma moneda)
  perform t90g.abono('DTM-770004', 100);        -- histórico USD: 300 − 100 = 200 USD
  perform t90g.afirma('K7 cartera: COP→USD parcial 47 USD, USD→COP parcial 230.000 COP, misma moneda 750.000 COP, histórico 200 USD',
    t90g.cartera('USD') - v_usd0 = 47 + 200 and t90g.cartera('COP') - v_cop0 = 230000 + 750000,
    (t90g.cartera('USD') - v_usd0) || ' / ' || (t90g.cartera('COP') - v_cop0));
  perform t90g.abono('DTM-770001', 47);
  perform t90g.afirma('K7b pagado por completo en la moneda de cobro: saldo cero (no queda 600.000 − 147)', t90g.cartera('USD') - v_usd0 = 200, (t90g.cartera('USD') - v_usd0)::text);
end $$;

do $$
declare v_total int; v_ok int;
begin
  select count(*), count(*) filter (where ok) into v_total, v_ok from t90g.res;
  if v_total < 11 then raise exception 'TEST 90G SQL: se esperaban >= 11 afirmaciones y hubo %', v_total; end if;
  if v_ok <> v_total then raise exception 'TEST 90G SQL: % de % afirmaciones fallaron', v_total - v_ok, v_total; end if;
  raise notice 'TEST 90G SQL: TODO OK (% afirmaciones)', v_total;
end $$;

rollback;
