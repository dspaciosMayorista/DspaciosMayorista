-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 222 · hija manual con precio NETO (#50). Deja el esquema EXACTAMENTE como antes de la 222.
-- Correr con el mismo rol que aplicó la 222. Un solo archivo, una sola transacción.
--
-- SE NIEGA (sin cambiar nada) si:
--   · hay hijas selladas (cotizacion_neto con filas): borrar el sello de una hija con pagos o contrato
--     dejaría un NETO sin su descuento; en ese caso NO se revierte, se conserva el sello; o
--   · la 223 sigue aplicada (la modalidad es obligatoria): primero rollback_223.
--
-- Qué restaura: los cuerpos ORIGINALES de las cuatro funciones que la 222 reemplazó (copiados de la
-- 211 y la 216; sus permisos no se tocan), y borra lo agregado: las dos RPC nuevas, las dos tablas, las
-- tres columnas del recibo y el esquema p50_priv (con su interruptor y todas sus funciones).
-- ───────────────────────────────────────────────────────────────────────────
begin;

set local lock_timeout = '10s';

do $$
begin
  if to_regclass('public.cotizacion_neto') is null or to_regnamespace('p50_priv') is null then
    raise exception 'rollback 222: la 222 no está aplicada (o está a medias). No se cambió nada.';
  end if;
  if exists (select 1 from public.cotizacion_neto) then
    raise exception 'rollback 222: hay % hija(s) selladas; revertir perdería su precio NETO. No se cambió nada.',
      (select count(*) from public.cotizacion_neto);
  end if;
  if p50_priv.exigir_modalidad() then
    raise exception 'rollback 222: la 223 sigue aplicada (modalidad obligatoria). Aplica antes rollback_223. No se cambió nada.';
  end if;
end $$;

-- 1. Cuerpos originales (211 y 216).
create or replace function public.elegir_opcion_comparativa_sesion(p_validacion uuid, p_clave text)
returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  r public.cotizacion_comparativa_validaciones; v_uid uuid := auth.uid(); v_hija bigint; v_prev public.cotizacion_comparativa_eventos;
begin
  if v_uid is null then
    raise exception 'COMPARATIVA_NO_AUTORIZADO: inicia sesión para continuar.' using errcode = '42501';
  end if;
  if p_clave is null or length(p_clave) < 8 or length(p_clave) > 80 then
    raise exception 'COMPARATIVA_DATOS: clave de idempotencia inválida.' using errcode = 'P0001';
  end if;
  select * into r from public.cotizacion_comparativa_validaciones where id = p_validacion for update;
  if not found or r.canal = 'publico' or r.actor_id is distinct from v_uid then
    raise exception 'COMPARATIVA_RECIBO: recibo inválido.' using errcode = 'P0001';
  end if;
  -- Identidad y propiedad releídas desde la base con auth.uid() (no desde el recibo),
  -- ANTES de cualquier respuesta: tampoco un reintento devuelve datos a quien ya no puede actuar.
  if r.canal = 'interno' then
    perform f211_priv.interno_activo(v_uid, r.tenant);
  else
    perform f211_priv.b2b_propietario(v_uid, r.cotizacion_id);
  end if;
  if r.consumida_en is not null then
    if r.clave = p_clave then return r.hija_id; end if;
    raise exception 'COMPARATIVA_RECIBO: el recibo ya fue usado.' using errcode = 'P0001';
  end if;
  if r.expira_en <= now() then
    raise exception 'COMPARATIVA_RECIBO: el recibo venció; vuelve a intentarlo.' using errcode = 'P0001';
  end if;
  -- Idempotencia por clave de madre (otro recibo, misma clave → misma hija o rechazo).
  select * into v_prev from public.cotizacion_comparativa_eventos
   where cotizacion_id = r.cotizacion_id and tipo = 'elegida' and clave = p_clave;
  if found then
    if v_prev.huella = r.huella then return v_prev.hija_id; end if;
    raise exception 'COMPARATIVA_CLAVE: la clave ya se usó con otros datos.' using errcode = 'P0001';
  end if;
  v_hija := f211_priv.crear_hija(r.cotizacion_id, r.opcion_ref, r.acomodacion_ref, r.version, r.canal,
                                 v_uid, r.id, null, p_clave, r.huella, null);
  update public.cotizacion_comparativa_validaciones
     set consumida_en = now(), hija_id = v_hija, clave = p_clave, datos_cliente = null
   where id = r.id;
  return v_hija;
end $$;

create or replace function public.resolver_solicitud_comparativa(p_solicitud bigint, p_decision text, p_motivo text, p_clave text)
returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  v_uid uuid := auth.uid(); sol public.cotizacion_comparativa_solicitudes; c public.cotizaciones;
  v_hija bigint; v_prev public.cotizacion_comparativa_eventos; v_cot bigint;
begin
  if v_uid is null then
    raise exception 'COMPARATIVA_NO_AUTORIZADO: inicia sesión para continuar.' using errcode = '42501';
  end if;
  perform f211_priv.purgar_ip_huella();
  -- ORDEN DE BLOQUEOS ÚNICO en toda la comparativa: MADRE primero, luego solicitud
  -- (así lo hacen registrar_solicitud y crear_hija). Bloquear primero la solicitud
  -- provocaba un deadlock entre dos confirmaciones de solicitudes distintas.
  select cotizacion_id into v_cot from public.cotizacion_comparativa_solicitudes where id = p_solicitud;
  if v_cot is null then
    raise exception 'COMPARATIVA_NO_DISPONIBLE: la solicitud no existe.' using errcode = 'P0001';
  end if;
  select * into c from public.cotizaciones where id = v_cot for update;
  select * into sol from public.cotizacion_comparativa_solicitudes where id = p_solicitud for update;
  if not found then
    raise exception 'COMPARATIVA_NO_DISPONIBLE: la solicitud no existe.' using errcode = 'P0001';
  end if;
  perform f211_priv.interno_activo(v_uid, sol.tenant);
  if p_decision not in ('confirmar','rechazar') then
    raise exception 'COMPARATIVA_DATOS: decisión inválida.' using errcode = 'P0001';
  end if;
  if sol.estado <> 'pendiente' then
    if p_decision = 'confirmar' and sol.estado = 'atendida' and sol.hija_id is not null then return sol.hija_id; end if;
    raise exception 'COMPARATIVA_NO_DISPONIBLE: la solicitud ya fue resuelta.' using errcode = 'P0001';
  end if;
  if p_decision = 'rechazar' then
    update public.cotizacion_comparativa_solicitudes
       set estado = 'rechazada', verificada_por = v_uid, motivo = left(p_motivo, 300), ip_huella = null, atendida_en = now()
     where id = sol.id;
    insert into public.cotizacion_comparativa_eventos (cotizacion_id, tenant, tipo, solicitud_id, actor_tipo, actor_id)
    values (sol.cotizacion_id, sol.tenant, 'solicitud_rechazada', sol.id, 'interno', v_uid);
    return null;
  end if;
  -- Confirmar: vencimiento efectivo (72 h o vigencia de la madre).
  if sol.created_at < now() - interval '72 hours' then
    raise exception 'COMPARATIVA_VENCIDA: la solicitud venció (72 h).' using errcode = 'P0001';
  end if;
  if p_clave is null or length(p_clave) < 8 or length(p_clave) > 80 then
    raise exception 'COMPARATIVA_DATOS: clave de idempotencia inválida.' using errcode = 'P0001';
  end if;
  select * into v_prev from public.cotizacion_comparativa_eventos
   where cotizacion_id = sol.cotizacion_id and tipo = 'elegida' and clave = p_clave;
  if found then return v_prev.hija_id; end if;
  v_hija := f211_priv.crear_hija(sol.cotizacion_id, sol.opcion_ref, sol.acomodacion_ref, sol.version, 'interno',
              v_uid, null, sol.id, p_clave,
              encode(sha256(convert_to(concat_ws('|', sol.id, sol.opcion_ref, sol.acomodacion_ref, v_uid), 'UTF8')), 'hex'), null);
  update public.cotizacion_comparativa_solicitudes
     set estado = 'atendida', hija_id = v_hija, verificada_por = v_uid, ip_huella = null, atendida_en = now()
   where id = sol.id;
  insert into public.cotizacion_comparativa_eventos (cotizacion_id, tenant, tipo, solicitud_id, hija_id, actor_tipo, actor_id)
  values (sol.cotizacion_id, sol.tenant, 'solicitud_atendida', sol.id, v_hija, 'interno', v_uid);
  return v_hija;
end $$;

create or replace function public.registrar_pago_previo_rev(
  p_cotizacion_id bigint, p_valor numeric, p_moneda text, p_trm numeric, p_forma_pago text, p_referencia text,
  p_fecha_pago date, p_usuario_id uuid, p_idempotency_key text, p_rev_esperada integer,
  p_snapshot jsonb default null, p_exigido_total_moneda numeric default null, p_pct_efectivo numeric default null
) returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_tenant text;
  v_tipo text;
  v_modo text;
  v_rev integer;
  v_congelada timestamptz;
  v_rol text;
  v_actor_tenant text;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_aut bigint;
  v_res text;
begin
  select c.tenant, c.tipo, c.modo, c.economico_rev, c.condicion_pago_congelada_en
    into v_tenant, v_tipo, v_modo, v_rev, v_congelada
    from public.cotizaciones c where c.id = p_cotizacion_id for update;
  if not found then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  v_rol := public._autorizado_pago_previo(p_usuario_id);
  select u.tenant into v_actor_tenant from public.usuarios u where u.id = p_usuario_id;
  if v_rol <> 'superadmin' and v_actor_tenant is distinct from v_tenant then
    raise exception 'No tienes acceso a la agencia (tenant %) de esta cotización.', v_tenant using errcode = '42501';
  end if;
  if v_tipo is distinct from 'manual' or v_modo is distinct from 'simple' then
    raise exception 'Los pagos previos solo aplican a cotizaciones dinámicas.' using errcode = 'P0001';
  end if;
  -- Reintento con una clave ya usada: la 198 devuelve el pago original SIN escribir
  -- (o rechaza si cambió algún dato). No necesita autorización.
  if v_key is not null and exists (select 1 from public.cotizacion_pagos_previos p where p.idempotency_key = v_key) then
    return public.registrar_pago_previo(p_cotizacion_id, p_valor, p_moneda, p_trm, p_forma_pago, p_referencia, p_fecha_pago,
                                        p_usuario_id, p_idempotency_key, p_snapshot, p_exigido_total_moneda, p_pct_efectivo);
  end if;
  -- Primer pago: la misma revisión que leyó la app y la misma composición.
  if v_congelada is null then
    if p_rev_esperada is distinct from v_rev then
      raise exception 'PAGO_39_REVISION: la cotización cambió desde que se preparó el pago; recarga la página e inténtalo de nuevo.' using errcode = 'P0001';
    end if;
    if p_snapshot is null or not p39_priv.composicion_coincide(p_cotizacion_id, p_snapshot) then
      raise exception 'PAGO_39_COMPOSICION: las condiciones enviadas no corresponden a los servicios actuales de la cotización; recarga la página.' using errcode = 'P0001';
    end if;
  end if;
  v_aut := p39_priv.emitir(p_cotizacion_id, 'pago', p_usuario_id);
  v_res := public.registrar_pago_previo(p_cotizacion_id, p_valor, p_moneda, p_trm, p_forma_pago, p_referencia, p_fecha_pago,
                                        p_usuario_id, p_idempotency_key, p_snapshot, p_exigido_total_moneda, p_pct_efectivo);
  perform p39_priv.cerrar(v_aut);
  return v_res;
end $$;

create or replace function public.convertir_cotizacion_manual_controlada(
  p_cotizacion_id bigint, p_usuario_id uuid
) returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_tipo text;
  v_modo text;
  v_aut bigint;
  v_res text;
begin
  select c.tipo, c.modo into v_tipo, v_modo from public.cotizaciones c where c.id = p_cotizacion_id for update;
  if not found then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  if v_modo = 'comparativa' then
    raise exception 'COMPARATIVA_NO_COBRABLE: una comparativa no se convierte en contrato; elige una opción primero.' using errcode = 'P0001';
  end if;
  if v_tipo is distinct from 'manual' then
    raise exception 'Solo las cotizaciones dinámicas se convierten por esta vía.' using errcode = 'P0001';
  end if;
  -- Ya convertida: la 198 devuelve el número existente sin escribir nada.
  if exists (select 1 from public.ventas v where v.cotizacion_id = p_cotizacion_id) then
    return public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  end if;
  v_aut := p39_priv.emitir(p_cotizacion_id, 'conversion', p_usuario_id);
  v_res := public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  perform p39_priv.cerrar(v_aut);
  return v_res;
end $$;

-- 2. Lo que agregó la 222.
drop function public.registrar_validacion_comparativa_n50(bigint, text, text, integer, text, uuid, numeric, text, boolean, jsonb, text, boolean, boolean);
drop function public.resolver_solicitud_comparativa_n50(bigint, text, text, text, text, boolean, boolean);
drop table public.cotizacion_neto_componentes;
drop table public.cotizacion_neto;
alter table public.cotizacion_comparativa_validaciones
  drop column modalidad, drop column reconoce_recobro, drop column autorizar_margen;
drop schema p50_priv cascade;

-- 3. Verificación: sin rastro de #50, la 198 intacta y la frontera de #39 activa.
do $$
begin
  if to_regnamespace('p50_priv') is not null or to_regclass('public.cotizacion_neto') is not null
     or to_regclass('public.cotizacion_neto_componentes') is not null then
    raise exception 'rollback 222: quedaron objetos de #50.';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc like '%p50_priv%') then
    raise exception 'rollback 222: una función pública sigue llamando a p50_priv.';
  end if;
  if not p39_priv.frontera_activa() then
    raise exception 'rollback 222: la frontera de #39 no está activa.';
  end if;
  if md5(replace((select prosrc from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), chr(13), ''))
     <> 'edc9975010746e53e4af6a75ad9763dc' then
    raise exception 'rollback 222: el cuerpo de la RPC 198 cambió.';
  end if;
end $$;

commit;
