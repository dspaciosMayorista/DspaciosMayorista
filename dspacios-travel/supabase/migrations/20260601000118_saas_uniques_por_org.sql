-- ─────────────────────────────────────────────────────────────────────────
-- SaaS Fase 2 — UNIQUE globales → UNIQUE por organización.
--
-- SOLO rama `saas-whitelabel`. Varios catálogos tenían UNIQUE GLOBAL en su
-- nombre/código (de la época mono-tenant). En multi-tenant eso impide que dos
-- agencias tengan, p. ej., un destino "CARTAGENA" o una forma de pago "CONTADO".
-- Se convierten a UNIQUE POR ORG `(org_id, col)`.
--
-- SEGURO para los datos: pasar de único global a único por-org RELAJA la
-- restricción (todo lo que era único global sigue siendo único dentro de su org).
-- Idempotente: dropea el nombre viejo y el nuevo antes de recrear.
--
-- NO se tocan identidades globales por naturaleza: `usuarios.email` (auth).
-- ─────────────────────────────────────────────────────────────────────────

-- parametros_tributarios.parametro
alter table public.parametros_tributarios drop constraint if exists parametros_tributarios_parametro_key;
alter table public.parametros_tributarios drop constraint if exists parametros_tributarios_org_parametro_key;
alter table public.parametros_tributarios add constraint parametros_tributarios_org_parametro_key unique (org_id, parametro);

-- destinos.nombre
alter table public.destinos drop constraint if exists destinos_nombre_key;
alter table public.destinos drop constraint if exists destinos_org_nombre_key;
alter table public.destinos add constraint destinos_org_nombre_key unique (org_id, nombre);

-- planes_alimentacion.codigo
alter table public.planes_alimentacion drop constraint if exists planes_alimentacion_codigo_key;
alter table public.planes_alimentacion drop constraint if exists planes_alimentacion_org_codigo_key;
alter table public.planes_alimentacion add constraint planes_alimentacion_org_codigo_key unique (org_id, codigo);

-- categorias_habitacion.nombre
alter table public.categorias_habitacion drop constraint if exists categorias_habitacion_nombre_key;
alter table public.categorias_habitacion drop constraint if exists categorias_habitacion_org_nombre_key;
alter table public.categorias_habitacion add constraint categorias_habitacion_org_nombre_key unique (org_id, nombre);

-- formas_pago.nombre
alter table public.formas_pago drop constraint if exists formas_pago_nombre_key;
alter table public.formas_pago drop constraint if exists formas_pago_org_nombre_key;
alter table public.formas_pago add constraint formas_pago_org_nombre_key unique (org_id, nombre);
