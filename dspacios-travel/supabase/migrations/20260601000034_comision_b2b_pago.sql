-- 034 · Control de pago de comisiones B2B (aliados)
-- Permite marcar una comisión B2B como pagada y su fecha, para el módulo de
-- Comisiones (organiza por contrato las comisiones B2B y su estado de pago).
alter table public.aliados_b2b
  add column if not exists fecha_pago date;

-- estado ya existe ('pendiente' por defecto); se usará 'pagada' al registrar el pago.
