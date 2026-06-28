-- ───────────────────────────────────────────────────────────────────────────
-- 096 · FINANZAS USD — TRM de referencia (fallback para rentabilidad)
--
--  La rentabilidad/IVA/provisiones de un contrato USD se calculan en COP a la
--  TRM promedio vigente del contrato (ventas.trm_contrato, que se mueve con cada
--  abono). Mientras el contrato no tenga abonos (sin TRM realizada todavía), se
--  usa esta TRM de referencia editable para dar una cifra provisional en pesos.
-- ───────────────────────────────────────────────────────────────────────────

insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion)
values ('trm_referencia', 4000, 'COP por 1 USD',
        'TRM de referencia para liquidar en COP los contratos USD sin abonos (provisional).')
on conflict (parametro) do nothing;
