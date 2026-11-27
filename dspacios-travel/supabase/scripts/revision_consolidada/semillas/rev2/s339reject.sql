-- REVISIÓN CONSOLIDADA (ronda de correcciones) · semilla ADITIVA e idempotente para S339-02 (rechazo de soportes y corrección del aliado).
-- NO toca nada existente: solo agrega dos contratos sintéticos de la agencia aliada de la revisión (ficha 9409, la de DTM-8301…8306) SIN soportes cargados, para que el recorrido suba archivos
-- REALES por la interfaz (los soportes sembrados de DTM-8301…8306 son filas sin archivo en Storage: no se pueden abrir). Requiere la migración 345 aplicada para rechazar.
--   DTM-8310 · 1 pago registrado (caben 2 soportes vigentes)      DTM-8311 · 0 pagos registrados (cabe 1)
insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, freelance_nombre, tipo_asesor, asesor)
select v.* from (values
  ('DTM-8310', 'Cliente Rechazo 8310', 'mayorista', 'CARTAGENA', current_date + 50, 'confirmado', 2400000::numeric, 'COP', 9409::bigint, 'Agencia Aliada Revision', null::text, 'agencia', 'Rev Venta'),
  ('DTM-8311', 'Cliente Rechazo 8311', 'mayorista', 'SANTA MARTA', current_date + 51, 'pendiente', 1900000::numeric, 'COP', 9409::bigint, 'Agencia Aliada Revision', null::text, 'agencia', 'Rev Venta')
) as v(numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, freelance_nombre, tipo_asesor, asesor)
where not exists (select 1 from public.ventas x where x.numero_contrato = v.numero_contrato);

insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant, fecha_abono)
select 'DTM-8310', 500000, 'Transferencia', 'mayorista', current_date - 3
where exists (select 1 from public.ventas where numero_contrato = 'DTM-8310') and not exists (select 1 from public.abonos where numero_contrato = 'DTM-8310');
