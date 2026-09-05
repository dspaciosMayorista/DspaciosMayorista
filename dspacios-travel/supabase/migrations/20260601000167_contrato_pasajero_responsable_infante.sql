-- ───────────────────────────────────────────────────────────────────────────
-- Migración 167 — vínculo durable INF→adulto responsable + reemplazo
-- transaccional de pasajeros + reconciliación atómica de sillas.
--
-- Retoma el pendiente de pasajeros ADT/CHD/INF en el inventario de vuelos
-- (sillas de bloqueos/records). NUNCA se ha ejecutado en Supabase real —
-- probada únicamente contra Postgres local desechable — así que esta
-- reescritura reemplaza el archivo tal cual, en vez de crear una migración
-- 168 de cierre (la 167 original tampoco había corrido en ningún lado).
--
-- ═════════════════════════════════════════════════════════════════════════
-- Revisión de alto riesgo sobre la versión anterior de este archivo —
-- hallazgos y rediseño
-- ═════════════════════════════════════════════════════════════════════════
--
-- B1 (vínculo NO es realmente obligatorio) — la versión anterior dejaba
--   `responsable_id` nullable sin ninguna regla que exigiera llenarlo, la UI
--   ofrecía "Sin vincular" sin condición, y los 3 flujos de creación insertan
--   infantes sin vínculo. Diseño corregido:
--   - La tabla sigue nullable (no se puede forzar NOT NULL sin inventar a
--     quién responde por un infante ya cargado antes de que este vínculo
--     existiera — eso SÍ sería "migrar relaciones históricas", que se pidió
--     explícitamente NO hacer).
--   - Lo obligatorio se mueve a la ÚNICA función que reemplaza pasajeros de
--     un contrato ya creado (`guardar_pasajeros_contrato`, ver abajo):
--     un infante NUEVO en el guardado (sin `id` existente, o que antes NO
--     era infante) exige `responsable_orden`; un infante YA EXISTENTE que ya
--     estaba sin vincular (`responsable_id is null` antes de este guardado)
--     puede seguir guardándose sin vincular — así el histórico queda
--     intacto, sin inventar nada, y CUALQUIER infante nuevo desde este punto
--     en adelante SÍ queda vinculado. Es monótono: un vínculo ya puesto no
--     se puede volver a dejar en null en el mismo guardado (solo reasignar a
--     otro adulto válido) — evita que "editar y guardar" regrese sin darse
--     cuenta un infante ya conforme a un estado no conforme.
--   - Los 3 flujos de CREACIÓN (reservar/actions.ts × 2, contratos/actions.ts)
--     siguen sin UI para elegir responsable — construirla en los 3
--     formularios es un cambio de UI mucho más grande, sobre el camino de
--     reserva más usado del sistema; se deja **explícitamente reportada como
--     decisión abierta** en el PR, no resuelta en silencio.
--
-- B2 (no es un hallazgo de esta migración — vive en el código TS que la
--   consume) — page.tsx no seleccionaba `responsable_id` y el estado inicial
--   de `EditarAsesorPasajeros.tsx` nunca lo convertía a `responsableIndex`;
--   cualquier guardado borraba en silencio el vínculo ya persistido. Se
--   corrige en el PR (page.tsx + EditarAsesorPasajeros.tsx), fuera de este
--   archivo SQL.
--
-- B3 (múltiples pasos sueltos, sin atomicidad) — la versión anterior hacía
--   DELETE + INSERT + N UPDATE (responsables) + 1 llamada RPC aparte
--   (`ajustar_sillas_por_pasajeros`) desde TypeScript, cada uno un viaje de
--   red distinto: un fallo a medio camino dejaba estado parcial. Diseño
--   corregido: **una sola función** `guardar_pasajeros_contrato(numero,
--   pasajeros jsonb)` hace TODO — valida, actualiza/inserta/borra por `id`
--   (mismo patrón YA usado por `guardar_tramos_contrato`, migración 157: NO
--   se borra y reinserta todo — se conserva el `id` de las filas que ya
--   existían, indispensable para saber cuáles son "históricas" y aplicar la
--   regla de abuelo del punto B1), relinkea responsables, y llama
--   internamente a `ajustar_sillas_por_pasajeros` — todo en la transacción
--   implícita de la función. Si cualquier paso falla, Postgres revierte TODO.
--
-- B4 (bloqueo_id no se puede volver a descubrir tras liberar todas las
--   sillas) — confirmado: si un contrato llega a 0 pasajeros con silla,
--   `ajustar_sillas_por_pasajeros` limpiaba `sillas.numero_contrato` de
--   TODAS sus sillas, y la única forma que tenía de encontrar el
--   `bloqueo_id` era `select bloqueo_id from sillas where numero_contrato =
--   X` — que ya no devuelve nada. **No hacía falta inventar una relación
--   nueva**: `ventas.bloqueo_ref_id` (migración 022, `bigint references
--   bloqueos_vuelo(id)`) YA es exactamente esa relación durable — nunca se
--   limpia al liberar sillas, y `reservarDesdeTarifarioInterno`
--   (app/(dashboard)/dashboard/reservar/actions.ts) YA la estampa al crear.
--   El hallazgo real es que **el flujo de contrato manual** (`crearContratoInterno`,
--   app/(dashboard)/dashboard/contratos/actions.ts) NUNCA la llenaba para
--   contratos tipo bloqueo — se corrige ahí (fuera de este archivo SQL) y
--   `ajustar_sillas_por_pasajeros` pasa a leer `ventas.bloqueo_ref_id`
--   PRIMERO, con el descubrimiento por `sillas` como respaldo para contratos
--   viejos que nunca la tuvieron estampada (no se inventa nada para esos:
--   siguen exactamente igual que antes).
--
-- B5 (creación: conteo divergente + sin candado de concurrencia) — confirmado
--   en los dos flujos de creación con silla: usaban `paxConSilla` (agregado
--   de la configuración de habitaciones) o `pax`/`holders.length || pax`
--   (con una caída semánticamente incorrecta al total de pasajeros CON
--   infantes) para el `.limit()` de sillas a tomar, en vez de recontar los
--   pasajeros REALES que sí ocupan silla (`holders.length`, ya calculado con
--   `esInfantePorEdad`/`pasajeroConsumeSilla`). Además, la selección de
--   sillas libres + la actualización en paralelo NO usan ningún candado
--   (`for update`), así que dos reservas concurrentes contra el MISMO
--   bloqueo pueden tomar las mismas sillas "libres" antes de que ninguna
--   confirme — y los errores del `Promise.all` de actualización se ignoraban
--   (reservar/actions.ts) o solo se registraban sin bloquear el contrato
--   (contratos/actions.ts). Se corrige en TypeScript (fuera de este archivo):
--   ambos flujos ahora usan `holders.length` (nunca un agregado que pueda
--   incluir infantes) y reservan las sillas llamando a
--   `ajustar_sillas_por_pasajeros` (que SÍ bloquea con `for update` el pool
--   completo de sillas del bloqueo), en vez de un `select` + `update`
--   paralelo sin candado.
--
-- Adicional, hallazgos puntuales corregidos en este archivo:
--   - `responsable_id ... on delete set null` → `on delete restrict`: con
--     SET NULL, borrar la fila del adulto (ej. al reemplazar pasajeros)
--     des-vinculaba al infante EN SILENCIO, sin pasar por ninguna validación
--     — rompía la propiedad "una vez vinculado, no se puede perder el
--     vínculo sin decisión explícita" del diseño de B1. Con RESTRICT, borrar
--     un adulto que todavía es responsable de alguien fallaría — por eso
--     `guardar_pasajeros_contrato` limpia `responsable_id` de TODAS las
--     filas del contrato ANTES de borrar ninguna (nunca hay una fila viva
--     apuntando a una que se está por borrar en el momento del DELETE).
--   - El trigger solo exigía "el responsable no es, a su vez, infante" —
--     eso permite que un NIÑO (CHD, es_infante=false pero menor de edad) sea
--     "responsable". Ahora valida edad real ≥ 18 años a la fecha de salida
--     del contrato (mismo criterio de edad que el resto del sistema,
--     replicado en SQL vía `public.edad_anios`/`public.es_infante_por_edad`
--     — mismo umbral que `lib/reservar/pasajeros.ts::esInfantePorEdad` y
--     `lib/utils.ts::calcularEdad`; si alguna vez cambia el umbral en TS,
--     hay que cambiarlo aquí también, no hay forma de compartir código entre
--     los dos lenguajes).
--   - `ajustar_sillas_por_pasajeros` repetía en un array literal
--     ('superadmin','gerencia','administracion','operaciones','venta') el
--     MISMO conjunto de roles que ya decide `puede_ver_contrato()` por sí
--     sola (ver su definición, migración 144: solo esos 5 roles pueden
--     hacer que devuelva true) — el array era 100% redundante y un riesgo de
--     divergencia si `puede_ver_contrato()` cambia de criterio sin que
--     alguien recuerde actualizar este archivo también. Se quita; queda
--     exactamente la misma condición que ya usa la policy `contrato_pasajeros:
--     interno` (migración 147): `puede_ver_contrato() AND (mi_rol() <>
--     'venta' OR soy_asesor_del_contrato())`.
--   - `ventas.pax` (auditado, sin cambios): representa el total de pasajeros
--     INCLUYENDO niños/infantes (ver comentario en
--     app/(dashboard)/dashboard/contratos/actions.ts, `crearContratoInterno`)
--     — nunca es "pasajeros con silla". Por eso ninguna cuenta de sillas
--     puede usar `pax` como sustituto de `holders.length`; documentado para
--     que no se repita la confusión.
--
-- Preflight: supabase/scripts/preflight_167_contrato_pasajero_responsable.sql
-- Postcheck: supabase/scripts/postcheck_167_contrato_pasajero_responsable.sql
-- Rollback:  supabase/scripts/rollback_167_contrato_pasajero_responsable.sql
-- Probada ÚNICAMENTE contra una base Postgres local desechable — NO se ha
-- ejecutado en Supabase real.
-- ───────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- A) Helpers de edad compartidos (SQL) — mismo umbral que
--    lib/utils.ts::calcularEdad / lib/reservar/pasajeros.ts::esInfantePorEdad.
--    Puros, sin acceso a tablas — PUBLIC puede ejecutarlos sin riesgo.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.edad_anios(p_fecha_nacimiento date, p_referencia date)
returns integer
language sql
immutable
as $$
  select case
    when p_fecha_nacimiento is null or p_referencia is null then null
    when p_fecha_nacimiento > p_referencia then null
    else extract(year from age(p_referencia, p_fecha_nacimiento))::int
  end;
