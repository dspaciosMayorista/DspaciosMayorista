-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 196 · vuelve eliminar_contrato, revertir_contrato_incompleto y
-- _ajustar_sillas_bloqueo_nucleo a su versión anterior (166/172/167, copiadas
-- tal cual) y quita liberar_vencidas y _vaciar_sillas.
--
-- ⚠️ ORDEN: desplegar ANTES el código anterior de lib/reservar/liberarVencidas.ts
-- (el nuevo llama a liberar_vencidas). Al revertir vuelve el comportamiento
-- anterior: liberaciones que dejan datos residuales y que ponen `disponible`
-- también sillas devueltas o no vendidas de un contrato eliminado.
-- ───────────────────────────────────────────────────────────────────────────
begin;

CREATE OR REPLACE FUNCTION public.eliminar_contrato(p_numero text, p_reusar boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.mi_rol() <> 'superadmin' then
    raise exception 'Solo un superadmin puede eliminar contratos.';
  end if;

  if p_reusar and p_numero ~ '^DTM-' then
    raise exception
      'No se puede reutilizar el consecutivo de un contrato DTM- (mayorista): '
      'esa numeración usa una secuencia dedicada que nunca lee de '
      'numeros_contrato_liberados. Vuelve a eliminar el contrato con '
      'p_reusar=false si no necesitas reciclar el número.';
  end if;

  -- Libera las sillas asociadas (vuelven a 'disponible').
  update public.sillas
     set estado = 'disponible', numero_contrato = null,
         pasajero_nombres = null, pasajero_apellidos = null, tipo_doc = null,
         numero_doc = null, nacimiento = null, asesor = null, hotel = null,
         acomodacion = null, plazo = null
   where numero_contrato = p_numero;

  -- Desvincula la cotización de origen (vuelve a 'abierta' para reconvertir).
  update public.cotizaciones set numero_contrato = null, estado = 'abierta'
   where numero_contrato = p_numero;

  -- Hijas SIN cascade (factura_items cae por cascade de facturacion).
  delete from public.facturacion          where numero_contrato = p_numero;
  delete from public.rentabilidad         where numero_contrato = p_numero;
  delete from public.liquidacion_comisiones where numero_contrato = p_numero;
  delete from public.aliados_b2b          where numero_contrato = p_numero;
  delete from public.cuentas_por_pagar    where numero_contrato = p_numero;
  delete from public.abonos               where numero_contrato = p_numero;

  -- Ventana ESTRECHA del bypass (migración 166): encendida justo antes del
  -- ÚNICO delete que puede cascadear a contrato_condiciones, apagada
  -- inmediatamente después. `set local` ya está acotado a esta transacción
  -- (esta llamada RPC); apagarlo explícitamente además acota la ventana al
  -- tiempo de esta única sentencia, no al resto de la transacción.
  set local app.eliminando_contrato = 'true';

  -- La venta (contrato_pasajeros/hoteles/vuelos/items/condiciones, vouchers,
  -- adjuntos: cascade).
  delete from public.ventas where numero_contrato = p_numero;

  set local app.eliminando_contrato = 'false';

  if p_reusar then
    insert into public.numeros_contrato_liberados(numero) values (p_numero)
      on conflict do nothing;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revertir_contrato_incompleto(p_numero_contrato text, p_tenant text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public._ajustar_sillas_bloqueo_nucleo(p_numero_contrato text, p_bloqueo_id bigint, p_holders_nuevo integer)
 RETURNS TABLE(holders_total integer, silla_ids bigint[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_estado_muestra  public.estado_silla;
  v_holders_actual  integer;
  v_delta           integer;
  v_disponibles     integer;
  v_ids             bigint[];
begin
  if p_numero_contrato is null or length(p_numero_contrato) = 0 or length(p_numero_contrato) > 30 then
    raise exception 'Número de contrato inválido.';
  end if;
  if p_bloqueo_id is null or p_bloqueo_id <= 0 then
    raise exception 'Bloqueo inválido.';
  end if;
  if p_holders_nuevo is null or p_holders_nuevo < 0 or p_holders_nuevo > 100 then
    raise exception 'Cantidad de pasajeros con silla inválida.';
  end if;

  -- Bloquea la fila padre (mismo orden/candado que actualizar_estado_emision_contrato,
  -- migración 157) para serializar con cualquier otra operación sobre ESTE contrato.
  perform 1 from public.ventas where ventas.numero_contrato = p_numero_contrato for update;

  -- Bloquea TODO el pool de sillas de ESTE bloqueo (asignadas al contrato +
  -- libres) — necesario para que dos reservas/ediciones concurrentes del
  -- MISMO bloqueo nunca sub-cuenten la disponibilidad real. A diferencia de
  -- la versión original (migración 167), `p_bloqueo_id` es un parámetro
  -- EXPLÍCITO del llamador — nunca se descubre aquí (ver
  -- `_ajustar_sillas_nucleo` más abajo, que sigue descubriéndolo para el
  -- caso de un solo bloqueo). Esto es lo que permite que un mismo contrato
  -- reconcilie VARIOS bloqueos distintos, uno por llamada, dentro de la
  -- MISMA transacción (revisión de alto riesgo, ronda 3 — B6; ver
  -- `crear_pasajeros_contrato_multi`, parte E) sin necesitar una columna
  -- `bloqueo_ref_id` que solo admite un valor por contrato.
  perform 1 from public.sillas where bloqueo_id = p_bloqueo_id for update;

  -- Todo scoped por `bloqueo_id` ADEMÁS de `numero_contrato` — con un solo
  -- bloqueo por contrato (caso original) es redundante; con varios bloqueos
  -- bajo el mismo contrato (B6) es lo que evita que reconciliar el bloqueo A
  -- cuente o libere sillas que en realidad pertenecen al bloqueo B.
  select count(*) into v_holders_actual
    from public.sillas
   where numero_contrato = p_numero_contrato
     and bloqueo_id = p_bloqueo_id
     and estado in ('en_plazo', 'confirmada');

  v_delta := p_holders_nuevo - v_holders_actual;

  if v_delta > 0 then
    select count(*) into v_disponibles
      from public.sillas
     where bloqueo_id = p_bloqueo_id
       and estado in ('disponible', 'cambio_entrante');

    if v_disponibles < v_delta then
      raise exception 'No hay suficientes sillas disponibles en el bloqueo (% disponibles, % requeridas).', v_disponibles, v_delta;
    end if;

    -- El estado de las sillas NUEVAS hereda el de las que el contrato YA
    -- tenía en ESTE bloqueo (en_plazo o confirmada) — nunca un estado
    -- inventado; si el contrato no tenía ninguna silla previa de este
    -- bloqueo (holders_actual = 0, primera vez que gana pasajeros con
    -- silla aquí), nace en_plazo.
    select estado into v_estado_muestra
      from public.sillas
     where numero_contrato = p_numero_contrato
       and bloqueo_id = p_bloqueo_id
       and estado in ('en_plazo', 'confirmada')
     limit 1;
    v_estado_muestra := coalesce(v_estado_muestra, 'en_plazo');

    update public.sillas
       set estado = v_estado_muestra, numero_contrato = p_numero_contrato
     where id in (
       select id from public.sillas
        where bloqueo_id = p_bloqueo_id
          and estado in ('disponible', 'cambio_entrante')
        order by numero_silla
        limit v_delta
     );
  elsif v_delta < 0 then
    update public.sillas
       set estado = 'disponible', numero_contrato = null,
           pasajero_nombres = null, pasajero_apellidos = null, tipo_doc = null,
           numero_doc = null, nacimiento = null, asesor = null, hotel = null,
           acomodacion = null, plazo = null
     where id in (
       select id from public.sillas
        where numero_contrato = p_numero_contrato
          and bloqueo_id = p_bloqueo_id
          and estado in ('en_plazo', 'confirmada')
        order by numero_silla desc
        limit (-v_delta)
     );
  end if;

  select array_agg(id order by numero_silla) into v_ids
    from public.sillas
   where numero_contrato = p_numero_contrato
     and bloqueo_id = p_bloqueo_id
     and estado in ('en_plazo', 'confirmada');

  return query select p_holders_nuevo, coalesce(v_ids, array[]::bigint[]);
end;
$function$;

drop function if exists public.liberar_vencidas(date);
drop function if exists public._vaciar_sillas(bigint[], text);

do $$
begin
  if exists (select 1 from pg_proc where proname in ('liberar_vencidas', '_vaciar_sillas')) then
    raise exception 'Rollback 196 incompleto.';
  end if;
  if position('_vaciar_sillas' in pg_get_functiondef('public.eliminar_contrato(text, boolean)'::regprocedure)) > 0 then
    raise exception 'Rollback 196 incompleto: eliminar_contrato sigue usando _vaciar_sillas.';
  end if;
end $$;

commit;
