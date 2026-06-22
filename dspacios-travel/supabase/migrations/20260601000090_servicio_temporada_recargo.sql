-- ───────────────────────────────────────────────────────────────────────────
-- 090 · SERVICIOS por TEMPORADA — recargo individual por temporada
--
--  Cierra el modelo de la 089: una temporada debe ser una tarifa COMPLETA, no
--  solo el precio por persona. Faltaba el RECARGO INDIVIDUAL (suplemento neto del
--  proveedor cuando va 1 solo pax en cobro por persona): hasta ahora era un valor
--  único en `servicios_adicionales` igual en todas las temporadas. Ahora cada
--  temporada puede definir el suyo.
--
--   · servicio_temporadas.recargo_individual: NETO del proveedor para 1 pax en ESA
--     temporada. NULL = usa el recargo base del servicio (no lo sobre-escribe).
--   · Los rangos por GRUPO por temporada ya existen (servicio_tarifa_pax.temporada,
--     migración 089): una temporada = precio/persona + recargo + rangos por grupo.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.servicio_temporadas
  add column if not exists recargo_individual numeric(15,2);
