-- ───────────────────────────────────────────────────────────────────────────
-- PROPUESTA (NO es una migración; NO aplicar todavía) · las reservas solo
-- toman sillas realmente libres. Tareas 2 y 3, R1 (diseño §6.8.4).
--
-- ⚠️ CAMBIA EL CUPO VENDIBLE: una silla "disponible" con cualquier dato del
-- grupo D (pasajero de carga masiva sin contrato, o residuo de una liberación
-- antigua) deja de contarse y de venderse. Antes de convertir esto en una
-- migración hay que correr en Producción
-- supabase/scripts/diagnostico_r1_r2_lectura.sql (solo lectura) y revisar con
-- el usuario cuántas sillas y records cambian.
--
-- Requiere 194 (_silla_libre) y 196 (núcleo con _vaciar_sillas: esta versión
-- parte de la de la 196, así que no la deshace).
--
-- Cambia:
--   1. cupos_por_bloqueo.cupos_disponibles → solo sillas libres de verdad
--      (tarifario, vitrina y pantalla de Reservar leen esta vista). Se agrega
--      al final la columna cupos_disponibles_con_datos para ver la diferencia.
--   2. _ajustar_sillas_bloqueo_nucleo (167/196): cuenta y asigna solo sillas
--      libres de verdad (lo usan crear_pasajeros_contrato y
--      crear_pasajeros_contrato_multi).
-- Además habría que cambiar en el código (no incluido aquí):
--   · reservar/actions.ts (pre-chequeos de cupo, hoy por estado) para que
--     cuenten con la misma regla (p. ej. leyendo cupos_por_bloqueo); si no se
--     cambian, una reserva sin cupo real falla en el núcleo con "No hay
--     suficientes sillas" (sin sobreventa, pero con un mensaje más tardío).
--   · vuelos/actions.ts cargarPasajerosMasivo: elegir sillas con la misma
--     regla (hoy solo mira estado y nombre).
-- Prueba: supabase/scripts/test_propuesta_reservas_solo_libres.sql (aplica
-- esta propuesta DENTRO de una transacción y la revierte).
-- ───────────────────────────────────────────────────────────────────────────

create or replace view public.cupos_por_bloqueo as
 SELECT b.id,
    b.record,
    b.ruta,
    b.fecha_ida,
    b.cupos_total,
    count(s.id) FILTER (WHERE public._silla_libre(s)) AS cupos_disponibles,
    count(s.id) FILTER (WHERE s.estado = ANY (ARRAY['confirmada'::estado_silla, 'en_plazo'::estado_silla])) AS cupos_ocupados,
    count(s.id) FILTER (WHERE s.estado = 'devuelta'::estado_silla) AS cupos_devueltos,
    count(s.id) FILTER (WHERE s.estado = ANY (ARRAY['disponible'::estado_silla, 'cambio_entrante'::estado_silla]) AND NOT public._silla_libre(s)) AS cupos_disponibles_con_datos
   FROM bloqueos_vuelo b
     LEFT JOIN sillas s ON s.bloqueo_id = b.id
  GROUP BY b.id, b.record, b.ruta, b.fecha_ida, b.cupos_total;

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
    -- PROPUESTA: solo sillas libres de verdad (_silla_libre, 194): una silla
    -- "disponible" con datos de otra persona (carga masiva o residuo) ya no
    -- cuenta ni se asigna.
    select count(*) into v_disponibles
      from public.sillas s
     where s.bloqueo_id = p_bloqueo_id
       and public._silla_libre(s);

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
       select s.id from public.sillas s
        where s.bloqueo_id = p_bloqueo_id
          and public._silla_libre(s)
        order by s.numero_silla
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
