-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 210 · RETIRADA de la reentrada segura (#44 / K15)
--
-- NO es un rollback "limpio": reabre K15. Restaura TAL CUAL las definiciones de
-- la 172 de `registrar_financiero_contrato` (vuelve a reemplazar las CxP de un
-- contrato ya completo) y `revertir_contrato_incompleto` (vuelve a devolver void
-- y a borrar sin mirar si la RPC ya completó el contrato), y retira la guarda del
-- payload pendiente.
--
-- SE CONSERVA (inocuo, y retirarlo destruiría datos o fallaría con duplicados):
--   · ventas.financiero_registrado_en y sus valores;
--   · el índice único asientos_contables_cxp_referencia_uk.
-- NO repara ningún dato: ni CxP/asientos que la 172 reabierta vuelva a tocar, ni
-- filas pendientes que se vuelvan a crear. Ver el plan de contención del informe.
--
-- Uso: psql -1 -v ON_ERROR_STOP=1 -f rollback_210_financiero_contrato_reentrada.sql
-- (sin BEGIN/COMMIT propios: las pruebas lo aplican dentro de su transacción).
-- ───────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'financiero_registrado_en') then
    raise exception 'rollback 210: la 210 no está aplicada en esta base.';
  end if;
end $$;

drop trigger if exists trg_contrato_financiero_pendiente_guarda on public.contrato_financiero_pendiente;
drop function if exists public.contrato_financiero_pendiente_guarda();

-- registrar_financiero_contrato: definición de la migración 172 (sin cambios).
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

  -- Migración 172: el estado financiero solo puede llegar a 'completo' EN
  -- LA MISMA transacción donde ya quedaron escritos los costos y CADA CxP —
  -- nunca antes, nunca por separado. El payload pendiente (si existía, de un
  -- intento anterior o del intento actual persistido antes de esta llamada)
  -- se borra: ya cumplió su propósito.
  update public.ventas set financiero_estado = 'completo', financiero_actualizado_en = now()
   where numero_contrato = p_numero_contrato;
  delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;

  return jsonb_build_object('creadas', v_ids, 'eliminadas', v_eliminadas);
end;
$$;

comment on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) is
  'Escribe EN UNA TRANSACCIÓN los costos, las cuentas por pagar y marca financiero_estado=completo de un contrato (migración 172) — o queda todo o no queda nada, y "completo" nunca aparece sin costo/CxP detrás. Idempotente. Solo service_role.';

revoke all on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) to service_role;

-- revertir_contrato_incompleto: vuelve a void (definición de la 172).
drop function public.revertir_contrato_incompleto(text, text);
create function public.revertir_contrato_incompleto(
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
    return; -- ya no existe: nada que revertir (reintento del propio rollback)
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

  -- BUG C corregido: mismo reset completo que eliminar_contrato (166) y
  -- _ajustar_sillas_nucleo (167) — antes esta función dejaba asesor/hotel/
  -- acomodacion residuales en una silla ya "disponible".
  update public.sillas
     set estado = 'disponible', numero_contrato = null, plazo = null,
         pasajero_nombres = null, pasajero_apellidos = null,
         tipo_doc = null, numero_doc = null, nacimiento = null,
         asesor = null, hotel = null, acomodacion = null
   where numero_contrato = p_numero_contrato;

  -- BUG B corregido: aliados_b2b no tiene ON DELETE CASCADE (referencia
  -- RESTRICT por defecto) — sin este delete, el `delete from ventas` de
  -- abajo fallaba con foreign_key_violation para cualquier contrato B2B
  -- (la comisión se inserta ANTES del paso financiero). Se agregan también
  -- facturacion/rentabilidad/liquidacion_comisiones por el mismo motivo
  -- estructural que eliminar_contrato (166) las borra explícito, aunque en
  -- un contrato recién creado e incompleto normalmente estén vacías (nacen
  -- de procesos posteriores a la confirmación, que este mecanismo bloquea).
  delete from public.facturacion            where numero_contrato = p_numero_contrato;
  delete from public.rentabilidad           where numero_contrato = p_numero_contrato;
  delete from public.liquidacion_comisiones where numero_contrato = p_numero_contrato;
  delete from public.aliados_b2b            where numero_contrato = p_numero_contrato;
  delete from public.cuentas_por_pagar      where numero_contrato = p_numero_contrato;
  delete from public.contrato_items         where numero_contrato = p_numero_contrato;
  delete from public.contrato_hoteles       where numero_contrato = p_numero_contrato;
  delete from public.contrato_vuelos        where numero_contrato = p_numero_contrato;
  delete from public.contrato_servicios     where numero_contrato = p_numero_contrato;
  delete from public.contrato_pasajeros     where numero_contrato = p_numero_contrato and responsable_id is not null;
  delete from public.contrato_pasajeros     where numero_contrato = p_numero_contrato;

  -- Migración 172: el payload pendiente ya no tiene contrato que describir.
  delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;

  -- BUG A corregido: `contrato_condiciones` (migración 164) es INMUTABLE —
  -- su trigger bloquea CUALQUIER delete, incluido el que llega por cascada
  -- desde `ventas` (on delete cascade, migración 164), salvo que la
  -- transacción traiga encendido `app.eliminando_contrato` (el mismo
  -- bypass, mismo nombre de flag, que ya usa `eliminar_contrato`, migración
  -- 166 — ningún cambio al trigger, reutiliza el escape existente). Sin
  -- esto, revertir un contrato con condiciones YA congeladas (el caso
  -- normal: `congelarCondicionesContratoBestEffort` corre en el paso 6bis,
  -- ANTES del financiero) fallaba con "contrato_condiciones es
  -- permanente..." y dejaba el contrato vivo — reproducido empíricamente.
  -- Ventana del bypass: exactamente esta única sentencia (mismo criterio
  -- que 166), no el resto de la función.
  set local app.eliminando_contrato = 'true';
  delete from public.ventas where numero_contrato = p_numero_contrato;
  set local app.eliminando_contrato = 'false';
end;
$$;

comment on function public.revertir_contrato_incompleto(text, text) is
  'Deshace un contrato recién creado cuya escritura financiera falló, sin dejar huérfanos en sillas/pasajeros/hoteles/vuelos/condiciones/ítems/aliados_b2b (migración 172 corrige tres bugs reproducidos empíricamente: bypass de inmutabilidad de contrato_condiciones, borrado de aliados_b2b antes de ventas, reset completo de sillas). Se niega a borrar si ya hay abonos, pagos o retenciones. Solo service_role.';

revoke all on function public.revertir_contrato_incompleto(text, text) from public, anon, authenticated;
grant execute on function public.revertir_contrato_incompleto(text, text) to service_role;

-- Verificación: ACL solo service_role y tipo de retorno de la 172.
do $$
declare p regprocedure;
begin
  foreach p in array array['public.registrar_financiero_contrato(text,text,jsonb,jsonb)'::regprocedure, 'public.revertir_contrato_incompleto(text,text)'::regprocedure] loop
    if has_function_privilege('anon', p, 'execute') or has_function_privilege('authenticated', p, 'execute') or not has_function_privilege('service_role', p, 'execute') then
      raise exception 'rollback 210: ACL inesperado en %', p;
    end if;
  end loop;
  if (select format_type(prorettype, null) from pg_proc where oid = 'public.revertir_contrato_incompleto(text,text)'::regprocedure) <> 'void' then
    raise exception 'rollback 210: revertir_contrato_incompleto no volvió a void';
  end if;
end $$;
