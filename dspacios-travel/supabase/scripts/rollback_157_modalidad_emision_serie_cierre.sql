-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 157 (modalidad_emision: CIERRE)
--
-- Reabre el CHECK/RPC a ('individual','serie','grupo') — el mismo estado
-- transitorio que dejó la 155. NO hay ningún dato que "devolver": la 157
-- convirtió cualquier 'individual' remanente a 'serie' y, para cuando este
-- rollback se ejecute, todo lo que antes era 'individual' ya está en
-- 'serie' — no existe una forma de saber cuáles filas eran 'individual'
-- antes del cierre (la migración no lo registra por diseño: mismo criterio
-- de la 153/154, nunca se inventa un dato). Si de verdad hace falta volver a
-- 'individual' fila por fila, es una operación manual aparte con la lista
-- de IDs a mano — este rollback NO la hace.
--
-- Uso: solo si hay que revertir un despliegue completo (código + 157) a la
-- fase transitoria (código viejo o mixto sirviendo tráfico otra vez).
--
-- Todo el archivo corre en una transacción explícita (`begin`/`commit`). Se
-- pega en el editor SQL de Supabase. Es idempotente.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- 1) CHECK constraint reabierto a individual/serie/grupo.
alter table public.bloqueos_vuelo
  drop constraint if exists bloqueos_vuelo_modalidad_emision_check;
alter table public.bloqueos_vuelo
  add constraint bloqueos_vuelo_modalidad_emision_check
  check (modalidad_emision in ('individual', 'serie', 'grupo'));

comment on column public.bloqueos_vuelo.modalidad_emision is
  'Serie o grupo (antes: individual/grupo — "individual" se renombra a "serie"). '
  'FASE TRANSITORIA (reabierta por rollback de la 157): el CHECK acepta ''individual'' '
  'además de ''serie''/''grupo''. Obligatoria en registros nuevos; null en registros '
  'anteriores a la 152 = "Sin definir", nunca se infiere.';

-- 2) RPC reabierto — mismo cuerpo que la migración 155 (dominio transitorio).
create or replace function public.actualizar_control_bloqueo(
  p_bloqueo_id        bigint,
  p_modalidad_emision text,
  p_estado_emision    text,
  p_estado_pago       text,
  p_nota              text
)
returns void
language plpgsql
as $$
declare
  v_modalidad_antes text;
  v_emision_antes   text;
  v_pago_antes      text;
  v_detalle         text := '';
  v_registrado_por  text;
begin
  if p_modalidad_emision not in ('individual', 'serie', 'grupo') then
    raise exception 'Modalidad de emisión inválida.';
  end if;
  if p_estado_emision not in ('pendiente', 'emitido') then
    raise exception 'Estado de emisión inválido.';
  end if;
  if p_estado_pago not in ('pendiente', 'pagado') then
    raise exception 'Estado de pago inválido.';
  end if;

  select modalidad_emision, estado_emision, estado_pago
    into v_modalidad_antes, v_emision_antes, v_pago_antes
    from public.bloqueos_vuelo
   where id = p_bloqueo_id
     for update;

  if not found then
    raise exception 'Bloqueo no encontrado o sin permiso para verlo.';
  end if;

  if coalesce(v_modalidad_antes, '') <> p_modalidad_emision then
    v_detalle := v_detalle || (case when v_detalle <> '' then ' · ' else '' end)
      || 'Modalidad de emisión: '
      || coalesce(case v_modalidad_antes when 'individual' then 'Serie' when 'serie' then 'Serie' when 'grupo' then 'Grupo' end, 'Sin definir')
      || ' → '
      || (case p_modalidad_emision when 'individual' then 'Serie' when 'serie' then 'Serie' when 'grupo' then 'Grupo' end);
  end if;

  if coalesce(v_emision_antes, '') <> p_estado_emision then
    v_detalle := v_detalle || (case when v_detalle <> '' then ' · ' else '' end)
      || 'Estado de emisión: '
      || coalesce(case v_emision_antes when 'pendiente' then 'Pendiente' when 'emitido' then 'Emitido' end, 'Sin definir')
      || ' → '
      || (case p_estado_emision when 'pendiente' then 'Pendiente' when 'emitido' then 'Emitido' end);
  end if;

  if coalesce(v_pago_antes, '') <> p_estado_pago then
    v_detalle := v_detalle || (case when v_detalle <> '' then ' · ' else '' end)
      || 'Estado de pago: '
      || coalesce(case v_pago_antes when 'pendiente' then 'Pendiente' when 'pagado' then 'Pagado' end, 'Sin definir')
      || ' → '
      || (case p_estado_pago when 'pendiente' then 'Pendiente' when 'pagado' then 'Pagado' end);
  end if;

  if v_detalle = '' and coalesce(trim(p_nota), '') = '' then
    raise exception 'No hay cambios para registrar.';
  end if;

  if v_detalle <> '' then
    update public.bloqueos_vuelo
       set modalidad_emision = p_modalidad_emision,
           estado_emision = p_estado_emision,
           estado_pago = p_estado_pago,
           updated_at = now()
     where id = p_bloqueo_id;

    if not found then
      raise exception 'No se pudo actualizar el bloqueo (sin permiso de escritura).';
    end if;
  end if;

  select coalesce(u.nombre, u.email) into v_registrado_por
    from public.usuarios u
   where u.id = auth.uid();

  insert into public.bloqueo_cambios (bloqueo_id, detalle, nota, registrado_por)
  values (p_bloqueo_id, nullif(v_detalle, ''), nullif(trim(p_nota), ''), v_registrado_por);
end;
$$;

comment on function public.actualizar_control_bloqueo(bigint, text, text, text, text) is
  'Actualiza modalidad/estado de emisión/estado de pago de un bloqueo y registra el cambio '
  'en bloqueo_cambios en UNA sola transacción (SELECT ... FOR UPDATE + UPDATE + INSERT) — '
  'si el INSERT del historial falla, el UPDATE también se revierte. SIN security definer. '
  'FASE TRANSITORIA (reabierta por rollback de la 157): dominio individual/serie/grupo.';

commit;
