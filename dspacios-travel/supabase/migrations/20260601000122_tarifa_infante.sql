-- ───────────────────────────────────────────────────────────────────────────
-- 122 · Tarifa de infante por temporada (igual que Niño 1 / Niño 2)
--
--  Antes el cargo de infante era un valor plano por hotel (migración 118).
--  El dueño pidió manejarlo IGUAL que Niño 1/Niño 2: la tarifa por NOCHE vive
--  en tarifa_hotel (varía por categoría/régimen/temporada — ej. Hotel Virrey
--  Cartagena cobra "seguro hotelero" distinto según el plan), $0 = gratis, y
--  la nota queda junto a la tarifa (no aparte en la config del hotel).
--
--  Se agrega 'infante' como valor del enum de acomodación, igual que se hizo
--  con 'nino2' en la migración 020.
-- ───────────────────────────────────────────────────────────────────────────

alter type acomodacion_tipo add value if not exists 'infante';

alter table public.tarifa_hotel add column if not exists neto_infante numeric(15,2);
alter table public.tarifa_hotel add column if not exists nota_infante text;

-- Backfill: si el hotel ya tenía el cargo plano (118) configurado, se copia
-- como punto de partida a TODAS sus tarifas existentes (editable por fila/
-- temporada después, ej. si en temporada alta el cargo cambia). No pisa filas
-- que ya tengan su propio valor (re-correr esta migración es seguro).
update public.tarifa_hotel th
set neto_infante = h.infante_cargo_neto
from public.hoteles h
where h.id = th.hotel_id
  and th.neto_infante is null
  and h.infante_cargo_neto > 0;

update public.tarifa_hotel th
set nota_infante = nullif(trim(both ' ' from concat_ws('. ', nullif(h.infante_cargo_desc, ''), nullif(h.infante_nota, ''))), '')
from public.hoteles h
where h.id = th.hotel_id
  and th.nota_infante is null
  and (h.infante_cargo_desc is not null or h.infante_nota is not null);
