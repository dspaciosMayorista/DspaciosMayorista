-- ───────────────────────────────────────────────────────────────────────────
-- Migración 187 — búsqueda interna de pasajero por documento exacto
-- (reutilización de identidad entre contratos) + nombres/apellidos
-- estructurados para registros NUEVOS.
--
-- Contexto: no existe ningún directorio reutilizable de pasajeros.
-- `contrato_pasajeros` es un log de filas por contrato (una persona que
-- viajó dos veces aparece dos veces, sin ningún id compartido); `sillas` es
-- un snapshot operativo best-effort del inventario de vuelos (ver el
-- comentario "Snapshot cosmético" en contratos/actions.ts); `crm_contactos`
-- NO tiene columna `tenant` y se lee con `auth.uid() is not null` sin
-- ningún filtro adicional (migración 042) — mezcla las dos agencias y no es
-- apto para exponer datos de pasajero por este camino. Esta migración NO
-- crea una tabla directorio nueva: en vez de eso, agrega una función de
-- SOLO LECTURA que busca coincidencias EXACTAS de documento dentro de
-- `contrato_pasajeros`, filtradas por los mismos permisos/tenant que ya
-- rigen el acceso a cada contrato (`puede_ver_contrato`/
-- `soy_asesor_del_contrato`, migraciones 142/144/147) — nunca un listado ni
-- una búsqueda abierta.
--
-- ⚠️ CORRECCIÓN sobre la primera versión de esta migración (revisión
-- posterior): `contrato_pasajeros.nacionalidad` NO nace aquí — existe desde
-- la migración 022 (`20260601000022_reserva_tarifario.sql`, línea 17-18:
-- `alter table public.contrato_pasajeros add column if not exists
-- nacionalidad text;`). La primera versión de esta migración la
-- re-declaraba como si fuera propia (inofensivo en sí — `add column if not
-- exists` es no-op sobre una columna ya existente — pero el rollback que la
-- acompañaba SÍ hacía `drop column if exists nacionalidad`, lo que habría
-- borrado una columna que pertenece a la 022 y que puede tener datos reales
-- desde entonces). Corregido: esta migración YA NO toca `nacionalidad` en
-- absoluto (ni la agrega ni la comenta) y su rollback ya no la dropea. Los
-- scripts de preflight/postcheck/rollback en `supabase/scripts/` se
-- corrigieron para no tratar la existencia de `nacionalidad` como señal de
-- si la 187 está aplicada.
--
-- ⚠️ Alcance explícito de esta migración:
--   - Agrega: la función de búsqueda + `nombres`/`apellidos` ESTRUCTURADOS
--     (nullable, sin backfill) — ver la parte C para la decisión completa
--     de reutilización de nombres.
--   - NO toca el núcleo atómico de pasajeros/sillas de la migración 167
--     (`_reemplazar_pasajeros_nucleo`, `_guardar_pasajeros_nucleo`,
--     `guardar_pasajeros_contrato`, `crear_pasajeros_contrato`,
--     `crear_pasajeros_contrato_multi`, el tipo `_fila_pasajero_167`): esas
--     funciones fueron revisadas en múltiples rondas de alto riesgo
--     específicamente por su atomicidad pasajeros↔sillas, y cambiar su
--     `RETURNS TABLE` exige un DROP+CREATE en cascada de las 5 funciones
--     más el tipo compuesto — cirugía de alto riesgo que no se puede
--     validar contra una base real desde este entorno (sin Postgres local
--     ni acceso remoto). `nombres`/`apellidos`/`nacionalidad` se persisten
--     en cambio con un UPDATE directo, POSTERIOR, desde TypeScript — mismo
--     patrón que el snapshot de `sillas.pasajero_*`/`sillas.nacimiento`,
--     pero a diferencia de aquel, aquí SÍ se revisa `{ error }` de Supabase
--     y se reporta honestamente si falla (ver lib/reservar/actions.ts) —
--     nunca se llama "cosmético" ni se asume éxito sin comprobarlo.
--   - NO reconstruye nombres/apellidos separados para filas HISTÓRICAS
--     (`contrato_pasajeros.nombre` sigue siendo un solo campo de texto,
--     nunca se parte por heurística). Ver la parte C.
--   - Preflight/postcheck/rollback/test en supabase/scripts/*_187_*.sql. No
--     ejecutada en producción — pendiente de validación y aprobación del
--     dueño.
--
-- ⚠️ Auditoría SECURITY DEFINER vs. RLS real (por qué esto SÍ aísla por
-- agencia y por contrato propio, no una presunción):
--   `buscar_pasajero_por_documento` es SECURITY DEFINER — corre con los
--   privilegios del DUEÑO del esquema, así que el `join public.ventas`
--   dentro de la función NO pasa por la RLS de `ventas` (que desde la
--   migración 144 ni siquiera deja a `venta` hacer SELECT directo sobre esa
--   tabla). Eso es INTENCIONAL y es el mismo mecanismo que ya usan
--   `puede_ver_contrato`/`_autorizado_escribir_pasajeros` (ambas SECURITY
--   DEFINER desde las migraciones 144/167, con el comentario explícito de
--   que sin esto `venta` se quedaría sin poder leer las tablas hijas de sus
--   propios contratos). El aislamiento real NO viene de la RLS de `ventas`
--   dentro de esta función — viene de las condiciones EXPLÍCITAS del WHERE:
--   `puede_ver_contrato(cp.numero_contrato)` (tenant vía `puede_ver_tenant`
--   para administracion/operaciones, todo tenant para superadmin/gerencia)
--   y, para `venta`, además `soy_asesor_del_contrato(...)`.
--
--   Lo que SÍ hay que verificar (y que la primera versión de esta migración
--   no probó con una prueba ejecutable dedicada) es que `mi_rol()`/
--   `auth.uid()` — que internamente leen la GUC de sesión
--   `request.jwt.claims` — seguyan resolviendo al usuario REAL que invocó la
--   función y no a un actor genérico, incluso dentro de una cadena de
--   llamadas SECURITY DEFINER. Esto es cierto en Postgres porque SECURITY
--   DEFINER cambia el ROL de privilegios (`current_user`) para la duración
--   de la función, pero NO resetea las GUC de sesión — `request.jwt.claims`
--   sigue siendo la que PostgREST fijó para toda la conexión/request. Esta
--   migración no presupone esto: `supabase/scripts/
--   test_187_seguridad_rls.sql` lo prueba de forma DIRECTA (identidad
--   propagada) e INDIRECTA (aislamiento observado) para superadmin,
--   gerencia, administracion/operaciones (con `usuarios.tenant` coincidente
--   y con `usuarios.tenant` cruzado — dos agencias asignadas distintas, NO
--   una "agencia activa" de UI: ver la nota de decisión de permisos más
--   abajo en ese mismo script para el caso de superadmin/gerencia), venta
--   (contrato propio vs. ajeno, misma agencia y agencia cruzada) y un
--   usuario externo (agencia/freelance) — con datos auto-contenidos dentro
--   de la transacción (nunca depende de "si existe" un usuario real de
--   cada rol en la base, así ningún escenario crítico queda "omitido").
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ═════════════════════════════════════════════════════════════════════════
-- A) `nombres`/`apellidos` ESTRUCTURADOS — solo para pasajeros NUEVOS desde
--    ahora en adelante (ver la decisión completa en la parte C). Nullable,
--    sin backfill: NUNCA se derivan por heurística del `nombre` combinado
--    histórico.
-- ═════════════════════════════════════════════════════════════════════════

alter table public.contrato_pasajeros
  add column if not exists nombres   text,
  add column if not exists apellidos text;

comment on column public.contrato_pasajeros.nombres is
  'Nombres del pasajero, estructurados (separados de apellidos). NULL en '
  'toda fila creada antes de la migración 187 y en cualquier fila donde el '
  'guardado best-effort posterior a la creación haya fallado — nunca se '
  'infiere ni se deriva partiendo `nombre` por heurística. Cuando ambas '
  '(nombres y apellidos) existen, `nombre` sigue siendo la fuente visible '
  'para el documento/contrato; estas dos son solo para que una búsqueda '
  'futura pueda reutilizarlas SIN pedirle a un humano que las separe de '
  'nuevo. Migración 187.';

comment on column public.contrato_pasajeros.apellidos is
  'Ver el comentario de contrato_pasajeros.nombres — misma regla, apellidos.';

-- Índice de soporte para la búsqueda exacta por documento (parte B) — no
-- existía ninguno sobre (tipo_id, identificacion) hasta ahora (el único
-- índice previo de esta tabla es por numero_contrato, migración 141, y por
-- responsable_id, migración 167).
create index if not exists idx_contrato_pasajeros_documento
  on public.contrato_pasajeros(tipo_id, identificacion);

-- ═════════════════════════════════════════════════════════════════════════
-- B) Búsqueda interna de pasajero por documento EXACTO.
--
-- Reglas de diseño:
--   - Match EXACTO de tipo_id + identificacion. Nada de ILIKE/similar ni
--     búsqueda por nombre — cero superficie de enumeración masiva.
--   - Resultados LIMITADOS (máx. 8 combinaciones distintas) y agregados: si
--     el mismo documento aparece en varios contratos con datos DISTINTOS
--     (nombre/nombres/apellidos/fecha_nacimiento/nacionalidad), se devuelve
--     una fila POR COMBINACIÓN distinta — nunca se elige una "ganadora" en
--     el servidor. El front-end decide cuál usar (o ninguna); jamás se
--     sobrescribe en silencio.
--   - NUNCA expone `id`, `responsable_id` ni `es_infante` de
--     `contrato_pasajeros` — son atributos DEL CONTRATO de origen (una
--     asignación de silla, un vínculo con otro pasajero de ESE contrato),
--     no de la persona. El llamador debe volver a calcular `es_infante`
--     contra la fecha de salida del contrato NUEVO (ver
--     `es_infante_por_edad`, migración 167) y vincular el responsable
--     dentro del contrato nuevo — nunca copiar el vínculo viejo.
--   - Filtro de permisos IDÉNTICO al que ya protege cada contrato
--     individual (`puede_ver_contrato`/`soy_asesor_del_contrato`) — mismo
--     criterio ya usado por `_autorizado_escribir_pasajeros` (migración
--     167): `superadmin`/`gerencia` ven todo tenant; `administracion`/
--     `operaciones` su propio tenant (`puede_ver_tenant`); `venta` SOLO
--     los contratos donde es el asesor asignado. Cualquier otro rol
--     (incl. B2B externo/anónimo) queda rechazado ANTES de tocar la tabla
--     — no depende de que el front-end no la llame, es la autoridad real
--     (ver la auditoría SECURITY DEFINER arriba).
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.buscar_pasajero_por_documento(
  p_tipo_id        text,
  p_identificacion text
)
returns table (
  nombre            text,
  nombres           text,
  apellidos         text,
  fecha_nacimiento  date,
  nacionalidad      text,
  veces_visto       bigint,
  ultimo_contrato   text,
  ultima_fecha      date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_max_resultados constant int := 8;
  v_tipo_id        text;
  v_ident          text;
begin
  -- Autoridad real de acceso: solo roles internos con lectura de contratos.
  -- Ningún rol externo (agencia/freelance/cliente_final) ni anónimo pasa de
  -- aquí — no depende de que el tarifario público o el portal B2B
  -- simplemente "no llamen" esta función (ver test_187_seguridad_rls.sql).
  --
  -- ⚠️ `coalesce(..., true)`, NO un `not in` desnudo: `mi_rol()` devuelve
  -- NULL para un usuario interno DESACTIVADO (migración 140, `where ...
  -- and activo`). En PL/pgSQL un `if <NULL> then` se trata como FALSE (NO
  -- entra al cuerpo del if) — con un `not in` desnudo, un usuario inactivo
  -- habría pasado de largo este chequeo SIN excepción (el WHERE de más
  -- abajo lo habría dejado sin filas igual, porque también evalúa a NULL,
  -- así que no había fuga de datos — pero sí un mensaje de error ausente,
  -- exactamente lo que esta migración se propuso NO presuponer). Con
  -- `coalesce`, `mi_rol() is null` fuerza el `true` → SIEMPRE rechaza
  -- explícito, igual que un rol externo real. Ver el caso "usuario interno
  -- inactivo" en test_187_seguridad_rls.sql.
  if coalesce(public.mi_rol()::text not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta'), true) then
    raise exception 'Sin permiso para buscar pasajeros.';
  end if;

  -- ⚠️ Se busca EXACTAMENTE el tipo_id recibido — esta función NO normaliza
  -- "PASAPORTE" a "PAS" ni viceversa. `contrato_pasajeros.tipo_id` guarda
  -- lo que cada formulario haya mandado, y el núcleo atómico de la
  -- migración 167 compara literalmente contra 'PAS' (línea ~979 de esa
  -- migración) para eximir del chequeo "solo dígitos". Los 5 formularios
  -- que escriben pasajeros deben usar el MISMO valor ('PAS') para que un
  -- pasaporte real (a) no sea rechazado por ese chequeo y (b) sea
  -- encontrable por esta búsqueda sin importar en qué formulario se cargó
  -- originalmente — ver el fix de ProgramaReservaForm.tsx que acompaña esta
  -- migración (usaba 'PASAPORTE', ya corregido a 'PAS').
  v_tipo_id := coalesce(nullif(trim(p_tipo_id), ''), 'CC');
  v_ident := nullif(trim(p_identificacion), '');

  if v_ident is null then
    raise exception 'El número de documento es obligatorio.';
  end if;
  if length(v_ident) > 30 then
    raise exception 'El número de documento es demasiado largo.';
  end if;
  if length(v_tipo_id) > 10 then
    raise exception 'El tipo de documento es inválido.';
  end if;

  return query
    select cp.nombre,
           cp.nombres,
           cp.apellidos,
           cp.fecha_nacimiento,
           cp.nacionalidad,
           count(*)::bigint as veces_visto,
           (array_agg(cp.numero_contrato order by v.fecha_venta desc nulls last, cp.id desc))[1] as ultimo_contrato,
           max(v.fecha_venta) as ultima_fecha
      from public.contrato_pasajeros cp
      join public.ventas v on v.numero_contrato = cp.numero_contrato
     where cp.tipo_id = v_tipo_id
       and cp.identificacion = v_ident
       -- Mismo candado que _autorizado_escribir_pasajeros (migración 167,
       -- rama de edición) — sin duplicar su lista de roles: puede_ver_contrato
       -- ya falla cerrado para cualquiera fuera de {superadmin, gerencia,
       -- administracion, operaciones, venta} y ya verifica tenant. La
       -- función es SECURITY DEFINER (ver auditoría arriba): este `join
       -- ventas` bypasea la RLS de esa tabla a propósito, y el aislamiento
       -- real lo dan estas dos condiciones explícitas, no la RLS de ventas.
       and public.puede_ver_contrato(cp.numero_contrato)
       and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(cp.numero_contrato))
     group by cp.nombre, cp.nombres, cp.apellidos, cp.fecha_nacimiento, cp.nacionalidad
     order by max(v.fecha_venta) desc nulls last
     limit v_max_resultados;
end;
$$;

comment on function public.buscar_pasajero_por_documento(text, text) is
  'Búsqueda interna de solo lectura por documento EXACTO (tipo_id + '
  'identificacion) dentro de contrato_pasajeros, para reutilizar datos '
  'demográficos al crear un contrato nuevo — nunca enumeración masiva ni '
  'búsqueda por nombre. SECURITY DEFINER: el join a `ventas` bypasea su RLS '
  'a propósito (mismo criterio que puede_ver_contrato/'
  '_autorizado_escribir_pasajeros, migraciones 144/167) — el aislamiento '
  'real lo dan las condiciones explícitas del WHERE (puede_ver_contrato + '
  'soy_asesor_del_contrato para venta), probadas en '
  'test_187_seguridad_rls.sql. Agrupa por (nombre, nombres, apellidos, '
  'fecha_nacimiento, nacionalidad): si el mismo documento trae datos '
  'DISTINTOS en contratos distintos, devuelve una fila por combinación '
  '(máx. 8) — nunca elige una versión "correcta" en el servidor, así que un '
  'dato contradictorio nunca se sobrescribe en silencio. NUNCA devuelve '
  'id/responsable_id/es_infante (atributos del contrato de origen, no de la '
  'persona) — el llamador debe recalcular es_infante contra la fecha del '
  'contrato NUEVO y vincular el responsable dentro de ese contrato nuevo. '
  'Migración 187.';

revoke all on function public.buscar_pasajero_por_documento(text, text) from public, anon;
grant execute on function public.buscar_pasajero_por_documento(text, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- C) Decisión de reutilización de nombres — qué se rellena HOY y cómo se
--    guardan datos estructurados para el futuro.
--
--    `contrato_pasajeros.nombre` (single text) es y sigue siendo la fuente
--    visible del contrato/documento. Partirlo por heurística para filas
--    HISTÓRICAS está descartado a propósito (un apellido compuesto, un
--    "de la Cruz", un solo nombre sin apellido registrado, harían que
--    cualquier heurística acierte mal en algún caso real, y ese error se
--    imprimiría en un contrato/documento legal).
--
--    Decisión: separar el problema en dos mitades con una frontera dura en
--    la fecha de esta migración —
--
--    HOY (retroactivo, sin escribir nada nuevo): la búsqueda por documento
--    puede rellenar con confianza `fecha_nacimiento` y `nacionalidad` de
--    CUALQUIER fila histórica que matchee — son campos ATÓMICOS, no hay
--    ambigüedad de dónde corta un nombre. `nombre` (combinado) se muestra
--    tal cual para que la persona lo LEA y lo copie a mano en los campos ya
--    separados de nombres/apellidos del formulario nuevo — nunca se aplica
--    solo.
--
--    DE AQUÍ EN ADELANTE (estructurado, para que el problema deje de
--    crecer): todos los formularios que capturan pasajeros YA piden nombres
--    y apellidos por separado en su propio estado de React — nunca se
--    perdió ese dato, solo nunca se guardó estructurado en la base (el
--    núcleo atómico de la 167 solo persiste `nombre` combinado). Las nuevas
--    columnas `nombres`/`apellidos` (parte A) capturan ESE mismo split que
--    el formulario ya tenía, con un UPDATE best-effort posterior a la
--    creación (mismo patrón que `nacionalidad`, con manejo honesto de
--    error — ver reservar/actions.ts y contratos/actions.ts). Una vez que
--    una fila tiene `nombres`/`apellidos` no nulos, un match futuro de esta
--    búsqueda SÍ puede aplicarlos directamente a los campos separados del
--    formulario (nunca partiendo nada: son el mismo split que un humano ya
--    escribió al crear esa fila). El corte es la fecha de escritura de cada
--    FILA, no una fecha global: una base con filas viejas y nuevas mezcladas
--    simplemente tiene algunas filas con nombres/apellidos y otras sin —
--    la búsqueda ya distingue el caso (devuelve null en las que no los
--    tienen) y la UI decide qué mostrar en cada caso (ver
--    BuscarPasajeroDocumento.tsx).
-- ═════════════════════════════════════════════════════════════════════════

notify pgrst, 'reload schema';

commit;
