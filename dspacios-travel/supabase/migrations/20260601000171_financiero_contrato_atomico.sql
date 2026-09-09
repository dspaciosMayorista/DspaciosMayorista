-- ───────────────────────────────────────────────────────────────────────────
-- 171 · ESCRITURA FINANCIERA ATÓMICA del contrato (costos + cuentas por pagar)
--
-- Problema real que resuelve (revisión del PR #294, punto B7):
-- los flujos de creación (`reservarDesdeTarifarioInterno`,
-- `convertirCotizacionCarrito`) insertaban el contrato y DESPUÉS escribían,
-- en varias llamadas sueltas envueltas en `try/catch`, el costo y las cuentas
-- por pagar. Si una de esas escrituras fallaba, la operación devolvía ÉXITO
-- con el contrato creado y el costo/CxP faltantes: un contrato que se ve
-- normal pero cuya obligación con el proveedor no existe. `try/catch` +
-- logging no es una garantía; una transacción sí.
--
-- Este archivo agrega DOS funciones:
--
--   1) `registrar_financiero_contrato(...)` — UNA transacción que escribe
--      TODO lo financiero del contrato: las columnas de costo de `ventas` y
--      todas las filas de `cuentas_por_pagar`. O queda todo, o no queda nada.
--      Es IDEMPOTENTE: reejecutarla para el mismo contrato reemplaza las CxP
--      automáticas que ella misma creó (nunca las manuales, nunca las que ya
--      tienen pagos o retenciones), así que un reintento no duplica.
--
--   2) `revertir_contrato_incompleto(...)` — deshace un contrato recién
--      creado cuando su escritura financiera falla, para que el error NO deje
--      un "contrato fantasma". Falla CERRADO: se niega a borrar un contrato
--      que ya tenga abonos, pagos o retenciones (ahí ya hubo dinero real y la
--      decisión es humana, no automática).
--
-- Ambas son SECURITY DEFINER y SOLO para `service_role`: las invoca el
-- servidor con el cliente admin dentro del flujo de creación, nunca el
-- navegador. `eliminar_contrato` (migración 117) NO sirve para esto: exige
-- rol superadmin, y quien reserva es un asesor.
--
-- `search_path` fijo con `pg_temp` al final — mismo criterio que el resto de
-- las funciones SECURITY DEFINER del proyecto.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- Marca de las CxP creadas automáticamente por la escritura financiera. Es la
-- que permite reemplazarlas en un reintento sin tocar las que cargó una
-- persona a mano.
create or replace function public.marca_cxp_automatica()
returns text language sql immutable as $$ select 'Generado automáticamente desde el tarifario'::text $$;

comment on function public.marca_cxp_automatica() is
  'Texto de `cuentas_por_pagar.observaciones` que identifica una CxP creada por la escritura financiera automática (migración 171). Solo esas filas se reemplazan en un reintento.';

