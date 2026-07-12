-- ───────────────────────────────────────────────────────────────────────────
-- 127 · PUC — subcuenta faltante para el IRT (Ingreso Recibido para Terceros)
--
--  La migración 126 sembró "2815 Ingresos recibidos para terceros" (el pasivo
--  correcto para el IRT: plata que el cliente paga y la agencia solo intermedia
--  hacia hoteles/aerolíneas — NO es ingreso propio) pero solo con la subcuenta
--  de comisiones B2B (281505). Falta la subcuenta específica para el IRT que
--  usa el asiento automático de facturación (contrato_facturacion.irt).
-- ───────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  padre_id bigint;
begin
  foreach t in array array['mayorista','minorista'] loop
    select id into padre_id from public.puc_cuentas where tenant = t and codigo = '2815';
    if padre_id is not null then
      insert into public.puc_cuentas (tenant, codigo, nombre, nivel, padre_id, naturaleza, permite_movimiento)
      values (t, '281510', 'Ingreso recibido para terceros (IRT)', 4, padre_id, 'credito', true)
      on conflict (tenant, codigo) do nothing;
    end if;
  end loop;
end $$;
