-- VOLUMEN SINTÉTICO para medir fn_gestion_contratos (#106). SOLO LOCAL, base desechable. Parámetro: psql -v n=20000.
-- Mezcla: 2 agencias, COP/USD (5 % cobro cruzado), 3 abonos por contrato (en promedio), vouchers (15 %), facturas contabilizadas (8 %) y legado (8 %),
-- comisiones B2B (25 %, con pagos en el 40 %), acuses manuales (≈5 % de los contratos con voucher/factura).
\set ON_ERROR_STOP 1
set session_replication_role = replica;
insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion) values (9601, 'Agencia Aliada Demo', '900106001', 'agencia', 0.10, false, 0) on conflict (id) do nothing;

insert into public.ventas (numero_contrato, tenant, cliente, destino, estado, asesor, precio_venta, moneda, tipo_paquete, financiero_estado, plazo, fecha_venta, fecha_salida, fecha_regreso,
                           canal, tipo_asesor, aliado_id, modo_compra, comision_estado, moneda_cobro, trm_cobro, total_cobro, pax)
select case when g % 3 = 0 then 'MIN-00-' || lpad(g::text, 6, '0') else 'DTM-' || lpad(g::text, 6, '0') end,
       case when g % 3 = 0 then 'minorista' else 'mayorista' end,
       'Cliente ' || g, 'CARTAGENA',
       (array['confirmado','confirmado','pendiente','activo','cancelado'])[1 + g % 5],
       'Local Venta',
       case when g % 7 = 0 then 1000 + (g % 50) * 40 else 900000 + (g % 400) * 15000 end,
       case when g % 7 = 0 then 'USD' else 'COP' end, 'porcion', 'completo', date '2026-12-01',
       date '2025-01-01' + (g % 700), date '2026-01-01' + (g % 500), date '2026-01-05' + (g % 500),
       case when g % 4 = 0 then 'B2B' else 'B2C' end, case when g % 4 = 0 then 'agencia' else 'interno' end, case when g % 4 = 0 then 9601 end,
       case when g % 40 = 0 then 'neta' end, case when g % 40 = 0 then 'descontada' end,
       case when g % 20 = 1 then (case when g % 7 = 0 then 'COP' else 'USD' end) end,
       case when g % 20 = 1 then 4200 end,
       case when g % 20 = 1 then (case when g % 7 = 0 then (1000 + (g % 50) * 40) * 4200 else 1000 end) end, 2
  from generate_series(1, :n) g;

insert into public.abonos (numero_contrato, tenant, cliente, fecha_abono, valor_abono, forma_pago, trm, monto_cop)
select v.numero_contrato, v.tenant, v.cliente, date '2026-01-01' + (k * 9), round((coalesce(v.total_cobro, v.precio_venta) * (case k when 1 then 0.4 when 2 then 0.3 else 0.3 end) * (0.5 + (random() * 0.5)))::numeric, 2), 'transferencia', 1, 1
  from public.ventas v cross join generate_series(1, 3) k where (right(v.numero_contrato, 1)::int + k) % 4 <> 0;

insert into public.vouchers (numero_contrato, tipo, proveedor, contenido)
select numero_contrato, 'hotel', 'Hotel Demo', '{}' from public.ventas where abs(hashtext(numero_contrato)) % 100 < 15;
insert into public.vouchers (numero_contrato, tipo, proveedor, contenido)
select numero_contrato, 'traslado', 'Traslados Demo', '{}' from public.ventas where abs(hashtext(numero_contrato)) % 100 < 6;

insert into public.facturacion (numero_contrato, numero_factura, fecha_factura, cliente, estado_dian)
select numero_contrato, 'FE-' || numero_contrato, date '2026-06-01', cliente, 'borrador' from public.ventas where abs(hashtext('f' || numero_contrato)) % 100 < 8;
with a as (insert into public.asientos_contables (numero, descripcion, tenant)
           select 1000000 + row_number() over (order by numero_contrato), 'F ' || numero_contrato, tenant from public.ventas where abs(hashtext('c' || numero_contrato)) % 100 < 8 returning id, descripcion)
insert into public.contrato_facturacion (numero_contrato, irt, ingreso_propio, asiento_factura_id, dian_emitida)
select substr(descripcion, 3), 0, 1, id, true from a;

with b as (insert into public.aliados_b2b (numero_contrato, tenant, aliado, nit, tipo_aliado, precio_venta, base_comision, pct_comision, recobro_total, aplica_retencion, pct_retencion, estado, aliado_id)
           select numero_contrato, tenant, 'Agencia Aliada Demo', '900106001', 'agencia', precio_venta, precio_venta, 0.10, 0, false, 0, 'pendiente', 9601
             from public.ventas where tipo_asesor = 'agencia' and abs(hashtext('b' || numero_contrato)) % 100 < 85 returning id, precio_venta)
insert into public.comision_b2b_pagos (aliado_b2b_id, tenant, fecha, valor)
select id, 'mayorista', date '2026-07-01', round(precio_venta * 0.1 * 0.5, 2) from b where id % 5 < 2;

insert into public.contrato_seguimiento (numero_contrato, contrato_uid, tenant, tipo, accion, canal, referencia, actor_id, actor_nombre)
select v.numero_contrato, v.contrato_uid, v.tenant, 'voucher_entregado', 'marcar', 'whatsapp', public.seguimiento_referencia(v.numero_contrato, 'voucher_entregado'), '00000000-0000-0000-0000-000000000106', 'Semilla'
  from public.ventas v where exists (select 1 from public.vouchers x where x.numero_contrato = v.numero_contrato) and abs(hashtext('s' || v.numero_contrato)) % 100 < 30;
set session_replication_role = origin;
analyze;
