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
-- SEGUNDA revisión de alto riesgo (independiente) sobre la versión anterior
-- de este archivo — B1 y B5 NO se consideraron cerrados. Hallazgos y
-- rediseño de esta ronda:
-- ═════════════════════════════════════════════════════════════════════════
--
-- B1 (vínculo aún NO obligatorio en la autoridad SQL) — la versión anterior
--   dejaba el trigger `fn_validar_responsable_infante` con
--   `if new.responsable_id is null then return new;` SIN condición alguna:
--   aceptaba CUALQUIER infante sin vínculo, en INSERT o UPDATE, viniera de
--   donde viniera. Solo `guardar_pasajeros_contrato` (la función TypeScript
--   que se usa para EDITAR) aplicaba la regla de "abuelo" — pero un INSERT
--   directo (los 3 flujos de creación, que insertaban `contrato_pasajeros`
--   sin pasar por esa función) no tocaba esa función en absoluto, así que el
--   trigger los dejaba pasar sin más. Peor: como el "abuelo" de
--   `guardar_pasajeros_contrato` se decidía mirando el ESTADO ANTERIOR de la
--   fila (`es_infante`/`responsable_id` antes de este guardado) sin ninguna
--   marca que distinguiera "esto ya era así ANTES de que existiera esta
--   regla" de "esto quedó así por un INSERT directo hace un minuto", CUALQUIER
--   infante colado por un INSERT directo se volvía indistinguible de uno
--   genuinamente histórico en la siguiente edición — el hueco se perpetuaba.
--
--   Diseño corregido — la autoridad se mueve al propio TRIGGER, no a una
--   función de aplicación en particular, así protege CUALQUIER camino de
--   escritura (RPC de edición, RPC de creación, o un INSERT/UPDATE directo
--   que alguna vez se cuele por otro lado):
--   - Nueva tabla `_pasajeros_exentos_167`: una FOTO INMUTABLE, tomada UNA
--     SOLA VEZ al aplicar esta migración, de los ids de `contrato_pasajeros`
--     que EN ESE MOMENTO ya eran `es_infante=true` con `responsable_id=null`
--     (el 100% de los infantes existentes, porque la columna `responsable_id`
--     recién se agrega en esta misma migración). Sin GRANTs de
--     INSERT/UPDATE/DELETE para NINGÚN rol de aplicación — ni siquiera
--     `service_role` — así que nada de lo que corra después de este `INSERT`
--     puede agregarle una fila nueva. Es un HECHO histórico congelado, no una
--     bandera que alguna función pueda activar por conveniencia.
--   - `fn_validar_responsable_infante` ahora SIEMPRE rechaza
--     `es_infante=true AND responsable_id is null`, salvo que el `id` de esa
--     fila exista en `_pasajeros_exentos_167`. Como la tabla de exención
--     jamás vuelve a recibir una fila nueva, esto implica que CUALQUIER
--     INSERT nuevo de un infante sin responsable se rechaza siempre (su `id`
--     nunca puede estar en la foto congelada) — cierra el hueco de raíz, sin
--     depender de que la aplicación use tal o cual función.
--   - Para que este trigger INMEDIATO (no diferido) no rompa el propio
--     reemplazo transaccional de pasajeros (que necesita, dentro de una
--     misma llamada, poder mover un vínculo de un adulto a otro, o insertar
--     un infante nuevo junto con su adulto nuevo), `_guardar_pasajeros_nucleo`
--     (ver más abajo) se reescribió para que CADA fila, en CADA statement que
--     la toca, quede siempre en un estado ya válido — nunca hay un paso
--     intermedio de "responsable_id = null a la fuerza, ya lo religo después"
--     como tenía la versión anterior (ese paso intermedio era, de hecho, la
--     única razón por la que el trigger viejo TENÍA que aceptar null sin
--     condición: si se endurecía sin cambiar el orden de escritura, el propio
--     mecanismo de reemplazo se rompía a sí mismo).
--   - Los 3 flujos de CREACIÓN (`reservarDesdeTarifarioInterno`/
--     `reservarProgramaInterno` en reservar/actions.ts,
--     `crearContratoInterno` en contratos/actions.ts) se reescriben (fuera de
--     este archivo) para pasar por el mismo mecanismo transaccional
--     (`crear_pasajeros_contrato`, ver parte D) — y los 3 formularios reales
--     (`ReservaForm.tsx`, `ProgramaReservaForm.tsx`, `NuevoContratoForm.tsx`)
--     ganan un selector de "adulto responsable" para cada fila que resulte
--     infante por fecha de nacimiento real. Si de todas formas se intenta
--     crear un infante sin responsable por cualquiera de estos 3 caminos, el
--     RPC lo rechaza con un mensaje claro — nunca lo guarda en silencio sin
--     vínculo (la autoridad real es siempre el trigger, esto es una
--     validación de aplicación adicional para un mensaje más claro).
--
-- B5 (creación solo parcialmente atómica) — confirmado en ambos flujos con
--   sillas: `reservarDesdeTarifarioInterno` asignaba las sillas (RPC atómico)
--   y LUEGO insertaba `contrato_pasajeros` en una llamada Supabase aparte —
--   un fallo en ese segundo paso dejaba sillas ya tomadas sin ningún pasajero
--   guardado. `crearContratoInterno` insertaba pasajeros y solo DESPUÉS
--   intentaba las sillas; si el RPC de sillas fallaba, el flujo se marcaba
--   "parcial" internamente pero terminaba devolviendo `ok: true` de todas
--   formas — un fallo de capacidad podía reportarse como éxito.
--
--   Diseño corregido — pasajeros + responsables + sillas se confirman o
--   revierten JUNTOS, en una sola función Postgres (una sola transacción):
--   - `_guardar_pasajeros_nucleo(numero, pasajeros, holders_min,
--     min_pasajeros, usuario_creacion)` es ahora el ÚNICO mecanismo que
--     reemplaza los pasajeros de un contrato Y reconcilia sus sillas (llama
--     internamente a `_ajustar_sillas_nucleo`, migración 167 original) — sin
--     candado de acceso propio, reutilizable por edición y creación.
--   - `guardar_pasajeros_contrato` (edición, sesión interna) y
--     `crear_pasajeros_contrato` (creación, `service_role` + usuario real y
--     activo) son wrappers delgados que solo autorizan y delegan.
--   - Los flujos de creación en TypeScript pasan de "asignar sillas, LUEGO
--     insertar pasajeros por separado" (o viceversa) a UNA sola llamada a
--     `crear_pasajeros_contrato` — si cualquier parte falla (payload
--     inválido, capacidad insuficiente, vínculo faltante), Postgres revierte
--     TODO: no quedan sillas tomadas sin pasajero, ni pasajero guardado sin
--     su silla, y la Server Action nunca devuelve `ok: true` en ese caso.
--   - `p_holders_min`: la reserva puede legítimamente crearse con la lista de
--     pasajeros VACÍA (`convertirCotizacion` con `override` de superadmin,
--     "captura los pasajeros después") mientras la composición de
--     habitaciones YA exige un número de sillas — por eso el número de
--     sillas a reservar es `GREATEST(p_holders_min, pasajeros reales que no
--     son infante en este payload)`: nunca menos de lo que declara la
--     composición de habitaciones (evita sub-reservar cuando todavía no hay
--     nombres), nunca menos de lo que de verdad aparece nombrado en el
--     payload (evita sub-reservar si un pasajero nombrado resulta infante).
--
-- Adicional, hallazgos puntuales que se conservan de la ronda anterior (sin
-- cambios): `responsable_id ... on delete restrict` (nunca se borra en
-- silencio al responsable de alguien); el trigger exige mayoría de edad REAL
-- (≥18 a la fecha de salida) para el responsable, no solo "no ser infante" —
-- un CHD no puede ser responsable; sin arreglos de roles hardcodeados
-- duplicando `puede_ver_contrato()`; `ventas.pax` sigue sin ser sustituto de
-- "pasajeros con silla".
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
  'años) a la fecha de salida del contrato. Obligatorio SIEMPRE para un '
  'infante NUEVO (autoridad: el propio trigger, no una función en '
  'particular) — la ÚNICA excepción es un id congelado en '
  '`_pasajeros_exentos_167` (los infantes que ya existían, sin vínculo, al '
  'aplicar esta migración). Migración 167.';

