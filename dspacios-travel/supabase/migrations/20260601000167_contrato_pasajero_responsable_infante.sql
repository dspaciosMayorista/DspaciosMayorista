-- ───────────────────────────────────────────────────────────────────────────
-- Migración 167 — vínculo durable INF→adulto responsable + reconciliación
-- atómica de sillas al editar pasajeros del contrato.
--
-- Retoma el pendiente de pasajeros ADT/CHD/INF en el inventario de vuelos
-- (sillas de bloqueos/records). Auditoría previa (ver PR): antes de esta
-- migración `contrato_pasajeros.es_infante` (boolean) era el único concepto
-- de "tipo de pasajero" para contrato/vuelo, pero:
--   - No existía ningún vínculo estructural infante→adulto responsable (ni
--     FK, ni columna) — solo una etiqueta visual "(infante)" en el documento
--     del contrato, sin decir a QUIÉN acompaña.
--   - `sillas.responsable_menor` (migración 003, columna de texto libre)
--     nunca se llena con datos reales en ningún flujo de escritura vigente
--     (confirmado por auditoría de código) — no es un precedente a repetir.
--   - Editar los pasajeros de un contrato ya creado (`actualizarPasajerosContrato`,
--     app/(dashboard)/dashboard/contratos/[numero]/editar-contrato-actions.ts)
--     hace DELETE + INSERT completo de `contrato_pasajeros` pero NUNCA toca
--     `sillas` — agregar/quitar un pasajero con silla no ajusta el inventario.
--
-- Esta migración agrega DOS piezas, ambas ADITIVAS (no se toca ninguna
-- migración ya aplicada):
--
--   A) `contrato_pasajeros.responsable_id` — self-FK a la misma tabla (mismo
--      patrón de `puc_cuentas.padre_id`, migración 126), validada por un
--      trigger de integridad (no de acceso — la RLS existente de
--      `contrato_pasajeros`, migración 147, ya decide quién puede escribir
--      la FILA; este trigger solo garantiza que, SI se escribe, el vínculo
--      sea válido): el responsable debe existir, pertenecer al MISMO
--      contrato, no ser el propio pasajero, y no ser a su vez infante. Solo
--      un pasajero marcado `es_infante = true` puede tener `responsable_id`.
--
--   B) `ajustar_sillas_por_pasajeros(numero_contrato, holders_nuevo)` — RPC
--      atómico (mismo patrón que `actualizar_estado_emision_contrato`,
--      migración 157: candado de acceso reutilizando los MISMOS helpers ya
--      definidos — `puede_ver_contrato`/`soy_asesor_del_contrato`/`mi_rol()`,
--      nunca una lista de roles nueva — luego `for update` sobre la fila
--      padre y sobre el POOL de sillas del bloqueo, para que dos ediciones
--      concurrentes del mismo bloqueo se serialicen). Dado un contrato con
--      sillas propias (solo bloqueo negociado las usa — porción terrestre,
--      empaquetado y dinámico nunca tocan `sillas`, ver migración 156/comentario
--      en reservar/actions.ts), ajusta cuántas sillas tiene asignadas ese
--      contrato para que calcen con `holders_nuevo` (pasajeros que SÍ
--      consumen silla — ADT+CHD, nunca infantes, decidido en TypeScript por
--      `lib/reservar/pasajeros.ts::pasajeroConsumeSilla`, la única fuente de
--      verdad de ese cálculo). Si faltan sillas disponibles en el bloqueo,
--      falla la función ENTERA (ninguna silla queda a medio asignar) — nunca
--      un ajuste parcial.
--
-- NO se toca ningún dato de infante en `sillas` (`inf_nombres`/`responsable_menor`
-- y similares) — siguen sin usarse, tal como ya estaban; el vínculo INF→adulto
-- vive exclusivamente en `contrato_pasajeros`, que es la tabla que YA lista a
-- TODOS los pasajeros (incluidos infantes) para documentos/manifiestos.
--
-- Preflight: supabase/scripts/preflight_167_contrato_pasajero_responsable.sql
-- Postcheck: supabase/scripts/postcheck_167_contrato_pasajero_responsable.sql
-- Rollback:  supabase/scripts/rollback_167_contrato_pasajero_responsable.sql
-- Probada ÚNICAMENTE contra una base Postgres local desechable — NO se ha
-- ejecutado en Supabase real.
-- ───────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- A) Vínculo INF → adulto responsable
-- ═════════════════════════════════════════════════════════════════════════

