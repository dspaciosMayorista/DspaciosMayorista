-- 139 · Programas: tercer tipo de traslado — "Salida terrestre" (bus)
--
-- Hasta ahora `incluye_aereo` (boolean) solo distinguía 2 casos: "Porción
-- terrestre" (sin ningún traslado origen→destino, el cliente llega por su
-- cuenta: solo hospedaje/asistencia/tours en destino) vs "Con aéreo" (vuelo
-- incluido). Faltaba un tercer caso real: programas con traslado en BUS desde
-- el punto de origen al destino (ej. destinos a un par de horas) — sí tienen
-- traslado incluido, pero no es aéreo.
--
-- `tipo_transporte`: 'ninguno' | 'aereo' | 'terrestre'. Se mantiene
-- `incluye_aereo` sin borrar (convención del proyecto) y sincronizado desde
-- el código por compatibilidad, pero deja de ser la fuente de verdad.

alter table public.programas
  add column if not exists tipo_transporte text not null default 'ninguno';

update public.programas
  set tipo_transporte = 'aereo'
  where incluye_aereo = true and tipo_transporte = 'ninguno';
