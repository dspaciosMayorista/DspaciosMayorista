-- ───────────────────────────────────────────────────────────────────────────
-- Migración 196 · liberaciones de sillas SIN datos residuales (R1) y sin
-- revivir sillas devueltas ni no vendidas (R2). Tareas 2 y 3, diseño §6.8.4.
--
-- Requiere la 194 (`_silla_con_datos`). No toca la ELECCIÓN de sillas al
-- reservar ni ningún conteo de cupo vendible: eso va aparte
-- (supabase/propuestas/reservas_solo_sillas_libres.sql), sin aplicar hasta
-- revisar el conteo del diagnóstico de solo lectura.
--
-- QUÉ HACE
--   1. `_vaciar_sillas(ids, motivo)` (privada): la ÚNICA regla para soltar
--      sillas de un contrato. Quita numero_contrato y contrato_manual y TODOS
--      los datos del grupo D (las 16 columnas: adulto, infante, responsable
--      del menor, agencia, asesor, hotel, acomodación, plazo). Solo vuelven a
--      `disponible` las que estaban vendibles u ocupadas; `devuelta`
--      (definitiva, DIR-1) y `no_vendida` conservan su estado (decisión del
--      usuario 2026-10-01), igual que `retirada` y `cambio` (historial). Si
--      conserva alguna, deja una nota en bloqueo_cambios.
--      El historial contractual NO se toca: contrato_pasajeros (lo que quede
--      del contrato), auditoria (087, guarda los valores anteriores de cada
--      silla) y movimientos_silla siguen intactos.
--   2. `liberar_vencidas(p_hoy)` (solo service_role): reemplaza el UPDATE
--      directo de lib/reservar/liberarVencidas.ts en UNA transacción. Vence lo
--      que tenga plazo ESTRICTAMENTE anterior al día de negocio de Bogotá: un
--      plazo de hoy no se libera hoy (antes, la ruta de Reservar usaba la
--      fecha UTC y desde las 7 p. m. liberaba contratos que vencían ese mismo
--      día en Colombia).
--   3–5. eliminar_contrato (166), revertir_contrato_incompleto (172) y la
--      rama que suelta sillas de _ajustar_sillas_bloqueo_nucleo (167) usan
--      `_vaciar_sillas`. El resto de cada función es IDÉNTICO a su última
--      versión (comprobado con diff; ver informe). `create or replace` conserva
--      dueño y permisos de cada una.
--
-- QUÉ NO HACE: no limpia datos existentes (diagnóstico de solo lectura
-- primero: supabase/scripts/diagnostico_r1_r2_lectura.sql), no cambia qué
-- sillas toma una reserva, no cambia cupos.
-- ───────────────────────────────────────────────────────────────────────────

