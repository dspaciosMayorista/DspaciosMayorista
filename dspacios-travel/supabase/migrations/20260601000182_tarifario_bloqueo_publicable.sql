-- ───────────────────────────────────────────────────────────────────────────
-- 182 · TARIFARIO — bloqueo efectivo de snapshots no publicables (Fase 2)
--
-- FASE 2 de la corrección de "snapshots desactualizados durante la
-- recalculación" (pendiente #1 de TASKS.md). La migración 181 (ya aplicada,
-- NO se edita aquí) agregó `armado_paquetes.tarifario_snapshot_publicable`,
-- `tarifario_estado`, la revisión de fuentes y la publicación atómica — pero
-- todavía NINGÚN lector consultaba esa columna: un paquete bloqueado
-- (`tarifario_snapshot_publicable = false`, por ejemplo mientras está
-- 'pendiente'/'fallido' o inactivo) seguía sirviendo sus filas viejas de
-- `tarifario_resultado` en el tarifario público, la búsqueda en vivo y el
-- motor de reserva — la Fase 1 dejó la señal de gobernanza escrita, pero sin
-- ningún efecto real todavía.
--
-- ⚠️ RONDA DE AUDITORÍA (2 hallazgos P1 sobre la primera versión de esta
-- migración, corregidos aquí — la primera versión NUNCA se aplicó a ningún
-- entorno más allá del local desechable, así que se reescribe directo, sin
-- una migración 183 de parche):
--
--   P1-a "bypass directo por tarifario_resultado" — la primera versión de
--   esta migración creaba `tarifario_resultado_publicable` pero DEJABA
--   INTACTA la policy de la tabla base (`tarifario_resultado: lectura`, "for
--   select using (true)", migración 018). Esa tabla es la que expone
--   PostgREST — cualquier cliente (anon/authenticated externo) podía
--   saltarse la vista por completo pidiendo `tarifario_resultado` directo
--   (incluso filtrando por `paquete_id`) y seguir viendo un snapshot
--   bloqueado. La vista nunca fue una puerta obligatoria, solo una opción
--   más entre varias que llevaban al mismo dato sin filtrar.
--
--   P1-b "paquetes inactivos existentes" — `tarifario_snapshot_publicable`
--   nace con `default true` (migración 181). Un paquete que YA estaba
--   `activo = false` en el momento de aplicar la 181 nunca disparó el
--   trigger de invalidación (el trigger solo reacciona a un UPDATE
--   posterior) y pudo quedar con `snapshot_publicable = true` mientras sigue
--   inactivo — la vista de la primera versión de esta migración solo exigía
--   `tarifario_snapshot_publicable = true`, sin comprobar `activo` aparte,
--   así que ese caso se colaba. Nunca hay que confiar en que ambas columnas
--   estén sincronizadas — se exigen las DOS, en la vista Y en la policy,
--   cada una por su cuenta.
--
-- ⚠️ SEGUNDA RONDA DE AUDITORÍA (3 hallazgos sobre la versión anterior de
-- esta migración — tampoco se aplicó fuera de local, se reescribe directo):
--
--   1. "grant faltante para service_role" — `buscarHoteles`/
--   `buscarReceptivos`/`liquidarServicioPuntual` (lib/reservar/cotizar.ts)
--   leen `tarifario_resultado_publicable` con `createAdminClient()`
--   (`service_role`). La versión anterior solo hacía `grant select ... to
--   anon, authenticated` — bypassar RLS (lo que `service_role` ya hace por
--   diseño de Supabase) NO concede por sí solo el privilegio SQL de `SELECT`
--   sobre una vista; sin un `grant` explícito, esas 3 consultas fallarían con
--   "permission denied for view" en cualquier entorno donde no exista un
--   `default privilege` que se lo conceda de antemano — nunca hay que confiar
--   en eso. Se agrega `service_role` al `grant select` explícito de la vista
--   (ver punto C más abajo). `tarifario_resumen` NO recibe el mismo grant:
--   confirmado por grep que su único lector (`cargarFilasResumenPaginado`,
--   lib/tarifario/resumen.ts) siempre recibe el cliente de SESIÓN, nunca
--   `createAdminClient()` — agregarlo sería un grant sin lector real detrás.
--
--   2. "pruebas 11-19 se podían omitir en silencio" — la batería anterior
--   dependía de que YA existiera un usuario interno activo en la base; si no
--   existía, imprimía un AVISO y el bloque entero terminaba igual en "TODAS
--   LAS PRUEBAS TERMINARON EN OK". Un entorno sin ese usuario previo (ej. una
--   base recién creada) podía "pasar" la batería sin haber probado NADA del
--   hallazgo P1-a/P1-b. Corregido en `test_182`: el usuario interno también
--   se crea SINTÉTICO dentro de la misma transacción (mismo patrón que el
--   externo), así que las pruebas por rol SIEMPRE corren; si por algún motivo
--   no se puede crear (constraint inesperado, etc.), el script aborta con
--   `raise exception`, nunca con un aviso que deje pasar el resto como éxito.
--
--   3. "el cortocircuito del OR no está garantizado" — la versión anterior
--   afirmaba que los roles internos "nunca evalúan" el helper porque el `OR`
--   de la policy "hace cortocircuito". Eso es una suposición incorrecta:
--   PostgreSQL NO garantiza orden de evaluación de operandos de `OR`/`AND` —
--   el planificador puede reordenar expresiones booleanas libremente (a
--   diferencia de `CASE`, que si lo garantiza). La razón REAL por la que un
--   usuario interno nunca puede toparse con un error de permisos al evaluar
--   `tarifario_paquete_publicable(paquete_id)` es más simple y no depende de
--   orden de evaluación: los usuarios internos de la aplicación ejecutan bajo
--   el mismo rol SQL de Postgres que los externos, `authenticated` (Supabase
--   no crea un rol de Postgres distinto por cada rol de negocio — la
--   distinción "interno/externo" vive en `usuarios.rol`, leída por
--   `mi_rol()`, nunca en el rol de conexión) — y `authenticated` SÍ tiene
--   `EXECUTE` sobre el helper (ver punto A). Aunque PostgreSQL evaluara
--   AMBAS ramas del `OR` para cada fila, ninguna fallaría por falta de
--   privilegio; la autorización real para un interno la sigue decidiendo
--   `mi_rol()` (la otra rama del `OR`), no la presencia/ausencia de
--   `EXECUTE` sobre el helper.
--
-- DISEÑO CORREGIDO
--   1. `armado_paquetes` sigue siendo interna (RLS: solo superadmin/
--      gerencia/administracion/operaciones) y anon/authenticated externo
--      NUNCA la leen directo — ni antes ni después de esta migración.
--   2. Un helper `SECURITY DEFINER` puramente booleano,
--      `tarifario_paquete_publicable(p_paquete_id)`, es el ÚNICO punto que
--      lee `armado_paquetes.tarifario_snapshot_publicable`/`activo` para
--      decidir visibilidad — nunca expone ninguna otra columna, `search_path`
--      fijo, `revoke` de PUBLIC, `grant execute` a `authenticated` (el ÚNICO
--      rol SQL de Postgres bajo el que corren TANTO los internos como los
--      externos — ver el hallazgo 3 de la segunda ronda de auditoría, más
--      arriba: no hay un rol de Postgres separado por rol de negocio, así que
--      no tiene sentido "no concedérselo a los internos") y a `anon`.
--   3. La policy de LECTURA de `tarifario_resultado` (la tabla base, no la
--      vista) se reemplaza: un rol interno autorizado sigue viendo TODO sin
--      filtrar (necesario para el diagnóstico del paquete en
--      administración); cualquier otro rol (anon, authenticated externo)
--      solo ve filas cuyo `paquete_id` sea publicable según el helper. La
--      policy y el helper corren en la MISMA sentencia SQL que la lectura —
--      PostgreSQL evalúa el `using(...)` de la policy por fila dentro de la
--      misma consulta, nunca como un `select` de permiso separado.
--   4. `tarifario_resultado_publicable` (la vista) ahora exige TANTO
--      `tarifario_snapshot_publicable = true` COMO `activo = true` en su
--      propio `where` — no depende de que la policy de arriba haga ese
--      trabajo por ella (la vista bypassa la RLS de la tabla base al ser
--      SIN `security_invoker`, así que su propio filtro es la única
--      protección real que tiene). `security_barrier = true` (P2 de la
--      auditoría): impide que Postgres reordene funciones potencialmente
--      "leaky" hacia adentro del filtro de la vista antes de aplicar el
--      `where` de autorización.
--   5. La ESCRITURA de `tarifario_resultado` no cambia — sigue siendo
--      exclusiva de los roles internos (migración 018), esta migración no la
--      toca.
--   6. `service_role` sigue siendo privilegiado (bypassa RLS por diseño de
--      Supabase, igual que siempre) — todo lector en vivo del código de la
--      app (`buscarHoteles`/`buscarReceptivos`/`computarReserva`/etc., ver el
--      mapa de lectores del informe de esta fase) ya fue migrado en el
--      código para usar `tarifario_resultado_publicable`, nunca la tabla
--      base directo, sin importar qué cliente use. ⚠️ Bypassar RLS NO es lo
--      mismo que tener el privilegio SQL de `SELECT` sobre una vista — esta
--      migración concede `SELECT` EXPLÍCITO a `service_role` sobre
--      `tarifario_resultado_publicable` (hallazgo 1 de la segunda ronda de
--      auditoría, ver arriba), sin depender de ningún `default privilege` de
--      Supabase. El filtro de la vista (`publicable Y activo`) no distingue
--      por rol — se aplica igual a `service_role` que a cualquier otro
--      lector, así que `service_role` tampoco puede recuperar por esta vista
--      un paquete bloqueado o inactivo.
--
-- ALCANCE — SOLO LECTORES QUE SIRVEN EL SNAPSHOT EN VIVO (sin cambios de
--   código en esta ronda; el ajuste de esta migración es puramente SQL)
--   Quedan DELIBERADAMENTE sin tocar:
--     · El editor de paquetes en administración
--       (app/(dashboard)/dashboard/paquetes/[id]/page.tsx) — sigue leyendo
--       `tarifario_resultado` directo bajo un rol interno autorizado, que la
--       nueva policy deja pasar sin filtrar (necesita ver el snapshot REAL,
--       incluido uno bloqueado, para poder diagnosticarlo).
--     · Contratos/cotizaciones ya congelados (`app/c/[token]`, `app/cot/
--       [token]`, `contrato_*`) — nunca leyeron `tarifario_resultado`, leen
--       sus propias tablas congeladas; no dependen del estado actual del
--       snapshot (regla 10).
--     · Los hoteles Bernalo/por unidad que se cotizan en vivo
--       (`app/tarifario/busquedaUnidadActions.ts`,
--       `lib/tarifario/datosBernalo.ts`) — NO se tocan en esta ronda (pedido
--       explícito del dueño). Confirmado por grep: ninguno de los dos
--       archivos hace `.from("tarifario_resultado")`/`.from("tarifario_
--       resultado_publicable")` en ninguna parte — su búsqueda es paralela y
--       100% en vivo contra `hoteles`/`hotel_temporadas`/
--       `hotel_tarifas_unidad` (ver `cargarHotelesBernaloDescubiertos` y
--       `evaluarDisponibilidadHotelUnidad`), así que el bloqueo de
--       `tarifario_resultado`/`tarifario_resultado_publicable` de esta
--       migración no la afecta en absoluto — permanece intacta.
--     · `buscarHoteles`/`buscarReceptivos`/`liquidarServicioPuntual`
--       (lib/reservar/cotizar.ts, con `createAdminClient()` → `service_role`)
--       SÍ leen `tarifario_resultado_publicable` desde la ronda anterior de
--       esta fase, solo como ÍNDICE de descubrimiento (qué paquete_id/
--       hotel_id/servicio_id existen) — el precio se sigue re-liquidando EN
--       VIVO contra `tarifa_hotel`/`hotel_temporadas`/`servicio_tarifa_pax`.
--       Estos 3 son exactamente los lectores que motivaron el hallazgo 1 de
--       la segunda ronda de auditoría (grant faltante para `service_role`
--       sobre la vista) — sin el `grant select` explícito que agrega esta
--       migración, estas 3 consultas fallarían con "permission denied".
--
-- RLS/GRANTS — RESUMEN FINAL TRAS ESTA MIGRACIÓN
--   · `armado_paquetes`: SIN CAMBIO — solo superadmin/gerencia/
--     administracion/operaciones (migración 018).
--   · `tarifario_resultado` (tabla base): YA NO es "for select using(true)".
--     Un rol interno autorizado ve TODO; cualquier otro rol (incluido
--     anon) solo ve filas de paquetes publicables Y activos, vía el helper.
--     La ESCRITURA no cambia.
--   · `tarifario_resultado_publicable` (vista): `grant select` a anon +
--     authenticated + `service_role` (el `service_role` es NUEVO en esta
--     segunda ronda de auditoría — hallazgo 1). Mismas columnas que la tabla
--     base, filtro propio (publicable Y activo) con `security_barrier`,
--     aplicado SIN distinguir por rol — ni `service_role` puede recuperar por
--     esta vista un paquete bloqueado o inactivo.
--   · `tarifario_resumen` (vista, migración 162): SIN CAMBIO de exposición —
--     sigue leyendo de `tarifario_resultado_publicable`, `security_invoker =
--     true`, mismo `revoke`/`grant` EXACTO de la migración 162
--     (`public, anon, authenticated` — nunca `service_role`). SIN `select`
--     para `service_role` (confirmado por grep que ningún lector real la
--     consulta con `createAdminClient()` — agregarlo sería un grant sin
--     lector detrás), pero esta migración TAMPOCO toca ningún privilegio
--     preexistente que `service_role` pudiera tener sobre esta vista desde
--     antes de la 182 (ver "TERCERA RONDA DE AUDITORÍA" más abajo) — un
--     saneamiento de privilegios históricos, si hiciera falta, es una tarea
--     aparte, con su propio inventario de dependencias y su propio rollback,
--     fuera del alcance de esta fase.
--   · `tarifario_paquete_publicable(bigint)` (función nueva): `revoke all
--     from public`, `grant execute` a anon + authenticated. `service_role`
--     no lo necesita (bypassa RLS, nunca evalúa la policy que lo invoca) ni
--     lo tiene concedido. Los roles internos de la aplicación SÍ pueden
--     ejecutarlo (corren bajo `authenticated`, igual que los externos — ver
--     el hallazgo 3 de la segunda ronda de auditoría más arriba: PostgreSQL
--     NO garantiza que el `OR` de la policy evite evaluar este helper para un
--     interno, pero tampoco importa, porque `authenticated` ya tiene
--     `EXECUTE`).
--
-- Preflight/postcheck/rollback/pruebas propios de esta migración:
--   supabase/scripts/preflight_182_tarifario_bloqueo_publicable.sql
--   supabase/scripts/postcheck_182_tarifario_bloqueo_publicable.sql
--   supabase/scripts/rollback_182_tarifario_bloqueo_publicable.sql
--   supabase/scripts/test_182_tarifario_bloqueo_publicable.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

