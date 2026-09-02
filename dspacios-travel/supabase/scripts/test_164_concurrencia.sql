-- Preparación para las pruebas de CONCURRENCIA (dos conexiones).
-- Deja tres cotizaciones limpias; el script test_164_concurrencia.sh dispara
-- registros en paralelo. Precondición: test_164_schema.sql aplicado.
select public._reset_cot(201,'COP',3000000); -- ya tiene un pago congelado (para reutilización bajo carga)
select public._reset_cot(202,'USD',2000);     -- competirá por ser el PRIMER pago (T4)
select public._reset_cot(203,'COP',3000000); -- doble-click primer pago (T3), SIN primer pago previo
select public.registrar_pago_previo(201, 800000, 'COP', 1, 'Transferencia', 'BASE', current_date,
  '00000000-0000-0000-0000-000000000001', 'KC-BASE-201', public._snap(), 1066000, 35.53);
select 'ready' as estado;