create index if not exists idx_contrato_pasajeros_responsable
  on public.contrato_pasajeros(responsable_id) where responsable_id is not null;

-- Foto INMUTABLE de los infantes históricos (ver cabecera del archivo, B1).
-- Se llena UNA SOLA VEZ, más abajo, con los ids que a la fecha de esta
-- migración ya eran infante sin vínculo — nunca vuelve a escribirse después.
create table if not exists public._pasajeros_exentos_167 (
  pasajero_id bigint primary key references public.contrato_pasajeros(id) on delete cascade
);

comment on table public._pasajeros_exentos_167 is
  'Snapshot INMUTABLE, tomado UNA SOLA VEZ al aplicar la migración 167: ids '
  'de contrato_pasajeros que EN ESE MOMENTO ya eran es_infante=true con '
  'responsable_id=null (infantes históricos, antes de que el vínculo fuera '
  'obligatorio) — nunca se inventa ni se migra una relación para ellos, solo '
  'se les permite seguir sin una. NO se vuelve a escribir nunca después de '
  'esta migración: sin GRANT de INSERT/UPDATE/DELETE para ningún rol de '
  'aplicación (ni siquiera service_role) — así que ninguna función, ni '
  'siquiera SECURITY DEFINER de la aplicación, puede agregarle un id nuevo. '
  'Solo el dueño del esquema (quien corre las migraciones) puede escribir '
  'aquí. `fn_validar_responsable_infante()` la consulta (ella sí, SECURITY '
  'DEFINER, puede LEERLA) para decidir si un infante sin responsable puede '
  'seguir guardándose sin uno. Como después de esta migración es '
  'estructuralmente imposible insertar un infante nuevo sin responsable '
  '(ver el trigger), cualquier fila que en el futuro aparezca en '
  'contrato_pasajeros con es_infante=true y responsable_id=null tiene que '
  'ser, forzosamente, uno de estos ids congelados aquí — nunca uno nuevo. '
  'Migración 167.';

insert into public._pasajeros_exentos_167 (pasajero_id)
select id from public.contrato_pasajeros
 where coalesce(es_infante, false) and responsable_id is null
on conflict do nothing;

revoke all on public._pasajeros_exentos_167 from public, anon, authenticated, service_role;

-- Integridad del vínculo — SECURITY DEFINER a propósito: es un chequeo de
-- HECHOS sobre la fila referenciada (existe / mismo contrato / no es
-- infante / es mayor de edad / está en la foto de exención), no de
-- permisos — la RLS de `contrato_pasajeros` (migración 147) ya decidió,
-- ANTES de que este trigger corra, si quien escribe puede tocar esta fila.
-- Es la ÚNICA autoridad real de "todo infante debe tener responsable,
-- salvo excepción histórica congelada" — cualquier función de aplicación
-- que haga su propia validación adicional es solo para dar un mensaje más
-- claro, nunca el candado real.
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
  v_exento     boolean;
begin
  if coalesce(new.es_infante, false) and new.responsable_id is null then
    select exists(
      select 1 from public._pasajeros_exentos_167 e where e.pasajero_id = new.id
    ) into v_exento;
    if v_exento then
      return new;
    end if;
    raise exception 'Todo infante debe tener un adulto responsable vinculado.';
  end if;

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
  'Trigger BEFORE INSERT/UPDATE en contrato_pasajeros — AUTORIDAD REAL (no '
  'solo de aplicación) de "todo infante nuevo debe tener responsable": '
  'rechaza es_infante=true con responsable_id null salvo que el id esté '
  'congelado en _pasajeros_exentos_167. Como esa tabla nunca vuelve a '
  'escribirse, es IMPOSIBLE que un INSERT nuevo quede exento — cierra el '
  'hueco sin importar qué función/RPC/camino haga la escritura. También '
  'valida responsable_id cuando SÍ viene: existe, mismo contrato, no '
  'auto-referencia, no infante, mayor de edad real ≥18 a la fecha de '
  'salida. Es integridad de DATOS, no de acceso — la RLS de la tabla '
  'decide quién puede escribir la fila antes de que este trigger corra. '
  'Migración 167.';

drop trigger if exists trg_validar_responsable_infante on public.contrato_pasajeros;
create trigger trg_validar_responsable_infante
  before insert or update on public.contrato_pasajeros
  for each row execute function public.fn_validar_responsable_infante();

revoke all on function public.fn_validar_responsable_infante() from public;
revoke all on function public.fn_validar_responsable_infante() from anon;

