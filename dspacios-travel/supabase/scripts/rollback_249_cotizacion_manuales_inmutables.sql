-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la 249 (congelado de payload.manuales). Elimina el disparador y su función: vuelve a ser posible editar los servicios manuales de una
-- cotización ya hecha. No toca datos ni el disparador de la 238. Si el código nuevo sigue desplegado, esa protección pasa a depender solo de la
-- verificación al convertir (que compara contra el documento cotizado y el plan B2B), no de la base.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regprocedure('public.tg_cot_manuales_inmutables()') is null then
    raise exception 'ROLLBACK 249 ABORTADO: la 249 no está aplicada (no existe tg_cot_manuales_inmutables).';
  end if;
end;
$$;

drop trigger if exists trg_cot_manuales_inmutables on public.cotizaciones;
drop function if exists public.tg_cot_manuales_inmutables();

commit;
