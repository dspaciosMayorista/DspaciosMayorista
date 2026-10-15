-- ROLLBACK · #30 contrato manual NETO (migración 206, 20260601000206_contrato_manual_neto.sql).
-- Quita SOLO los objetos de la migración. No toca datos: un contrato que ya se
-- registró en NETO conserva su precio, su marca y su fila de comisión
-- descontada (la 205 la sigue protegiendo); solo deja de existir la vía para
-- crear NETO manuales y la guarda de UPDATE en ventas. Antes de correrlo, el
-- código de la app que llama aplicar_neto_contrato_manual debe estar retirado
-- (si no, crear un contrato manual NETO fallaría y se revertiría).
begin;
drop trigger if exists trg_ventas_modalidad_b2b_inmutable on public.ventas;
drop function if exists public.tg_ventas_modalidad_b2b_inmutable();
drop function if exists public.aplicar_neto_contrato_manual(text, bigint, numeric);
commit;