-- ═════════════════════════════════════════════════════════════════════════
-- C) Reconciliación atómica de sillas — reutilizable por CREACIÓN y EDICIÓN
--
-- `_ajustar_sillas_nucleo` (privada, sin candado de acceso propio): TODO el
-- mecanismo — candado del pool, conteo, capacidad, asignar/liberar. Sin ella
-- habría que duplicar esta lógica en cada wrapper, con riesgo de divergencia.
-- `ajustar_sillas_por_pasajeros` (pública, `authenticated`): candado de
-- ACCESO por sesión real — mismo criterio que la policy `contrato_pasajeros:
-- interno` (migración 147). Utilidad general para ajustar sillas de un
-- contrato ya creado sin tocar sus pasajeros (p. ej. herramientas manuales
-- futuras); el reemplazo de pasajeros (parte D) llama al núcleo directo.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public._ajustar_sillas_bloqueo_nucleo(
  p_numero_contrato text,
  p_bloqueo_id       bigint,
  p_holders_nuevo    integer
)
returns table(holders_total integer, silla_ids bigint[])
language plpgsql
security definer
set search_path = public
as $$
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
    select count(*) into v_disponibles
      from public.sillas
     where bloqueo_id = p_bloqueo_id
       and estado in ('disponible', 'cambio_entrante');

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
       select id from public.sillas
        where bloqueo_id = p_bloqueo_id
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
          and bloqueo_id = p_bloqueo_id
          and estado in ('en_plazo', 'confirmada')
        order by numero_silla desc
        limit (-v_delta)
     );
  end if;

  select array_agg(id order by numero_silla) into v_ids
    from public.sillas
   where numero_contrato = p_numero_contrato
     and bloqueo_id = p_bloqueo_id
     and estado in ('en_plazo', 'confirmada');

  return query select p_holders_nuevo, coalesce(v_ids, array[]::bigint[]);
end;
$$;

comment on function public._ajustar_sillas_bloqueo_nucleo(text, bigint, integer) is
  'Mecanismo puro (SIN candado de acceso propio) de reconciliación atómica '
  'de sillas de UN bloqueo específico (parámetro explícito, nunca '
  'descubierto) dentro de un contrato — candado del pool + conteo + '
  'capacidad + asignar/liberar, todo scoped por bloqueo_id además de '
  'numero_contrato. Es el núcleo real; `_ajustar_sillas_nucleo` (un solo '
  'bloqueo, lo descubre) y `crear_pasajeros_contrato_multi` (varios '
  'bloqueos explícitos, uno por llamada) delegan aquí. Migración 167 '
  '(revisión de alto riesgo, ronda 3 — B6).';

revoke all on function public._ajustar_sillas_bloqueo_nucleo(text, bigint, integer) from public, anon, authenticated, service_role;

-- ── Compatibilidad: un solo bloqueo, DESCUBIERTO (nunca recibido como
--    parámetro) — mismo comportamiento externo exacto que la versión
--    original de esta función; ahora es un wrapper delgado sobre el núcleo
--    parametrizado de arriba. La usan `ajustar_sillas_por_pasajeros`
--    (utilidad general, authenticated) y `_guardar_pasajeros_nucleo`
--    (reemplazo de pasajeros de UN bloqueo, edición y creación). ──────────
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
  v_bloqueo_id bigint;
begin
  if p_numero_contrato is null or length(p_numero_contrato) = 0 or length(p_numero_contrato) > 30 then
    raise exception 'Número de contrato inválido.';
  end if;
  if p_holders_nuevo is null or p_holders_nuevo < 0 or p_holders_nuevo > 100 then
    raise exception 'Cantidad de pasajeros con silla inválida.';
  end if;

  -- Mismo candado que el núcleo parametrizado (reentrante dentro de la
  -- misma transacción: no bloquea contra sí mismo).
  perform 1 from public.ventas where ventas.numero_contrato = p_numero_contrato for update;

  -- Fuente PRIMARIA del bloqueo: `ventas.bloqueo_ref_id` (migración 022) —
  -- durable, estampado por los flujos de creación, y NUNCA se limpia al
  -- liberar sillas (a diferencia de `sillas.numero_contrato`, que sí se
  -- limpia). Respaldo: contratos que nunca tuvieron `bloqueo_ref_id`
  -- estampado (anteriores a este fix) siguen descubriendo el bloqueo por
  -- una silla ya asignada — igual que antes, no se inventa nada para
  -- ellos. Un contrato con VARIOS bloqueos (conversión de carrito con más
  -- de un ítem tipo bloqueo) no pasa por aquí: usa
  -- `crear_pasajeros_contrato_multi`, que recibe cada bloqueo_id explícito
  -- y nunca necesita descubrirlo (B6).
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

  return query select * from public._ajustar_sillas_bloqueo_nucleo(p_numero_contrato, v_bloqueo_id, p_holders_nuevo);
end;
$$;

comment on function public._ajustar_sillas_nucleo(text, integer) is
  'Wrapper de _ajustar_sillas_bloqueo_nucleo para el caso de UN solo '
  'bloqueo, descubierto (nunca recibido como parámetro) desde '
  'ventas.bloqueo_ref_id o, en su defecto, una silla ya asignada. Privada: '
  'la llaman ajustar_sillas_por_pasajeros (utilidad general, authenticated) '
  'y _guardar_pasajeros_nucleo (reemplazo de pasajeros, edición y '
  'creación), cada una con su propio candado de acceso ANTES de delegar '
  'aquí. Un contrato con VARIOS bloqueos usa crear_pasajeros_contrato_multi '
  'en su lugar (B6). Migración 167.';

revoke all on function public._ajustar_sillas_nucleo(text, integer) from public, anon, authenticated;

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
  'Wrapper de _ajustar_sillas_nucleo para ajustar SOLO las sillas de un '
  'contrato ya creado, sin tocar sus pasajeros: exige una sesión real de '
  'usuario interno (mismo candado que la policy de contrato_pasajeros, '
  'migración 147). Utilidad general — el reemplazo de pasajeros (parte D) '
  'llama al núcleo directo, no a este wrapper. Migración 167.';

