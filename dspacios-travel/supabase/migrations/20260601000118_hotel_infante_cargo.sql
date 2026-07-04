-- ───────────────────────────────────────────────────────────────────────────
-- 118 · Cargo obligatorio de infante + notas especiales de niño/infante por hotel
--
--  Algunos hoteles cobran algo a los infantes aunque no paguen habitación (ej.
--  "Niños de 0 a 4 años no pagan pero deben pagar alimentación $20.000 por
--  comida/noche") y necesitan anotaciones visibles (ej. "comparte cama con los
--  padres", "debe pagar seguro hotelero obligatorio"). Antes el infante SIEMPRE
--  sumaba $0 al precio de venta (lib/reservar/computo.ts) y no había dónde
--  guardar una nota.
--
--  infante_cargo_neto: costo NETO por infante POR NOCHE (se multiplica por
--  noches y por número de infantes, y lleva el mismo % de markup del paquete
--  que el resto de costos del hotel — igual criterio que el costo de habitación).
--  infante_cargo_desc: qué es el cargo (ej. "Alimentación obligatoria"), se
--  muestra junto al valor en el tarifario público y en el contrato.
--  infante_nota / nino_nota: anotaciones libres, informativas (no suman al
--  precio), visibles en el tarifario público junto al rango de edades.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.hoteles add column if not exists infante_cargo_neto numeric not null default 0;
alter table public.hoteles add column if not exists infante_cargo_desc text;
alter table public.hoteles add column if not exists infante_nota text;
alter table public.hoteles add column if not exists nino_nota text;
