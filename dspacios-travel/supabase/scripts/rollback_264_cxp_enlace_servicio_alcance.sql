-- Rollback de la 264 (provisional): retira trigger, índices y columnas nuevas. Pierde el vínculo estructurado (no toca las CxP ni las líneas).
begin;
drop trigger if exists cxp_enlazar_servicio_alcance on public.cuentas_por_pagar;
drop function if exists public.tg_cxp_enlazar_servicio_alcance();
drop index if exists public.uq_cxp_contrato_servicio;
drop index if exists public.idx_contrato_servicios_servicio;
alter table public.cuentas_por_pagar drop constraint if exists cuentas_por_pagar_alcance_traslado_chk;
alter table public.cuentas_por_pagar drop column if exists contrato_servicio_id;
alter table public.cuentas_por_pagar drop column if exists alcance_traslado;
alter table public.contrato_servicios drop column if exists servicio_id;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name in ('cuentas_por_pagar') and column_name in ('alcance_traslado','contrato_servicio_id')) then
    raise exception 'rollback 264: quedaron columnas';
  end if;
end $$;
commit;
