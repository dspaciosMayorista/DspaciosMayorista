-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 172.
--
-- ⚠️ El código de `reservarDesdeTarifarioInterno`/`convertirCotizacionCarrito`
-- ESTAMPA `financiero_estado: 'pendiente'` al insertar `ventas` y llama a
-- `guardarPendienteFinanciero` (que escribe en `contrato_financiero_
-- pendiente`) ANTES de intentar `registrar_financiero_contrato`. Revertir
-- este archivo sin volver el código a la versión anterior deja esos dos
-- flujos fallando al crear cualquier contrato (columna/tabla inexistentes) —
-- fallan CERRADO (error, sin contrato creado), no en silencio, pero de
-- todas formas hay que revertir el código junto con esto, no por separado.
--
-- Revierte:
--   · `registrar_financiero_contrato`/`revertir_contrato_incompleto` a su
--     versión de la migración 171 (sin el estado durable, sin los bugs A/B/C
--     corregidos — quedan EXACTAMENTE como los dejó la 171);
--   · borra `contrato_financiero_pendiente` (con su contenido — son intentos
--     en curso, no historial que deba preservarse);
--   · borra las columnas `financiero_estado`/`financiero_actualizado_en` de
--     `ventas` (ningún otro código las lee si este archivo se revierte junto
--     con el TypeScript).
--
--   psql -d <base> -v ON_ERROR_STOP=1 -f rollback_172_financiero_pendiente_durable.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

drop table if exists public.contrato_financiero_pendiente;

alter table public.ventas drop constraint if exists ventas_financiero_estado_check;
drop index if exists public.ventas_financiero_pendiente_idx;
alter table public.ventas drop column if exists financiero_estado;
alter table public.ventas drop column if exists financiero_actualizado_en;

-- Restaura registrar_financiero_contrato/revertir_contrato_incompleto a su
-- versión EXACTA de la migración 171 (byte a byte del archivo original).
create or replace function public.registrar_financiero_contrato(
  p_numero_contrato text,
  p_tenant          text,
  p_costos          jsonb,
  p_cxp             jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existe    boolean;
  v_item      jsonb;
  v_ids       jsonb := '[]'::jsonb;
  v_eliminadas jsonb := '[]'::jsonb;
  v_id         bigint;
  v_valor      numeric;
begin
  if p_numero_contrato is null or btrim(p_numero_contrato) = '' then
    raise exception 'registrar_financiero_contrato: numero_contrato vacío';
  end if;
  if p_tenant is null or btrim(p_tenant) = '' then
    raise exception 'registrar_financiero_contrato: tenant vacío';
  end if;

  select true into v_existe
  from public.ventas
  where numero_contrato = p_numero_contrato and tenant = p_tenant
  for update;
  if not coalesce(v_existe, false) then
    raise exception 'registrar_financiero_contrato: el contrato % no existe en la agencia %', p_numero_contrato, p_tenant;
  end if;

  if p_cxp is not null and jsonb_typeof(p_cxp) <> 'array' then
    raise exception 'registrar_financiero_contrato: p_cxp debe ser un arreglo';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_cxp, '[]'::jsonb)) loop
    if coalesce(btrim(v_item->>'tipo_proveedor'), '') = '' then
      raise exception 'registrar_financiero_contrato: una CxP no declara tipo_proveedor';
    end if;
    begin
      v_valor := (v_item->>'valor_total')::numeric;
    exception when others then
      raise exception 'registrar_financiero_contrato: valor_total no numérico en la CxP "%"', coalesce(v_item->>'servicio', '(sin nombre)');
    end;
    if v_valor is null or v_valor < 0 then
      raise exception 'registrar_financiero_contrato: valor_total inválido (%) en la CxP "%"', v_valor, coalesce(v_item->>'servicio', '(sin nombre)');
    end if;
  end loop;

  with borradas as (
    delete from public.cuentas_por_pagar c
    where c.numero_contrato = p_numero_contrato
      and c.observaciones like public.marca_cxp_automatica() || '%'
      and not exists (select 1 from public.cxp_pagos p where p.cuenta_por_pagar_id = c.id)
      and not exists (select 1 from public.retenciones_cxp r where r.cuenta_por_pagar_id = c.id)
    returning c.id
  )
  select coalesce(jsonb_agg(borradas.id), '[]'::jsonb) into v_eliminadas from borradas;

  update public.ventas v set
    costo_hotel      = coalesce((p_costos->>'costo_hotel')::numeric,      v.costo_hotel),
    costo_aereo      = coalesce((p_costos->>'costo_aereo')::numeric,      v.costo_aereo),
    costo_receptivo  = coalesce((p_costos->>'costo_receptivo')::numeric,  v.costo_receptivo),
    costo_asistencia = coalesce((p_costos->>'costo_asistencia')::numeric, v.costo_asistencia),
    otros_costos     = coalesce((p_costos->>'otros_costos')::numeric,     v.otros_costos)
  where v.numero_contrato = p_numero_contrato;

  for v_item in select * from jsonb_array_elements(coalesce(p_cxp, '[]'::jsonb)) loop
    insert into public.cuentas_por_pagar (
      numero_contrato, tenant, proveedor, tipo_proveedor, servicio, servicio_id,
      valor_total, moneda, fecha_obligacion, fecha_vencimiento,
      aplica_retencion, pct_retencion, observaciones
    ) values (
      p_numero_contrato,
      p_tenant,
      nullif(btrim(coalesce(v_item->>'proveedor', '')), ''),
      v_item->>'tipo_proveedor',
      nullif(btrim(coalesce(v_item->>'servicio', '')), ''),
      nullif(v_item->>'servicio_id', '')::bigint,
      (v_item->>'valor_total')::numeric,
      coalesce(nullif(v_item->>'moneda', ''), 'COP'),
      nullif(v_item->>'fecha_obligacion', '')::date,
      nullif(v_item->>'fecha_vencimiento', '')::date,
      coalesce((v_item->>'aplica_retencion')::boolean, false),
      coalesce((v_item->>'pct_retencion')::numeric, 0),
      coalesce(nullif(v_item->>'observaciones', ''), public.marca_cxp_automatica())
    )
    returning id into v_id;

    v_ids := v_ids || jsonb_build_object(
      'id', v_id,
      'tipo_proveedor', v_item->>'tipo_proveedor',
      'proveedor', v_item->>'proveedor',
      'servicio', v_item->>'servicio',
      'servicio_id', v_item->>'servicio_id',
      'valor_total', (v_item->>'valor_total')::numeric
    );
  end loop;

  return jsonb_build_object('creadas', v_ids, 'eliminadas', v_eliminadas);
