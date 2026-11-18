-- SEMILLA SINTÉTICA de la revisión local del #53 (confirmación configurable, vencimiento que no cancela contratos con pagos, vouchers de aliados).
-- Solo LOCAL: ningún dato de Producción. Todos los contratos son DTM-53xx. Se aplica sobre la base local53 (esquema ≤302 + 303–307).
\set ON_ERROR_STOP 1

-- Aliados del catálogo (ids 9301/9302)
insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion) values
  (9301, 'Agencia Aliada Demo', '900530001', 'agencia', 0.10, false, 0),
  (9302, 'Agencia Aliada Dos',  '900530002', 'agencia', 0.10, false, 0)
on conflict (id) do nothing;

create function pg_temp.mk(n text, estado text, precio numeric, neto boolean, plazo_dias int, aliado int default null, cliente text default null) returns void language sql as $$
  insert into public.ventas (numero_contrato, tenant, cliente, destino, estado, asesor, precio_venta, moneda, tipo_paquete, financiero_estado, plazo, fecha_salida, fecha_regreso,
                             comision_estado, comision_b2b, tipo_asesor, aliado_id, agencia_nombre, pax)
  values (n, 'mayorista', coalesce(cliente, 'Cliente ' || n), 'CARTAGENA', estado, 'Rev Venta', precio, 'COP', 'porcion', 'completo', current_date + plazo_dias,
          current_date + 60, current_date + 63, case when neto then 'descontada' end, case when neto then 100000 end,
          case when aliado is not null then 'agencia' end, aliado, case when aliado is not null then 'Agencia Aliada Demo' end, 2)
$$;
create function pg_temp.cond(n text, exigido numeric) returns void language sql as $$
  insert into public.contrato_condiciones (numero_contrato, tipo_componente, orden, valor_componente, condicion_pago_tipo, monto_exigido, restriccion_comercial, moneda, trm)
  values (n, 'hotel', 0, 1, 'normal', exigido, 'normal', 'COP', 1)
$$;
create function pg_temp.ab(n text, valor numeric) returns void language sql as $$
  insert into public.abonos (numero_contrato, tenant, cliente, fecha_abono, valor_abono, forma_pago, trm, monto_cop) values (n, 'mayorista', 'Cliente', current_date - 1, valor, 'transferencia', 1, valor)
$$;
create function pg_temp.vou(n text, tipo text) returns void language sql as $$
  insert into public.vouchers (numero_contrato, tipo, proveedor, contenido) values (n, tipo, 'Hotel Demo Cartagena', jsonb_build_object(
    'emision', to_char(current_date, 'YYYY-MM-DD'), 'nReserva', 'R-' || n, 'vendedor', 'Rev Venta', 'elaboradoPor', 'Rev Superadmin', 'contactoEmpresa', 'reservas@demo.test',
    'proveedor', 'Hotel Demo Cartagena', 'hotel', 'Hotel Demo Cartagena', 'destino', 'CARTAGENA', 'fechaIngreso', to_char(current_date + 60, 'YYYY-MM-DD'), 'tipoPax', 'Adultos',
    'noches', '3', 'tipoPlan', 'Plan completo', 'titular', 'Cliente ' || n, 'adultos', '2', 'ninos', '0',
    'checkIn', to_char(current_date + 60, 'YYYY-MM-DD'), 'checkOut', to_char(current_date + 63, 'YYYY-MM-DD'),
    'incluye', jsonb_build_array('Alojamiento 3 noches', 'Desayuno diario'), 'infoImportante', 'Presentar documento de identidad.', 'noIncluye', 'Gastos personales'))
$$;

-- A) CONFIRMACIÓN: mismo precio y misma condición (30 % = 300.000 de 1.000.000)
select pg_temp.mk('DTM-5301', 'pendiente', 1000000, false, 10); select pg_temp.cond('DTM-5301', 300000); select pg_temp.ab('DTM-5301', 250000);               -- PVP bajo el mínimo
select pg_temp.mk('DTM-5302', 'pendiente', 900000,  true,  10, 9301); select pg_temp.cond('DTM-5302', 300000); select pg_temp.ab('DTM-5302', 300000);      -- NETO que YA alcanza su condición (antes exigía el total): «Reintentar confirmación»
select pg_temp.mk('DTM-5303', 'pendiente', 1000000, false, 10); select pg_temp.cond('DTM-5303', 1000000); select pg_temp.ab('DTM-5303', 400000);           -- el hotel exige el 100 %

-- B) VENCIMIENTO (plazo vencido hace 5 días)
select pg_temp.mk('DTM-5311', 'pendiente', 1000000, false, -5); select pg_temp.cond('DTM-5311', 300000);                                                   -- sin pagos → el cron lo cancela
select pg_temp.mk('DTM-5312', 'pendiente', 1000000, false, -5); select pg_temp.cond('DTM-5312', 300000); select pg_temp.ab('DTM-5312', 50000);            -- pago pequeño → se conserva
select pg_temp.mk('DTM-5313', 'pendiente', 900000,  true,  -5, 9301); select pg_temp.cond('DTM-5313', 300000); select pg_temp.ab('DTM-5313', 300000);     -- NETO en el mínimo → se conserva

-- C) VOUCHERS del aliado «Agencia Aliada Demo» (9301): saldo pendiente / pagado completo / otro aliado
select pg_temp.mk('DTM-5321', 'confirmado', 1000000, false, 10, 9301); select pg_temp.ab('DTM-5321', 600000);  select pg_temp.vou('DTM-5321', 'hotel');     -- saldo pendiente: el aliado NO abre
select pg_temp.mk('DTM-5322', 'confirmado', 1000000, false, 10, 9301); select pg_temp.ab('DTM-5322', 1000000); select pg_temp.vou('DTM-5322', 'hotel');     -- 100 % pagado: el aliado abre
select pg_temp.mk('DTM-5323', 'confirmado', 1000000, false, 10, 9302); select pg_temp.ab('DTM-5323', 1000000); select pg_temp.vou('DTM-5323', 'hotel');     -- pagado, pero de OTRO aliado: no abre
