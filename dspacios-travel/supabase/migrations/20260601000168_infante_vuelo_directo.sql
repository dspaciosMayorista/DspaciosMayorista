-- ───────────────────────────────────────────────────────────────────────────
-- 168 · Gestión de infantes DIRECTAMENTE desde el detalle de un vuelo
--
-- Caso real que motiva esto: MIN-00-0541 es un contrato interno minorista
-- enlazado al bloqueo por `sillas.contrato_manual = '00-0541'` (texto libre,
-- migración 085) — no por `sillas.numero_contrato` (FK orgánica). Antes de
-- esta migración, agregar o editar un infante de ese contrato exigía abrir la
-- ficha completa del contrato (`guardar_pasajeros_contrato`, migración 167,
-- reemplazo TOTAL de la lista de pasajeros) — nada permitía hacerlo desde el
-- propio vuelo, ni acotado a un solo infante.
--
-- ⚠️ Esta migración NO modifica la 167: reutiliza sus reglas de negocio
-- (`es_infante_por_edad`, `edad_anios`, el trigger `trg_validar_responsable_
-- infante`) tal cual están, y agrega una función NUEVA y ESTRECHA que solo
-- toca UNA fila de `contrato_pasajeros` (nunca la lista completa, nunca
-- sillas, nunca holders/capacidad/precios/CxP/contrato_items).
--
-- ═════════════════════════════════════════════════════════════════════════
-- DISEÑO — por qué NO se reutiliza guardar_pasajeros_contrato
-- ═════════════════════════════════════════════════════════════════════════
-- `_reemplazar_pasajeros_nucleo` (migración 167) es un REEMPLAZO COMPLETO:
-- recibe la lista ENTERA de pasajeros del contrato y BORRA cualquiera que no
-- venga en el payload. Usarla para "agregar un infante" obligaría a mandar
-- también a todos los demás pasajeros (adultos con silla incluidos) en cada
-- llamada — exactamente el tipo de operación amplia que el pedido explícito
-- de "RPC estrecho" busca evitar. Por eso `guardar_infante_vuelo` (más abajo)
-- es una función NUEVA, propia, que solo hace INSERT/UPDATE de UNA fila
-- `es_infante = true` — nunca toca ninguna otra fila del contrato, nunca
-- llama a `_ajustar_sillas_nucleo` (los infantes no ocupan silla — no hay
-- nada que reconciliar), nunca escribe `ventas.pax` (semántica existente:
-- ese contador nunca fue sustituto de "pasajeros con silla", ver migración
-- 167 — se conserva intacta, no se adivina ni se corrige aquí).
--
-- ═════════════════════════════════════════════════════════════════════════
-- CÓMO SE RESUELVE EL CONTRATO — sin admitir un número suelto del navegador
-- ═════════════════════════════════════════════════════════════════════════
-- El cliente NUNCA manda un `numero_contrato` ni un `responsable_id`
-- directos: manda `p_bloqueo_id` + `p_silla_responsable_id` (la silla
-- CONCRETA del adulto, tal cual la reindió la página del vuelo) + los datos
-- del infante. La función:
--   1) Relee `bloqueos_vuelo.fecha_ida` DE VERDAD (server-side) para
--      clasificar INF/no-INF con `es_infante_por_edad` — nunca confía en que
--      el cliente ya haya clasificado bien.
--   2) Exige que `p_silla_responsable_id` sea una silla REAL de ESE
--      `p_bloqueo_id` (si no, error) — esta comprobación ES, a la vez, la
--      autorización estrecha de `control_vuelo` (ver más abajo) y el ancla
--      que resuelve a qué contrato pertenece el infante.
--   3) Resuelve el contrato EFECTIVO de esa silla exactamente como
--      `lib/vuelos/contratoManual.ts` (`candidatosNumeroContrato`): orgánico
--      (`sillas.numero_contrato`) si existe; si no, prueba la referencia de
--      `contrato_manual` tal cual y con el prefijo `MIN-` (si no lo trae ya)
--      contra `ventas` — exige encontrar EXACTAMENTE una, nunca adivina ante
--      0 o ≥2 candidatas (mismo criterio fail-closed que la resolución en
--      TypeScript, reescrito aquí en SQL porque esta función, al ser
--      SECURITY DEFINER, ya tiene acceso completo a `ventas` sin necesitar
--      un cliente admin de TypeScript — a diferencia de la lectura de
--      presentación del manifiesto, PR #289/#290/#291, que si lo necesita
--      porque corre con el cliente de sesión).
--   4) Ubica al pasajero RESPONSABLE en `contrato_pasajeros` por DOCUMENTO
--      (tipo + número de la silla) dentro de ESE contrato — nunca por
--      nombre. Exige encontrar exactamente uno.
--
-- ⚠️ RIESGO RESIDUAL DOCUMENTADO (no se resuelve aquí, exige tocar la 167,
-- que el pedido prohíbe explícitamente): el TRIGGER `trg_validar_responsable_
-- infante` deriva `es_infante`/mayoría de edad contra `ventas.fecha_salida`
-- (fecha del CONTRATO), mientras que esta función clasifica y valida contra
-- `bloqueos_vuelo.fecha_ida` (fecha REAL de ESE tramo/bloqueo) — la fecha
-- pedida explícitamente para esta funcionalidad. Para la enorme mayoría de
-- contratos (un solo bloqueo, `fecha_salida` = fecha del vuelo) coinciden.
-- Si un contrato abarca VARIOS bloqueos con fechas distintas, o su
-- `fecha_salida` quedó mal cargada, esta función puede clasificar como
-- infante (contra fecha_ida) un caso que el trigger, al correr sobre el
-- INSERT/UPDATE (BEFORE, mismas migración 167), reclasifique como NO
-- infante (contra fecha_salida) — ese trigger sobreescribe `new.es_infante`
-- directamente. Sin un chequeo aparte, eso dejaría guardado un pasajero SIN
-- silla que el sistema ya no considera infante (huérfano de clasificación).
-- Por eso el paso 8 de esta función relee la fila resultante (que ya refleja
-- lo que el trigger BEFORE decidió, vía RETURNING) y, si `es_infante` no
-- quedó en `true`, revierte TODA la transacción con un mensaje claro — nunca
-- se guarda a medias. No se sincronizan las dos fechas aquí: eso sigue
-- siendo una limitación estructural preexistente de `contrato_pasajeros`
-- (una fila de CONTRATO, no de bloqueo) — ver el comentario de
-- `_fecha_referencia_efectiva` en la migración 167.
--
-- ═════════════════════════════════════════════════════════════════════════
-- AUTORIZACIÓN — por qué `control_vuelo` NO amplía su alcance
-- ═════════════════════════════════════════════════════════════════════════
-- A diferencia de `acceso_editar_vuelos_contrato()` (migración 157, que le da
-- a `control_vuelo` acceso a CUALQUIER contrato de su tenant para editar
-- vuelos), aquí `control_vuelo` NO recibe ningún acceso general a
-- `ventas`/`contrato_pasajeros`: su ÚNICA puerta de entrada es haber resuelto
-- arriba una silla REAL de ESTE `bloqueo_id` — que es, por construcción,
-- exactamente "un responsable presente en el bloqueo" (pedido explícito).
-- Los demás roles internos (superadmin/gerencia/administracion/operaciones/
-- venta-asesor) necesitan además pasar `_autorizado_escribir_pasajeros()` —
-- el MISMO candado que ya exige `guardar_pasajeros_contrato` — así que para
-- ELLOS esta función no abre ninguna puerta nueva, solo un atajo más angosto
-- (una fila) sobre un permiso que ya tenían.
--
-- Preflight: supabase/scripts/preflight_168_infante_vuelo_directo.sql
-- Postcheck: supabase/scripts/postcheck_168_infante_vuelo_directo.sql
-- Rollback:  supabase/scripts/rollback_168_infante_vuelo_directo.sql
-- Probada ÚNICAMENTE contra una base Postgres local desechable — NO se ha
-- ejecutado en Supabase real.
-- ───────────────────────────────────────────────────────────────────────────