do $$
begin
  if to_regclass('public.tarifario_resultado_publicable') is not null then
    raise exception
      'La relación public.tarifario_resultado_publicable ya existe (tabla, vista u otro objeto) — abortando la migración 182 para no pisarla. Revisar manualmente qué es antes de reintentar.';
  end if;
  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'tarifario_paquete_publicable'
  ) then
    raise exception
      'La función public.tarifario_paquete_publicable ya existe — abortando la migración 182 para no pisarla. Revisar manualmente qué es antes de reintentar.';
  end if;
end $$;

-- A. Helper SECURITY DEFINER — el ÚNICO punto donde un rol sin acceso a
--    `armado_paquetes` obtiene información derivada de ella. Booleano puro:
--    nunca devuelve ninguna columna de `armado_paquetes`, solo el veredicto
--    de publicabilidad de UN paquete_id puntual. `stable` (no escribe nada,
--    seguro leer su resultado varias veces dentro de la misma sentencia).
--    `coalesce(..., false)` — fail-closed: un paquete_id que no exista en
--    `armado_paquetes` (huérfano, borrado, o simplemente no encontrado)
--    nunca se trata como publicable.
create or replace function public.tarifario_paquete_publicable(p_paquete_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select ap.tarifario_snapshot_publicable and ap.activo
      from public.armado_paquetes ap
      where ap.id = p_paquete_id
    ),
    false
  );