alter table public.contrato_pasajeros
  add column if not exists responsable_id bigint references public.contrato_pasajeros(id) on delete set null;

comment on column public.contrato_pasajeros.responsable_id is
  'Solo para pasajeros es_infante=true: FK al pasajero ADULTO/no-infante del '
  'MISMO contrato que responde por este infante (durable — sobrevive recargas '
  'y ediciones, nunca solo estado de formulario). Validado por el trigger '
  'trg_validar_responsable_infante: debe existir, mismo numero_contrato, no '
  'ser el propio pasajero, y su fila referenciada debe tener es_infante=false. '
  'Migración 167.';

create index if not exists idx_contrato_pasajeros_responsable
  on public.contrato_pasajeros(responsable_id) where responsable_id is not null;

-- Integridad del vínculo — SECURITY DEFINER a propósito: es un chequeo de
-- HECHOS sobre la fila referenciada (existe / mismo contrato / no es
-- infante), no de permisos — la RLS de `contrato_pasajeros` (migración 147)
-- ya decidió, ANTES de que este trigger corra, si quien escribe puede tocar
-- esta fila. Sin DEFINER, un `venta` insertando el infante y el adulto en la
-- MISMA transacción podría toparse con visibilidad parcial según el orden de
-- evaluación; con DEFINER el trigger ve el hecho real sin depender de eso, y
-- nunca expone ninguna columna de la fila referenciada al llamador (solo
-- deja pasar o lanza una excepción genérica).
create or replace function public.fn_validar_responsable_infante()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resp record;
begin
  if new.responsable_id is null then
    return new;
  end if;

  if new.responsable_id = new.id then
    raise exception 'Un pasajero no puede ser su propio responsable.';
  end if;

  if not coalesce(new.es_infante, false) then
    raise exception 'Solo un infante puede tener un adulto responsable vinculado.';
  end if;

  select id, numero_contrato, es_infante into v_resp
    from public.contrato_pasajeros
   where id = new.responsable_id;

  if not found then
    raise exception 'El adulto responsable indicado no existe.';
  end if;

  if v_resp.numero_contrato is distinct from new.numero_contrato then
    raise exception 'El adulto responsable debe pertenecer al mismo contrato.';
  end if;

  if v_resp.es_infante then
    raise exception 'El adulto responsable no puede ser, a su vez, un infante.';
  end if;

  return new;
end;
$$;

comment on function public.fn_validar_responsable_infante() is
  'Trigger BEFORE INSERT/UPDATE en contrato_pasajeros: valida responsable_id '
  '(existe, mismo contrato, no auto-referencia, no infante). Es integridad de '
  'DATOS, no de acceso — la RLS de la tabla decide quién puede escribir la '
  'fila antes de que este trigger corra. Migración 167.';

drop trigger if exists trg_validar_responsable_infante on public.contrato_pasajeros;
create trigger trg_validar_responsable_infante
  before insert or update on public.contrato_pasajeros
  for each row execute function public.fn_validar_responsable_infante();

revoke all on function public.fn_validar_responsable_infante() from public;
revoke all on function public.fn_validar_responsable_infante() from anon;

