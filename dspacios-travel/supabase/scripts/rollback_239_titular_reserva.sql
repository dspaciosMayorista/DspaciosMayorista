-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la 239 (titular de la reserva en ventas NETO asistidas).
--   · Restaura ventas_basica a la definición de la 235 (sin las cuatro columnas del titular) y elimina ventas.titular_*.
--   · SE NIEGA si hay contratos con titular guardado: al quitar las columnas se perdería quién era el titular de una venta NETO y quedaría solo el aliado.
--     Decide qué hacer con esos contratos (exportar el titular, por ejemplo) y vuelve a correr este script.
-- Si el código nuevo sigue desplegado, la conversión de una cotización NETO falla sin esas columnas: revierte primero el despliegue.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'titular_nombre') then
    raise exception 'ROLLBACK 239 ABORTADO: la 239 no está aplicada (no existe ventas.titular_nombre).';
  end if;
  if exists (select 1 from public.ventas where titular_nombre is not null or titular_documento is not null or titular_telefono is not null or titular_email is not null) then
    raise exception 'ROLLBACK 239 ABORTADO: hay % contrato(s) con titular de la reserva guardado; al quitar las columnas se perdería.',
      (select count(*) from public.ventas where titular_nombre is not null or titular_documento is not null or titular_telefono is not null or titular_email is not null);
  end if;
end;
$$;

-- La vista pierde columnas: CREATE OR REPLACE no puede quitarlas, así que se elimina y se recrea con la definición de la 235.
drop view public.ventas_basica;
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
    v.moneda_cobro, v.trm_cobro, v.total_cobro
  from public.ventas v
  where
    public.mi_rol() in ('superadmin','gerencia')
    or (public.mi_rol() in ('administracion','operaciones','venta')
        and public.puede_ver_tenant(v.tenant));
grant select on public.ventas_basica to authenticated;

alter table public.ventas drop column titular_nombre, drop column titular_documento, drop column titular_telefono, drop column titular_email;

commit;
