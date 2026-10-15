-- ───────────────────────────────────────────────────────────────────────────
-- 210 · K15 — CIERRE MÍNIMO de la reentrada de la escritura financiera (#44)
--
-- Defecto (K15, reproducido sobre 171/172):
--   · `registrar_financiero_contrato` no mira el estado: llamada de nuevo sobre
--     un contrato YA completo, borra y recrea sus CxP automáticas (las que no
--     tienen pagos/retenciones) y devuelve sus ids como `eliminadas`; la app
--     borra entonces los asientos de esas CxP y postea los nuevos FUERA de la
--     transacción. Un fallo o una caída entre medias deja el asiento de una CxP
--     huérfano o ausente, y si la CxP ya tenía pagos, queda DUPLICADA.
--   · `revertir_contrato_incompleto` tampoco mira el estado: la compensación de
--     un proceso que perdió la respuesta (o que llegó tarde) borra un contrato
--     que OTRA sesión ya completó (el reconciliador, un reintento).
--   · `contrato_financiero_pendiente` se escribe ANTES de la RPC con `upsert`:
--     un segundo proceso que llega cuando el primero ya completó vuelve a crear
--     la fila, y nada la borra jamás (residuo permanente).
--
-- Cierre (todo en esta migración; las 171/172 NO se editan):
--   1. `registrar_financiero_contrato` solo actúa sobre un contrato en
--      `financiero_estado = 'pendiente'`. En cualquier otro estado es un NO-OP
--      que devuelve `{ya_completo: true}`, sin tocar CxP, costos ni asientos,
--      y limpia un payload residual. Al completar, marca `financiero_registrado_en`.
--   2. `revertir_contrato_incompleto` se niega a borrar un contrato que la RPC
--      ya registró (`financiero_registrado_en` no nulo): devuelve
--      `{estado: 'ya_completo'}`. Un contrato `completo` por DEFECTO (nunca pasó
--      por la RPC: el flujo manual de `main` lo revierte tal cual) conserva su
--      comportamiento. Devuelve jsonb (antes void) para que quien llama lo sepa.
--   3. `contrato_financiero_pendiente`: un INSERT (incluido el de un upsert) para
--      un contrato que ya no está pendiente se descarta en silencio, con el
--      contrato bloqueado en FOR SHARE para ordenar el cruce con la RPC. No hay
--      guarda en UPDATE: tomar el candado de la venta con la fila del pendiente
--      ya bloqueada invertiría el orden de bloqueo de la RPC (venta → pendiente).
--   4. Índice único parcial `asientos_contables (referencia) where origen = 'cxp'`:
--      dos posteos simultáneos del asiento de una misma CxP (el alta y la
--      reconciliación) no pueden duplicarlo; el segundo recibe 23505.
--
-- Permisos: ambas funciones siguen siendo solo `service_role` (se reafirma el
-- ACL: la revertir se recrea porque cambia su tipo de retorno).
--
-- FORWARD-ONLY: no es reversible sin reabrir K15. `rollback_210_*.sql` restaura
-- las definiciones 172 de las dos funciones y retira la guarda del pendiente,
-- conserva la columna y el índice (inocuos) y NO repara datos. Ver el plan de
-- contención y recuperación del informe de entrega.
--
-- No repara contratos históricos: ningún backfill. El preflight LISTA los
-- residuos (pendientes sobre contratos completos, asientos cxp duplicados).
-- Pruebas: supabase/scripts/test_210_financiero_contrato.sql y test_210_carrera.sh.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 0. Precondiciones ──────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.registrar_financiero_contrato(text,text,jsonb,jsonb)') is null
     or to_regprocedure('public.revertir_contrato_incompleto(text,text)') is null then
    raise exception '210: faltan las funciones de las migraciones 171/172.';
  end if;
  if to_regclass('public.contrato_financiero_pendiente') is null then
    raise exception '210: falta contrato_financiero_pendiente (migración 172).';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'financiero_registrado_en') then
    raise exception '210: ya aplicada (existe ventas.financiero_registrado_en). No se re-aplica.';
  end if;
  -- El índice único no se puede crear sobre duplicados: se falla CERRADO, sin reparar nada.
  -- (El preflight_210 los lista; resolverlos es una decisión de contabilidad, no de esta migración.)
  if exists (select 1 from public.asientos_contables where origen = 'cxp' group by referencia having count(*) > 1) then
    raise exception '210: hay asientos origen=cxp duplicados por referencia; resuélvelos antes (ver preflight_210, P3). No se aplicó nada.';
  end if;
end $$;

