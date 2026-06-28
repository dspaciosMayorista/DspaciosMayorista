-- ───────────────────────────────────────────────────────────────────────────
-- 106 · CONTABILIDAD — impuesto de renta (PyME) sobre la renta líquida
--
--  Separa dos conceptos que estaban mezclados:
--    · RETENCION_RENTA (3,5%) = retención EN LA FUENTE, un anticipo que retienen
--      al cobrar (queda como provisión/retención por contrato).
--    · IMPUESTO_RENTA (35%)   = impuesto de renta real, sobre la RENTA LÍQUIDA
--      (ingresos − costos − gastos), a nivel de Estado de Resultados.
-- ───────────────────────────────────────────────────────────────────────────

insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion)
values ('IMPUESTO_RENTA', 0.35, 'renta_liquida', 'Impuesto de renta PyME sobre la renta líquida (ingresos − costos − gastos)')
on conflict (parametro) do nothing;