begin;

create or replace function public.guardar_infante_vuelo(
  p_bloqueo_id            bigint,
  p_silla_responsable_id  bigint,
  p_infante_id            bigint,
  p_nombres               text,
  p_apellidos             text,
  p_tipo_doc              text,
  p_numero_doc            text,
  p_fecha_nacimiento      date
)
returns table (
  id                bigint,
  nombre            text,
  tipo_id           text,
  identificacion    text,
  fecha_nacimiento  date,
  responsable_id    bigint,
  numero_contrato   text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol              rol_usuario;
  v_bloqueo          record;
  v_silla            record;
  v_nombre_completo  text;
  v_tipo_doc         text;
  v_numero_doc       text;
  v_fecha_ref        date;
  v_edad_resp        integer;
  v_numero_contrato  text;
  v_candidatos       text[];
  v_encontrados      text[];
  v_conteo_resp      integer;
  v_responsable_id   bigint;
  v_infante_actual   record;
  v_orden_nuevo      integer;
  v_resultado        record;
  v_es_infante_final boolean;
begin
  -- ── 0) Sesión real y activa (mi_rol() devuelve null si el usuario está
  -- desactivado — migración 140 — o no existe). El cliente NUNCA autoriza:
  -- todo lo que sigue se re-lee/re-decide aquí, server-side. ─────────────
  v_rol := public.mi_rol();
  if v_rol is null then
    raise exception 'No autorizado.';
  end if;

  -- ── 1) Validación de forma de los datos del infante (unknown hasta
  -- comprobarlo) — mismos límites/reglas que `_reemplazar_pasajeros_nucleo`
  -- (migración 167), para no divergir del resto del sistema. ─────────────
  if p_bloqueo_id is null or p_bloqueo_id <= 0 then
    raise exception 'Vuelo inválido.';
  end if;
  if p_silla_responsable_id is null or p_silla_responsable_id <= 0 then
    raise exception 'Debes indicar la silla del adulto responsable.';
  end if;
  if p_infante_id is not null and p_infante_id <= 0 then
    raise exception 'Infante inválido.';
  end if;

  v_nombre_completo := nullif(trim(concat_ws(' ', nullif(trim(p_nombres), ''), nullif(trim(p_apellidos), ''))), '');
  if v_nombre_completo is null then
    raise exception 'Nombres y apellidos son obligatorios.';
  end if;
  if length(v_nombre_completo) > 200 then
    raise exception 'El nombre es demasiado largo.';
  end if;

  if p_tipo_doc is null or length(trim(p_tipo_doc)) = 0 then
    raise exception 'El tipo de documento es obligatorio.';
  end if;
  v_tipo_doc := trim(p_tipo_doc);
  if length(v_tipo_doc) > 10 then
    raise exception 'El tipo de documento es inválido.';
  end if;

  if p_numero_doc is null or length(trim(p_numero_doc)) = 0 then
    raise exception 'El número de documento es obligatorio.';
  end if;
  v_numero_doc := trim(p_numero_doc);
  if length(v_numero_doc) > 30 then
    raise exception 'El número de documento es demasiado largo.';
  end if;
  if v_tipo_doc <> 'PAS' and v_numero_doc !~ '^\d+$' then
    raise exception 'El documento debe ser solo números (excepto Pasaporte).';
  end if;

  if p_fecha_nacimiento is null then
    raise exception 'La fecha de nacimiento es obligatoria.';
  end if;
  if p_fecha_nacimiento > current_date then
    raise exception 'La fecha de nacimiento no puede ser futura.';
  end if;

  -- ── 2) Vuelo real — la fecha de referencia sale de AQUÍ, nunca de lo que
  -- mande el cliente (relectura server-side, pedida explícitamente). ─────
  select bv.id, bv.fecha_ida into v_bloqueo from public.bloqueos_vuelo bv where bv.id = p_bloqueo_id;
  if not found then
    raise exception 'El vuelo indicado no existe.';
  end if;
  v_fecha_ref := coalesce(v_bloqueo.fecha_ida, current_date);

  if not public.es_infante_por_edad(p_fecha_nacimiento, v_fecha_ref) then
    raise exception 'Este pasajero tiene 2 años o más a la fecha del vuelo: debe registrarse con silla, no como infante.';
  end if;

  -- ── 3) La silla del responsable DEBE ser una silla real de ESTE vuelo —
  -- nunca se acepta un numero_contrato o responsable_id sueltos del
  -- navegador. Esta comprobación ES, a la vez, el ancla que resuelve el
  -- contrato Y la autorización estrecha de `control_vuelo` (ver cabecera).
  -- `for update`: serializa contra una edición concurrente de esta silla. ─
  select s.id, s.bloqueo_id, s.numero_contrato, s.contrato_manual, s.tipo_doc, s.numero_doc, s.nacimiento
    into v_silla
    from public.sillas s
   where s.id = p_silla_responsable_id and s.bloqueo_id = p_bloqueo_id
   for update;
  if not found then
    raise exception 'La silla del responsable no pertenece a este vuelo.';
  end if;
  if coalesce(trim(v_silla.tipo_doc), '') = '' or coalesce(trim(v_silla.numero_doc), '') = '' then
    raise exception 'La silla elegida no tiene documento registrado — no se puede confirmar como responsable.';
  end if;

  v_edad_resp := public.edad_anios(v_silla.nacimiento, v_fecha_ref);
  if v_edad_resp is null or v_edad_resp < 18 then
    raise exception 'El adulto responsable debe ser mayor de edad (18 años) a la fecha del vuelo.';
  end if;

  -- ── 4) Contrato EFECTIVO de esa silla — mismo criterio EXACTO que
  -- lib/vuelos/contratoManual.ts::candidatosNumeroContrato (orgánico, o
  -- contrato_manual tal cual / con prefijo MIN-, exigiendo UNA sola venta
  -- real entre los candidatos). ───────────────────────────────────────────
  if v_silla.numero_contrato is not null then
    v_numero_contrato := v_silla.numero_contrato;
  else
    if coalesce(trim(v_silla.contrato_manual), '') = '' then
      raise exception 'Esta silla no está asociada a ningún contrato — no se puede agregar un infante aquí.';
    end if;
    v_candidatos := array[trim(v_silla.contrato_manual)];
    if left(trim(v_silla.contrato_manual), 4) <> 'MIN-' then
      v_candidatos := array_append(v_candidatos, 'MIN-' || trim(v_silla.contrato_manual));
    end if;

    select array_agg(v.numero_contrato) into v_encontrados
      from public.ventas v
     where v.numero_contrato = any(v_candidatos);

    if v_encontrados is null or array_length(v_encontrados, 1) is null then
      raise exception 'La referencia "%" no corresponde a ninguna venta interna registrada — no se puede agregar el infante aquí.', trim(v_silla.contrato_manual);
    end if;
    if array_length(v_encontrados, 1) > 1 then
      raise exception 'La referencia "%" es ambigua: coincide con más de una venta interna. Corrígela desde el contrato antes de continuar.', trim(v_silla.contrato_manual);
    end if;
    v_numero_contrato := v_encontrados[1];
  end if;

  -- ── 5) Autorización — ver diseño en la cabecera del archivo. ───────────
  if v_rol <> 'control_vuelo' and not public._autorizado_escribir_pasajeros(v_numero_contrato, null) then
    raise exception 'Contrato no encontrado o sin permiso para editarlo.';
  end if;

  -- Bloquea la fila padre — mismo candado que el resto del módulo de
  -- pasajeros (guardar_pasajeros_contrato/_reemplazar_pasajeros_nucleo),
  -- para serializar con cualquier otra escritura sobre ESTE contrato.
  perform 1 from public.ventas v where v.numero_contrato = v_numero_contrato for update;

  -- ── 6) Responsable en `contrato_pasajeros`, por DOCUMENTO — nunca por
  -- nombre. Fail-closed: exige encontrar EXACTAMENTE uno. ─────────────────
  select count(*) into v_conteo_resp
    from public.contrato_pasajeros cp
   where cp.numero_contrato = v_numero_contrato
     and upper(trim(cp.tipo_id)) = upper(trim(v_silla.tipo_doc))
     and upper(trim(cp.identificacion)) = upper(trim(v_silla.numero_doc));

  if v_conteo_resp = 0 then
    raise exception 'No se encontró al responsable en los pasajeros del contrato — verifica su documento en el contrato antes de continuar.';
  end if;
  if v_conteo_resp > 1 then
    raise exception 'El documento del responsable está duplicado en el contrato — no se puede resolver de forma inequívoca.';
  end if;

  select cp.id into v_responsable_id
    from public.contrato_pasajeros cp
   where cp.numero_contrato = v_numero_contrato
     and upper(trim(cp.tipo_id)) = upper(trim(v_silla.tipo_doc))
     and upper(trim(cp.identificacion)) = upper(trim(v_silla.numero_doc));

  -- ── 7) Alta o edición — SOLO esta fila; nunca se toca ninguna otra fila
  -- de `contrato_pasajeros`, ninguna silla, ni ventas.pax/contrato_items/
  -- cuentas_por_pagar. El trigger `trg_validar_responsable_infante`
  -- (migración 167, sin modificar) sigue siendo la autoridad final. ──────
  if p_infante_id is not null then
    select cp.id, cp.numero_contrato, cp.es_infante into v_infante_actual
      from public.contrato_pasajeros cp
     where cp.id = p_infante_id;

    if not found then
      raise exception 'El infante indicado no existe.';
    end if;
    if v_infante_actual.numero_contrato is distinct from v_numero_contrato then
      raise exception 'El infante indicado no pertenece a este contrato.';
    end if;
    if not coalesce(v_infante_actual.es_infante, false) then
      raise exception 'Solo se pueden editar infantes desde aquí.';
    end if;

    update public.contrato_pasajeros cp
       set nombre           = v_nombre_completo,
           tipo_id          = v_tipo_doc,
           identificacion   = v_numero_doc,
           fecha_nacimiento = p_fecha_nacimiento,
           responsable_id   = v_responsable_id
     where cp.id = p_infante_id
    returning cp.id, cp.nombre, cp.tipo_id, cp.identificacion, cp.fecha_nacimiento, cp.responsable_id, cp.numero_contrato, cp.es_infante
      into v_resultado;
  else
    select coalesce(max(cp.orden), -1) + 1 into v_orden_nuevo
      from public.contrato_pasajeros cp
     where cp.numero_contrato = v_numero_contrato;

    insert into public.contrato_pasajeros
      (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, responsable_id, orden)
    values
      (v_numero_contrato, v_nombre_completo, v_tipo_doc, v_numero_doc, p_fecha_nacimiento, true, v_responsable_id, v_orden_nuevo)
    returning contrato_pasajeros.id, contrato_pasajeros.nombre, contrato_pasajeros.tipo_id, contrato_pasajeros.identificacion,
              contrato_pasajeros.fecha_nacimiento, contrato_pasajeros.responsable_id, contrato_pasajeros.numero_contrato,
              contrato_pasajeros.es_infante
      into v_resultado;
  end if;

  -- ── 8) Invariante final: el TRIGGER de la migración 167 (sin modificar,
  -- `fn_validar_responsable_infante`, BEFORE INSERT/UPDATE) es la autoridad
  -- que de verdad decide `es_infante`, derivándolo de `ventas.fecha_salida`
  -- (fecha del CONTRATO) — no de `bloqueos_vuelo.fecha_ida` (fecha REAL de
  -- ESTE bloqueo), que es lo que este RPC usó arriba para clasificar. Si
  -- ambas fechas divergen (contrato con varios bloqueos, o fecha_salida mal
  -- cargada), el trigger puede reescribir `es_infante` a `false` en la MISMA
  -- fila que este RPC insertó/actualizó como infante — dejaría un pasajero
  -- sin silla que el sistema ya no considera infante. En vez de guardarlo a
  -- medias, se revierte TODA la transacción con un mensaje claro: la fila
  -- vuelve exactamente al estado anterior (rollback automático de Postgres
  -- ante una excepción), nunca queda un pasajero huérfano de silla y de
  -- clasificación. Ver riesgo residual documentado en la cabecera. ────────
  v_es_infante_final := coalesce(v_resultado.es_infante, false);
  if not v_es_infante_final then
    raise exception 'La fecha de nacimiento clasifica como infante contra la fecha del vuelo (%), pero el contrato (fecha de salida) ya no lo considera infante — revisa la fecha de salida del contrato antes de continuar. No se guardó ningún cambio.', v_fecha_ref;
  end if;

  return query select v_resultado.id, v_resultado.nombre, v_resultado.tipo_id, v_resultado.identificacion,
                      v_resultado.fecha_nacimiento, v_resultado.responsable_id, v_resultado.numero_contrato;
