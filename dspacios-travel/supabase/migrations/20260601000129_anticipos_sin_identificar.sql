-- ───────────────────────────────────────────────────────────────────────────
-- 129 · Anticipos de clientes SIN identificar (depósitos sin contrato relacionado)
--
-- "Registrar como movimiento contable" en Conciliaciones dejaba elegir
-- CUALQUIER cuenta para un depósito de cliente que no se va a relacionar con
-- un contrato del sistema — pero esa plata sigue siendo un pasivo real (un
-- anticipo), exactamente igual que un abono normal que aún no se ha
-- facturado (280505). La diferencia no es el tipo de cuenta, es que no se
-- sabe a qué contrato pertenece todavía (o nunca se va a saber). Se separa en
-- su propia subcuenta para no mezclar "anticipo de un contrato conocido, aún
-- sin facturar" con "depósito sin identificar" — más limpio para conciliar
-- después si algún día se identifica.
-- ───────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  padre_id bigint;
begin
  foreach t in array array['mayorista','minorista'] loop
    select id into padre_id from public.puc_cuentas where tenant = t and codigo = '2805';
    if padre_id is not null then
      insert into public.puc_cuentas (tenant, codigo, nombre, nivel, padre_id, naturaleza, permite_movimiento)
      values (t, '280510', 'Anticipos de clientes sin identificar', 4, padre_id, 'credito', true)
      on conflict (tenant, codigo) do nothing;
    end if;
  end loop;
end $$;