$$;

comment on function public.edad_anios(date, date) is
  'Años cumplidos de p_fecha_nacimiento a p_referencia — mismo criterio que '
  'lib/utils.ts::calcularEdad (null si falta un dato o si el nacimiento es '
  'posterior a la referencia). Migración 167.';

create or replace function public.es_infante_por_edad(p_fecha_nacimiento date, p_referencia date)
returns boolean
language sql
immutable
as $$
  select coalesce(public.edad_anios(p_fecha_nacimiento, p_referencia) < 2, false);
$$;

comment on function public.es_infante_por_edad(date, date) is
  'true si, a p_referencia, el pasajero tiene menos de 2 años cumplidos — '
  'mismo umbral y mismo criterio fail-safe (edad indeterminada = false, '
  'nunca sub-contar el inventario) que lib/reservar/pasajeros.ts::'
  'esInfantePorEdad. Migración 167.';

-- ═════════════════════════════════════════════════════════════════════════
-- B) Vínculo INF → adulto responsable
-- ═════════════════════════════════════════════════════════════════════════

alter table public.contrato_pasajeros
  add column if not exists responsable_id bigint references public.contrato_pasajeros(id) on delete restrict;

comment on column public.contrato_pasajeros.responsable_id is
  'Solo para pasajeros es_infante=true: FK al pasajero ADULTO (mayor de edad '
  'real, no solo "no infante") del MISMO contrato que responde por este '
  'infante (durable — sobrevive recargas y ediciones, nunca solo estado de '
  'formulario). ON DELETE RESTRICT a propósito: nunca se puede borrar en '
  'silencio al responsable de alguien sin decidirlo explícitamente primero '
  '(desvincular o reasignar). Validado por el trigger '
  'trg_validar_responsable_infante: debe existir, mismo numero_contrato, no '
  'ser el propio pasajero, no ser a su vez infante, y ser mayor de edad (≥18 '
  'años) a la fecha de salida del contrato. Obligatorio para infantes NUEVOS '
  'o recién marcados como infante — ver guardar_pasajeros_contrato(); los '
  'infantes que ya existían sin vínculo antes de esta migración NO se '
  'migran/inventan un responsable. Migración 167.';

