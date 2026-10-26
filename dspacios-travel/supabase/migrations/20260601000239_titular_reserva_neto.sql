-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 239 · #102 (Preview #403) — Titular de la reserva en las ventas NETO asistidas
-- Preflight/postcheck/rollback: supabase/scripts/{preflight,postcheck,rollback}_239_titular_reserva.sql
--
-- Problema: en una venta B2B asistida en NETO el cliente comercial es el ALIADO (agencia o freelance) y la persona cuyos datos se capturan es el
-- «Titular de la reserva». `ventas` solo tenía `cliente*` (una sola identidad), así que o se guardaba la persona como cliente (como hasta ahora) o se
-- perdía al titular. Qué hace: agrega `ventas.titular_nombre/titular_documento/titular_telefono/titular_email` (nullable; solo los escribe la conversión
-- de una cotización NETO) y los expone en la vista `ventas_basica` (columnas AL FINAL; el resto de la definición es IDÉNTICO al de la 235, con el mismo
-- control de rol/agencia y el mismo enmascarado: el documento del titular sale `••••1234` para un asesor ajeno).
-- Contratos existentes: las cuatro columnas NULL, nada cambia. PVP con comisión y B2C no las usan.
--
-- Qué NO hace: no toca RLS, datos, la 238 ni su disparador. No hay backfill (no hay cómo saber a posteriori qué contratos NETO tenían otro titular).
-- Aditiva: se puede aplicar con el código viejo arriba. Orden: preflight → 239 → postcheck → recién después el código nuevo (el código nuevo escribe
-- estas columnas al convertir una cotización NETO; sin ellas esa conversión falla de forma explícita y B2C/PVP con comisión siguen igual).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.ventas') is null or to_regclass('public.ventas_basica') is null then
    raise exception 'MIGRACIÓN 239 ABORTADA: falta public.ventas o public.ventas_basica.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'total_cobro') then
    raise exception 'MIGRACIÓN 239 ABORTADA: falta la 235 (ventas.total_cobro); la vista se redefine sobre su versión.';
  end if;
end;
$$;

alter table public.ventas
  add column if not exists titular_nombre text,
  add column if not exists titular_documento text,
  add column if not exists titular_telefono text,
  add column if not exists titular_email text;

comment on column public.ventas.titular_nombre is '239: titular de la reserva cuando el cliente comercial del contrato es el aliado (venta NETO asistida, #102). NULL en el resto.';

-- ═══ La vista básica (rol venta) expone el titular ═════════════════════════
-- CREATE OR REPLACE con las columnas nuevas AL FINAL: el resto es IDÉNTICO a la 235.
create or replace view public.ventas_basica as
  select
    v.numero_contrato, v.fecha_venta, v.asesor, v.canal, v.tipo_cliente,
    v.cliente,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.cliente_documento
      when v.cliente_documento is null then null
      when length(v.cliente_documento) <= 4 then '••••'
      else '••••' || right(v.cliente_documento, 4)
    end as cliente_documento,
    v.cliente_telefono, v.cliente_email,
    v.destino, v.tipo_paquete, v.fecha_salida, v.fecha_regreso, v.fecha_emision,
    v.pax, v.hotel, v.aerolinea, v.receptivo, v.asistencia, v.otros_proveedores,
    v.precio_venta, v.moneda, v.estado, v.facturado, v.numero_documento,
    v.plan_nombre, v.tours_traslados, v.asistencia_medica, v.plazo,
    v.tipo_asesor, v.agencia_nombre, v.agencia_asesor, v.freelance_nombre, v.aliado_id,
    v.asesor_firma_nombre, v.asesor_firma_cargo, v.asesor_firma_tel,
    v.paquete_armado_id, v.bloqueo_ref_id, v.empaquetado_ref_id, v.tenant,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.cliente_direccion
      else null
    end as cliente_direccion,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.asesor_firma_cc
      else null
    end as asesor_firma_cc,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.share_token
      else null
    end as share_token,
    v.created_at, v.updated_at,
    -- 235: moneda y total de COBRO (datos comerciales como precio_venta, no financieros): el asesor ve cuánto cobrar y en qué moneda.
    v.moneda_cobro, v.trm_cobro, v.total_cobro,
    -- 239: titular de la reserva (NETO: el cliente es el aliado). Mismo enmascarado que el documento del cliente para un asesor ajeno.
    v.titular_nombre,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.titular_documento
      when v.titular_documento is null then null
      when length(v.titular_documento) <= 4 then '••••'
      else '••••' || right(v.titular_documento, 4)
    end as titular_documento,
    v.titular_telefono, v.titular_email
  from public.ventas v
  where
    public.mi_rol() in ('superadmin','gerencia')
    or (public.mi_rol() in ('administracion','operaciones','venta')
        and public.puede_ver_tenant(v.tenant));
grant select on public.ventas_basica to authenticated;

commit;
