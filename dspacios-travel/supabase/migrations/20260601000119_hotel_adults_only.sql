-- ───────────────────────────────────────────────────────────────────────────
-- 119 · Hotel "Adults Only" (no acepta niños)
--
--  Algunos hoteles (Adults Only) no reciben niños ni infantes bajo ninguna
--  circunstancia. Se marca por hotel; el motor de reserva bloquea la venta si
--  declaran niños/infantes, y el tarifario público muestra el aviso.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.hoteles add column if not exists adults_only boolean not null default false;
