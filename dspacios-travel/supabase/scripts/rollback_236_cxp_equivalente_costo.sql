-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la 236 (equivalente en COP de las CxP en USD del carrito). Restaura el texto EXACTO de registrar_financiero_contrato de la 227,
-- elimina el trigger de inmutabilidad, el CHECK y las columnas valor_cop_costo / trm_costo.
-- SE NIEGA si ya hay CxP con equivalente de costos: sin las columnas, su asiento de devengo (por el equivalente en COP) quedaría sin respaldo y la
-- CxP volvería a leerse por su valor nominal en dólares. Hay que decidir antes qué hacer con ellas (anular los contratos o devengar de otra forma).
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cuentas_por_pagar' and column_name = 'valor_cop_costo') then
    raise exception 'ROLLBACK 236 ABORTADO: la 236 no está aplicada (no existe cuentas_por_pagar.valor_cop_costo).';
  end if;
  if exists (select 1 from public.cuentas_por_pagar where valor_cop_costo is not null or trm_costo is not null) then
    raise exception 'ROLLBACK 236 ABORTADO: hay cuentas por pagar con equivalente en COP a la TRM de costos (% filas); su devengo depende de esas columnas.',
      (select count(*) from public.cuentas_por_pagar where valor_cop_costo is not null or trm_costo is not null);
  end if;
end $$;

drop trigger if exists trg_cxp_costo_inmutable on public.cuentas_por_pagar;
drop function if exists public.trg_cxp_costo_inmutable();
alter table public.cuentas_por_pagar drop constraint if exists cuentas_por_pagar_cop_costo_chk;
alter table public.cuentas_por_pagar drop column if exists valor_cop_costo, drop column if exists trm_costo;

-- Texto EXACTO de la 227 (la vigente antes de la 236).
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
  v_estado     text;
  v_item       jsonb;
  v_ids        jsonb := '[]'::jsonb;
  v_eliminadas jsonb := '[]'::jsonb;
  v_id         bigint;
  v_valor      numeric;
  v_acep       bigint;
begin
  if p_numero_contrato is null or btrim(p_numero_contrato) = '' then
    raise exception 'registrar_financiero_contrato: numero_contrato vacío';
  end if;
  if p_tenant is null or btrim(p_tenant) = '' then
    raise exception 'registrar_financiero_contrato: tenant vacío';
  end if;

  select v.financiero_estado into v_estado
  from public.ventas v
  where v.numero_contrato = p_numero_contrato and v.tenant = p_tenant
  for update;
  if not found then
    raise exception 'registrar_financiero_contrato: el contrato % no existe en la agencia %', p_numero_contrato, p_tenant;
  end if;

  -- K15: la escritura financiera se hace UNA vez. Un contrato que ya no está
  -- pendiente (otra sesión lo completó mientras esta esperaba el candado, un
  -- reintento tras una respuesta perdida, o nunca fue pendiente) NO se toca:
  -- ni se borran sus CxP, ni se tocan los costos, ni se devuelven ids para que
  -- la app mueva asientos. Se limpia, eso sí, un payload residual.
  if v_estado is distinct from 'pendiente' then
    delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;
    return jsonb_build_object('creadas', '[]'::jsonb, 'eliminadas', '[]'::jsonb, 'ya_completo', true, 'estado', v_estado);
  end if;

  -- 227 (#63): un contrato ligado a una aceptación de oferta COP con TRM NO usa el payload del llamador: se deriva de lo
  -- aceptado y se rechaza todo lo demás (llamadas directas incluidas). Un contrato sin aceptación sigue EXACTAMENTE la 210.
  select v.aceptacion_63_id into v_acep from public.ventas v where v.numero_contrato = p_numero_contrato;
  if v_acep is not null then
    return public.p63_registrar_financiero(p_numero_contrato, p_tenant, p_costos, p_cxp, v_acep);
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

  -- (Contrato pendiente: normalmente sin CxP; si quedaron CxP automáticas de un
  -- intento anterior sin pagos ni retenciones, se reemplazan como en la 172.)
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

  -- 'completo' nace en la MISMA transacción que escribe costos y CxP, y deja la
  -- marca durable que impide a la compensación borrar este contrato (210).
  update public.ventas
     set financiero_estado = 'completo', financiero_actualizado_en = now(), financiero_registrado_en = now()
   where numero_contrato = p_numero_contrato;
  delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;

  return jsonb_build_object('creadas', v_ids, 'eliminadas', v_eliminadas);
end;
$$;

comment on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) is
  '227 (sobre 210): escribe costos + CxP + estado completo EN UNA TRANSACCIÓN, solo sobre un contrato en financiero_estado=pendiente; en otro estado es un no-op {ya_completo:true}. Un contrato de oferta COP con TRM (aceptacion_63_id) deriva todo de lo aceptado y rechaza payload alterno. Solo service_role.';

revoke all on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) to service_role;

commit;
