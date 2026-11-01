-- Rollback de 267 (#65): quita el trigger diferido y su función. No toca datos (las filas ya enlazadas quedan como están).
drop trigger if exists trg_recobro_beneficiario_explicito on public.aliados_b2b;
drop function if exists public.fn_recobro_beneficiario_explicito();
