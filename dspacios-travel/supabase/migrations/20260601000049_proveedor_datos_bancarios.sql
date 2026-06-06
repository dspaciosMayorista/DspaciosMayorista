-- 049 · Datos bancarios del proveedor separados
-- Reemplaza el texto libre 'datos_pago' por campos estructurados: banco, tipo de
-- cuenta y número de cuenta. Se conserva 'datos_pago' (no se elimina) para no
-- perder lo ya cargado; la UI usa los nuevos campos y muestra el viejo como
-- respaldo si los nuevos están vacíos. Idempotente.

alter table public.proveedores
  add column if not exists banco          text,
  add column if not exists tipo_cuenta    text,
  add column if not exists numero_cuenta  text;