$$;

comment on function public.tarifario_paquete_publicable(bigint) is
  'Helper SECURITY DEFINER booleano (Fase 2, migración 182): true solo si armado_paquetes.tarifario_snapshot_publicable Y activo son ambos true para ese paquete_id. Es el ÚNICO punto por el que un rol sin acceso a armado_paquetes (anon, authenticated externo) obtiene información derivada de ella — nunca expone ninguna columna, solo este veredicto. Usado por la policy de lectura de tarifario_resultado y (indirectamente, vía el join propio de la vista) por tarifario_resultado_publicable. search_path fijo, revocado de PUBLIC, concedido a anon y authenticated. Los usuarios internos de la aplicación TAMBIÉN ejecutan bajo el rol SQL authenticated (Supabase no crea un rol de Postgres distinto por rol de negocio) y por lo tanto también tienen EXECUTE sobre este helper — eso es intencional, no un descuido: PostgreSQL no garantiza que el OR de la policy evite evaluarlo para un interno (el planificador puede reordenar expresiones booleanas), así que si lo evaluara, debe poder ejecutarlo sin error de permisos. La autorización real de un interno la decide mi_rol() (la otra rama del OR de la policy), nunca la presencia/ausencia de EXECUTE sobre este helper.';

revoke all on function public.tarifario_paquete_publicable(bigint) from public;
grant execute on function public.tarifario_paquete_publicable(bigint) to anon, authenticated;

