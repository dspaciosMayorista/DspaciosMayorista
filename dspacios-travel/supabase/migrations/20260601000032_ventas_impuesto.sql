-- 032 · BNC (impuesto del paquete) a nivel de contrato
-- Guarda el impuesto/BNC total del contrato. La BASE COMISIONABLE = precio_venta − impuesto
-- (si el contrato no tiene BNC, impuesto = 0 ⇒ la base comisionable es el PVP completo).
alter table public.ventas
  add column if not exists impuesto numeric not null default 0;

comment on column public.ventas.impuesto is
  'BNC / impuesto no comisionable total del contrato. Base comisionable = precio_venta - impuesto.';
