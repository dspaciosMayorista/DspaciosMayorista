-- 228 · ROLLBACK. Solo elimina objetos de la 228 y verifica la marca de la función antes de borrar.
-- Los pagos/retenciones ya registrados NO se tocan.
begin;
do $$
begin
  if obj_description('public.trg_cxp_guarda_saldo_hija()'::regprocedure, 'pg_proc') is distinct from
       '228 · guarda atómica: pagos + retenciones <= valor_total + tolerancia, en la moneda de la CxP.' then
    raise exception 'ROLLBACK ABORTADO: la función no lleva la marca de la 228.';
  end if;
end $$;
drop trigger if exists cxp_pagos_guarda_saldo on public.cxp_pagos;
drop trigger if exists retenciones_cxp_guarda_saldo on public.retenciones_cxp;
drop trigger if exists cxp_guarda_valor on public.cuentas_por_pagar;
drop function if exists public.trg_cxp_guarda_saldo_hija();
drop function if exists public.trg_cxp_guarda_valor();
drop function if exists public.cxp_rechazo_rls(text);
drop function if exists public.cxp_origen_peticion();
drop function if exists public.cxp_roles_contables(text);
drop function if exists public.cxp_tolerancia(text);
commit;