-- B. Policy de LECTURA de tarifario_resultado (la TABLA base) — se reemplaza
--    la de la migración 018 ("for select using (true)", el bypass que
--    confirmó la auditoría). Un rol interno autorizado (mismo set que ya
--    protege la ESCRITURA de esta tabla y toda `armado_paquetes`) sigue
--    viendo TODO sin filtrar — lo necesita
--    app/(dashboard)/dashboard/paquetes/[id]/page.tsx para diagnosticar un
--    paquete bloqueado. Cualquier otro rol (anon, authenticated externo)
--    quedó reducido a las filas cuyo paquete es publicable Y activo, vía el
--    helper de arriba — NUNCA lee armado_paquetes directo.
drop policy if exists "tarifario_resultado: lectura" on public.tarifario_resultado;
create policy "tarifario_resultado: lectura" on public.tarifario_resultado
  for select
  using (
    coalesce(public.mi_rol()::text, '') in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    or public.tarifario_paquete_publicable(paquete_id)
  );

-- La policy de ESCRITURA de tarifario_resultado (migración 018) NO se toca —
-- sigue siendo exclusiva de los mismos 4 roles internos, sin cambios.

-- C. Vista autoritativa: MISMAS columnas que tarifario_resultado, filtradas
--    por publicable Y activo — las DOS, cada una comprobada aquí mismo, sin
--    asumir que ya vienen sincronizadas (hallazgo P1-b). SIN
--    `security_invoker` (a propósito: corre con los privilegios del DUEÑO de
--    la vista, no de quien consulta — necesario para leer
--    `armado_paquetes.tarifario_snapshot_publicable`/`activo` como filtro
--    interno sin que el llamador necesite acceso directo a esa tabla, y sin
--    exponerle ninguna de sus columnas). `security_barrier = true` (P2 de la
--    auditoría): evita que el planificador evalúe una función potencialmente
--    "leaky" del lado del llamador (ej. en un `.eq()`/`.filter()` adicional
--    que PostgREST traduzca a una condición extra) ANTES de aplicar este
--    `where` de autorización — el filtro de publicabilidad siempre se aplica
--    primero.
create view public.tarifario_resultado_publicable
  with (security_barrier = true, security_invoker = false)
