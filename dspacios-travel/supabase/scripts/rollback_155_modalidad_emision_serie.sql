-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 155 (modalidad_emision: 'serie' vuelve a 'individual')
--
-- Deja `bloqueos_vuelo.modalidad_emision` EXACTAMENTE como estaba antes de la
-- 155: valores 'individual'/'grupo', mismo CHECK, mismo comentario de
-- columna. No pierde ningún dato — el UPDATE es una biyección exacta sobre
-- el rename de la 155 (todo lo que la 155 puso en 'serie' venía de
-- 'individual'; nada más pudo haber quedado en 'serie' porque el CHECK de
-- la 155 solo permite 'serie'/'grupo'/null).
--
-- ⚠️ Solo tiene sentido correrlo si el CÓDIGO de la aplicación también se
-- revierte al mismo tiempo (o antes): el código desplegado después de la 155
-- escribe/lee 'serie', así que si sigue corriendo mientras se aplica este
-- rollback, sus inserts/updates empezarán a fallar contra el CHECK viejo.
--
-- Todo el archivo corre en una transacción explícita (`begin`/`commit`), con
-- la misma verificación final que la migración original (en sentido
-- contrario). Se pega en el editor SQL de Supabase. Es idempotente.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- 1) Rename de datos en reversa — SOLO 'serie'. null y 'grupo' intactos.
update public.bloqueos_vuelo
   set modalidad_emision = 'individual'
 where modalidad_emision = 'serie';

-- 2) CHECK constraint de vuelta a individual/grupo.
alter table public.bloqueos_vuelo
  drop constraint if exists bloqueos_vuelo_modalidad_emision_check;
alter table public.bloqueos_vuelo
  add constraint bloqueos_vuelo_modalidad_emision_check
  check (modalidad_emision in ('individual', 'grupo'));

-- 3) Comentario restaurado (texto de la migración 152).
comment on column public.bloqueos_vuelo.modalidad_emision is
  'Individual o grupo. Obligatoria en registros nuevos (validada en crearBloqueo); '
  'null en registros anteriores a esta migración = "Sin definir" en la UI, nunca se infiere. Migración 152.';

-- 4) RPC restaurado — mismo cuerpo exacto de la migración 152 (dominio y
--    etiquetas individual/grupo).
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
  if p_modalidad_emision not in ('individual', 'grupo') then
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
      || coalesce(case v_modalidad_antes when 'individual' then 'Individual' when 'grupo' then 'Grupo' end, 'Sin definir')
      || ' → '
      || (case p_modalidad_emision when 'individual' then 'Individual' when 'grupo' then 'Grupo' end);
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
  'si el INSERT del historial falla, el UPDATE también se revierte. SIN security definer: '
  'corre con el rol del que llama, sujeta a las mismas policies de bloqueos_vuelo/bloqueo_cambios. '
  'Migración 152.';

-- 5) Verificación: cero 'serie' remanentes, cero violaciones del CHECK viejo.
do $$
declare
  v_remanentes bigint;
begin
  select count(*) into v_remanentes
    from public.bloqueos_vuelo
   where modalidad_emision = 'serie';

  if v_remanentes > 0 then
    raise exception 'ROLLBACK 155 FALLÓ: % filas siguen con modalidad_emision=''serie'' — el UPDATE de reversa no se aplicó a todas.', v_remanentes;
  end if;

  select count(*) into v_remanentes
    from public.bloqueos_vuelo
   where modalidad_emision is not null
     and modalidad_emision not in ('individual', 'grupo');

  if v_remanentes > 0 then
    raise exception 'ROLLBACK 155 FALLÓ: % filas tienen un modalidad_emision fuera de individual/grupo/null tras revertir.', v_remanentes;
  end if;
end $$;

commit;
