-- Migración 306 (#14-A): clave de ENVÍO de la cotización del carrito — protección contra el envío concurrente/duplicado (dos pestañas, reintento tras una respuesta perdida).
-- El formulario manda una clave (UUID) por INTENCIÓN de envío. El servidor la guarda JUNTO CON quién la usó (`actor_envio`: id del usuario, o «anon» sin sesión) y la HUELLA del contenido
-- (`huella_envio`: SHA-256 del contenido canónico enviado, calculada por el servidor, nunca por el navegador). Un índice ÚNICO impide una segunda cotización con la misma clave.
-- La segunda solicitud con la misma clave solo se trata como «ya generada» si el usuario Y el contenido coinciden (misma intención, otra pestaña o reintento); si no coinciden (otro usuario u
-- otro contenido) se RECHAZA sin revelar nada de la cotización existente y sin crear otra: dos compras distintas nunca se confunden.
-- Aditiva e idempotente; no toca datos ni políticas. Las cotizaciones sin clave (histórico, otros flujos) no se ven afectadas (índice parcial). Rollback: supabase/scripts/rollback_306_cotizacion_clave_envio.sql
-- Orden: preflight_306 → esta migración → postcheck_306 → despliegue del código. Sin dependencias de la 303/304/305.
alter table public.cotizaciones add column if not exists clave_envio uuid;
alter table public.cotizaciones add column if not exists huella_envio text;
alter table public.cotizaciones add column if not exists actor_envio text;
alter table public.cotizaciones drop constraint if exists cotizaciones_clave_envio_completa_chk;
alter table public.cotizaciones add constraint cotizaciones_clave_envio_completa_chk check (
  clave_envio is null or (huella_envio is not null and char_length(huella_envio) = 64 and actor_envio is not null and char_length(actor_envio) between 1 and 64));
create unique index if not exists uq_cotizaciones_clave_envio on public.cotizaciones (clave_envio) where clave_envio is not null;
comment on column public.cotizaciones.clave_envio is 'Clave de envío del formulario del carrito (#14-A): una por intención de envío; única cuando existe.';
comment on column public.cotizaciones.huella_envio is 'SHA-256 (hex) del contenido canónico del envío que usó la clave: la clave solo se reconoce como «misma intención» si el contenido coincide.';
comment on column public.cotizaciones.actor_envio is 'Quién usó la clave: id del usuario autenticado o «anon». La clave solo se reconoce para el mismo actor.';
