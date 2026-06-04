-- Migración 038: PRIORIDAD + VIGENCIA DE COMPRA + PROMOCIONES en temporadas
--
-- Fase 2/3 del tarifario de hoteles:
--  • Las temporadas ahora pueden CRUZARSE en fechas; gana la de mayor `prioridad`.
--  • Toda vigencia (temporada/promo) tiene una VIGENCIA DE COMPRA (compra_inicio/
--    compra_fin): si HOY está fuera de ese rango, esa tarifa no se ofrece.
--  • Una promoción es una "temporada" con `tipo`:
--      - 'tarifa'         → tarifa normal o de reemplazo (tiene sus filas en tarifa_hotel)
--      - 'descuento_pct'  → % de descuento sobre la tarifa base de esas fechas
--      - 'descuento_monto'→ descuento en $ por pax sobre la tarifa base
--    `descuento_valor` guarda el % o el monto.

alter table public.hotel_temporadas
  add column if not exists prioridad       integer not null default 1,
  add column if not exists compra_inicio   date,
  add column if not exists compra_fin      date,
  add column if not exists tipo            text not null default 'tarifa',
  add column if not exists descuento_valor numeric(15,2);