create index if not exists idx_contrato_pasajeros_responsable
  on public.contrato_pasajeros(responsable_id) where responsable_id is not null;

-- Integridad del vínculo — SECURITY DEFINER a propósito: es un chequeo de
-- HECHOS sobre la fila referenciada (existe / mismo contrato / no es
-- infante / es mayor de edad), no de permisos — la RLS de `contrato_pasajeros`
-- (migración 147) ya decidió, ANTES de que este trigger corra, si quien
-- escribe puede tocar esta fila. Sin DEFINER, un `venta` insertando el
-- infante y el adulto en la MISMA transacción podría toparse con visibilidad
-- parcial según el orden de evaluación; con DEFINER el trigger ve el hecho
-- real sin depender de eso, y nunca expone ninguna columna de la fila
-- referenciada al llamador (solo deja pasar o lanza una excepción genérica).
create or replace function public.fn_validar_responsable_infante()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resp       record;
  v_fecha_ref  date;
  v_edad_resp  integer;
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

  select id, numero_contrato, es_infante, fecha_nacimiento into v_resp
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

  -- No basta con "no ser infante" — un CHD (niño de, digamos, 8 años) tampoco
  -- puede ser responsable. Se exige mayoría de edad real (≥18) a la fecha de
  -- salida del contrato (o a hoy, si el contrato no tiene fecha de salida
  -- registrada — porción terrestre sin fecha, o dato aún no capturado).
  select v.fecha_salida into v_fecha_ref from public.ventas v where v.numero_contrato = new.numero_contrato;
  v_fecha_ref := coalesce(v_fecha_ref, current_date);
  v_edad_resp := public.edad_anios(v_resp.fecha_nacimiento, v_fecha_ref);

  if v_edad_resp is null or v_edad_resp < 18 then
    raise exception 'El adulto responsable debe ser mayor de edad (18 años) a la fecha de salida.';
  end if;

  return new;
end;
$$;

comment on function public.fn_validar_responsable_infante() is
  'Trigger BEFORE INSERT/UPDATE en contrato_pasajeros: valida responsable_id '
  '(existe, mismo contrato, no auto-referencia, no infante, mayor de edad '
  'real ≥18 a la fecha de salida). Es integridad de DATOS, no de acceso — la '
  'RLS de la tabla decide quién puede escribir la fila antes de que este '
  'trigger corra. Migración 167.';

drop trigger if exists trg_validar_responsable_infante on public.contrato_pasajeros;
create trigger trg_validar_responsable_infante
  before insert or update on public.contrato_pasajeros
  for each row execute function public.fn_validar_responsable_infante();

revoke all on function public.fn_validar_responsable_infante() from public;
revoke all on function public.fn_validar_responsable_infante() from anon;