as
  select r.*
  from public.tarifario_resultado r
  join public.armado_paquetes ap on ap.id = r.paquete_id
  where ap.tarifario_snapshot_publicable = true
    and ap.activo = true;

comment on view public.tarifario_resultado_publicable is
  'tarifario_resultado filtrado por armado_paquetes.tarifario_snapshot_publicable = true Y activo = true (Fase 2, migración 182 — las DOS condiciones, nunca solo una: un paquete que ya estaba inactivo al aplicar la migración 181 pudo quedar con snapshot_publicable=true por el DEFAULT, sin haber disparado ningún trigger de invalidación). El join de autorización ocurre DENTRO de esta vista (sin security_invoker, privilegios del dueño; security_barrier=true), en la MISMA sentencia que la lectura de filas, nunca como una comprobación separada. Expone EXACTAMENTE las mismas columnas que tarifario_resultado — ninguna columna de armado_paquetes se expone. Todo lector que sirva el tarifario en vivo (público, búsqueda, cotización, reserva) debe leer esta vista, nunca tarifario_resultado directo; la administración (diagnóstico del paquete, bajo un rol interno autorizado — ver la policy de tarifario_resultado) y los contratos/cotizaciones ya congelados son las únicas excepciones documentadas (ver cabecera de la migración 182). Desde esta migración, tarifario_resultado (la tabla base) YA NO es de lectura pública sin filtrar — esta vista sigue siendo necesaria incluso para un acceso "de solo lectura pública", no es una capa opcional.';

