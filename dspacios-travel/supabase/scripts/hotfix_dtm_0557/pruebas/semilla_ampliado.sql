-- Variante LOCAL: sobre el caso real, agrega las referencias que producción
-- podría traer (condiciones congeladas, control de emisión con historial,
-- cotización de origen, descuento de liquidación y conciliación).
begin;
insert into public.contrato_condiciones (numero_contrato, tipo_componente, referencia_externa, orden, valor_componente, monto_exigido)
values ('DTM-0057', 'hotel', 'tarifa:1', 1, 4000000, 1200000),
       ('DTM-0057', 'vuelo_bloqueo', 'record:XYZ123', 2, 1800000, 1800000);
insert into public.contrato_vuelo_control (numero_contrato, estado_emision) values ('DTM-0057', 'pendiente');
insert into public.contrato_vuelo_control_cambios (numero_contrato, detalle, nota) values ('DTM-0057', 'cambio de hora', 'prueba');
insert into public.cotizaciones (codigo, estado, tenant, numero_contrato, cliente) values ('COT-9001', 'convertida', 'mayorista', 'DTM-0057', 'Cliente real');
insert into auth.users (email) values ('asesor.prueba@local');  -- handle_new_user crea public.usuarios
insert into public.liquidacion_descuentos (usuario_id, mes, valor, descripcion, numero_contrato)
select id, '2026-10', 50000, 'descuento asesor', 'DTM-0057' from public.usuarios where email = 'asesor.prueba@local';
with c as (insert into public.conciliacion (nota, total) values ('cruce de prueba', 100000) returning id)
insert into public.conciliacion_sistema (conciliacion_id, ref, descripcion, valor, numero_contrato)
select id, 'abono:x', 'cruce', 100000, 'DTM-0057' from c;
commit;
