-- Rollback de la 265 (provisional): retira triggers, funciones y la clave estable. No borra CxP ni líneas; las columnas de la 264 y los vínculos ya escritos se conservan.
-- Para volver al comportamiento de la 264 (enlace por descripción) basta reaplicar el archivo de la 264, que es idempotente; para retirar también la 264 usa rollback_264.
begin;
drop trigger if exists ventas_completo_exige_enlaces on public.ventas;
drop function if exists public.tg_ventas_completo_exige_enlaces();
drop trigger if exists linea_enlazada_protegida on public.contrato_servicios;
drop function if exists public.tg_linea_enlazada_protegida();
drop trigger if exists cxp_enlace_inmutable on public.cuentas_por_pagar;
drop function if exists public.tg_cxp_enlace_inmutable();
drop trigger if exists cxp_enlace_por_clave on public.cuentas_por_pagar;
drop function if exists public.tg_cxp_enlace_por_clave();
drop function if exists public.corregir_enlace_cxp_alcance(bigint, bigint);
drop index if exists public.uq_contrato_servicios_clave_enlace;
alter table public.contrato_servicios drop column if exists clave_enlace;
do $$ begin
  if exists (select 1 from pg_trigger where tgname in ('ventas_completo_exige_enlaces','linea_enlazada_protegida','cxp_enlace_inmutable','cxp_enlace_por_clave') and not tgisinternal)
     or exists (select 1 from information_schema.columns where table_schema='public' and table_name='contrato_servicios' and column_name='clave_enlace') then
    raise exception 'rollback 265: quedaron objetos';
  end if;
end $$;
commit;