-- ── 1. Marca durable de "registrado por la RPC" ────────────────────────────
-- NULL = nunca pasó por `registrar_financiero_contrato` (contratos históricos, o
-- creados con financiero_estado='completo' por defecto). No se rellena a nadie.
alter table public.ventas add column financiero_registrado_en timestamptz;
comment on column public.ventas.financiero_registrado_en is
  '210: instante en que `registrar_financiero_contrato` completó la escritura financiera (costos + CxP). NULL = nunca pasó por la RPC. `revertir_contrato_incompleto` no borra un contrato con esta marca. Sin backfill.';

-- ── 2. registrar_financiero_contrato — solo sobre un contrato pendiente ────
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
  '210: escribe costos + CxP + estado completo EN UNA TRANSACCIÓN, solo sobre un contrato en financiero_estado=pendiente; en otro estado es un no-op {ya_completo:true} que no toca nada. Solo service_role.';

revoke all on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) to service_role;

-- ── 3. revertir_contrato_incompleto — nunca borra lo que la RPC ya completó ─
-- Cambia el tipo de retorno (void → jsonb): CREATE OR REPLACE no puede, así que
-- se recrea. El ACL se reafirma abajo. Nada depende de esta función en la base.
drop function public.revertir_contrato_incompleto(text, text);
create function public.revertir_contrato_incompleto(
  p_numero_contrato text,
  p_tenant          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado     text;
  v_registrado timestamptz;
begin
  select v.financiero_estado, v.financiero_registrado_en into v_estado, v_registrado
  from public.ventas v
  where v.numero_contrato = p_numero_contrato and v.tenant = p_tenant
  for update;
  if not found then
    return jsonb_build_object('estado', 'no_existe'); -- nada que revertir (reintento del propio rollback)
  end if;

  -- K15: la compensación NO borra un contrato que la RPC financiera ya completó
  -- (otra sesión, un reintento, o la propia respuesta que se perdió). El candado
  -- de la venta ordena este chequeo frente a la RPC: o ve 'completo' o la RPC
  -- espera a que esto termine y encuentra el contrato borrado.
  if v_estado = 'completo' and v_registrado is not null then
    return jsonb_build_object('estado', 'ya_completo');
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
         tipo_doc = null, numero_doc = null, nacimiento = null,
         asesor = null, hotel = null, acomodacion = null
   where numero_contrato = p_numero_contrato;

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
  delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;

  -- Ventana ESTRECHA del bypass de contrato_condiciones (mismo criterio que 166/172).
  set local app.eliminando_contrato = 'true';
  delete from public.ventas where numero_contrato = p_numero_contrato;
  set local app.eliminando_contrato = 'false';

  return jsonb_build_object('estado', 'revertido');
end;
$$;

comment on function public.revertir_contrato_incompleto(text, text) is
  '210: deshace un contrato recién creado cuya escritura financiera falló. Devuelve {estado: revertido | no_existe | ya_completo}; NUNCA borra un contrato que registrar_financiero_contrato ya completó (ya_completo). Se niega (excepción) si hay abonos, pagos o retenciones. Solo service_role.';

revoke all on function public.revertir_contrato_incompleto(text, text) from public, anon, authenticated;
grant execute on function public.revertir_contrato_incompleto(text, text) to service_role;

-- ── 4. contrato_financiero_pendiente: nada para un contrato que ya no está pendiente ──
create function public.contrato_financiero_pendiente_guarda()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_estado text;
begin
  -- SECURITY INVOKER a propósito: `current_user` es el rol real de quien escribe. anon/authenticated
  -- no tienen policy en esta tabla y deben recibir el 42501 de RLS EXACTAMENTE como antes de la 210
  -- (si este trigger los descartara en silencio, un contrato completo respondería distinto de uno
  -- pendiente: se filtraría su estado y se tomaría su candado sin permiso).
  if current_user in ('anon', 'authenticated') then
    return new;
  end if;
  -- FOR SHARE: espera a una RPC que tenga la venta en FOR UPDATE y decide con lo que ella confirmó.
  -- Venta inexistente: se deja pasar para que la FK dé su error.
  select v.financiero_estado into v_estado
  from public.ventas v
  where v.numero_contrato = new.numero_contrato
  for share;
  if found and v_estado is distinct from 'pendiente' then
    return null; -- descartado: un payload para un contrato ya cerrado sería residuo permanente
  end if;
  return new;
end;
$$;
revoke all on function public.contrato_financiero_pendiente_guarda() from public, anon, authenticated;

create trigger trg_contrato_financiero_pendiente_guarda
before insert on public.contrato_financiero_pendiente
for each row execute function public.contrato_financiero_pendiente_guarda();

-- ── 5. Un solo asiento de CxP por referencia ──────────────────────────────
create unique index asientos_contables_cxp_referencia_uk
  on public.asientos_contables (referencia) where origen = 'cxp';
comment on index public.asientos_contables_cxp_referencia_uk is
  '210: un asiento de devengo por CxP (referencia cxp:<id>). Los posteos concurrentes del alta y de la reconciliación no pueden duplicarlo.';
