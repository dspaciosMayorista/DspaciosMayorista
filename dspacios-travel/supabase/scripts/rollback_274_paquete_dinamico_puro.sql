-- Rollback de la 274 (#82). Borra SOLO lo que creó la 274. Si ya hay cotizaciones dinámicas,
-- cotizacion_versiones y paquete_din_id se pierden: exportarlas antes.
drop trigger if exists trg_din_venta_guarda on public.ventas;
drop trigger if exists trg_din_cotizacion_guarda on public.cotizaciones;
drop trigger if exists trg_din_servicios_guarda on public.cotizacion_servicios;
drop function if exists public.tg_din_venta_guarda();
drop function if exists public.tg_din_cotizacion_guarda();
drop function if exists public.tg_din_servicios_guarda();
drop function if exists public.convertir_cotizacion_din(bigint, uuid);
drop function if exists public.marcar_version_mostrada(uuid, bigint, integer);
drop function if exists public.registrar_costos_cotizacion_din(uuid, bigint, jsonb);
drop function if exists public.editar_cotizacion_din(uuid, bigint, integer, text, jsonb, jsonb);
drop function if exists public.crear_cotizacion_din(uuid, text, bigint, jsonb, jsonb);
drop function if exists public.din_lineas_sin_costo(bigint);
drop function if exists public.din_marcar_lineas(bigint, jsonb);
drop function if exists public.din_costos_pendientes(bigint);
drop table if exists public.cotizacion_versiones;
drop function if exists public.tg_cotizacion_versiones_inmutable();
alter table public.cotizaciones drop column if exists paquete_din_id;
alter table public.cotizacion_servicios drop column if exists componente;
alter table public.cotizacion_servicios drop column if exists exige_costo;
drop table if exists public.paquete_din_servicios;
drop table if exists public.paquete_din_hoteles;
drop table if exists public.paquete_din_vuelos;
drop table if exists public.paquete_din;
