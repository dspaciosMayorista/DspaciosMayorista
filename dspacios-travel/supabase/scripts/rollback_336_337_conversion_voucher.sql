-- ROLLBACK 336 + 337. Removes ONLY what those migrations added; no voucher, quotation or contract is deleted or edited.
-- The application of this branch calls these objects: roll back only together with the previous application build.
begin;
drop function if exists public.guardar_voucher_vuelo(text, jsonb);
drop index if exists public.vouchers_vuelo_uno_por_contrato;
drop function if exists public.liberar_conversion_cotizacion(bigint, uuid);
drop function if exists public.reclamar_conversion_cotizacion(bigint, integer);
drop table if exists public.cotizacion_conversion_reclamo;
commit;