-- ═════════════════════════════════════════════════════════════════════════
-- C) Reconciliación atómica de sillas — reutilizable por CREACIÓN y EDICIÓN
--
-- Diseño en tres piezas (revisión de alto riesgo — B5 audit de creación):
--   - `_ajustar_sillas_nucleo` (privada, sin candado de acceso propio): TODO
--     el mecanismo — candado del pool, conteo, capacidad, asignar/liberar.
--     Sin ella habría que duplicar esta lógica en dos funciones (edición y
--     creación), con el riesgo de que diverjan.
--   - `ajustar_sillas_por_pasajeros` (pública, `authenticated`): candado de
--     ACCESO por sesión real — mismo criterio que la policy
--     `contrato_pasajeros: interno` (migración 147). La usa la EDICIÓN
--     (`guardar_pasajeros_contrato`, con la sesión del usuario interno).
--   - `asignar_sillas_creacion` (pública, `service_role` ÚNICAMENTE): la
--     usan los flujos de CREACIÓN (`reservar/actions.ts`,
--     `contratos/actions.ts`), que corren con la clave de servicio porque
--     una reserva puede venir de un usuario externo B2B (agencia/freelance)
--     — `mi_rol()`/`puede_ver_contrato()` exigen un rol interno y NO
--     aplican aquí. En vez de confiar ciegamente en `service_role` (que ya
--     de por sí solo lo puede invocar código del servidor, nunca el
--     navegador), exige un `p_usuario_id` real y activo — mismo patrón que
--     `_autorizado_congelar_condiciones` (migración 165) — para que quede
--     un actor de verdad en el candado, aunque no se exija un rol
--     puntual (la reserva ya pasó su propia validación de negocio en
--     TypeScript antes de llegar aquí).
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public._ajustar_sillas_nucleo(
  p_numero_contrato text,
  p_holders_nuevo    integer
)
returns table(holders_total integer, silla_ids bigint[])
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
  v_ids             bigint[];
begin
  if p_numero_contrato is null or length(p_numero_contrato) = 0 or length(p_numero_contrato) > 30 then
    raise exception 'Número de contrato inválido.';
  end if;
  if p_holders_nuevo is null or p_holders_nuevo < 0 or p_holders_nuevo > 100 then
    raise exception 'Cantidad de pasajeros con silla inválida.';
  end if;

  -- Bloquea la fila padre (mismo orden/candado que actualizar_estado_emision_contrato,
  -- migración 157) para serializar con cualquier otra operación sobre ESTE contrato.
  perform 1 from public.ventas where ventas.numero_contrato = p_numero_contrato for update;

  -- Fuente PRIMARIA del bloqueo: `ventas.bloqueo_ref_id` (migración 022) —
  -- durable, estampado por los flujos de creación, y NUNCA se limpia al
  -- liberar sillas (a diferencia de `sillas.numero_contrato`, que sí se
  -- limpia). Sin esto, un contrato que llega a 0 sillas asignadas (todas
  -- liberadas) no tenía forma de volver a descubrir su bloqueo para
  -- reasignarle sillas más adelante. Respaldo: contratos que nunca tuvieron
  -- `bloqueo_ref_id` estampado (anteriores a este fix, o el camino de
  -- conversión de carrito con varios ítems/bloqueos por contrato, fuera de
  -- alcance de este cambio) siguen descubriendo el bloqueo por una silla ya
  -- asignada — igual que antes, no se inventa nada para ellos.
  select v.bloqueo_ref_id into v_bloqueo_id from public.ventas v where v.numero_contrato = p_numero_contrato;
  if v_bloqueo_id is null then
    select s.bloqueo_id into v_bloqueo_id
      from public.sillas s
     where s.numero_contrato = p_numero_contrato
     limit 1;
  end if;

  -- Sin sillas propias (porción terrestre/empaquetado/dinámico) ⇒ nada que
  -- reconciliar. No es un error: la mayoría de los contratos caen aquí.
  if v_bloqueo_id is null then
    return query select 0, array[]::bigint[];
    return;
  end if;

  -- Bloquea TODO el pool de sillas de este bloqueo (asignadas al contrato +
  -- libres) — necesario para que dos reservas/ediciones concurrentes del
  -- MISMO bloqueo nunca sub-cuenten la disponibilidad real.
  perform 1 from public.sillas where bloqueo_id = v_bloqueo_id for update;

  select count(*) into v_holders_actual
    from public.sillas
   where numero_contrato = p_numero_contrato
     and estado in ('en_plazo', 'confirmada');

  v_delta := p_holders_nuevo - v_holders_actual;

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
  elsif v_delta < 0 then
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

  select array_agg(id order by numero_silla) into v_ids
    from public.sillas
   where numero_contrato = p_numero_contrato
     and estado in ('en_plazo', 'confirmada');

  return query select p_holders_nuevo, coalesce(v_ids, array[]::bigint[]);
end;
$$;

comment on function public._ajustar_sillas_nucleo(text, integer) is
  'Mecanismo puro (SIN candado de acceso propio) de reconciliación atómica '
  'de sillas — candado del pool + conteo + capacidad + asignar/liberar. '
  'Privada: solo la llaman ajustar_sillas_por_pasajeros (edición,  '
  'authenticated) y asignar_sillas_creacion (creación, service_role), cada '
  'una con su propio candado de acceso ANTES de delegar aquí. Migración 167.';

