-- 048 · Política de reservas del proveedor
-- Campo de texto LIBRE de uso INTERNO (no se muestra en el contrato): condiciones
-- de reserva/cancelación del proveedor. Se ve en Proveedores y en la info del
-- hotel que tenga ese proveedor. Idempotente.

alter table public.proveedores
  add column if not exists politica_reservas text;
