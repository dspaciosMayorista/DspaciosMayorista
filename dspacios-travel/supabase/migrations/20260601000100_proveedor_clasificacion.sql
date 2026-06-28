-- ───────────────────────────────────────────────────────────────────────────
-- 100 · CONTABILIDAD — clasificación del proveedor (IRT / Costo)
--
--  Cada proveedor del catálogo se trata como:
--    · costo = se factura como INGRESO PROPIO de la empresa; su IVA (sobre la
--              base gravable de la CxP) es IVA descontable. Costo neto = valor − IVA.
--    · irt   = Ingreso Recibido para Tercero (hotel/aerolínea): la empresa solo
--              intermedia; NO es costo propio ni genera IVA descontable.
--  Por defecto 'costo' (comportamiento actual). La base gravable del IVA del
--  costo ya vive en cuentas_por_pagar.base_gravable / iva_proveedor.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.proveedores
  add column if not exists clasificacion text not null default 'costo';  -- 'costo' | 'irt'