-- ═══ 1. Regla única para soltar sillas ═══════════════════════════════════
create or replace function public._vaciar_sillas(p_ids bigint[], p_motivo text)
returns integer language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return 0; end if;
  insert into public.bloqueo_cambios (bloqueo_id, detalle)
  select s.bloqueo_id,
         format('%s: %s silla(s) %s conservan su estado (sin contrato ni datos).',
                coalesce(nullif(btrim(p_motivo), ''), 'Liberación'), count(*), string_agg(distinct s.estado::text, '/'))
    from public.sillas s
   where s.id = any(p_ids) and s.estado::text in ('devuelta', 'no_vendida', 'retirada', 'cambio')
   group by s.bloqueo_id;
  update public.sillas set
    estado = case when estado::text in ('devuelta', 'no_vendida', 'retirada', 'cambio') then estado else 'disponible' end,
    numero_contrato = null, contrato_manual = null,
    pasajero_nombres = null, pasajero_apellidos = null, tipo_doc = null, numero_doc = null, nacimiento = null,
    inf_nombres = null, inf_apellidos = null, inf_tipo_doc = null, inf_numero = null, inf_nacimiento = null,
    responsable_menor = null, agencia = null, asesor = null, hotel = null, acomodacion = null, plazo = null,
    updated_at = now()
  where id = any(p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public._vaciar_sillas(bigint[], text) from public, anon, authenticated;

-- ═══ 2. Vencimiento de reservas pendientes (cron y Reservar) ═════════════
-- p_hoy: día de negocio (lib/fechaNegocio.ts). Null = el de Bogotá según la
-- base. Libera las sillas en plazo de los contratos pendientes con
-- plazo < p_hoy y los marca cancelados, todo junto.
create or replace function public.liberar_vencidas(p_hoy date default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare
  v_hoy date := coalesce(p_hoy, (now() at time zone 'America/Bogota')::date);
  v_nums text[];
  v_sillas integer := 0;
begin
  select array_agg(numero_contrato order by numero_contrato) into v_nums
    from (select numero_contrato from public.ventas
           where estado = 'pendiente' and plazo < v_hoy
           order by numero_contrato for update) v;
  if v_nums is null then
    return jsonb_build_object('ok', true, 'hoy', v_hoy, 'liberadas', 0, 'sillas', 0);
  end if;
  v_sillas := public._vaciar_sillas(
    array(select id from public.sillas where numero_contrato = any(v_nums) and estado = 'en_plazo'),
    'Reserva vencida');
  update public.ventas set estado = 'cancelado' where numero_contrato = any(v_nums) and estado = 'pendiente';
  return jsonb_build_object('ok', true, 'hoy', v_hoy, 'liberadas', cardinality(v_nums), 'sillas', v_sillas);
end $$;
revoke all on function public.liberar_vencidas(date) from public, anon, authenticated;
grant execute on function public.liberar_vencidas(date) to service_role;
comment on function public.liberar_vencidas(date) is
  'Cancela contratos pendientes con plazo anterior al día de negocio (Bogotá) y suelta sus sillas en plazo sin datos residuales. Solo service_role (cron y Reservar). Migración 196.';

-- ═══ 3. eliminar_contrato (166) — solo cambia la liberación de sillas ═════
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

  -- Migración 196 (R1 + R2): libera las sillas del contrato con la regla
  -- única `_vaciar_sillas`: quita contrato y TODOS los datos del grupo D;
  -- devuelta y no vendida conservan su estado (nota en bloqueo_cambios).
  perform public._vaciar_sillas(
    array(select id from public.sillas where numero_contrato = p_numero),
    format('Contrato %s eliminado', p_numero));

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

-- ═══ 4. revertir_contrato_incompleto (172) — solo cambia la liberación ═════
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

  -- Migración 196 (R1 + R2): misma regla única que eliminar_contrato
  -- (`_vaciar_sillas`): sin datos residuales, devuelta/no vendida conservan
  -- su estado.
  perform public._vaciar_sillas(
    array(select id from public.sillas where numero_contrato = p_numero_contrato),
    format('Contrato %s revertido (escritura financiera incompleta)', p_numero_contrato));

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

-- ═══ 5. _ajustar_sillas_bloqueo_nucleo (167) — solo la rama que suelta sillas ═
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
    -- Migración 196 (R1): la silla que se suelta queda sin ningún dato.
    perform public._vaciar_sillas(
      array(select id from public.sillas
             where numero_contrato = p_numero_contrato
               and bloqueo_id = p_bloqueo_id
               and estado in ('en_plazo', 'confirmada')
             order by numero_silla desc
             limit (-v_delta)),
      format('Contrato %s: menos pasajeros', p_numero_contrato));
  end if;

  select array_agg(id order by numero_silla) into v_ids
    from public.sillas
   where numero_contrato = p_numero_contrato
     and bloqueo_id = p_bloqueo_id
     and estado in ('en_plazo', 'confirmada');

  return query select p_holders_nuevo, coalesce(v_ids, array[]::bigint[]);
end;
$function$;
