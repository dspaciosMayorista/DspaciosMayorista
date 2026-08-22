-- ───────────────────────────────────────────────────────────────────────────
-- 157 · VUELOS — modalidad_emision: CIERRE del rename individual → serie
--
-- ⚠️ NO CORRER en el mismo despliegue que la 155/156. Orden documentado
-- (idéntico en estructura al de 153/154, cotizaciones):
--   1) migración 155 (transitoria: CHECK/RPC aceptan individual+serie+grupo)
--      · 2) migración 156 (empaquetados, aditiva, independiente) · 3) fusionar
--      y desplegar el código nuevo (lee individual/serie como "Serie",
--      escribe solo 'serie') · 4) smoke test: crear/editar un bloqueo desde
--      el formulario, confirmar en la BD que quedó guardado 'serie' · 5)
--      recién ENTONCES correr ESTA migración · 6) correr
--      `supabase/scripts/test_empaquetados.sql`.
--
-- QUÉ HACE
--   1. Convierte cualquier 'individual' remanente a 'serie' (todo lo que el
--      código nuevo no haya reescrito todavía por sí solo — ediciones no
--      disparadas durante la ventana de transición).
--   2. Cierra el CHECK a solo ('serie','grupo').
--   3. Cierra el RPC `actualizar_control_bloqueo()` a solo validar/etiquetar
--      serie/grupo (mismo cuerpo que tenía la versión original de la 155,
--      antes de reescribirla como transitoria).
--   4. Verifica: cero filas deben quedar en 'individual', cero violaciones
--      del CHECK nuevo — si algo no cuadra, aborta (nunca se fuerza un valor
--      ni se deja el cierre a medias).
--   5. Repite explícitamente `revoke ... from public/anon` + `grant execute
--      ... to authenticated` sobre `actualizar_control_bloqueo()` (ronda
--      posterior, consulta preventiva en producción — ver el comentario
--      junto al `revoke`, más abajo): la 152 ya lo hacía, pero solo contra
--      PUBLIC, y Supabase le da a `anon` un grant EXECUTE directo al crear
--      la función — sin revocárselo a `anon` explícitamente, ese acceso
--      sobrevive cualquier `create or replace` por más que el `revoke from
--      public` se repita.
--
-- QUÉ NO CAMBIA
--   `estado_emision`/`estado_pago`, `bloqueo_cambios`, y el resto del RPC
--   salvo el dominio/etiquetas de modalidad.
--
-- ATOMICIDAD: todo el archivo corre en una transacción explícita
-- (`begin`/`commit`) — si la verificación final falla, Postgres revierte
-- también el UPDATE y el cambio de constraint.
--
-- ROLLBACK PROBADO: `supabase/scripts/rollback_157_modalidad_emision_serie_cierre.sql`
-- — reabre el CHECK/RPC a individual/serie/grupo (no hay dato que revertir:
-- una vez cerrado, no queda ningún 'individual' que "devolver").
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- 1) Cualquier 'individual' remanente pasa a 'serie'. null y 'grupo' intactos.
update public.bloqueos_vuelo
   set modalidad_emision = 'serie'
 where modalidad_emision = 'individual';

-- 2) CHECK constraint cerrado (serie/grupo).
alter table public.bloqueos_vuelo
  drop constraint if exists bloqueos_vuelo_modalidad_emision_check;
alter table public.bloqueos_vuelo
  add constraint bloqueos_vuelo_modalidad_emision_check
  check (modalidad_emision in ('serie', 'grupo'));

comment on column public.bloqueos_vuelo.modalidad_emision is
  'Serie o grupo (antes de la migración 155: individual/grupo — "individual" se '
  'renombró a "serie"; cerrado en la 157). Obligatoria en registros nuevos (validada '
  'en crearBloqueo); null en registros anteriores a la 152 = "Sin definir" en la UI, '
  'nunca se infiere. "Sistema" (la tercera modalidad del negocio) NUNCA es un valor de '
  'esta columna: es la modalidad implícita de toda fila de la tabla `empaquetados` '
  '(migración 156) cuando se muestra fusionada en Control Vuelos. Migración 157.';

-- 3) RPC cerrado a serie/grupo — mismo cuerpo que la migración 152 (dominio
--    original), solo con las etiquetas 'serie'→"Serie" en vez de
--    'individual'→"Individual".
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
  if p_modalidad_emision not in ('serie', 'grupo') then
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
      || coalesce(case v_modalidad_antes when 'serie' then 'Serie' when 'grupo' then 'Grupo' end, 'Sin definir')
      || ' → '
      || (case p_modalidad_emision when 'serie' then 'Serie' when 'grupo' then 'Grupo' end);
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
  'Modalidad válida: serie/grupo (cerrado en la migración 157; individual/serie/grupo durante '
  'la transición de la 155).';

-- Repetido explícitamente (152, 155, 157) — nunca se asume que sobrevive
-- solo. Consulta preventiva en producción (antes de correr esta migración):
-- `actualizar_control_bloqueo` tenía `anon EXECUTE = true` pese al `revoke
-- ... from public` de la 152 — Supabase otorga EXECUTE directo a
-- `anon`/`authenticated` sobre funciones nuevas vía `ALTER DEFAULT
-- PRIVILEGES` a nivel de proyecto, así que hace falta revocárselo a `anon`
-- explícitamente, no solo a PUBLIC. Ver el mismo bloque en la migración 155.
revoke all on function public.actualizar_control_bloqueo(bigint, text, text, text, text) from public;
revoke all on function public.actualizar_control_bloqueo(bigint, text, text, text, text) from anon;
grant execute on function public.actualizar_control_bloqueo(bigint, text, text, text, text) to authenticated;

-- 4) Verificación: cero 'individual' remanentes, cero violaciones del CHECK.
do $$
declare
  v_remanentes bigint;
begin
  select count(*) into v_remanentes
    from public.bloqueos_vuelo
   where modalidad_emision = 'individual';

  if v_remanentes > 0 then
    raise exception '157 FALLÓ: % filas siguen con modalidad_emision=''individual'' después del cierre — el UPDATE no se aplicó a todas.', v_remanentes;
  end if;

  select count(*) into v_remanentes
    from public.bloqueos_vuelo
   where modalidad_emision is not null
     and modalidad_emision not in ('serie', 'grupo');

  if v_remanentes > 0 then
    raise exception '157 FALLÓ: % filas tienen un modalidad_emision fuera de serie/grupo/null tras el cierre — revisar antes de continuar.', v_remanentes;
  end if;
end $$;

commit;
