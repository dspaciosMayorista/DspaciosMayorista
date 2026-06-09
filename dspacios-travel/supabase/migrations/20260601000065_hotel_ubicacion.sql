-- 065 · Ubicación del hotel (para mostrar el mapa en el tarifario)
--
-- Texto libre: dirección o coordenadas "lat,lng". Se embebe un mapa de Google
-- gratis (iframe output=embed, sin API key) en la vista Booking.

alter table public.hoteles
  add column if not exists ubicacion text;
