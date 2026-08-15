-- ───────────────────────────────────────────────────────────────────────────
-- 151 · VUELOS — control general por record: modalidad, emisión y pago
--
-- QUÉ AGREGA
--   Tres campos MANUALES a nivel de `bloqueos_vuelo` (todo el record, no una
--   silla puntual), independientes del estado de las sillas:
--
--     modalidad_emision  'individual' | 'grupo'   — cómo se emite el vuelo.
--     estado_emision     'pendiente'  | 'emitido'  — si YA se emitió el vuelo.
--     estado_pago        'pendiente'  | 'pagado'   — si YA se le pagó al
--                         proveedor/aerolínea. **NO** es el pago del cliente
--                         (eso vive en `abonos`/`cuentas_por_pagar` por
--                         contrato) — deliberadamente no se cruza con eso.
--
-- POR QUÉ NO UN DEFAULT 'pendiente'
--   Un registro CREADO ANTES de esta migración no tiene forma de saber si ya
--   se emitió o se pagó — nadie cargó ese dato porque el campo no existía.
--   Si la columna naciera con `default 'pendiente'`, Postgres aplicaría ese
--   valor a TODAS las filas existentes (desde la v11, `add column ... default`
--   es metadata-only pero el efecto lógico es el mismo: toda fila vieja
--   quedaría mostrando 'pendiente'), afirmando algo que no se sabe. Las tres
--   columnas nacen sin default (`null`) — la UI muestra "Sin definir"/"Por
--   confirmar" para null, nunca "Pendiente". Un bloqueo NUEVO sí nace con
--   `estado_emision`/`estado_pago = 'pendiente'`, pero eso lo decide la
--   aplicación en el INSERT (`crearBloqueo`/`cargarBloqueosMasivo`), no un
--   default de columna — ahí sí es una afirmación verdadera: un record recién
--   creado genuinamente empieza pendiente.
--
-- MODALIDAD: sin default en absoluto, ni siquiera en bloqueos nuevos — el
--   formulario de creación la exige (`crearBloqueo` valida y rechaza si falta
--   o no es 'individual'/'grupo'). No hay un valor neutral razonable para
--   "modalidad no elegida" salvo null/"Sin definir".
--
-- QUÉ NO CAMBIA
--   No se toca `fecha_emision` (columna existente desde la 003): sigue siendo
--   la fecha LÍMITE/programada para emitir, no una prueba de que YA se emitió
--   — por eso NO se deduce `estado_emision='emitido'` de que `fecha_emision`
--   exista o haya pasado. La UI la renombra visualmente a "Fecha límite de
--   emisión" para que la distinción quede clara, sin tocar la columna.
--   No se recalculan tarifarios al cambiar solo estos tres campos (a
--   diferencia de `actualizarBloqueo`/`registrarCambioOperacional`, que sí
--   afectan tarifa/fechas del paquete armado).
--
-- REGISTRO DE CAMBIOS — ATÓMICO, vía `actualizar_control_bloqueo()`
--   La primera versión de esta migración dejaba que la Server Action hiciera
--   SELECT (estado anterior) + UPDATE (bloqueos_vuelo) + INSERT
--   (bloqueo_cambios) como tres llamadas sueltas de supabase-js — el mismo
--   patrón sin atomicidad que `registrarCambioOperacional` (migración 070) ya
--   tenía para cambios de horario/vuelo. Si el INSERT del historial fallaba
--   (red, constraint, lo que sea), el UPDATE ya había corrido: el bloqueo
--   quedaba con modalidad/emisión/pago cambiados pero SIN rastro en
--   `bloqueo_cambios` de que eso pasó, aunque la acción devolviera error.
--
--   Se reemplaza por una función de Postgres que hace SELECT ... FOR UPDATE
--   (bloquea la fila) + UPDATE + INSERT dentro de LA MISMA invocación —una
--   sola transacción implícita: si el INSERT final falla, TODO se revierte,
--   incluido el UPDATE.
--
--   `language plpgsql` SIN `security definer`: corre con el rol del que
--   llama (`authenticated`), sujeta a las MISMAS policies de `bloqueos_vuelo`/
--   `bloqueo_cambios` que ya existían (superadmin/administracion/gerencia/
--   operaciones/control_vuelo pueden escribir; `venta` puede LEER pero no
--   escribir ninguna de las dos). No usa `service_role` en ningún punto —
--   ni la función ni la Server Action que la llama.
--
--   El actor ("quién") se resuelve DENTRO de la función, desde
--   `public.usuarios` por `auth.uid()` (nombre si existe, si no el email del
--   perfil) — el mismo criterio que ya usaba `registrarCambioOperacional` en
--   TypeScript, pero ahora en SQL para que quede dentro de la transacción; no
--   se recibe como parámetro del cliente (evita que alguien se atribuya un
--   cambio que no hizo).
--
--   Nota sobre nota: si `modalidad_emision`/`estado_emision`/`estado_pago`
--   no cambian pero llega una nota, igual se registra (el UPDATE se SALTA —
--   nada que actualizar— pero el INSERT en `bloqueo_cambios` sí corre, con
--   `detalle` en null y la nota).
--
-- RLS: sin cambios en las policies existentes. Estas tres columnas viven en
--   `bloqueos_vuelo`, que ya tiene su policy de escritura (superadmin/
--   administracion/gerencia/operaciones/control_vuelo, migración 137) — una
--   columna nueva en una tabla existente la hereda automáticamente, Postgres
--   no tiene RLS por columna.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.bloqueos_vuelo
  add column if not exists modalidad_emision text,
  add column if not exists estado_emision    text,
  add column if not exists estado_pago       text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bloqueos_vuelo_modalidad_emision_check'
  ) then
    alter table public.bloqueos_vuelo
      add constraint bloqueos_vuelo_modalidad_emision_check
      check (modalidad_emision in ('individual', 'grupo'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bloqueos_vuelo_estado_emision_check'
  ) then
    alter table public.bloqueos_vuelo
      add constraint bloqueos_vuelo_estado_emision_check
      check (estado_emision in ('pendiente', 'emitido'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bloqueos_vuelo_estado_pago_check'
  ) then
    alter table public.bloqueos_vuelo
      add constraint bloqueos_vuelo_estado_pago_check
      check (estado_pago in ('pendiente', 'pagado'));
  end if;
end $$;

comment on column public.bloqueos_vuelo.modalidad_emision is
  'Individual o grupo. Obligatoria en registros nuevos (validada en crearBloqueo); '
  'null en registros anteriores a esta migración = "Sin definir" en la UI, nunca se infiere. Migración 151.';
comment on column public.bloqueos_vuelo.estado_emision is
  'Si el vuelo YA se emitió (independiente de fecha_emision, que es solo el límite). '
  'null = "Por confirmar" (no se sabe), distinto de ''pendiente'' (se sabe que falta). Migración 151.';
comment on column public.bloqueos_vuelo.estado_pago is
  'Si YA se pagó al proveedor/aerolínea. NO es el pago del cliente (abonos/cuentas_por_pagar '
  'son por contrato, esto es por record). null = "Por confirmar". Migración 151.';

-- ── Guardado atómico del control + su historial ─────────────────────────────
--
-- SIN `security definer`: corre con el rol del que llama, sujeta a las
-- MISMAS policies de `bloqueos_vuelo`/`bloqueo_cambios` que ya protegían
-- estas tablas (superadmin/administracion/gerencia/operaciones/control_vuelo
-- escriben; `venta` lee pero no escribe ninguna de las dos).
--
-- `select ... for update` bloquea la fila dentro de la transacción (evita
-- una carrera con otra edición concurrente del mismo bloqueo) Y, como es un
-- SELECT, ya respeta la policy de LECTURA de `bloqueos_vuelo` — si el rol no
-- puede ni ver el bloqueo, `not found` dispara abajo. La policy de ESCRITURA
-- se comprueba después, al hacer el UPDATE: para un rol que SÍ puede leer
-- pero NO escribir (ej. `venta`), Postgres no lanza error en un UPDATE cuyo
-- `using` no matchea ninguna fila — simplemente actualiza 0 filas en
-- silencio — por eso se verifica `if not found` también ahí.
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

  -- Detalle antes→después con las MISMAS etiquetas que ve el usuario — solo
  -- de lo que efectivamente cambió, nunca de los tres campos a la fuerza.
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

  -- Nada cambió y no hay nota → no hay nada que registrar (mismo criterio
  -- que la versión anterior en TypeScript).
  if v_detalle = '' and coalesce(trim(p_nota), '') = '' then
    raise exception 'No hay cambios para registrar.';
  end if;

  -- Si nada cambió pero SÍ hay nota, no hace falta tocar bloqueos_vuelo —
  -- solo queda el registro en bloqueo_cambios con detalle en null.
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

  -- Actor resuelto DENTRO de la función (nunca recibido como parámetro): un
  -- cliente no puede atribuirse un cambio ajeno. Mismo criterio que ya usaba
  -- la versión en TypeScript — nombre del perfil si existe, si no su email.
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
  'Migración 151.';

revoke all on function public.actualizar_control_bloqueo(bigint, text, text, text, text) from public;
grant execute on function public.actualizar_control_bloqueo(bigint, text, text, text, text) to authenticated;
