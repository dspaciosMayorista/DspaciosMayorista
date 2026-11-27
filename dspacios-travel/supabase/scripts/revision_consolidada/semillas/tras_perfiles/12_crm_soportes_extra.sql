-- REVISION CONSOLIDADA — semilla 12: datos extra del CRM (#76 referidos). Rango de ids 60000-69999, contratos DTM-61xx. Se aplica UNA vez, despues de fijar los perfiles.
-- DTM-6101 y DTM-6102 del aliado 9802 (referido al 2 %): una compra ORDINARIA y una NETO con la MISMA base comisionable guardada de 2.600.000 -> la participacion del referido es 52.000 en las dos.
--   · DTM-6101 ordinaria: PVP 2.600.000, comision del aliado 10 % sobre 2.600.000, pagada completa.
--   · DTM-6102 NETO: PVP original 2.600.000; la comision del aliado (260.000) se descontó del precio, el cliente paga 2.340.000 (pagado completo); la evidencia guarda la base ORIGINAL 2.600.000.
-- Se crean DESPUES de las asignaciones de la semilla 06, así que el contrato guarda la foto del referidor vigente (Odair Referidor, 2 %).
insert into public.ventas (numero_contrato, tenant, tipo_paquete, estado, cliente, asesor, precio_venta, impuesto, moneda, aliado_id, created_at) values
  ('DTM-6101', 'mayorista', 'bloqueo', 'confirmado', 'Cliente Referido 6101', 'Rev Venta', 2600000, 0, 'COP', 9802, clock_timestamp()),
  ('DTM-6102', 'mayorista', 'bloqueo', 'confirmado', 'Cliente Referido 6102', 'Rev Venta', 2340000, 0, 'COP', 9802, clock_timestamp());
update public.ventas set comision_estado = 'descontada', modo_compra = 'neta', comision_b2b = 260000 where numero_contrato = 'DTM-6102';
insert into public.aliados_b2b (numero_contrato, tenant, aliado, aliado_id, precio_venta, base_comision, base_explicita, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado, descontada_en_precio)
select v.numero_contrato, 'mayorista', a.nombre, a.id, 2600000, 2600000, true, 0.10, 0, 0, false, 0,
       case when v.numero_contrato = 'DTM-6102' then 'pagada' else 'pendiente' end, v.numero_contrato = 'DTM-6102'
  from public.ventas v join public.aliados a on a.id = v.aliado_id where v.numero_contrato in ('DTM-6101', 'DTM-6102');
insert into public.abonos (numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, tenant) values
  ('DTM-6101', 'Cliente Referido 6101', public.fecha_negocio(), 2600000, 'Transferencia', 'mayorista'),
  ('DTM-6102', 'Cliente Referido 6102', public.fecha_negocio(), 2340000, 'Transferencia', 'mayorista');