end;
$$;

comment on function public.guardar_infante_vuelo(bigint, bigint, bigint, text, text, text, text, date) is
  'RPC ESTRECHO para agregar/editar UN infante (sin silla) directamente desde '
  'el detalle de un vuelo — nunca reemplaza la lista completa de pasajeros '
  '(eso sigue siendo guardar_pasajeros_contrato, migración 167, sin '
  'modificar). El cliente manda bloqueo_id + la silla CONCRETA del '
  'responsable (nunca un numero_contrato/responsable_id sueltos): el server '
  're-lee bloqueos_vuelo.fecha_ida para clasificar INF, exige que esa silla '
  'exista de verdad en ese vuelo (autorización estrecha de control_vuelo: '
  'sin acceso general a ventas/contrato_pasajeros, solo lo que resuelve esa '
  'silla), resuelve el contrato EFECTIVO (orgánico o contrato_manual, mismo '
  'criterio fail-closed que lib/vuelos/contratoManual.ts) y ubica al '
  'responsable en contrato_pasajeros por DOCUMENTO, nunca por nombre. Nunca '
  'toca sillas/capacidad/holders/precios/CxP/contrato_items/ventas.pax. '
  'Riesgo residual documentado en la cabecera de la migración 168: clasifica '
  'contra bloqueos_vuelo.fecha_ida, mientras el trigger de la 167 valida '
  'contra ventas.fecha_salida — pueden divergir en un contrato con varios '
  'bloqueos de fechas distintas; si divergen, esta función relee la fila '
  'resultante y revierte TODA la transacción si el trigger reclasificó '
  'es_infante a false, nunca queda a medias. Migración 168.';

revoke all on function public.guardar_infante_vuelo(bigint, bigint, bigint, text, text, text, text, date) from public;
revoke all on function public.guardar_infante_vuelo(bigint, bigint, bigint, text, text, text, text, date) from anon;
grant execute on function public.guardar_infante_vuelo(bigint, bigint, bigint, text, text, text, text, date) to authenticated;

commit;
