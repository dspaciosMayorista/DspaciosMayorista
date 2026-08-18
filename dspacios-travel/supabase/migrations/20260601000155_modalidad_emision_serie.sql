-- ───────────────────────────────────────────────────────────────────────────
-- 155 · VUELOS — modalidad_emision: 'individual' pasa a llamarse 'serie'
--
-- Migración 152 dejó `bloqueos_vuelo.modalidad_emision` con dos valores
-- posibles: 'individual' | 'grupo' (null = "Sin definir", nunca se infiere).
-- El dueño pidió renombrar el vocabulario a Serie/Grupo (más claro para el
-- negocio — un bloqueo "individual" en realidad es una emisión en SERIE,
-- silla por silla, contra un bloqueo negociado con la aerolínea) y dejar
-- planteado un tercer concepto, "Sistema", para el inventario nuevo de
-- Empaquetados (migración 156) — pero "Sistema" NUNCA se agrega al CHECK de
-- esta columna: un bloqueo negociado (`bloqueos_vuelo`) nunca es "Sistema"
-- por definición (esa es precisamente la distinción de negocio: bloqueo =
-- cupo negociado con la aerolínea; Sistema = tarifa comprada/cotizada por
-- sistema, sin cupo negociado). "Sistema" queda como la modalidad IMPLÍCITA
-- y fija de toda fila de `empaquetados` cuando se muestra fusionada en
-- Control Vuelos — no una tercera opción de este CHECK.
--
-- QUÉ HACE
--   1. Renombra el valor de datos: UPDATE ... SET modalidad_emision='serie'
--      WHERE modalidad_emision='individual'. NUNCA toca null (sigue siendo
--      "Sin definir", nunca se le asume un valor) ni 'grupo'.
--   2. Reemplaza el CHECK constraint por modalidad_emision in ('serie','grupo').
--   3. Actualiza el comentario de la columna.
--   4. Verifica: cero filas deben quedar en 'individual' después del UPDATE,
--      y cero filas deben violar el nuevo CHECK — si algo no cuadra, aborta
--      (nunca se fuerza un valor ni se deja el rename a medias).
--
--   5. Reemplaza el RPC `actualizar_control_bloqueo()` (migración 152) por
--      una versión que valida/etiqueta 'serie' en vez de 'individual' — el
--      cuerpo original tenía el dominio válido y las etiquetas del historial
--      ("Individual"/"Grupo") escritas a mano dentro de la función; sin este
--      reemplazo, guardar 'serie' desde el formulario de Control fallaría
--      con "Modalidad de emisión inválida." (el RPC seguiría validando
--      contra el dominio viejo). El resto de la función (SELECT...FOR
--      UPDATE + UPDATE + INSERT atómico en `bloqueo_cambios`, resolución del
--      actor por `auth.uid()`, sin `security definer`) queda IDÉNTICO.
--
-- QUÉ NO CAMBIA
--   `estado_emision`/`estado_pago` (mismos valores, no forman parte de este
--   rename), la tabla `bloqueo_cambios`, y toda la mecánica del RPC salvo el
--   dominio/etiquetas de modalidad (punto 5).
--
-- ATOMICIDAD: todo el archivo corre en una transacción explícita
-- (`begin`/`commit`). Si la verificación final falla, Postgres revierte
-- también el UPDATE y el cambio de constraint — nunca queda el rename a
-- medias (datos ya en 'serie' pero el constraint todavía aceptando
-- 'individual', o viceversa).
--
-- ROLLBACK PROBADO: `supabase/scripts/rollback_155_modalidad_emision_serie.sql`
-- — vuelve 'serie'→'individual' sin perder ningún dato (mismo criterio:
-- transaccional, verificado, nunca toca null/'grupo').
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- 1) Rename de datos — SOLO 'individual'. null y 'grupo' quedan intactos.
update public.bloqueos_vuelo
   set modalidad_emision = 'serie'
 where modalidad_emision = 'individual';

-- 2) CHECK constraint nuevo (serie/grupo).
alter table public.bloqueos_vuelo
  drop constraint if exists bloqueos_vuelo_modalidad_emision_check;
alter table public.bloqueos_vuelo
  add constraint bloqueos_vuelo_modalidad_emision_check
  check (modalidad_emision in ('serie', 'grupo'));

-- 3) Comentario actualizado.
comment on column public.bloqueos_vuelo.modalidad_emision is
  'Serie o grupo (antes de la migración 155: individual/grupo — "individual" se '
  'renombró a "serie"). Obligatoria en registros nuevos (validada en crearBloqueo); '
  'null en registros anteriores a la 152 = "Sin definir" en la UI, nunca se infiere. '
  '"Sistema" (la tercera modalidad del negocio) NUNCA es un valor de esta columna: '
  'es la modalidad implícita de toda fila de la tabla `empaquetados` (migración 156) '
  'cuando se muestra fusionada en Control Vuelos. Migración 155.';

-- 5) RPC actualizado — mismo cuerpo que la migración 152, solo cambia el
--    dominio válido ('serie' en vez de 'individual') y las etiquetas del
--    historial. `create or replace` conserva la firma exacta (mismos 5
--    parámetros posicionales), así que no hace falta `drop function` ni
--    volver a hacer `grant`/`revoke` (esos privilegios sobreviven un REPLACE).
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
  'Modalidad válida: serie/grupo (renombrado desde individual/grupo en la migración 155).';

-- 4) Verificación: cero 'individual' remanentes, cero violaciones del CHECK.
do $$
declare
  v_remanentes bigint;
begin
  select count(*) into v_remanentes
    from public.bloqueos_vuelo
   where modalidad_emision = 'individual';

  if v_remanentes > 0 then
    raise exception '155 FALLÓ: % filas siguen con modalidad_emision=''individual'' después del rename — el UPDATE no se aplicó a todas.', v_remanentes;
  end if;

  select count(*) into v_remanentes
    from public.bloqueos_vuelo
   where modalidad_emision is not null
     and modalidad_emision not in ('serie', 'grupo');

  if v_remanentes > 0 then
    raise exception '155 FALLÓ: % filas tienen un modalidad_emision fuera de serie/grupo/null tras el rename — revisar antes de continuar.', v_remanentes;
  end if;
end $$;

commit;
