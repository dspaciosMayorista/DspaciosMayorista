-- ───────────────────────────────────────────────────────────────────────────
-- 093 · MONEDA en paquetes y en el snapshot del tarifario
--
--  Para que un paquete pueda venderse en USD (hoteles internacionales) y el
--  tarifario muestre el símbolo correcto. La moneda del paquete se toma de sus
--  hoteles (todos deben coincidir). El snapshot guarda la moneda de cada fila.
--    · default 'COP' → nada cambia para los paquetes existentes.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.armado_paquetes
  add column if not exists moneda text not null default 'COP';

alter table public.tarifario_resultado
  add column if not exists moneda text not null default 'COP';
