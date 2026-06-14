-- ───────────────────────────────────────────────────────────────────────────
-- 071 · BLOQUEOS — origen y tarifa neta
--
--  * origen      → ciudad/IATA de salida (un bloqueo puede ser BOG-CTG-BOG, no
--                  siempre MDE). Configurable por bloqueo.
--  * tarifa_neta → lo que se le PAGA a la aerolínea por silla (costo).
--    (tarifa_para_empaquetar = precio de reventa a otra mayorista; ya existía.)
-- ───────────────────────────────────────────────────────────────────────────

alter table public.bloqueos_vuelo
  add column if not exists origen      text,
  add column if not exists tarifa_neta numeric(15,2);
