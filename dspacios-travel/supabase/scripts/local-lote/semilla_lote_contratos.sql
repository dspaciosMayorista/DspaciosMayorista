-- REVISIÓN LOCAL DEL LOTE — segunda parte de la semilla SINTÉTICA. Va DESPUÉS de generar el tarifario de los paquetes
-- 915001-915003 desde la app (el editor de servicios del contrato lee el tarifario publicado del paquete).
\set ON_ERROR_STOP 1
begin;
-- Contrato PENDIENTE del paquete Porción (#50, servicios del contrato): 2 pax, City tour ya elegido.
insert into public.ventas (numero_contrato, tenant, cliente, destino, tipo_paquete, estado, pax, precio_venta, moneda, fecha_venta, fecha_salida, fecha_regreso, paquete_armado_id, asesor, canal)
values ('DTM-9001', 'mayorista', 'Cliente Sintético Lote Uno', 'CARTAGENA', 'porcion_terrestre', 'pendiente', 2, 2000000, 'COP', current_date, '2026-12-12', '2026-12-15', 915001, 'Lote Superadmin', 'B2C');
insert into public.contrato_items (numero_contrato, descripcion, adultos, tarifa_adulto, orden)
values ('DTM-9001', 'Servicio · LOTE City tour', 2, 72000, 1);
-- Contratos con abonos sin conciliar (#50, Conciliaciones → Cartera): 100, 200, 300 y 5.000.
insert into public.ventas (numero_contrato, tenant, cliente, destino, tipo_paquete, estado, pax, precio_venta, moneda, fecha_venta, asesor, canal)
select 'DTM-90' || n, 'mayorista', 'Cliente Sintético Lote ' || n, 'CARTAGENA', 'porcion_terrestre', 'confirmado', 2, 10000, 'COP', current_date, 'Lote Superadmin', 'B2C'
from generate_series(11, 14) n;
insert into public.abonos (numero_contrato, tenant, cliente, fecha_abono, valor_abono, monto_cop, forma_pago, observacion)
select 'DTM-90' || n, 'mayorista', 'Cliente Sintético Lote ' || n, current_date - (14 - n), v, v, 'Transferencia', 'Abono sintético de revisión'
from (values (11, 100), (12, 200), (13, 300), (14, 5000)) x(n, v);
commit;