-- Explícito: sin privilegios previos de ningún tipo antes del grant select de
-- abajo (mismo endurecimiento que ya usa la migración 162).
revoke all on public.tarifario_resultado_publicable from public, anon, authenticated, service_role;

-- anon + authenticated: mismo alcance de siempre, sin restricción de tenant
-- (el tarifario es de mayorista únicamente, no existe separación por tenant
-- en esta tabla, igual criterio que tarifario_resumen/migración 162). Esta
-- vista es ahora la ÚNICA vía de lectura pública sin filtrar por rol interno
-- — ver el cambio de policy en el punto B.
--
-- service_role: EXPLÍCITO (hallazgo 1 de la segunda ronda de auditoría) —
-- `buscarHoteles`/`buscarReceptivos`/`liquidarServicioPuntual`
-- (lib/reservar/cotizar.ts) leen esta vista con `createAdminClient()`.
-- Bypasar RLS (lo que `service_role` ya hace por diseño de Supabase) NO
-- concede el privilegio SQL de `SELECT` sobre una vista — sin este `grant`
-- explícito esas 3 consultas fallarían con "permission denied for view
-- tarifario_resultado_publicable", y esta migración no depende de que algún
-- `default privilege` preexistente en el proyecto se lo conceda solo. El
-- `where` de la vista (publicable Y activo) NO distingue por rol: se aplica
-- exactamente igual a `service_role` que a `anon`/`authenticated` — ningún
-- rol, ni siquiera `service_role`, puede recuperar por esta vista un paquete
-- bloqueado o inactivo.
grant select on public.tarifario_resultado_publicable to anon, authenticated, service_role;

-- D. tarifario_resumen (migración 162, NO se edita ese archivo): sin cambios
--    respecto a la ronda anterior de esta misma migración — sigue leyendo de
--    `tarifario_resultado_publicable` (que ahora también exige `activo`),
--    `security_invoker = true` (sigue sin necesitar privilegio propio: ya lee
--    de una vista que anon/authenticated puede consultar directo) y el
--    filtro `r.paquete_activo = true` existente (redundante ahora — todo
--    paquete publicable ya tiene paquete_activo en sincronía — pero se
--    conserva sin tocar para no ampliar el diff más de lo necesario).
--
--    ⚠️ Deliberadamente SIN `grant select` a `service_role` (segunda ronda de
--    auditoría, hallazgo 1): confirmado por grep que `cargarFilasResumen
--    Paginado` (lib/tarifario/resumen.ts, el único lector de esta vista)
--    siempre recibe el cliente de SESIÓN (`createClient()`), nunca
--    `createAdminClient()` — agregar `service_role` aquí "por simetría" con
--    `tarifario_resultado_publicable` sería un privilegio sin ningún lector
--    real detrás. Si en el futuro aparece un lector con service_role, ese es
--    el momento de agregarlo, en su propia migración.
--
--    ⚠️ TERCERA RONDA DE AUDITORÍA — corrección sobre la ronda anterior: una
--    versión previa de esta migración agregaba `service_role` al `revoke all`
--    de `tarifario_resumen` (con la intención de "limpiar" privilegios
--    estructurales heredados — TRUNCATE/REFERENCES/TRIGGER — que
--    `service_role` tenía sobre esta vista desde ANTES de la 182, por un
--    `default privilege` del proyecto que ninguna migración de este repo
--    otorgó a propósito). Eso hacía que `rollback_182` NO pudiera restaurar
--    esa ACL histórica (el rollback recrea la vista con el `revoke`/`grant`
--    EXACTOS de la migración 162, que nunca mencionan `service_role` — no
--    hay forma de "reconstruir" desde el rollback un privilegio que nunca
--    quedó registrado en ningún script de esta migración) — aplicar y
--    revertir la 182 dejaba de ser un round-trip idéntico. **Esta migración
--    NO toca ningún privilegio de `service_role` sobre `tarifario_resumen`,
--    ni para quitarlo ni para agregarlo** — el `revoke`/`grant` de abajo son
--    IDÉNTICOS a los de la migración 162 (`public, anon, authenticated`,
--    nunca `service_role`). El saneamiento de esos privilegios históricos
--    (si el dueño decide que hace falta) es una tarea APARTE, con su propio
--    inventario de qué los originó y su propio rollback — no algo que esta
--    migración de Fase 2 deba decidir de paso.
create or replace view public.tarifario_resumen
  with (security_invoker = true)
