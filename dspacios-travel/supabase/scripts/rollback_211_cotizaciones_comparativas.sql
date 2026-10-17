-- ═════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 211 cotizaciones comparativas (#35).
-- Solo si NO existe ninguna comparativa ni cotización elegida: las comparativas
-- y sus eventos son inmutables a propósito. Si ya hay una, aborta sin cambiar
-- nada (conservar el historial pesa más que revertir); en ese caso el rollback
-- es una decisión humana y manual, no de este script.
-- NO toca el RPC 198, ni la 206, ni la 208.
-- ═════════════════════════════════════════════════════════════════════════
begin;
do $$
begin
  if exists (select 1 from public.cotizaciones where modo = 'comparativa' or cotizacion_origen_id is not null) then
    raise exception 'ROLLBACK 211 ABORTADO: ya existen comparativas o cotizaciones elegidas. Hay historial inmutable; decide con el dueño. No se cambió nada.';
  end if;
end $$;

drop trigger if exists trg_madre_sin_pagos on public.cotizacion_pagos_previos;
drop trigger if exists trg_madre_sin_condiciones on public.cotizacion_condiciones;
drop trigger if exists trg_madre_sin_venta on public.ventas;
drop trigger if exists trg_cot_servicios_comparativa_guarda on public.cotizacion_servicios;
drop trigger if exists trg_cotizaciones_hija_descartada on public.cotizaciones;
drop trigger if exists trg_cotizaciones_comparativa_guarda on public.cotizaciones;

drop function if exists public.comparativas_b2b_visibles();
drop function if exists public.resolver_solicitud_comparativa(bigint, text, text, text);
drop function if exists public.registrar_solicitud_comparativa(bigint, text, text, integer, text, text, text, text, text, text);
drop function if exists public.elegir_opcion_comparativa_publica(uuid, text);
drop function if exists public.elegir_opcion_comparativa_sesion(uuid, text);
drop function if exists public.registrar_validacion_comparativa(bigint, text, text, integer, text, uuid, numeric, text, boolean, jsonb);
drop function if exists public.crear_cotizacion_comparativa(uuid, jsonb, jsonb, jsonb, bigint);

drop table if exists public.cotizacion_comparativa_validaciones;
drop table if exists public.cotizacion_comparativa_solicitudes;
drop table if exists public.cotizacion_comparativa_eventos;
drop table if exists public.cotizacion_opciones;

drop schema if exists f211_priv cascade;

alter table public.cotizacion_servicios drop constraint if exists cotizacion_servicios_opcion_solo_hotel;
alter table public.cotizacion_servicios drop column if exists opcion_ref;
drop index if exists public.uq_cotizaciones_hija_activa;
drop index if exists public.idx_cotizaciones_aliado;
drop index if exists public.idx_cotizaciones_modo;
alter table public.cotizaciones drop constraint if exists cotizaciones_hija_forma;
alter table public.cotizaciones drop constraint if exists cotizaciones_comparativa_forma;
alter table public.cotizaciones drop constraint if exists cotizaciones_modo_check;
alter table public.cotizaciones
  drop column if exists vigencia_tope, drop column if exists madre_sello, drop column if exists madre_version,
  drop column if exists acomodacion_ref, drop column if exists opcion_ref, drop column if exists cotizacion_origen_id,
  drop column if exists creado_por_id, drop column if exists propietario_id, drop column if exists aliado_id,
  drop column if exists sello_economico, drop column if exists version, drop column if exists modo;
drop index if exists public.uq_cotizaciones_id_tenant;
commit;
