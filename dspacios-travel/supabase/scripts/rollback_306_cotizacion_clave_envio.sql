-- Rollback de la migración 306: quita el índice único, la restricción y las tres columnas de la clave de envío. Perderías la protección contra el envío duplicado; las cotizaciones ya creadas no cambian.
-- Despliega ANTES el código que no la usa (o el envío fallaría por columna inexistente).
begin;
drop index if exists public.uq_cotizaciones_clave_envio;
alter table public.cotizaciones drop constraint if exists cotizaciones_clave_envio_completa_chk;
alter table public.cotizaciones drop column if exists clave_envio, drop column if exists huella_envio, drop column if exists actor_envio;
commit;
