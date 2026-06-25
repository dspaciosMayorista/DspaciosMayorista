-- ───────────────────────────────────────────────────────────────────────────
-- 102 · CONTABILIDAD — IRT/Costo a nivel de cuenta por pagar (factura del proveedor)
--
--  La clasificación IRT/Costo se decide al CONFIGURAR LA FACTURA del proveedor en
--  el módulo "Proveedores" (antes "Pagos a proveedores"), no en el catálogo: el
--  mismo proveedor puede ser IRT en un contrato y Costo en otro.
--    · costo = se factura como ingreso propio → su IVA (base gravable × IVA) es
--              descontable; costo neto = valor_total − IVA.
--    · irt   = ingreso para tercero → no descuenta IVA ni es costo propio.
--  base_gravable e iva_proveedor ya existen en la tabla; aquí se agrega la marca.
--  La clasificación del catálogo (proveedores.clasificacion) queda como default.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.cuentas_por_pagar
  add column if not exists clasificacion text not null default 'costo';  -- 'costo' | 'irt'