revoke all on function public.ajustar_sillas_por_pasajeros(text, integer) from public;
revoke all on function public.ajustar_sillas_por_pasajeros(text, integer) from anon;
grant execute on function public.ajustar_sillas_por_pasajeros(text, integer) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- D) Reemplazo transaccional de pasajeros de un contrato — reutilizable por
--    EDICIÓN y CREACIÓN (autorización → validar forma → bloquear →
--    re-validar → upsert en DOS PASADAS → reconciliar sillas), mismo patrón
--    base de `guardar_tramos_contrato` (migración 157).
--
--    Diseño en tres piezas (segunda revisión de alto riesgo — B1/B5):
--    - `_guardar_pasajeros_nucleo` (privada, sin candado de acceso propio):
--      TODO el mecanismo — validación, upsert por id, vínculos, sillas.
--    - `guardar_pasajeros_contrato` (pública, `authenticated`): candado de
--      sesión interna — la usa la EDICIÓN.
--    - `crear_pasajeros_contrato` (pública, `service_role`): candado de
--      usuario real y activo (mismo patrón que `_autorizado_congelar_
--      condiciones`, migración 165) — la usan los 3 flujos de CREACIÓN, que
--      pueden venir de un usuario B2B externo (agencia/freelance) que nunca
--      pasaría el candado de rol interno del wrapper de edición.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public._autorizado_escribir_pasajeros(
  p_numero_contrato   text,
  p_usuario_creacion  uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activo boolean;
begin
  if p_usuario_creacion is not null then
    -- Camino de CREACIÓN (service_role): usuario real y activo, sin exigir
    -- un rol puntual — la validación de negocio de la reserva ya ocurrió
    -- antes, en TypeScript (mismo criterio que _autorizado_congelar_
    -- condiciones, migración 165).
    select activo into v_activo from public.usuarios where id = p_usuario_creacion;
    return coalesce(v_activo, false);
  end if;
  -- Camino de EDICIÓN (sesión real de un usuario interno) — mismo candado
  -- que la policy `contrato_pasajeros: interno` (migración 147).
  return public.puede_ver_contrato(p_numero_contrato)
     and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(p_numero_contrato));
end;
$$;

comment on function public._autorizado_escribir_pasajeros(text, uuid) is
  'Autorización COMPARTIDA para _guardar_pasajeros_nucleo: p_usuario_creacion '
  'null = sesión interna real (edición); no-null = usuario real y activo '
  '(creación, service_role). Se llama DOS veces por escritura (antes y '
  'después del candado `for update` de ventas, igual patrón que '
  'guardar_tramos_contrato) para que un cambio de rol/actor a mitad de '
  'camino no se cuele. Migración 167.';

revoke all on function public._autorizado_escribir_pasajeros(text, uuid) from public, anon, authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- Tipo compuesto para el resultado de `_reemplazar_pasajeros_nucleo` — B6
-- (ronda 3): permite materializar su resultado en un arreglo PL/pgSQL
-- (`_fila_pasajero_167[]`) para reutilizarlo varias veces dentro de la MISMA
-- invocación (contar holders reales por bloqueo Y devolver el resultado
-- final) SIN volver a llamar la función (que ESCRIBE — llamarla dos veces
-- duplicaría pasajeros nuevos) y SIN una tabla temporal.
-- ═════════════════════════════════════════════════════════════════════════
do $$ begin
  create type public._fila_pasajero_167 as (
    id                bigint,
    nombre            text,
    tipo_id           text,
    identificacion    text,
    fecha_nacimiento  date,
    es_infante        boolean,
    responsable_id    bigint,
    orden             integer
  );
exception when duplicate_object then null; end $$;

