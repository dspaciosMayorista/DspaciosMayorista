-- Esquema MÍNIMO para probar la 314 en una base desechable (postgres:17 plano). No es el esquema real: solo lo que usa public.crear_cotizacion_comparativa.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists f211_priv;
create table public.usuarios (id uuid primary key, rol text not null, activo boolean not null default true, tenant text not null default 'mayorista');
create table public.aliados (id bigint primary key, nombre text not null, tipo text);
create table public.cotizaciones (
  id bigserial primary key, tenant text, tipo text, modo text, estado text, payload jsonb, detalle jsonb, cliente text, cliente_documento text,
  destino text, hotel text, modulo text, plan_nombre text, pax int, precio_venta numeric, moneda text, fecha_salida date, fecha_regreso date,
  vigencia_hasta date, asesor text, creado_por text, aliado_id bigint, propietario_id uuid, creado_por_id uuid, sello_economico text);
create table public.cotizacion_servicios (cotizacion_id bigint, orden int, tipo_servicio text, plataforma text, nombre_servicio text, proveedor text,
  costo_neto numeric, modo text, pct_markup numeric, ta numeric, valor numeric, opcion_ref text);
create table public.cotizacion_opciones (cotizacion_id bigint, tenant text, opcion_ref text, acomodacion_ref text, orden int, etiqueta text, moneda text,
  tarifa_persona numeric, total numeric, resumen_publico jsonb, plantilla_hija jsonb);
create table public.cotizacion_comparativa_eventos (cotizacion_id bigint, tenant text, tipo text, actor_tipo text, actor_id uuid, version int, detalle jsonb);
create function f211_priv.sello_madre(p_id bigint) returns text language sql as $$ select 'sello'::text $$;
create function public.fecha_negocio() returns date language sql as $$ select current_date $$;

insert into public.usuarios values ('00000000-0000-0000-0000-000000000001', 'venta', true, 'mayorista');
insert into public.aliados values (7, 'Viajes Sol SAS', 'agencia'), (8, 'Laura Gómez', 'freelance');
-- Histórico PREEXISTENTE: una comparativa B2B sin aliado, creada antes de la 314. Debe seguir ahí, intacta.
insert into public.cotizaciones (tenant, tipo, modo, estado, payload, moneda, aliado_id) values
  ('mayorista', 'comparativa_manual', 'comparativa', 'abierta', '{"tipoAsesor":"agencia"}', 'COP', null),
  ('mayorista', 'comparativa_manual', 'comparativa', 'abierta', '{"tipoAsesor":"interno"}', 'COP', null);
