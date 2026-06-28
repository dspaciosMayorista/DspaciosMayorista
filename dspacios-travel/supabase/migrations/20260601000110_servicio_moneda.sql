-- ───────────────────────────────────────────────────────────────────────────
-- 110 · MONEDA en SERVICIOS ADICIONALES (COP / USD)
--
--  Los servicios (tours, traslados, asistencia…) podían cargarse SOLO en COP.
--  Para paquetes/productos internacionales (hotel en USD) hacían falta servicios
--  en USD. Igual que el hotel: UN servicio = UNA moneda. Su tarifa neta, recargo
--  individual y rangos por grupo quedan en esa moneda.
--
--  El snapshot del tarifario (tarifario_resultado.moneda, migr. 093) ya existe;
--  generarTarifario ahora copia la moneda del servicio a cada fila publicada.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.servicios_adicionales
  add column if not exists moneda text not null default 'COP';
