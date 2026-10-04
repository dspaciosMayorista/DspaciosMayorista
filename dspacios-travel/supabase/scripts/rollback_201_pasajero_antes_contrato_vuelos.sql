-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 201 (TOTAL, de base de datos) · pasajero antes del contrato /
-- retención en plazo / reserva sobre sillas libres / firmas con versión /
-- cierre de firmas antiguas / quitar y editar contrato manual.
--
-- ⚠️ NO es el rollback habitual. Para un problema del CÓDIGO nuevo basta con
-- volver a desplegar el código anterior SIN tocar la base (la 201 es
-- compatible con él y el código anterior SÍ gestiona las retenciones por las
-- firmas viejas: asignar contrato, editar plazo, Borrar), cancelando antes el
-- cierre si está programado (cancelar_cierre_firmas_201.sql). Este script es
-- solo para cuando la lógica de BASE de la 201 es la que falla y no se puede
-- corregir hacia adelante. Ver docs: alternativas y riesgos en el informe.
--
-- Devuelve el CÓDIGO de la base al estado de la 194/196 (con 199 y 200):
--   · restaura los 6 cuerpos anteriores (núcleo de reserva, cambiar estado,
--     asignar/quitar contrato manual, liberar silla, editar pasajero) y la
--     vista cupos_por_bloqueo;
--   · quita el EXECUTE de authenticated sobre _silla_libre/_silla_con_datos;
--   · borra la guarda de la retención, las funciones nuevas de la 201, el
--     estado del cierre y el registro de uso (EXPORTAR antes si se quiere
--     conservar la evidencia: `select * from public.vuelos_firmas_antiguas_uso`).
-- Generado desde las definiciones reales de una base con 1–200 (no reescrito
-- a mano). Tras correrlo, la guarda de la 201 vuelve a aceptar aplicarla.
-- NO toca datos.
--
-- SE NIEGA (y no cambia nada) si:
--   · las firmas antiguas YA CERRARON: revertir las reabriría. A partir de ahí
--     solo se corrige hacia adelante;
--   · el cierre está PROGRAMADO: cancelarlo antes (cancelar_cierre_firmas_201.sql);
--   · queda alguna RETENCIÓN (en_plazo sin contrato): con la 194 no reciben
--     contrato, no cambian de estado y el cron no las toca; la única salida
--     sería "Borrar", perdiendo el pasajero. No hay modo "conservar": dejarlas
--     no es recuperarlas. Se resuelven ANTES, con el código nuevo desplegado y
--     solo por vías REALES (preparar_rollback_201_retenciones.sql): contrato
--     manual solo si existe una venta real con su número; si no, liberar
--     cuando la persona desiste o el plazo venció. Mientras quede una retención
--     vigente sin decisión, este rollback espera.
--
-- ⚠️ ORDEN:
--   0. Con el código NUEVO aún desplegado: preparar_rollback_201_retenciones.sql
--      hasta que dé 0 (guardar el listado) y, si está programado, cancelar el cierre.
--   1. Re-desplegar el código ANTERIOR a la 201 y comprobarlo activo.
--   2. Correr este script enseguida (si entre 1 y 2 aparece una retención, se
--      niega: resolverla y repetir).
--   3. postcheck_192_197_vuelos_fase_b.sql (vuelve a los hashes de 194/196) y
--      los de 199/200; y preparar_rollback_201_retenciones.sql otra vez: 0.
-- ───────────────────────────────────────────────────────────────────────────
begin;

-- Nadie crea ni cambia una retención mientras se cuenta y se revierte.
lock table public.sillas in exclusive mode;

do $$
declare
  v_editar text;
  v_lista text;
  v_retenciones int;
  v_usos int;
  v_estado text;