-- ═════════════════════════════════════════════════════════════════════════
-- B) Reconciliación atómica de sillas al editar pasajeros
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.ajustar_sillas_por_pasajeros(
  p_numero_contrato text,
  p_holders_nuevo    integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bloqueo_id      bigint;
  v_estado_muestra  public.estado_silla;
  v_holders_actual  integer;
  v_delta           integer;
  v_disponibles     integer;
begin
  if p_numero_contrato is null or length(p_numero_contrato) = 0 or length(p_numero_contrato) > 30 then
    raise exception 'Número de contrato inválido.';
  end if;
  if p_holders_nuevo is null or p_holders_nuevo < 0 or p_holders_nuevo > 100 then
    raise exception 'Cantidad de pasajeros con silla inválida.';
  end if;

  -- Mismo candado que `contrato_pasajeros: interno` (migración 147) — se
  -- REUTILIZAN sus mismos helpers, nunca una lista de roles nueva.
  if public.mi_rol() not in ('superadmin','gerencia','administracion','operaciones','venta')
     or not public.puede_ver_contrato(p_numero_contrato)
     or (public.mi_rol() = 'venta' and not public.soy_asesor_del_contrato(p_numero_contrato))
  then
    raise exception 'Contrato no encontrado o sin permiso para editarlo.';
  end if;

  -- Bloquea la fila padre (mismo orden/candado que actualizar_estado_emision_contrato,
  -- migración 157) para serializar con cualquier otra operación sobre ESTE contrato.
  perform 1 from public.ventas where numero_contrato = p_numero_contrato for update;

  select bloqueo_id into v_bloqueo_id
    from public.sillas
   where numero_contrato = p_numero_contrato
   limit 1;

  -- Sin sillas propias (porción terrestre/empaquetado/dinámico) ⇒ nada que
  -- reconciliar. No es un error: la mayoría de los contratos caen aquí.
  if v_bloqueo_id is null then
    return 0;
  end if;

  -- Bloquea TODO el pool de sillas de este bloqueo (asignadas al contrato +
  -- libres) — necesario para que dos reservas/ediciones concurrentes del
  -- MISMO bloqueo nunca sub-cuenten la disponibilidad real (el defecto que
  -- ya existía, a propósito, en la asignación al crear — ver comentario de
  -- reservar/actions.ts — esta función SÍ lo cierra para el camino de editar).
  perform 1 from public.sillas where bloqueo_id = v_bloqueo_id for update;

  select count(*) into v_holders_actual
    from public.sillas
   where numero_contrato = p_numero_contrato
     and estado in ('en_plazo', 'confirmada');

  v_delta := p_holders_nuevo - v_holders_actual;

  if v_delta = 0 then
    return v_holders_actual;
  end if;

  if v_delta > 0 then
    select count(*) into v_disponibles
      from public.sillas
     where bloqueo_id = v_bloqueo_id
       and estado in ('disponible', 'cambio_entrante');

    if v_disponibles < v_delta then
      raise exception 'No hay suficientes sillas disponibles en el bloqueo (% disponibles, % requeridas).', v_disponibles, v_delta;
    end if;

    -- El estado de las sillas NUEVAS hereda el de las que el contrato YA
    -- tenía (en_plazo o confirmada) — nunca un estado inventado; si el
    -- contrato no tenía ninguna silla previa (holders_actual = 0, primera
    -- vez que gana pasajeros con silla), nace en_plazo.
    select estado into v_estado_muestra
      from public.sillas
     where numero_contrato = p_numero_contrato
       and estado in ('en_plazo', 'confirmada')
     limit 1;
    v_estado_muestra := coalesce(v_estado_muestra, 'en_plazo');

    update public.sillas
       set estado = v_estado_muestra, numero_contrato = p_numero_contrato
     where id in (
       select id from public.sillas
        where bloqueo_id = v_bloqueo_id
          and estado in ('disponible', 'cambio_entrante')
        order by numero_silla
        limit v_delta
     );
  else
    update public.sillas
       set estado = 'disponible', numero_contrato = null,
           pasajero_nombres = null, pasajero_apellidos = null, tipo_doc = null,
           numero_doc = null, nacimiento = null, asesor = null, hotel = null,
           acomodacion = null, plazo = null
     where id in (
       select id from public.sillas
        where numero_contrato = p_numero_contrato
          and estado in ('en_plazo', 'confirmada')
        order by numero_silla desc
        limit (-v_delta)
     );
  end if;

  return p_holders_nuevo;
end;
$$;

comment on function public.ajustar_sillas_por_pasajeros(text, integer) is
  'Ajusta atómicamente cuántas sillas de un bloqueo tiene asignadas un '
  'contrato para que calcen con holders_nuevo (pasajeros que consumen silla, '
  'ver lib/reservar/pasajeros.ts::pasajeroConsumeSilla — nunca cuenta '
  'infantes). No-op (retorna 0) si el contrato no usa sillas propias. Falla '
  'ENTERA (ningún cambio parcial) si falta capacidad para un aumento. '
  'Candado: mismos roles/pertenencia que la policy de contrato_pasajeros '
  '(migración 147). Migración 167.';

revoke all on function public.ajustar_sillas_por_pasajeros(text, integer) from public;
revoke all on function public.ajustar_sillas_por_pasajeros(text, integer) from anon;
grant execute on function public.ajustar_sillas_por_pasajeros(text, integer) to authenticated;

notify pgrst, 'reload schema';