-- ── 1) Escritura financiera atómica ───────────────────────────────────────
create or replace function public.registrar_financiero_contrato(
  p_numero_contrato text,
  p_tenant          text,
  p_costos          jsonb,   -- {costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos} (claves opcionales)
  p_cxp             jsonb    -- [{proveedor, tipo_proveedor, servicio, valor_total, moneda, fecha_obligacion, fecha_vencimiento, aplica_retencion, pct_retencion, observaciones, servicio_id}]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existe    boolean;
  v_item      jsonb;
  v_ids        jsonb := '[]'::jsonb;
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

  -- El contrato debe existir Y pertenecer al tenant declarado. Se bloquea la
  -- fila para que dos ejecuciones concurrentes de esta función sobre el mismo
  -- contrato se serialicen (la segunda ve el estado final de la primera y
  -- reemplaza de forma determinista, en vez de duplicar).
  select true into v_existe
  from public.ventas
  where numero_contrato = p_numero_contrato and tenant = p_tenant
  for update;
  if not coalesce(v_existe, false) then
    raise exception 'registrar_financiero_contrato: el contrato % no existe en la agencia %', p_numero_contrato, p_tenant;
  end if;

  -- Validación del payload ANTES de escribir nada: un valor no numérico o
  -- negativo aborta la transacción completa (nunca se inserta media lista).
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

  -- Idempotencia: se quitan las CxP AUTOMÁTICAS previas de este contrato que
  -- todavía no tienen dinero movido. Las manuales (otra observación) y las
  -- que ya tienen pagos o retenciones NUNCA se tocan.
  -- Se devuelven sus ids en `eliminadas` porque el asiento contable de cada
  -- CxP vive fuera de esta transacción (referencia `cxp:<id>`, ver
  -- lib/contabilidad/asientos.ts): quien reintenta tiene que borrar esos
  -- asientos, o el libro diario quedaría con el costo dos veces (el de la CxP
  -- reemplazada más el de la nueva).
  with borradas as (
    delete from public.cuentas_por_pagar c
    where c.numero_contrato = p_numero_contrato
      and c.observaciones like public.marca_cxp_automatica() || '%'
      and not exists (select 1 from public.cxp_pagos p where p.cuenta_por_pagar_id = c.id)
      and not exists (select 1 from public.retenciones_cxp r where r.cuenta_por_pagar_id = c.id)
    returning c.id
  )
  select coalesce(jsonb_agg(borradas.id), '[]'::jsonb) into v_eliminadas from borradas;

  -- Costos del contrato: solo las claves presentes en el payload.
  update public.ventas v set
    costo_hotel      = coalesce((p_costos->>'costo_hotel')::numeric,      v.costo_hotel),
    costo_aereo      = coalesce((p_costos->>'costo_aereo')::numeric,      v.costo_aereo),
    costo_receptivo  = coalesce((p_costos->>'costo_receptivo')::numeric,  v.costo_receptivo),
    costo_asistencia = coalesce((p_costos->>'costo_asistencia')::numeric, v.costo_asistencia),
    otros_costos     = coalesce((p_costos->>'otros_costos')::numeric,     v.otros_costos)
  where v.numero_contrato = p_numero_contrato;

  -- Cuentas por pagar.
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

comment on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) is
  'Escribe EN UNA TRANSACCIÓN los costos y las cuentas por pagar de un contrato. O queda todo o no queda nada — nunca un contrato con costo/CxP faltante reportado como éxito. Idempotente: un reintento reemplaza solo las CxP automáticas sin pagos ni retenciones. Solo service_role.';

revoke all on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) to service_role;

-- ── 2) Reversión de un contrato cuya escritura financiera falló ───────────
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
    return; -- ya no existe: nada que revertir (reintento del propio rollback)
  end if;

  -- Falla CERRADO: si ya hubo dinero real (un abono del cliente, un pago o
  -- una retención a un proveedor) NO se borra nada automáticamente — eso es
  -- una anulación comercial, con decisión humana.
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

  -- Libera las sillas que este contrato tenía tomadas (vuelven al inventario).
  update public.sillas
     set estado = 'disponible', numero_contrato = null, plazo = null,
         pasajero_nombres = null, pasajero_apellidos = null,
         tipo_doc = null, numero_doc = null, nacimiento = null
   where numero_contrato = p_numero_contrato;

  -- Hijas del contrato. `contrato_pasajeros` va de último por el vínculo
  -- responsable_id entre sus propias filas (FK RESTRICT, migración 167):
  -- borrar el infante antes que su responsable evita el conflicto.
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

comment on function public.revertir_contrato_incompleto(text, text) is
  'Deshace un contrato recién creado cuya escritura financiera falló, para que el error no deje un contrato fantasma sin costo ni CxP. Se niega a borrar si ya hay abonos, pagos o retenciones. Solo service_role.';

revoke all on function public.revertir_contrato_incompleto(text, text) from public, anon, authenticated;
grant execute on function public.revertir_contrato_incompleto(text, text) to service_role;

commit;
