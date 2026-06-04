-- Backfill del BNC (ventas.impuesto) para contratos EXISTENTES.
-- Calcula el BNC = "Valor fijo del impuesto" del paquete × pax del contrato,
-- solo para ventas que están enlazadas a un paquete (paquete_armado_id) y que
-- aún tienen impuesto = 0. No toca las que ya tienen BNC.
--
--   · Requiere haber corrido antes la migración 032 (ventas.impuesto).
--   · Los contratos legacy SIN paquete enlazado no se pueden rellenar
--     (no hay de dónde sacar el BNC) → quedan en 0 ⇒ base comisionable = PVP.
--   · Aproximación: usa ventas.pax (puede incluir infantes); revísalo si tu
--     impuesto no aplica a infantes.

update public.ventas v
set impuesto = round(coalesce(p.impuesto_fijo, 0) * coalesce(v.pax, 0))
from public.armado_paquetes p
where v.paquete_armado_id = p.id
  and coalesce(v.impuesto, 0) = 0
  and coalesce(p.impuesto_fijo, 0) > 0;

-- Para revisar qué quedó (opcional):
-- select numero_contrato, pax, precio_venta, impuesto from public.ventas where impuesto > 0 order by numero_contrato;
