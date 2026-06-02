-- Migración 022: Reserva / contrato desde el tarifario
--
-- Campos en `ventas` para el flujo de reserva (cliente, tipo de venta/canal,
-- plazo de confirmación, enlace al paquete armado y al bloqueo) y la
-- nacionalidad del pasajero. La venta nace en estado 'pendiente'.

alter table public.ventas
  add column if not exists cliente_email     text,
  add column if not exists plazo             date,            -- fecha máx. para confirmar
  add column if not exists tipo_asesor       text,            -- 'interno' | 'agencia' | 'freelance'
  add column if not exists agencia_nombre    text,
  add column if not exists agencia_asesor    text,
  add column if not exists freelance_nombre  text,
  add column if not exists paquete_armado_id bigint references public.armado_paquetes(id),
  add column if not exists bloqueo_ref_id    bigint references public.bloqueos_vuelo(id);

alter table public.contrato_pasajeros
  add column if not exists nacionalidad text;