end;
$$;

create or replace function public.revertir_contrato_incompleto(
  p_numero_contrato text,
  p_tenant          text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existe boolean;
begin
  select true into v_existe
  from public.ventas
  where numero_contrato = p_numero_contrato and tenant = p_tenant
  for update;
  if not coalesce(v_existe, false) then
    return;
  end if;

  if exists (select 1 from public.abonos a where a.numero_contrato = p_numero_contrato) then
    raise exception 'revertir_contrato_incompleto: el contrato % ya tiene abonos; no se revierte automáticamente', p_numero_contrato;
  end if;
  if exists (
    select 1 from public.cuentas_por_pagar c
    where c.numero_contrato = p_numero_contrato
      and (exists (select 1 from public.cxp_pagos p where p.cuenta_por_pagar_id = c.id)
        or exists (select 1 from public.retenciones_cxp r where r.cuenta_por_pagar_id = c.id))
  ) then
    raise exception 'revertir_contrato_incompleto: el contrato % ya tiene pagos/retenciones a proveedor; no se revierte automáticamente', p_numero_contrato;
  end if;

  update public.sillas
     set estado = 'disponible', numero_contrato = null, plazo = null,
         pasajero_nombres = null, pasajero_apellidos = null,
         tipo_doc = null, numero_doc = null, nacimiento = null
   where numero_contrato = p_numero_contrato;

  delete from public.cuentas_por_pagar where numero_contrato = p_numero_contrato;
  delete from public.contrato_items     where numero_contrato = p_numero_contrato;
  delete from public.contrato_hoteles   where numero_contrato = p_numero_contrato;
  delete from public.contrato_vuelos    where numero_contrato = p_numero_contrato;
  delete from public.contrato_servicios where numero_contrato = p_numero_contrato;
  delete from public.contrato_pasajeros where numero_contrato = p_numero_contrato and responsable_id is not null;
  delete from public.contrato_pasajeros where numero_contrato = p_numero_contrato;
  delete from public.ventas             where numero_contrato = p_numero_contrato;
end;
$$;

revoke all on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) to service_role;
revoke all on function public.revertir_contrato_incompleto(text, text) from public, anon, authenticated;
grant execute on function public.revertir_contrato_incompleto(text, text) to service_role;

commit;

\echo '=== Verificación: las columnas/tabla nuevas ya no existen ==='
select
  not exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='financiero_estado') as financiero_estado_borrada,
  not exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='financiero_actualizado_en') as financiero_actualizado_en_borrada,
  to_regclass('public.contrato_financiero_pendiente') is null as tabla_pendiente_borrada;
\echo 'esperado: t | t | t'
