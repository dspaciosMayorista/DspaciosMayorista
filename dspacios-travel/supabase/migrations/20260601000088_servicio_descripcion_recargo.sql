-- ───────────────────────────────────────────────────────────────────────────
-- 088 · SERVICIOS — descripción del tour + recargo individual (1 pax)
--
--  · descripcion        → texto libre del servicio/tour (se muestra al cliente
--                         en el tarifario público y en la reserva).
--  · recargo_individual → valor ADICIONAL que se suma a la tarifa cuando el
--                         servicio se vende a 1 solo pasajero (suplemento
--                         individual). Solo aplica al cobro POR PERSONA. Es un
--                         monto fijo: el sistema lo suma a la tarifa.
--
--  Ambos campos se denormalizan a `tarifario_resultado` para que el motor de
--  reserva y la vitrina pública los tengan sin re-consultar el catálogo.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.servicios_adicionales
  add column if not exists descripcion        text,
  add column if not exists recargo_individual numeric(15,2) default 0;

alter table public.tarifario_resultado
  add column if not exists descripcion        text,
  add column if not exists recargo_individual numeric(15,2) default 0;