create or replace function public._reemplazar_pasajeros_nucleo(
  p_numero_contrato   text,
  p_pasajeros          jsonb,
  p_min_pasajeros      integer,
  p_usuario_creacion   uuid
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
  v_prev_resp_id   bigint;
  v_prev_exento    boolean;
  v_prev_found     boolean;
  v_ajenos         integer;
  v_encontrados    integer;
  v_new_id         bigint;
begin
  if p_numero_contrato is null or length(p_numero_contrato) = 0 or length(p_numero_contrato) > 30 then
    raise exception 'Número de contrato inválido.';
  end if;

  if not public._autorizado_escribir_pasajeros(p_numero_contrato, p_usuario_creacion) then
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
  if v_n < coalesce(p_min_pasajeros, 1) then
    raise exception 'Debe haber al menos un pasajero.';
  end if;
  if v_n > v_max_pasajeros then
    raise exception 'No se pueden guardar más de % pasajeros en un solo contrato.', v_max_pasajeros;
  end if;

  -- v_n = 0 (permitido solo cuando p_min_pasajeros = 0, creación sin
  -- nombres capturados todavía) fluye por el camino normal sin rama
  -- especial: cada bucle `for v_i in 1..v_n`/`jsonb_array_elements('[]')`
  -- es un no-op con arreglo vacío, y el DELETE de más abajo (con
  -- `v_ids_mantener` vacío) borra cualquier pasajero preexistente — nunca
  -- hay ninguno en una creación, así que es un no-op real también.
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

  if not public._autorizado_escribir_pasajeros(p_numero_contrato, p_usuario_creacion) then
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
  -- dejarlo en null a propósito — monótono); se PERDONA (grandfather) SOLO
  -- si el id ya existente está congelado en `_pasajeros_exentos_167` (foto
  -- inmutable tomada al aplicar la migración — ver parte B) y sigue sin
  -- vínculo. Esta comprobación es una validación de aplicación (mensaje más
  -- claro, por posición); la autoridad real es el trigger de la tabla.
  for v_i in 1..v_n loop
    v_prev_found := false; v_prev_resp_id := null; v_prev_exento := false;
    if v_id_arr[v_i] is not null then
      select cp.responsable_id into v_prev_resp_id
        from public.contrato_pasajeros cp
       where cp.id = v_id_arr[v_i] and cp.numero_contrato = p_numero_contrato;
      v_prev_found := found;
      if v_prev_found then
        select exists(
          select 1 from public._pasajeros_exentos_167 e where e.pasajero_id = v_id_arr[v_i]
        ) into v_prev_exento;
      end if;
    end if;

    if v_es_infante[v_i] then
      if v_resp_orden_arr[v_i] is null then
        if v_prev_found and v_prev_resp_id is null and v_prev_exento then
          -- Histórico congelado sin vínculo, sigue sin vínculo: permitido.
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
  -- Mutación — DOS PASADAS, nunca un estado intermedio inválido (por eso el
  -- trigger puede ser INMEDIATO, no diferido):
  --   1) TODOS los no-infantes primero (nunca tienen responsable_id) — así
  --      se conoce el id real de CUALQUIER adulto (nuevo o existente) antes
  --      de escribir ningún infante. Si una fila DEJA de ser infante en
  --      este guardado, se le limpia responsable_id explícitamente aquí
  --      (nunca puede quedar un no-infante con un responsable_id viejo).
  --   2) TODOS los infantes, con su responsable_id YA RESUELTO en el MISMO
  --      insert/update — nunca "null y luego religo".
  -- El DELETE de las filas descartadas va AL FINAL: para entonces ningún
  -- infante vivo apunta a una fila por borrar (o conservó su adulto, o fue
  -- re-apuntado a otro adulto sobreviviente en la pasada 2 — la fase de
  -- validación de arriba ya garantiza que un infante conservado con vínculo
  -- previo real SIEMPRE trae un responsableOrden nuevo, nunca queda
  -- "colgado" de un adulto que se está por borrar) — así ON DELETE RESTRICT
  -- nunca se dispara en el camino normal.
  -- ═══════════════════════════════════════════════════════════════════════

  for v_i in 1..v_n loop
    if v_es_infante[v_i] then continue; end if;
    if v_id_arr[v_i] is not null then
      update public.contrato_pasajeros set
        nombre = v_nombre_arr[v_i],
        tipo_id = v_tipo_id_arr[v_i],
        identificacion = v_ident_arr[v_i],
        fecha_nacimiento = v_fecha_nac_arr[v_i],
        es_infante = false,
        orden = v_i - 1,
        responsable_id = null
      where contrato_pasajeros.id = v_id_arr[v_i] and contrato_pasajeros.numero_contrato = p_numero_contrato;

      if not found then
        raise exception 'No se pudo actualizar un pasajero (id % no pertenece a este contrato).', v_id_arr[v_i];
      end if;
      v_orden_a_id[v_i] := v_id_arr[v_i];
    else
      insert into public.contrato_pasajeros
        (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
      values
        (p_numero_contrato, v_nombre_arr[v_i], v_tipo_id_arr[v_i], v_ident_arr[v_i], v_fecha_nac_arr[v_i], false, v_i - 1)
      returning contrato_pasajeros.id into v_new_id;
      v_orden_a_id[v_i] := v_new_id;
    end if;
  end loop;

  for v_i in 1..v_n loop
    if not v_es_infante[v_i] then continue; end if;
    if v_id_arr[v_i] is not null then
      update public.contrato_pasajeros set
        nombre = v_nombre_arr[v_i],
        tipo_id = v_tipo_id_arr[v_i],
        identificacion = v_ident_arr[v_i],
        fecha_nacimiento = v_fecha_nac_arr[v_i],
        es_infante = true,
        orden = v_i - 1,
        responsable_id = case when v_resp_orden_arr[v_i] is not null then v_orden_a_id[v_resp_orden_arr[v_i]] else null end
      where contrato_pasajeros.id = v_id_arr[v_i] and contrato_pasajeros.numero_contrato = p_numero_contrato;

      if not found then
        raise exception 'No se pudo actualizar un pasajero (id % no pertenece a este contrato).', v_id_arr[v_i];
      end if;
      v_orden_a_id[v_i] := v_id_arr[v_i];
    else
      insert into public.contrato_pasajeros
        (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden, responsable_id)
      values
        (p_numero_contrato, v_nombre_arr[v_i], v_tipo_id_arr[v_i], v_ident_arr[v_i], v_fecha_nac_arr[v_i], true, v_i - 1,
         case when v_resp_orden_arr[v_i] is not null then v_orden_a_id[v_resp_orden_arr[v_i]] else null end)
      returning contrato_pasajeros.id into v_new_id;
      v_orden_a_id[v_i] := v_new_id;
    end if;
  end loop;

  -- El DELETE va al final (ver diseño arriba) — por eso NO puede usar
  -- `v_ids_mantener` (solo los ids que YA existían antes de este guardado):
  -- con el DELETE al final, para este punto YA se insertaron las filas
  -- nuevas, y si se excluyeran solo las de `v_ids_mantener` el propio DELETE
  -- borraría esas filas recién creadas (su id nunca estuvo en ese arreglo).
  -- `v_orden_a_id` sí tiene el id FINAL de cada posición 1..v_n (existente o
  -- recién insertado) — es el conjunto correcto a conservar.
  delete from public.contrato_pasajeros
   where contrato_pasajeros.numero_contrato = p_numero_contrato
     and not (contrato_pasajeros.id = any(v_orden_a_id));

  -- La reconciliación de sillas (_ajustar_sillas_nucleo / _ajustar_sillas_
  -- bloqueo_nucleo) ya NO vive aquí (B6, ronda 3): un contrato puede abarcar
  -- VARIOS bloqueos, y este núcleo solo sabe ESCRIBIR pasajeros — cuántas
  -- sillas reconciliar, y en cuál/cuáles bloqueos, lo decide el LLAMADOR
  -- (`_guardar_pasajeros_nucleo` para un solo bloqueo descubierto;
  -- `crear_pasajeros_contrato_multi` para varios bloqueos explícitos), a
  -- partir de este mismo resultado (columna `es_infante` por posición).
  return query
    select cp.id, cp.nombre, cp.tipo_id, cp.identificacion, cp.fecha_nacimiento,
           cp.es_infante, cp.responsable_id, cp.orden
      from public.contrato_pasajeros cp
     where cp.numero_contrato = p_numero_contrato
     order by cp.orden asc, cp.id asc;
end;
$$;

comment on function public._reemplazar_pasajeros_nucleo(text, jsonb, integer, uuid) is
  'Reemplazo transaccional y atómico de los pasajeros de un contrato (edición '
  'o creación): valida el payload completo (unknown en el límite), recalcula '
  'es_infante server-side, exige responsable_id para infantes nuevos (única '
  'excepción: un id congelado en _pasajeros_exentos_167), conserva el id de '
  'las filas que ya existían (upsert en DOS PASADAS — no-infantes primero, '
  'luego infantes con su responsable_id ya resuelto — nunca un estado '
  'intermedio inválido). NO reconcilia sillas (eso lo hace el llamador — ver '
  '_guardar_pasajeros_nucleo y crear_pasajeros_contrato_multi, B6 ronda 3): '
  'un contrato puede abarcar más de un bloqueo, y esta función no tiene '
  'forma de saber cuántos ni cuáles. Llamarla escribe SIEMPRE — nunca '
  'invocarla dos veces para el mismo guardado (duplicaría pasajeros nuevos, '
  'que no traen id en el payload). Sin candado de acceso propio — lo '
  'aplican guardar_pasajeros_contrato/crear_pasajeros_contrato/'
  'crear_pasajeros_contrato_multi vía _autorizado_escribir_pasajeros. '
  'Migración 167.';

revoke all on function public._reemplazar_pasajeros_nucleo(text, jsonb, integer, uuid) from public, anon, authenticated, service_role;

-- ── Wrapper de UN bloqueo (edición o creación de un solo contrato/bloqueo):
--    escribe pasajeros vía _reemplazar_pasajeros_nucleo y reconcilia SUS
--    sillas vía _ajustar_sillas_nucleo (que descubre el bloqueo, nunca lo
--    recibe) — mismo comportamiento externo exacto que la función original
--    de esta migración, ahora separada en dos piezas reutilizables. ───────
create or replace function public._guardar_pasajeros_nucleo(
  p_numero_contrato   text,
  p_pasajeros          jsonb,
  p_holders_min        integer,
  p_min_pasajeros      integer,
  p_usuario_creacion   uuid
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
  v_reg            record;
  v_filas          public._fila_pasajero_167[] := '{}';
  v_holders_reales integer := 0;
  v_holders_final  integer;
begin
  -- Se llama UNA sola vez y se materializa en un arreglo (ver el tipo
  -- _fila_pasajero_167 arriba) — nunca dos: escribe, no solo lee.
  for v_reg in
    select * from public._reemplazar_pasajeros_nucleo(p_numero_contrato, p_pasajeros, p_min_pasajeros, p_usuario_creacion)
  loop
    v_filas := array_append(
      v_filas,
      row(v_reg.id, v_reg.nombre, v_reg.tipo_id, v_reg.identificacion, v_reg.fecha_nacimiento, v_reg.es_infante, v_reg.responsable_id, v_reg.orden)::public._fila_pasajero_167
    );
    if not v_reg.es_infante then v_holders_reales := v_holders_reales + 1; end if;
  end loop;

  -- `p_holders_min` es el PISO declarado por el llamador (composición de
  -- habitaciones en creación; 0 en edición, donde el payload SIEMPRE trae
  -- la lista completa y autoritativa) — nunca se reserva MENOS que eso, ni
  -- menos que los pasajeros reales (no-infante) de este payload.
  v_holders_final := greatest(coalesce(p_holders_min, 0), v_holders_reales);
  perform * from public._ajustar_sillas_nucleo(p_numero_contrato, v_holders_final);

  return query
    select (f).id, (f).nombre, (f).tipo_id, (f).identificacion, (f).fecha_nacimiento, (f).es_infante, (f).responsable_id, (f).orden
      from unnest(v_filas) as f;
end;
$$;

comment on function public._guardar_pasajeros_nucleo(text, jsonb, integer, integer, uuid) is
  'Wrapper de UN bloqueo sobre _reemplazar_pasajeros_nucleo (escribe '
  'pasajeros) + _ajustar_sillas_nucleo (reconcilia SUS sillas, descubriendo '
  'el bloqueo — nunca lo recibe): mismo comportamiento externo que la '
  'función original de esta migración antes de separarse en dos piezas '
  '(B6, ronda 3). Un contrato con VARIOS bloqueos usa '
  'crear_pasajeros_contrato_multi en su lugar. Sin candado de acceso propio '
  '— lo aplican guardar_pasajeros_contrato/crear_pasajeros_contrato vía '
  '_autorizado_escribir_pasajeros (dentro de _reemplazar_pasajeros_nucleo). '
  'Migración 167.';

revoke all on function public._guardar_pasajeros_nucleo(text, jsonb, integer, integer, uuid) from public, anon, authenticated, service_role;

-- ── Wrapper para EDICIÓN (sesión real de un usuario interno) ──────────────
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
begin
  if p_numero_contrato is null or length(p_numero_contrato) = 0 or length(p_numero_contrato) > 30 then
    raise exception 'Número de contrato inválido.';
  end if;
  if not public._autorizado_escribir_pasajeros(p_numero_contrato, null) then
    raise exception 'Contrato no encontrado o sin permiso para editarlo.';
  end if;

  -- Edición: la lista SIEMPRE es completa y autoritativa (mínimo 1 pasajero,
  -- sin piso adicional de sillas — se deriva 100% de este payload).
  return query select * from public._guardar_pasajeros_nucleo(p_numero_contrato, p_pasajeros, 0, 1, null);
end;
$$;

comment on function public.guardar_pasajeros_contrato(text, jsonb) is
  'Wrapper de _guardar_pasajeros_nucleo para la EDICIÓN de un contrato ya '
  'creado: exige una sesión real de usuario interno. Reemplaza el flujo '
  'anterior de DELETE+INSERT+N UPDATE+1 llamada RPC aparte desde TypeScript. '
  'Migración 167.';

revoke all on function public.guardar_pasajeros_contrato(text, jsonb) from public;
revoke all on function public.guardar_pasajeros_contrato(text, jsonb) from anon;
grant execute on function public.guardar_pasajeros_contrato(text, jsonb) to authenticated;

-- ── Wrapper para CREACIÓN (service_role — la reserva puede venir de un
--    usuario externo B2B, que nunca pasa el candado de rol interno de
--    arriba) — mismo patrón que `_autorizado_congelar_condiciones`
--    (migración 165): exige un actor real y activo.
create or replace function public.crear_pasajeros_contrato(
  p_numero_contrato text,
  p_pasajeros        jsonb,
  p_holders_min      integer,
  p_usuario_id       uuid
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
  v_activo boolean;
begin
  if p_usuario_id is null then
    raise exception 'Se requiere un usuario autenticado.';
  end if;
  select activo into v_activo from public.usuarios where usuarios.id = p_usuario_id;
  if v_activo is null then
    raise exception 'El usuario % no existe en el sistema.', p_usuario_id;
  end if;
  if not v_activo then
    raise exception 'El usuario está desactivado.';
  end if;

  -- Creación: la lista de pasajeros puede venir VACÍA (convertirCotizacion
  -- con override de superadmin, "captura los pasajeros después") mientras
  -- la composición de habitaciones ya exige `p_holders_min` sillas.
  return query select * from public._guardar_pasajeros_nucleo(p_numero_contrato, p_pasajeros, p_holders_min, 0, p_usuario_id);
end;
$$;

comment on function public.crear_pasajeros_contrato(text, jsonb, integer, uuid) is
  'Wrapper de _guardar_pasajeros_nucleo para la CREACIÓN de un contrato nuevo '
  '(reservarDesdeTarifarioInterno/reservarProgramaInterno en reservar/'
  'actions.ts, crearContratoInterno en contratos/actions.ts) — llamado con '
  'service_role porque la reserva puede venir de un usuario externo B2B '
  '(agencia/freelance). Exige un p_usuario_id real y activo. Inserta '
  'pasajeros + vínculos + reserva de sillas en UNA sola transacción: un '
  'fallo de capacidad revierte TODO, nunca deja sillas tomadas sin pasajero '
  'ni pasajero guardado sin su silla (cierra B5 de la segunda revisión de '
  'alto riesgo). Migración 167.';

revoke all on function public.crear_pasajeros_contrato(text, jsonb, integer, uuid) from public, anon, authenticated;
grant execute on function public.crear_pasajeros_contrato(text, jsonb, integer, uuid) to service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- E) Creación con VARIOS bloqueos bajo un mismo contrato — revisión de alto
--    riesgo, ronda 3 (B6). `convertirCotizacionCarrito` puede agrupar varios
--    ítems tipo `bloqueo` (records de vuelo DISTINTOS) bajo un mismo
--    `numero_contrato` — un caso que `crear_pasajeros_contrato` no puede
--    cubrir: `ventas.bloqueo_ref_id` es una sola columna, y
--    `_ajustar_sillas_nucleo` DESCUBRE un único bloqueo por contrato (nunca
--    lo recibe). Antes de esta pieza, ese camino (a) NO pasaba por el RPC
--    atómico (sillas por un lado, `insert` de pasajeros aparte — la misma
--    falla de atomicidad que B5 ya cerró para los otros 3 flujos), y (b)
--    rechazaba cualquier infante con un mensaje claro en vez de dejarlo sin
--    vínculo — correcto como corte de emergencia, pero una regresión real
--    frente a los demás flujos, que sí admiten infantes con responsable.
--
--    NO se fuerza `bloqueo_ref_id` a admitir varios valores, ni se inventa
--    ninguna relación nueva entre `ventas` y `bloqueos_vuelo`: en su lugar,
--    el llamador (TypeScript, que YA sabe qué ítem del carrito usa qué
--    `bloqueoId` y qué porción de `opts.pasajeros` le corresponde — ver
--    `convertirCotizacionCarrito`) declara EXPLÍCITAMENTE, por cada
--    bloqueo, cuál es su `bloqueoId` y qué POSICIONES (1-based, dentro del
--    mismo arreglo de pasajeros — misma convención que `responsableOrden`)
--    ocupan silla en él. Una posición puede aparecer en más de una entrada
--    (ej. un mismo grupo de personas vuela dos tramos con records
--    distintos, ambos bajo el mismo contrato) — no es un error, es el caso
--    esperado de un viaje multi-ciudad.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.crear_pasajeros_contrato_multi(
  p_numero_contrato   text,
  p_pasajeros          jsonb,
  p_reservas_sillas    jsonb,
  p_usuario_id         uuid
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
  v_activo          boolean;
  v_max_reservas    constant int := 20;
  v_claves_validas  constant text[] := array['bloqueoId', 'holdersMin', 'posiciones'];
  v_reg             record;
  v_filas           public._fila_pasajero_167[] := '{}';
  v_n_pasajeros     integer := 0;
  v_res_bloqueo_id  bigint[] := '{}';
  v_res_holders_min integer[] := '{}';
  v_res_holders_real integer[] := '{}';
  v_n_reservas      integer;
  v_elem            jsonb;
  v_clave           text;
  v_bloqueo_id      bigint;
  v_holders_min     integer;
  v_pos_elem        jsonb;
  v_pos             integer;
  v_pos_vistos      bigint[];
  v_holders_reales  integer;
begin
  if p_usuario_id is null then
    raise exception 'Se requiere un usuario autenticado.';
  end if;
  select activo into v_activo from public.usuarios where usuarios.id = p_usuario_id;
  if v_activo is null then
    raise exception 'El usuario % no existe en el sistema.', p_usuario_id;
  end if;
  if not v_activo then
    raise exception 'El usuario está desactivado.';
  end if;

  -- Escribe pasajeros + responsables — UNA sola vez (nunca dos: este núcleo
  -- ESCRIBE; invocarlo de nuevo duplicaría pasajeros nuevos, que no traen
  -- id en el payload) — materializado en un arreglo del tipo compuesto
  -- `_fila_pasajero_167` (parte D) para poder recorrerlo varias veces
  -- (contar holders reales por cada bloqueo) sin volver a llamar la función
  -- ni depender de una tabla temporal. Creación: la lista puede venir VACÍA
  -- (mismo criterio que crear_pasajeros_contrato — override de superadmin,
  -- "captura los pasajeros después"), por eso `p_min_pasajeros = 0`.
  for v_reg in
    select * from public._reemplazar_pasajeros_nucleo(p_numero_contrato, p_pasajeros, 0, p_usuario_id)
  loop
    v_filas := array_append(
      v_filas,
      row(v_reg.id, v_reg.nombre, v_reg.tipo_id, v_reg.identificacion, v_reg.fecha_nacimiento, v_reg.es_infante, v_reg.responsable_id, v_reg.orden)::public._fila_pasajero_167
    );
    v_n_pasajeros := v_n_pasajeros + 1;
  end loop;

  -- ═══════════════════════════════════════════════════════════════════════
  -- Validar `p_reservas_sillas` (unknown hasta comprobarlo): arreglo de
  -- objetos `{ bloqueoId, holdersMin?, posiciones }`. `holdersMin` es el
  -- PISO por bloqueo (composición de habitaciones de ESE ítem, ANTES de
  -- nombrar pasajeros) — mismo criterio que `p_holders_min` en el caso de
  -- un solo bloqueo, ahora uno por entrada.
  -- ═══════════════════════════════════════════════════════════════════════
  if p_reservas_sillas is null or jsonb_typeof(p_reservas_sillas) <> 'array' then
    raise exception 'Las reservas de sillas por bloqueo deben ser un arreglo.';
  end if;
  v_n_reservas := jsonb_array_length(p_reservas_sillas);
  if v_n_reservas > v_max_reservas then
    raise exception 'No se pueden reservar sillas de más de % bloqueos en un solo contrato.', v_max_reservas;
  end if;

  for v_elem in select t.value from jsonb_array_elements(p_reservas_sillas) with ordinality as t(value, ord) order by t.ord
  loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'Cada reserva de sillas debe ser un objeto.';
    end if;

    for v_clave in select jsonb_object_keys(v_elem)
    loop
      if not (v_clave = any(v_claves_validas)) then
        raise exception 'Campo no reconocido en una reserva de sillas: %.', v_clave;
      end if;
    end loop;

    if not (v_elem ?& array['bloqueoId', 'posiciones']) then
      raise exception 'Cada reserva de sillas requiere bloqueoId y posiciones.';
    end if;

    if jsonb_typeof(v_elem->'bloqueoId') <> 'number' then
      raise exception 'El bloqueoId de una reserva de sillas es inválido.';
    end if;
    begin
      v_bloqueo_id := (v_elem->>'bloqueoId')::bigint;
    exception when others then
      raise exception 'El bloqueoId de una reserva de sillas es inválido.';
    end;
    if v_bloqueo_id is null or v_bloqueo_id <= 0 then
      raise exception 'El bloqueoId de una reserva de sillas debe ser un entero positivo.';
    end if;
    if v_bloqueo_id = any(v_res_bloqueo_id) then
      raise exception 'El bloqueo % aparece repetido en las reservas de sillas.', v_bloqueo_id;
    end if;

    if v_elem ? 'holdersMin' and jsonb_typeof(v_elem->'holdersMin') <> 'null' then
      if jsonb_typeof(v_elem->'holdersMin') <> 'number' then
        raise exception 'El holdersMin de una reserva de sillas es inválido.';
      end if;
      begin
        v_holders_min := (v_elem->>'holdersMin')::integer;
      exception when others then
        raise exception 'El holdersMin de una reserva de sillas es inválido.';
      end;
      if v_holders_min < 0 or v_holders_min > 100 then
        raise exception 'El holdersMin de una reserva de sillas es inválido.';
      end if;
    else
      v_holders_min := 0;
    end if;

    if jsonb_typeof(v_elem->'posiciones') <> 'array' then
      raise exception 'Las posiciones de una reserva de sillas deben ser un arreglo.';
    end if;

    -- Posiciones (1-based, misma convención que responsableOrden): cuenta
    -- cuántas de ellas NO son infante en el resultado YA escrito arriba —
    -- ese conteo, junto con holdersMin, define cuántas sillas de ESTE
    -- bloqueo reservar (nunca menos que ninguno de los dos). Se rechaza una
    -- posición REPETIDA dentro de la MISMA reserva de bloqueo (contaría dos
    -- sillas para la misma persona en el mismo ítem) — repetirse ENTRE
    -- reservas de bloqueo DISTINTAS sigue siendo válido: el mismo grupo
    -- puede volar más de un tramo/record (revisión de alto riesgo, ronda 3
    -- — B11).
    v_holders_reales := 0;
    v_pos_vistos := '{}';
    for v_pos_elem in select * from jsonb_array_elements(v_elem->'posiciones')
    loop
      if jsonb_typeof(v_pos_elem) <> 'number' then
        raise exception 'Una posición de pasajero es inválida.';
      end if;
      begin
        v_pos := (v_pos_elem::text)::integer;
      exception when others then
        raise exception 'Una posición de pasajero es inválida.';
      end;
      if v_pos < 1 or v_pos > v_n_pasajeros then
        raise exception 'Una posición de pasajero está fuera de rango.';
      end if;
      if v_pos = any(v_pos_vistos) then
        raise exception 'La posición % aparece repetida dentro de la misma reserva de sillas.', v_pos;
      end if;
      v_pos_vistos := array_append(v_pos_vistos, v_pos);
      if not (v_filas[v_pos]).es_infante then
        v_holders_reales := v_holders_reales + 1;
      end if;
    end loop;

    v_res_bloqueo_id := array_append(v_res_bloqueo_id, v_bloqueo_id);
    v_res_holders_min := array_append(v_res_holders_min, v_holders_min);
    v_res_holders_real := array_append(v_res_holders_real, v_holders_reales);
  end loop;

  -- ═══════════════════════════════════════════════════════════════════════
  -- Reconciliar sillas en orden ASCENDENTE de bloqueo_id — NUNCA en el
  -- orden en que llegó el payload. `_ajustar_sillas_bloqueo_nucleo` bloquea
  -- (`for update`) el pool de sillas de cada bloqueo que toca; si dos
  -- conversiones concurrentes comparten dos o más de los mismos bloqueos
  -- pero los recorren en orden distinto, pueden bloquearse en un ciclo
  -- (A bloquea 10 y espera 20; B bloquea 20 y espera 10) — un deadlock que
  -- Postgres resuelve abortando una de las dos transacciones. Recorrerlos
  -- siempre en el MISMO orden relativo (ascendente por id) entre cualquier
  -- llamada concurrente elimina esa espera circular de raíz, sin necesitar
  -- ningún candado adicional a nivel de aplicación.
  -- ═══════════════════════════════════════════════════════════════════════
  for v_reg in
    select bid, hmin, hreal
      from unnest(v_res_bloqueo_id, v_res_holders_min, v_res_holders_real) as t(bid, hmin, hreal)
     order by bid asc
  loop
    perform * from public._ajustar_sillas_bloqueo_nucleo(p_numero_contrato, v_reg.bid, greatest(v_reg.hmin, v_reg.hreal));
  end loop;

  return query
    select (f).id, (f).nombre, (f).tipo_id, (f).identificacion, (f).fecha_nacimiento, (f).es_infante, (f).responsable_id, (f).orden
      from unnest(v_filas) as f;
end;
$$;

comment on function public.crear_pasajeros_contrato_multi(text, jsonb, jsonb, uuid) is
  'Wrapper de _reemplazar_pasajeros_nucleo (escribe pasajeros/responsables '
  'UNA vez) + _ajustar_sillas_bloqueo_nucleo (una llamada POR bloqueo '
  'explícito en p_reservas_sillas, en orden ascendente de bloqueo_id para '
  'evitar deadlocks cruzados entre llamadas concurrentes) — usado por '
  'convertirCotizacionCarrito cuando un contrato agrupa VARIOS ítems tipo '
  'bloqueo (records de vuelo distintos). p_reservas_sillas: '
  '[{bloqueoId, holdersMin?, posiciones}], posiciones 1-based dentro de '
  'p_pasajeros (misma convención que responsableOrden) — puede repetirse '
  'entre entradas (un mismo grupo puede volar más de un tramo/record), '
  'pero se rechaza si se repite DENTRO de la misma entrada (contaría dos '
  'sillas para la misma persona en el mismo bloqueo). '
  'Todo en UNA sola transacción: si cualquier bloqueo no tiene cupo, o el '
  'payload de pasajeros es inválido, o falta un responsable de infante, '
  'Postgres revierte TODO (pasajeros, vínculos y sillas de TODOS los '
  'bloqueos juntos) — nunca dos bloqueos con inventario a medias. No '
  'fuerza ventas.bloqueo_ref_id a admitir varios valores ni inventa '
  'ninguna relación nueva: cada bloqueo se reconcilia por su id explícito, '
  'nunca descubierto. Migración 167 (revisión de alto riesgo, ronda 3 — '
  'B6). Exige un p_usuario_id real y activo (mismo candado que '
  'crear_pasajeros_contrato).';

revoke all on function public.crear_pasajeros_contrato_multi(text, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.crear_pasajeros_contrato_multi(text, jsonb, jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
