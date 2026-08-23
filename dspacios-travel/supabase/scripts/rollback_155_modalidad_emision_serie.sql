-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 155 (modalidad_emision: fase TRANSITORIA)
--
-- La 155 es puramente ADITIVA — no toca ningún dato, solo AMPLÍA el CHECK/RPC
-- para aceptar 'individual','serie','grupo' además de lo que ya aceptaban.
-- Revertirla es, por lo tanto, CERRAR de vuelta el dominio a solo
-- ('individual','grupo') — no hay ningún dato que "devolver" porque la 155
-- nunca escribió nada.
--
-- ⚠️ Solo tiene sentido correr este rollback si el CÓDIGO de la aplicación
-- también se revierte al mismo tiempo (o antes): el código desplegado
-- después de la 155 puede estar escribiendo 'serie', así que si sigue
-- corriendo mientras se aplica este rollback, sus inserts/updates a 'serie'
-- empezarán a fallar contra el CHECK cerrado.
--
-- ⚠️ Si la migración 158 (cierre) YA corrió, este rollback NO tiene sentido
-- — usa en su lugar `rollback_158_modalidad_emision_serie_cierre.sql`, que
-- reabre el dominio a individual/serie/grupo (158 dejó todo en 'serie', así
-- que cerrar aquí a individual/grupo dejaría CERO filas válidas si alguna
-- quedó en 'serie').
--
-- Todo el archivo corre en una transacción explícita (`begin`/`commit`). Se
-- pega en el editor SQL de Supabase. Es idempotente.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- 1) CHECK constraint de vuelta a individual/grupo (cierra 'serie').
alter table public.bloqueos_vuelo
  drop constraint if exists bloqueos_vuelo_modalidad_emision_check;
alter table public.bloqueos_vuelo
  add constraint bloqueos_vuelo_modalidad_emision_check
  check (modalidad_emision in ('individual', 'grupo'));

-- 2) Comentario restaurado (texto de la migración 152).
comment on column public.bloqueos_vuelo.modalidad_emision is
  'Individual o grupo. Obligatoria en registros nuevos (validada en crearBloqueo); '
  'null en registros anteriores a esta migración = "Sin definir" en la UI, nunca se infiere. Migración 152.';

-- 3) RPC restaurado — mismo cuerpo exacto de la migración 152 (dominio y
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

-- Mismo modelo de privilegios que la migración 155/158: `revoke ... from
-- public/anon` + `grant execute ... to authenticated`, nunca EXECUTE para
-- PUBLIC/anon. El `create or replace` de arriba NO basta por sí solo para
-- dejar `anon` sin acceso — Supabase le otorga EXECUTE directo a `anon` al
-- crear cualquier función nueva (`ALTER DEFAULT PRIVILEGES` a nivel de
-- proyecto), independiente de PUBLIC (ver el comentario de la migración
-- 155). Se repite aquí para que el rollback deje exactamente el mismo
-- estado de privilegios que tenía antes de la 155, nunca uno más abierto.
revoke all on function public.actualizar_control_bloqueo(bigint, text, text, text, text) from public;
revoke all on function public.actualizar_control_bloqueo(bigint, text, text, text, text) from anon;
grant execute on function public.actualizar_control_bloqueo(bigint, text, text, text, text) to authenticated;

-- 4) Verificación: cero filas con modalidad_emision fuera de individual/grupo/null.
do $$
declare
  v_remanentes bigint;
begin
  select count(*) into v_remanentes
    from public.bloqueos_vuelo
   where modalidad_emision is not null
     and modalidad_emision not in ('individual', 'grupo');

  if v_remanentes > 0 then
    raise exception 'ROLLBACK 155 FALLÓ: % filas tienen un modalidad_emision fuera de individual/grupo/null — probablemente ya corrió la 158 (que deja todo en ''serie''). Usa el rollback de la 158 en su lugar.', v_remanentes;
  end if;
end $$;

commit;