begin
  -- 1. Nunca reabrir firmas que ya cerraron.
  if to_regclass('public.vuelos_cierre_firmas_201') is not null then
    if public._firmas_antiguas_cerradas() then
      raise exception 'Las firmas antiguas ya cerraron: revertir la 201 las reabriría. No se revirtió nada; corregir hacia adelante.';
    end if;
    select estado into v_estado from public.vuelos_cierre_firmas_201 where id = 1;
    if v_estado = 'programado' then
      raise exception 'El cierre de firmas antiguas está programado: cancelarlo antes (cancelar_cierre_firmas_201.sql). No se revirtió nada.';
    end if;
  end if;

  -- 2. La 201 completa, tal como la deja su propia guarda.
  select md5(replace(prosrc, chr(13), '')) into v_editar
    from pg_proc where oid = to_regprocedure('public.editar_pasajero_silla(bigint,jsonb)');
  if v_editar is distinct from '0cb298519f7f74c5e0b6a89c61ebe5a5'
     or (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.cambiar_estado_silla(bigint,text,text,boolean)')) is distinct from '49d46cf31a34b9ed6847da116db2169f'
     or (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.asignar_contrato_manual(bigint,text)')) is distinct from '170dfb530a5564469657a843ee0fda8f'
     or (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public._ajustar_sillas_bloqueo_nucleo(text,bigint,integer)')) is distinct from '26e514bbbbb1fda58cb024cb85884ef2'
     or (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.quitar_contrato_manual(bigint)')) is distinct from '8313f296fdc0fb8244a884833045ba11'
     or (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.liberar_silla(bigint)')) is distinct from '7dae462501f91621565c1ada8a6071cd'
     or (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.liberar_silla(bigint,jsonb)')) is distinct from '67a18542caa8241a25efc6800a69d4e5'
     or (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public._sillas_retencion_sin_contrato()')) is distinct from '8ee1cb4f0919a6e32f913a8ba228d1ae'
     or to_regclass('public.vuelos_firmas_antiguas_uso') is null
     or to_regclass('public.vuelos_cierre_firmas_201') is null
     or position('_silla_libre' in pg_get_viewdef('public.cupos_por_bloqueo'::regclass)) = 0 then
    raise exception 'La base no está como la deja la 201 (o ya se revirtió); revisar antes de correr este rollback.';
  end if;

  -- 3. Sin retenciones: no hay modo "conservar".
  select count(*) into v_retenciones from public.sillas
   where estado = 'en_plazo' and numero_contrato is null and contrato_manual is null;
  if v_retenciones > 0 then
    select string_agg(format('%s #%s %s (plazo %s)', b.record, s.numero_silla,
                             btrim(concat_ws(' ', s.pasajero_nombres, s.pasajero_apellidos)), s.plazo), '; '
                      order by b.record, s.numero_silla)
      into v_lista
      from (select * from public.sillas
             where estado = 'en_plazo' and numero_contrato is null and contrato_manual is null
             order by bloqueo_id, numero_silla limit 20) s
      join public.bloqueos_vuelo b on b.id = s.bloqueo_id;
    raise exception 'Quedan % retención(es) en plazo sin contrato; con la 194 no se podrían gestionar (solo Borrar, perdiendo el pasajero). Resuélvelas por vías reales (preparar_rollback_201_retenciones.sql) o usa el rollback solo de código: %. No se revirtió nada.',
      v_retenciones, v_lista;
  end if;
  select count(*) into v_usos from public.vuelos_firmas_antiguas_uso;
  raise notice 'Sin retenciones pendientes. Filas de vuelos_firmas_antiguas_uso que se borran: %', v_usos;
end $$;

-- ═══ 1. Guarda de la retención ════════════════════════════════════════════
drop trigger if exists sillas_retencion_sin_contrato on public.sillas;
drop function if exists public._sillas_retencion_sin_contrato();

-- ═══ 2. Cuerpos anteriores a la 201 ═══════════════════════════════════════
-- `create or replace` conserva dueño, permisos y comentarios de cada función.
-- public._ajustar_sillas_bloqueo_nucleo(text,bigint,integer): cuerpo anterior a la 201 (194/196)
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

-- public.cambiar_estado_silla(bigint,text,text,boolean): cuerpo anterior a la 201 (194/196)
CREATE OR REPLACE FUNCTION public.cambiar_estado_silla(p_silla_id bigint, p_estado text, p_motivo text, p_devolucion_real boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '5s'
AS $function$
declare
  v_actor record; v_s public.sillas%rowtype; v_desde text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  select * into v_actor from public._vuelos_actor();
  if v_motivo is null then raise exception using errcode = '22023', message = 'Escribe el motivo del cambio de estado.'; end if;
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_s.numero_contrato is not null or v_s.contrato_manual is not null or public._silla_con_datos(v_s) then
    raise exception using errcode = 'P0001',
      message = 'Esta silla tiene contrato o pasajero: su estado se cambia con las acciones del contrato (confirmar, liberar…).';
  end if;
  v_desde := case when v_s.estado::text = 'cambio_entrante' then 'disponible' else v_s.estado::text end;
  if v_desde = 'devuelta' then
    raise exception using errcode = 'P0001', message = 'Una silla devuelta es definitiva: no vuelve a otro estado.';
  end if;
  if p_estado is null or p_estado not in ('disponible', 'no_vendida', 'devuelta') then
    raise exception using errcode = 'P0001',
      message = 'Ese cambio de estado no se hace a mano: usa reservar, confirmar venta, liberar silla o retirar cupo.';
  end if;
  if v_desde = p_estado then return jsonb_build_object('ok', true, 'sin_cambios', true); end if;
  if not ((v_desde = 'disponible' and p_estado in ('no_vendida', 'devuelta'))
       or (v_desde = 'no_vendida' and p_estado = 'disponible')
       or (v_desde = 'no_vendida' and p_estado = 'devuelta')) then
    raise exception using errcode = 'P0001', message = format('Cambio no permitido de %s a %s.', v_desde, p_estado);
  end if;
  if v_desde = 'no_vendida' and p_estado = 'devuelta' and not coalesce(p_devolucion_real, false) then
    raise exception using errcode = 'P0001',
      message = 'Pasar de "No vendida" a "Devuelta" solo registra una devolución real a la aerolínea; confírmala.';
  end if;
  update public.sillas set estado = p_estado::public.estado_silla, updated_at = now() where id = p_silla_id;
  insert into public.bloqueo_cambios (bloqueo_id, detalle, nota, registrado_por)
  values (v_s.bloqueo_id, format('Silla %s: %s → %s', v_s.numero_silla, v_s.estado, p_estado), v_motivo, v_actor.actor_nombre);
  return jsonb_build_object('ok', true, 'sin_cambios', false, 'desde', v_s.estado::text, 'hacia', p_estado);
end $function$;

-- public.asignar_contrato_manual(bigint,text): cuerpo anterior a la 201 (194/196)
CREATE OR REPLACE FUNCTION public.asignar_contrato_manual(p_silla_id bigint, p_referencia text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '5s'
AS $function$
declare v_actor record; v_s public.sillas%rowtype; v_ref text; r record;
begin
  select * into v_actor from public._vuelos_actor();
  v_ref := public._ref_manual_normalizada(p_referencia);
  if v_ref is null or v_ref = '' then raise exception using errcode = '22023', message = 'Escribe el número de contrato manual.'; end if;
  select * into r from public._autorizar_contrato_silla(null, v_ref, v_actor.actor_rol, false);
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if not public._silla_libre(v_s) then
    raise exception using errcode = 'P0001', message = 'Solo se asigna un contrato manual a un cupo libre (sin contrato ni pasajero).';
  end if;
  update public.sillas set contrato_manual = v_ref, estado = 'confirmada', updated_at = now() where id = p_silla_id;
  return jsonb_build_object('ok', true, 'clase', r.clase, 'contrato_resuelto', r.numero_resuelto, 'referencia', v_ref);
end $function$;

-- public.editar_pasajero_silla(bigint,jsonb): cuerpo anterior a la 201 (194/196)
CREATE OR REPLACE FUNCTION public.editar_pasajero_silla(p_silla_id bigint, p_datos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '5s'
AS $function$
declare
  v_actor record; v_s public.sillas%rowtype; v_nac date; v_plazo date;
  t_nac text := nullif(btrim(coalesce(p_datos ->> 'nacimiento', '')), '');
  t_plazo text := nullif(btrim(coalesce(p_datos ->> 'plazo', '')), '');
begin
  select * into v_actor from public._vuelos_actor();
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception using errcode = '22023', message = 'Datos del pasajero inválidos.';
  end if;
  if t_nac is not null then
    if t_nac !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode = '22023', message = 'Fecha de nacimiento inválida.'; end if;
    v_nac := t_nac::date;
  end if;
  if t_plazo is not null then
    if t_plazo !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode = '22023', message = 'Fecha de plazo inválida.'; end if;
    v_plazo := t_plazo::date;
  end if;
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_s.estado::text in ('cambio', 'retirada') then
    raise exception using errcode = 'P0001', message = 'Esta silla es historial; no se edita.';
  end if;
  perform public._autorizar_contrato_silla(v_s.numero_contrato, v_s.contrato_manual, v_actor.actor_rol, true);
  update public.sillas set
    pasajero_nombres   = nullif(btrim(coalesce(p_datos ->> 'pasajero_nombres', '')), ''),
    pasajero_apellidos = nullif(btrim(coalesce(p_datos ->> 'pasajero_apellidos', '')), ''),
    tipo_doc           = nullif(btrim(coalesce(p_datos ->> 'tipo_doc', '')), ''),
    numero_doc         = nullif(btrim(coalesce(p_datos ->> 'numero_doc', '')), ''),
    nacimiento         = v_nac,
    asesor             = nullif(btrim(coalesce(p_datos ->> 'asesor', '')), ''),
    hotel              = nullif(btrim(coalesce(p_datos ->> 'hotel', '')), ''),
    acomodacion        = nullif(btrim(coalesce(p_datos ->> 'acomodacion', '')), ''),
    plazo              = v_plazo,
    updated_at         = now()
  where id = p_silla_id;
  return jsonb_build_object('ok', true);
end $function$;

-- public.quitar_contrato_manual(bigint): cuerpo anterior a la 201 (194/196)
CREATE OR REPLACE FUNCTION public.quitar_contrato_manual(p_silla_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '5s'
AS $function$
declare v_actor record; v_s public.sillas%rowtype;
begin
  select * into v_actor from public._vuelos_actor();
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_s.contrato_manual is null then raise exception using errcode = 'P0001', message = 'Esta silla no tiene contrato manual.'; end if;
  perform public._autorizar_contrato_silla(null, v_s.contrato_manual, v_actor.actor_rol, true);
  update public.sillas set contrato_manual = null,
         estado = case when estado::text in ('devuelta', 'no_vendida', 'retirada', 'cambio') then estado else 'disponible' end,
         updated_at = now()
   where id = p_silla_id;
  return jsonb_build_object('ok', true);
end $function$;

-- public.liberar_silla(bigint): cuerpo anterior a la 201 (194/196)
CREATE OR REPLACE FUNCTION public.liberar_silla(p_silla_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '5s'
AS $function$
declare v_actor record; v_s public.sillas%rowtype;
begin
  select * into v_actor from public._vuelos_actor();
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_s.estado::text in ('cambio', 'retirada', 'devuelta', 'no_vendida') then
    raise exception using errcode = 'P0001', message = format('Esta silla no se puede liberar (estado %s).', v_s.estado);
  end if;
  perform public._autorizar_contrato_silla(v_s.numero_contrato, v_s.contrato_manual, v_actor.actor_rol, true);
  update public.sillas set
    estado = 'disponible', numero_contrato = null, contrato_manual = null,
    pasajero_nombres = null, pasajero_apellidos = null, tipo_doc = null, numero_doc = null, nacimiento = null,
    asesor = null, agencia = null, hotel = null, acomodacion = null, plazo = null,
    inf_nombres = null, inf_apellidos = null, inf_tipo_doc = null, inf_numero = null, inf_nacimiento = null,
    responsable_menor = null, updated_at = now()
  where id = p_silla_id;
  return jsonb_build_object('ok', true);
end $function$;

-- ═══ 3. Vista de cupos (196) ══════════════════════════════════════════════
create or replace view public.cupos_por_bloqueo with (security_invoker = true) as
 SELECT b.id,
    b.record,
    b.ruta,
    b.fecha_ida,
    b.cupos_total,
    count(s.id) FILTER (WHERE (s.estado = ANY (ARRAY['disponible'::estado_silla, 'cambio_entrante'::estado_silla]))) AS cupos_disponibles,
    count(s.id) FILTER (WHERE (s.estado = ANY (ARRAY['confirmada'::estado_silla, 'en_plazo'::estado_silla]))) AS cupos_ocupados,
    count(s.id) FILTER (WHERE (s.estado = 'devuelta'::estado_silla)) AS cupos_devueltos
   FROM (bloqueos_vuelo b
     LEFT JOIN sillas s ON ((s.bloqueo_id = b.id)))
  GROUP BY b.id, b.record, b.ruta, b.fecha_ida, b.cupos_total;

-- ═══ 4. Funciones, estado del cierre y registro nuevos de la 201 ══════════
drop function if exists public.crear_pasajeros_contrato_con_sillas(text, jsonb, integer, uuid, jsonb, jsonb);
drop function if exists public.crear_pasajeros_contrato_multi_con_sillas(text, jsonb, jsonb, uuid, jsonb, jsonb);
drop function if exists public._copiar_datos_sillas_contrato(text, bigint, jsonb, jsonb);
drop function if exists public.liberar_retencion_vencida(bigint, jsonb);
drop function if exists public.quitar_contrato_manual(bigint, date, jsonb);
drop function if exists public._quitar_contrato_manual(bigint, date, timestamptz, boolean);
drop function if exists public.editar_contrato_manual(bigint, text, jsonb);
drop function if exists public.liberar_silla(bigint, jsonb);
drop function if exists public.asignar_contrato_manual(bigint, text, jsonb);
drop function if exists public._asignar_contrato_manual(bigint, text, timestamptz);
drop function if exists public._version_silla_esperada(jsonb);
drop function if exists public._retencion_vencida(date, date);
drop function if exists public._registrar_firma_antigua(text, bigint);
drop function if exists public._registrar_firma_nueva();
drop function if exists public.programar_cierre_firmas_antiguas(integer, text);
drop function if exists public.cancelar_cierre_firmas_antiguas(text);
drop function if exists public._firmas_antiguas_cerradas();
drop table if exists public.vuelos_cierre_firmas_201;
drop function if exists public._vuelos_cierre_firmas_201_monotono();
drop table if exists public.vuelos_firmas_antiguas_uso;

-- ═══ 5. Permisos de los predicados (antes: solo service_role) ═════════════
revoke execute on function public._silla_libre(public.sillas) from authenticated;
revoke execute on function public._silla_con_datos(public.sillas) from authenticated;

commit;