revoke all on function public._ajustar_sillas_nucleo(text, integer) from public, anon, authenticated;

-- ── Wrapper para EDICIÓN (sesión real de un usuario interno) ──────────────
create or replace function public.ajustar_sillas_por_pasajeros(
  p_numero_contrato text,
  p_holders_nuevo    integer
)
returns table(holders_total integer, silla_ids bigint[])
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Mismo candado que la policy `contrato_pasajeros: interno` (migración
  -- 147) — SIN repetir su lista de roles: `puede_ver_contrato()` YA falla
  -- cerrado para cualquier rol fuera de {superadmin, gerencia,
  -- administracion, operaciones, venta} (ver su definición, migración 144),
  -- así que un array aparte con esos mismos 5 roles era pura duplicación.
  if not (
    public.puede_ver_contrato(p_numero_contrato)
    and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(p_numero_contrato))
  ) then
    raise exception 'Contrato no encontrado o sin permiso para editarlo.';
  end if;

  return query select * from public._ajustar_sillas_nucleo(p_numero_contrato, p_holders_nuevo);
end;
$$;

comment on function public.ajustar_sillas_por_pasajeros(text, integer) is
  'Wrapper de _ajustar_sillas_nucleo para la EDICIÓN de un contrato ya '
  'creado: exige una sesión real de usuario interno (mismo candado que la '
  'policy de contrato_pasajeros, migración 147). La llama '
  '`guardar_pasajeros_contrato` internamente. Migración 167.';

revoke all on function public.ajustar_sillas_por_pasajeros(text, integer) from public;
revoke all on function public.ajustar_sillas_por_pasajeros(text, integer) from anon;
grant execute on function public.ajustar_sillas_por_pasajeros(text, integer) to authenticated;

