-- ROLLBACK de la migración 309 (#106 gestión integral de contratos). Borra SOLO lo que creó la 309: la tabla de acuses y las funciones. No toca ventas, abonos, vouchers,
-- facturación ni comisiones. SE NIEGA si ya existen acuses registrados (evidencia operativa del personal): expórtalos o decide su destino antes; este script no los destruye en silencio.
begin;
do $$
begin
  if to_regclass('public.contrato_seguimiento') is null then
    raise exception 'rollback 309: la 309 no está aplicada.';
  end if;
  if exists (select 1 from public.contrato_seguimiento) then
    raise exception 'rollback 309: hay % acuse(s) registrados en contrato_seguimiento; no se borran en silencio. Expórtalos y vacía la tabla a propósito si es lo que quieres.', (select count(*) from public.contrato_seguimiento);
  end if;
end $$;
drop function if exists public.fn_gestion_contratos(jsonb, text, integer, integer);
drop function if exists public.registrar_seguimiento_contrato(text, uuid, text, text, text, text);
drop function if exists public.seguimiento_referencia(text, text);
delete from public.contrato_guardas_config where tabla = 'contrato_seguimiento';
drop table public.contrato_seguimiento;
drop function if exists public.tg_contrato_seguimiento_inmutable();
select public.contrato_instalar_guardas();
commit;