as
  select
    r.modulo,
    r.paquete_id,
    r.paquete_nombre,
    r.paquete_activo,
    r.bloqueo_id,
    r.bloqueo_label,
    r.empaquetado_id,
    r.salida_id,
    r.hotel_id,
    r.hotel_nombre,
    r.servicio_id,
    r.servicio_nombre,
    r.destino_id,
    r.destino_nombre,
    r.categoria,
    r.regimen,
    r.fecha_ida,
    r.fecha_regreso,
    r.noches,
    r.moneda,
    min(r.precio_pvp) filter (where r.acomodacion = 'sencilla' and r.precio_pvp > 0) as precio_sencilla,
    min(r.precio_pvp) filter (where r.acomodacion = 'doble'    and r.precio_pvp > 0) as precio_doble,
    min(r.precio_pvp) filter (where r.acomodacion = 'triple'   and r.precio_pvp > 0) as precio_triple,
    min(r.precio_pvp) filter (where r.acomodacion = 'multiple' and r.precio_pvp > 0) as precio_multiple,
    min(r.precio_pvp) filter (where r.acomodacion = 'nino')    as precio_nino,
    min(r.precio_pvp) filter (where r.acomodacion = 'nino2')   as precio_nino2,
    min(r.precio_pvp) filter (where r.acomodacion = 'infante') as precio_infante,
    min(r.precio_pvp) filter (
      where r.acomodacion in ('sencilla', 'doble', 'triple', 'multiple') and r.precio_pvp > 0
    ) as desde_adulto,
    min(r.precio_pvp) filter (where r.precio_pvp > 0) as desde_general,
    min(r.descripcion) as descripcion,
    min(r.recargo_individual) as recargo_individual,
    min(r.tipo_tarifa) as tipo_tarifa
  from public.tarifario_resultado_publicable r
  where r.paquete_activo = true
  group by
    r.modulo, r.paquete_id, r.paquete_nombre, r.paquete_activo, r.bloqueo_id, r.bloqueo_label,
    r.empaquetado_id, r.salida_id, r.hotel_id, r.hotel_nombre, r.servicio_id, r.servicio_nombre,
    r.destino_id, r.destino_nombre, r.categoria, r.regimen, r.fecha_ida, r.fecha_regreso, r.noches, r.moneda;

comment on view public.tarifario_resumen is
  'Resumen agregado de tarifario_resultado_publicable (colapsa la dimensión acomodación; una fila por módulo/paquete/bloqueo/hotel/servicio/categoría/régimen). Carga inicial liviana del tarifario en dos niveles — la matriz de acomodación completa (con descripción/recargo/escalas) sigue viviendo en tarifario_resultado_publicable, consultada bajo demanda. Incluye precio_nino/precio_nino2/precio_infante (nunca filtrados por precio_pvp>0: 0 es un precio válido para menores). Desde la migración 182, hereda el bloqueo de snapshots no publicables o inactivos (armado_paquetes.tarifario_snapshot_publicable Y activo) a través de su fuente. security_invoker: hereda exactamente el mismo acceso público que ya tenía tarifario_resultado_publicable (nunca el de tarifario_resultado directo, que desde esta migración ya no es de lectura pública sin filtrar).';

revoke all on public.tarifario_resumen from public, anon, authenticated;
grant select on public.tarifario_resumen to anon, authenticated;

commit;