-- ── Wrapper para CREACIÓN (service_role — la reserva puede venir de un
--    usuario externo B2B, que nunca pasa el candado de rol interno de
--    arriba) — mismo patrón que `_autorizado_congelar_condiciones`
--    (migración 165): exige un actor real y activo, no confía ciegamente en
--    que "vino por service_role" sea suficiente (aunque solo código de
--    servidor puede invocar esta función — nunca el navegador).
create or replace function public.asignar_sillas_creacion(
  p_numero_contrato text,
  p_holders_nuevo    integer,
  p_usuario_id       uuid
)
returns table(holders_total integer, silla_ids bigint[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activo boolean;
begin
  if p_usuario_id is null then
    raise exception 'Se requiere un usuario autenticado.';
  end if;
  select activo into v_activo from public.usuarios where id = p_usuario_id;
  if v_activo is null then
    raise exception 'El usuario % no existe en el sistema.', p_usuario_id;
  end if;
  if not v_activo then
    raise exception 'El usuario está desactivado.';
  end if;

  return query select * from public._ajustar_sillas_nucleo(p_numero_contrato, p_holders_nuevo);
end;
$$;

comment on function public.asignar_sillas_creacion(text, integer, uuid) is
  'Wrapper de _ajustar_sillas_nucleo para la CREACIÓN de un contrato nuevo '
  '(reservar/actions.ts, contratos/actions.ts) — llamado con service_role '
  'porque la reserva puede venir de un usuario externo B2B (agencia/'
  'freelance), que nunca pasaría el candado de rol interno de '
  'ajustar_sillas_por_pasajeros. Exige un p_usuario_id real y activo (mismo '
  'patrón que _autorizado_congelar_condiciones, migración 165) — no exige un '
  'rol puntual porque la validación de negocio de la reserva ya ocurrió '
  'antes, en TypeScript. Migración 167.';

revoke all on function public.asignar_sillas_creacion(text, integer, uuid) from public, anon, authenticated;
grant execute on function public.asignar_sillas_creacion(text, integer, uuid) to service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- D) Reemplazo transaccional de pasajeros de un contrato — UNA sola función
--    (autorización → validar forma → bloquear → re-validar → upsert por id →
--    relinkear responsables → reconciliar sillas), mismo patrón que
--    `guardar_tramos_contrato` (migración 157).
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.guardar_pasajeros_contrato(
  p_numero_contrato text,
  p_pasajeros        jsonb
)
returns table (
  id                bigint,
  nombre            text,
  tipo_id           text,
  identificacion    text,
  fecha_nacimiento  date,
  es_infante        boolean,
  responsable_id    bigint,
  orden             integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_pasajeros  constant int := 50;
  v_claves_validas constant text[] := array['id', 'nombre', 'tipoId', 'identificacion', 'fechaNacimiento', 'responsableOrden'];
  v_n              integer;
  v_elem           jsonb;
  v_idx            integer := 0;
  v_id             bigint;
  v_ids_vistos     bigint[] := '{}';
  v_ids_mantener   bigint[] := '{}';
  v_clave          text;
  -- Arrays de trabajo, 1..v_n (una posición = una fila del payload, en orden).
  v_id_arr         bigint[];
  v_nombre_arr     text[];
  v_tipo_id_arr    text[];
  v_ident_arr      text[];
  v_fecha_nac_arr  date[];
  v_resp_orden_arr integer[];
  v_es_infante     boolean[];
  v_orden_a_id     bigint[];
  v_ref_fecha      date;
  v_i              integer;
  v_j              integer;
  v_prev_es_inf    boolean;
  v_prev_resp_id   bigint;
  v_prev_found     boolean;
  v_ajenos         integer;
  v_encontrados    integer;
  v_holders_nuevo  integer;
  v_new_id         bigint;
begin
  if p_numero_contrato is null or length(p_numero_contrato) = 0 or length(p_numero_contrato) > 30 then
    raise exception 'Número de contrato inválido.';
  end if;

  if not (
    public.puede_ver_contrato(p_numero_contrato)
    and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(p_numero_contrato))
  ) then
    raise exception 'Contrato no encontrado o sin permiso para editarlo.';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  -- FASE A — validación de FORMA/TIPO/LÍMITES del payload (`unknown` hasta
  -- comprobarlo), sin tocar el estado actual del contrato todavía.
  -- ═══════════════════════════════════════════════════════════════════════
  if p_pasajeros is null or jsonb_typeof(p_pasajeros) <> 'array' then
    raise exception 'El listado de pasajeros debe ser un arreglo.';
  end if;

  v_n := jsonb_array_length(p_pasajeros);
  if v_n < 1 then
    raise exception 'Debe haber al menos un pasajero.';
  end if;
  if v_n > v_max_pasajeros then
    raise exception 'No se pueden guardar más de % pasajeros en un solo contrato.', v_max_pasajeros;
  end if;

  v_id_arr := array_fill(null::bigint, array[v_n]);
  v_nombre_arr := array_fill(null::text, array[v_n]);
  v_tipo_id_arr := array_fill(null::text, array[v_n]);
  v_ident_arr := array_fill(null::text, array[v_n]);
  v_fecha_nac_arr := array_fill(null::date, array[v_n]);
  v_resp_orden_arr := array_fill(null::integer, array[v_n]);
  v_es_infante := array_fill(false, array[v_n]);
  v_orden_a_id := array_fill(null::bigint, array[v_n]);

  for v_elem in select t.value from jsonb_array_elements(p_pasajeros) with ordinality as t(value, ord) order by t.ord
  loop
    v_idx := v_idx + 1;

    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'Cada pasajero debe ser un objeto.';
    end if;

    for v_clave in select jsonb_object_keys(v_elem)
    loop
      if not (v_clave = any(v_claves_validas)) then
        raise exception 'Campo no reconocido en un pasajero: %.', v_clave;
      end if;
    end loop;

    -- id: ausente/null, o entero positivo — nunca repetido dentro del mismo payload.
    if v_elem ? 'id' and jsonb_typeof(v_elem->'id') <> 'null' then
      if jsonb_typeof(v_elem->'id') <> 'number' then
        raise exception 'El id de un pasajero debe ser numérico.';
      end if;
      begin
        v_id := (v_elem->>'id')::bigint;
      exception when others then
        raise exception 'El id de un pasajero es inválido.';
      end;
      if v_id is null or v_id <= 0 then
        raise exception 'El id de un pasajero debe ser un entero positivo.';
      end if;
      if v_id = any(v_ids_vistos) then
        raise exception 'Un pasajero repite el id % dentro del mismo guardado.', v_id;
      end if;
      v_ids_vistos := array_append(v_ids_vistos, v_id);
      v_ids_mantener := array_append(v_ids_mantener, v_id);
      v_id_arr[v_idx] := v_id;
    end if;

    if jsonb_typeof(v_elem->'nombre') is distinct from 'string' then
      raise exception 'El nombre de un pasajero es obligatorio.';
    end if;
    v_nombre_arr[v_idx] := nullif(trim(v_elem->>'nombre'), '');
    if v_nombre_arr[v_idx] is null then
      raise exception 'El nombre de un pasajero es obligatorio.';
    end if;
    if length(v_nombre_arr[v_idx]) > 200 then
      raise exception 'El nombre de un pasajero es demasiado largo.';
    end if;

    if v_elem ? 'tipoId' and jsonb_typeof(v_elem->'tipoId') not in ('null', 'string') then
      raise exception 'El tipo de documento de un pasajero es inválido.';
    end if;
    v_tipo_id_arr[v_idx] := coalesce(nullif(trim(v_elem->>'tipoId'), ''), 'CC');
    if length(v_tipo_id_arr[v_idx]) > 10 then
      raise exception 'El tipo de documento de un pasajero es inválido.';
    end if;

    if jsonb_typeof(v_elem->'identificacion') is distinct from 'string' then
      raise exception 'El número de documento de un pasajero es obligatorio.';
    end if;
    v_ident_arr[v_idx] := nullif(trim(v_elem->>'identificacion'), '');
    if v_ident_arr[v_idx] is null then
      raise exception 'El número de documento de un pasajero es obligatorio.';
    end if;
    if length(v_ident_arr[v_idx]) > 30 then
      raise exception 'El número de documento de un pasajero es demasiado largo.';
    end if;
    if v_tipo_id_arr[v_idx] <> 'PAS' and v_ident_arr[v_idx] !~ '^\d+$' then
      raise exception 'El documento debe ser solo números (excepto Pasaporte).';
    end if;

    if jsonb_typeof(v_elem->'fechaNacimiento') is distinct from 'string' then
      raise exception 'La fecha de nacimiento de un pasajero es obligatoria.';
    end if;
    declare
      v_fecha_txt text := nullif(trim(v_elem->>'fechaNacimiento'), '');
    begin
      if v_fecha_txt is null or v_fecha_txt !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'La fecha de nacimiento debe tener el formato AAAA-MM-DD.';
      end if;
      begin
        v_fecha_nac_arr[v_idx] := v_fecha_txt::date;
      exception when others then
        raise exception 'La fecha de nacimiento no existe en el calendario.';
      end;
    end;

    -- responsableOrden: ausente/null, o entero 1..v_n (posición DENTRO de
    -- este mismo arreglo — no un id de la base, todavía no existen los
    -- nuevos). Se valida en rango/auto-referencia aquí; que apunte a un
    -- adulto real (no infante recalculado) se valida más abajo, una vez que
    -- se conoce `v_es_infante` completo.
    if v_elem ? 'responsableOrden' and jsonb_typeof(v_elem->'responsableOrden') <> 'null' then
      if jsonb_typeof(v_elem->'responsableOrden') <> 'number' then
        raise exception 'El responsable indicado es inválido.';
      end if;
      begin
        v_resp_orden_arr[v_idx] := (v_elem->>'responsableOrden')::integer;
      exception when others then
        raise exception 'El responsable indicado es inválido.';
      end;
      if v_resp_orden_arr[v_idx] < 1 or v_resp_orden_arr[v_idx] > v_n then
        raise exception 'El adulto responsable indicado no existe en esta lista.';
      end if;
      if v_resp_orden_arr[v_idx] = v_idx then
        raise exception 'Un infante no puede ser su propio responsable.';
      end if;
    end if;
  end loop;

  -- Documento repetido dentro del mismo payload.
  for v_i in 1..v_n loop
    for v_j in (v_i + 1)..v_n loop
      if v_tipo_id_arr[v_i] = v_tipo_id_arr[v_j] and v_ident_arr[v_i] = v_ident_arr[v_j] then
        raise exception 'Documento repetido en la lista de pasajeros.';
      end if;
    end loop;
  end loop;

  -- ═══════════════════════════════════════════════════════════════════════
  -- Payload válido en su FORMA. Recién AHORA se bloquea la fila PADRE
  -- (ventas) — mismo orden/candado que `guardar_tramos_contrato` (migración
  -- 157): autorizar → validar forma → bloquear → re-validar contra el
  -- estado real → escribir. Dos guardados concurrentes del mismo contrato
  -- se serializan aquí.
  -- ═══════════════════════════════════════════════════════════════════════
  perform 1 from public.ventas where ventas.numero_contrato = p_numero_contrato for update;

  if not (
    public.puede_ver_contrato(p_numero_contrato)
    and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(p_numero_contrato))
  ) then
    raise exception 'Contrato no encontrado o sin permiso para editarlo.';
  end if;

  select v.fecha_salida into v_ref_fecha from public.ventas v where v.numero_contrato = p_numero_contrato;

  if array_length(v_ids_mantener, 1) > 0 then
    select count(*) into v_ajenos
      from public.contrato_pasajeros cp
     where cp.id = any(v_ids_mantener) and cp.numero_contrato <> p_numero_contrato;
    if v_ajenos > 0 then
      raise exception 'Uno de los pasajeros no pertenece a este contrato.';
    end if;

    select count(*) into v_encontrados
      from public.contrato_pasajeros cp
     where cp.id = any(v_ids_mantener) and cp.numero_contrato = p_numero_contrato;
    if v_encontrados <> array_length(v_ids_mantener, 1) then
      raise exception 'Uno de los pasajeros ya no existe (puede haber sido modificado por otro guardado mientras tanto). Vuelve a cargar la página e inténtalo de nuevo.';
    end if;
  end if;

  -- es_infante se recalcula SIEMPRE aquí, contra la fecha de salida YA
  -- bloqueada — nunca se recibe ni se confía en un valor mandado por el
  -- cliente (no existe siquiera esa clave en `v_claves_validas`).
  for v_i in 1..v_n loop
    v_es_infante[v_i] := public.es_infante_por_edad(v_fecha_nac_arr[v_i], coalesce(v_ref_fecha, current_date));

    if public.edad_anios(v_fecha_nac_arr[v_i], coalesce(v_ref_fecha, current_date)) < 18
       and v_tipo_id_arr[v_i] = 'CC' then
      raise exception 'Pasajero %: un menor no puede tener CC (usa RC o TI).', v_i;
    end if;
  end loop;

  -- Vínculo INF→responsable: obligatorio para un infante NUEVO en este
  -- guardado, o para uno que YA estaba vinculado (nunca se permite volver a
  -- dejarlo en null a propósito — monótono); se PERDONA (grandfather) un
  -- infante que YA existía sin vínculo antes de este guardado y que sigue
  -- sin traer uno — no se inventa ni se fuerza un vínculo histórico.
  for v_i in 1..v_n loop
    v_prev_found := false; v_prev_es_inf := null; v_prev_resp_id := null;
    if v_id_arr[v_i] is not null then
      select cp.es_infante, cp.responsable_id into v_prev_es_inf, v_prev_resp_id
        from public.contrato_pasajeros cp
       where cp.id = v_id_arr[v_i] and cp.numero_contrato = p_numero_contrato;
      v_prev_found := found;
    end if;

    if v_es_infante[v_i] then
      if v_resp_orden_arr[v_i] is null then
        if v_prev_found and coalesce(v_prev_es_inf, false) and v_prev_resp_id is null then
          -- Histórico sin vínculo, sigue sin vínculo: permitido (no se migra).
          continue;
        end if;
        raise exception 'El infante en la posición % debe tener un adulto responsable vinculado.', v_i;
      end if;
      if v_es_infante[v_resp_orden_arr[v_i]] then
        raise exception 'El adulto responsable no puede ser, a su vez, un infante.';
      end if;
    else
      if v_resp_orden_arr[v_i] is not null then
        raise exception 'Solo un infante puede tener un adulto responsable vinculado.';
      end if;
    end if;
  end loop;

  -- ═══════════════════════════════════════════════════════════════════════
  -- Mutación — upsert por id (conserva el id de las filas que ya existían,
  -- igual que `guardar_tramos_contrato`). `responsable_id` se limpia de
  -- TODAS las filas del contrato ANTES de borrar ninguna: con la FK en
  -- ON DELETE RESTRICT, ninguna fila viva puede quedar apuntando a una que
  -- se está por borrar en el mismo paso.
  -- ═══════════════════════════════════════════════════════════════════════
  update public.contrato_pasajeros set responsable_id = null where numero_contrato = p_numero_contrato;

  delete from public.contrato_pasajeros
   where contrato_pasajeros.numero_contrato = p_numero_contrato
     and (array_length(v_ids_mantener, 1) is null or not (contrato_pasajeros.id = any(v_ids_mantener)));

  for v_i in 1..v_n loop
    if v_id_arr[v_i] is not null then
      update public.contrato_pasajeros set
        nombre = v_nombre_arr[v_i],
        tipo_id = v_tipo_id_arr[v_i],
        identificacion = v_ident_arr[v_i],
        fecha_nacimiento = v_fecha_nac_arr[v_i],
        es_infante = v_es_infante[v_i],
        orden = v_i - 1
      where contrato_pasajeros.id = v_id_arr[v_i] and contrato_pasajeros.numero_contrato = p_numero_contrato;

      if not found then
        raise exception 'No se pudo actualizar un pasajero (id % no pertenece a este contrato).', v_id_arr[v_i];
      end if;
      v_orden_a_id[v_i] := v_id_arr[v_i];
    else
      insert into public.contrato_pasajeros
        (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
      values
        (p_numero_contrato, v_nombre_arr[v_i], v_tipo_id_arr[v_i], v_ident_arr[v_i], v_fecha_nac_arr[v_i], v_es_infante[v_i], v_i - 1)
      returning contrato_pasajeros.id into v_new_id;
      v_orden_a_id[v_i] := v_new_id;
    end if;
  end loop;

  -- Relinkea responsables usando el mapeo posición→id ya resuelto arriba
  -- (nunca se confía en el orden de retorno de un insert masivo).
  for v_i in 1..v_n loop
    if v_resp_orden_arr[v_i] is not null then
      update public.contrato_pasajeros
         set responsable_id = v_orden_a_id[v_resp_orden_arr[v_i]]
       where contrato_pasajeros.id = v_orden_a_id[v_i];
      -- El trigger corre aquí: existe, mismo contrato, no infante, mayor de edad.
    end if;
  end loop;

  -- Reconciliación de sillas (no-op si el contrato no usa sillas propias).
  -- Llama al NÚCLEO directo, no al wrapper `ajustar_sillas_por_pasajeros`:
  -- el acceso a ESTE contrato ya se validó arriba (dos veces, antes y
  -- después del candado), re-chequearlo aquí sería redundante.
  v_holders_nuevo := 0;
  for v_i in 1..v_n loop
    if not v_es_infante[v_i] then v_holders_nuevo := v_holders_nuevo + 1; end if;
  end loop;
  perform * from public._ajustar_sillas_nucleo(p_numero_contrato, v_holders_nuevo);

  return query
    select cp.id, cp.nombre, cp.tipo_id, cp.identificacion, cp.fecha_nacimiento,
           cp.es_infante, cp.responsable_id, cp.orden
      from public.contrato_pasajeros cp
     where cp.numero_contrato = p_numero_contrato
     order by cp.orden asc, cp.id asc;
end;
$$;

comment on function public.guardar_pasajeros_contrato(text, jsonb) is
  'Reemplazo transaccional y atómico de los pasajeros de un contrato ya '
  'creado: valida el payload completo (unknown en el límite), recalcula '
  'es_infante server-side, exige responsable_id para infantes nuevos (con '
  'excepción de abuelo para históricos sin vínculo), conserva el id de las '
  'filas que ya existían (upsert, mismo patrón que guardar_tramos_contrato, '
  'migración 157), y reconcilia el inventario de sillas del bloqueo llamando '
  'internamente a ajustar_sillas_por_pasajeros — todo en una sola '
  'transacción implícita. Reemplaza el flujo anterior de DELETE+INSERT+N '
  'UPDATE+1 llamada RPC aparte desde TypeScript. Migración 167.';

revoke all on function public.guardar_pasajeros_contrato(text, jsonb) from public;
revoke all on function public.guardar_pasajeros_contrato(text, jsonb) from anon;
grant execute on function public.guardar_pasajeros_contrato(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
