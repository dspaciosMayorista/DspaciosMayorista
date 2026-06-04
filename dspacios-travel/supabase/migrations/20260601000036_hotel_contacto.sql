-- Migración 036: contacto comercial del HOTEL (no del proveedor)
--
-- Un proveedor (p. ej. una cadena) puede tener varios hoteles; el contacto de
-- reservas es de CADA hotel. Estos datos alimentan el futuro envío de correos de
-- solicitud de reserva desde la app.

alter table public.hoteles
  add column if not exists contacto_telefono text,
  add column if not exists email_comercial   text;
