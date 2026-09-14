-- ───────────────────────────────────────────────────────────────────────────
-- 176 · PERSISTENCIA ESTRUCTURAL PARA UNA LÍNEA DE PRECIO TOTAL (Bernalo) +
--        SNAPSHOT PRIVADO POR HABITACIÓN (Fase 3F-2)
--
-- QUÉ RESUELVE
-- Fase 3F-1 (rama anterior) ya transporta una reserva Bernalo por habitación
-- desde el carrito hasta el checkout (`SolicitudItemBernaloValidado`), pero
-- `computarReserva` sigue bloqueando ese hotel (guardia de Fase 3, sin
-- cambios) y NADA escribe todavía contrato/CxP para él. Esta migración
-- SOLO prepara el terreno estructural para cuando 3F-3 conecte ese cálculo:
--
--   A) `contrato_items` gana un modo de precio EXPLÍCITO, sin romper el
--      modelo per-cápita existente (adultos/ninos × tarifa_adulto/tarifa_nino,
--      el único que hoy usan `ContratoDocumento.tsx`/`contenido-actions.ts`
--      para sumar el total del contrato). Bernalo no reparte comisión por
--      columna (confirmado en `lib/calc/unidadAlojamiento.ts`, ronda 8): su
--      línea es un valor YA compuesto, no una tarifa por persona.
--
--   B) `contrato_alojamiento_bernalo`: una fila POR HABITACIÓN FÍSICA con el
--      `SnapshotAlojamiento` completo que ya produce
--      `construirSnapshotAlojamiento` (Fase 3A, `lib/calc/unidadAlojamiento.ts`)
--      — neto, bruto, comisión, fuente del documento, id/versión de la
--      tarifa exacta que se cotizó. Es un dato COMERCIAL PRIVADO (nunca se
--      muestra al cliente ni a un rol externo): por eso vive en tabla aparte
--      de `contrato_items` (que sí es PVP visible, migración 146/148) y
--      nace con RLS activa y CERO policies — ni siquiera para roles internos
--      todavía (mismo criterio que `contrato_financiero_pendiente`, 172):
--      solo `service_role` puede tocarla, desde una frontera server-side que
--      esta fase NO construye.
--
-- ALCANCE EXPLÍCITO DE ESTA FASE (lo que esta migración NO hace)
--   · No conecta `checkout/actions.ts` ni `computarReserva` — la guardia de
--     Fase 3 sigue bloqueando hoteles `modelo_tarifario = 'unidad'`.
--   · No inserta ni recalcula ninguna fila existente de `contrato_items`.
--   · No cambia `ContratoDocumento.tsx` ni ningún otro renderer/insert de
--     aplicación — una fila `modo_precio = 'total'` hoy sumaría $0 en esas
--     pantallas (siguen leyendo solo `adultos × tarifa_adulto + ninos ×
--     tarifa_nino`) porque NINGUNA fila así existe todavía: nada la crea en
--     esta fase. Riesgo documentado para 3F-3, no corregido aquí a propósito
--     (tocar esos renderers está fuera del alcance pedido).
--   · No abre RLS de `contrato_alojamiento_bernalo` para resolver el PDF —
--     eso exige decidir la frontera server-side (qué rol, con qué filtro) y
--     queda para una fase posterior.
--   · Sin seed, sin backfill, sin trigger de inmutabilidad (el snapshot debe
--     poder desaparecer limpio con `ON DELETE CASCADE` si `revertir_contrato_
--     incompleto`/`eliminar_contrato` borran el contrato — un trigger que
--     bloquee el DELETE, como el de `contrato_condiciones` (migración 164),
--     rompería esas dos rutas).
--
-- ── A) `contrato_items.modo_precio` / `valor_total` ─────────────────────────
-- Dos modos, mutuamente excluyentes por CHECK:
--   · 'por_persona' (default — TODA fila existente y toda fila nueva que no
--     declare lo contrario): comportamiento actual, sin cambios. `valor_total`
--     debe ser null — nadie debe poder cargar los dos modelos a la vez en la
--     misma fila.
--   · 'total': `valor_total` obligatorio, no negativo y FINITO — `numeric`
--     de Postgres SÍ admite `NaN` como valor de columna (y `Infinity`/
--     `-Infinity` en un `numeric` sin precisión/escala declaradas), así que
--     "finito" no lo garantiza el tipo por sí solo: el CHECK lo exige
--     explícito (`valor_total::text not in ('NaN','Infinity','-Infinity')`,
--     ver el comentario junto al CHECK más abajo para el detalle completo,
--     incluida la corrección de un `NaN >= 0` que evalúa `true` en Postgres).
--     `adultos`/`ninos`/`tarifa_adulto`/`tarifa_nino` NO son
--     autoridad para esta línea (siguen aceptando su default 0, informativos
--     como mucho) — el motor Bernalo (3F-3) debe leer `valor_total`, nunca
--     recomponerlo desde esas cuatro columnas.
-- Nombre elegido: `modo_precio` (no `tipo_precio`/`modelo_precio`) para no
-- chocar semánticamente con `hoteles.modelo_tarifario` (persona/unidad, es
-- OTRO concepto: de dónde sale el precio, no cómo se representa la línea ya
-- calculada en el contrato).
--
-- ── B) `contrato_alojamiento_bernalo` ────────────────────────────────────
-- Una fila por habitación física de un contrato Bernalo (`habitacion_id`,
-- mismo id estable `${acomodacion}-${índice}` que ya usa Fase 3D,
-- `lib/reservar/ocupacionPorHabitacion.ts`). `snapshot` es el
-- `SnapshotAlojamiento` COMPLETO (jsonb) que devuelve
-- `construirSnapshotAlojamiento` — la fuente de verdad de "qué se cotizó
-- exactamente" (tarifaId, versionTarifario, desglose, ajusteComercial con
-- comisión/bruto/neto, fuente del documento) sin que 3F-3 tenga que
-- reconstruirlo desde cero al generar el documento o auditar el contrato.
-- `hotel_id`/`hotel_nombre`/`categoria`/`alimentacion`/`adultos`/
-- `edades_menores` son columnas ESPEJO (mismo criterio que
-- `hotel_tarifas_unidad`, migración 173): permiten listar/filtrar sin abrir
-- el JSON; `snapshot` sigue siendo la fuente de verdad real, esta migración
-- no exige que coincidan (esa coherencia, si se necesita, la exige el
-- adaptador TypeScript de 3F-3 — replicarla en un CHECK duplicaría la
-- validación del motor, lo que el encargo pide evitar explícitamente).
-- `hotel_id` con `ON DELETE SET NULL` (no cascade): si el hotel del catálogo
-- se borra, el snapshot histórico del contrato sigue existiendo — perder la
-- referencia al catálogo no debe borrar la prueba de qué se cobró.
--
-- ADITIVA, IDEMPOTENTE y TRANSACCIONAL (`begin`/`commit`, mismo criterio que
-- 172/173/174/175): columnas con `add column if not exists` + verificación de
-- definición compatible antes de cada CHECK; tabla con `create table if not
-- exists`.
--
-- Preflight / postcheck / prueba de comportamiento / rollback en
-- `supabase/scripts/` (176). Verificados contra Postgres local antes de
-- aplicar en cualquier otro entorno.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ══════════════════════════════════════════════════════════════════════════
-- A) contrato_items: modo_precio + valor_total
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_tipo text;
  v_nullable text;
  v_default text;
begin
  select data_type, is_nullable, column_default
    into v_tipo, v_nullable, v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'contrato_items' and column_name = 'modo_precio';

  if found and (
    v_tipo is distinct from 'text'
    or v_nullable is distinct from 'NO'
    or v_default is distinct from '''por_persona''::text'
  ) then
    raise exception 'ABORTADO: contrato_items.modo_precio existe con una definicion incompatible (tipo=%, nullable=%, default=%).', v_tipo, v_nullable, v_default;
  end if;
end $$;

alter table public.contrato_items
  add column if not exists modo_precio text not null default 'por_persona';

do $$
declare
  v_tipo text;
  v_nullable text;
  v_default text;
begin
  select data_type, is_nullable, column_default
    into v_tipo, v_nullable, v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'contrato_items' and column_name = 'valor_total';

  if found and (
    v_tipo is distinct from 'numeric'
    or v_nullable is distinct from 'YES'
    or v_default is not null
  ) then
    raise exception 'ABORTADO: contrato_items.valor_total existe con una definicion incompatible (tipo=%, nullable=%, default=%).', v_tipo, v_nullable, v_default;
  end if;
end $$;

alter table public.contrato_items
  add column if not exists valor_total numeric(15,2);

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'contrato_items_modo_precio_check'
     and conrelid = 'public.contrato_items'::regclass;

  if not found then
    alter table public.contrato_items
      add constraint contrato_items_modo_precio_check
      check (modo_precio in ('por_persona', 'total'));
  elsif v_def is distinct from 'CHECK ((modo_precio = ANY (ARRAY[''por_persona''::text, ''total''::text])))' then
    raise exception 'ABORTADO: el CHECK contrato_items_modo_precio_check existe con otra definicion: %.', v_def;
  end if;
end $$;

-- Coherencia modo↔valor_total: 'por_persona' NUNCA lleva valor_total (evita
-- que una misma fila declare los dos modelos a la vez); 'total' SIEMPRE
-- exige un valor_total obligatorio, NO NEGATIVO y FINITO.
--
-- ⚠️ CORRECCIÓN (ronda de revisión posterior a la entrega original): un
-- `valor_total >= 0` NO demuestra por sí solo que el valor sea finito.
-- `numeric` de PostgreSQL admite el valor especial `NaN`, y `NaN >= 0`
-- evalúa `true` (NaN compara como mayor que cualquier valor real, es el
-- orden documentado de Postgres para `numeric`) — verificado localmente:
-- `select 'NaN'::numeric(15,2) >= 0` devuelve `t`. Sin el filtro explícito
-- de abajo, una fila con `valor_total = 'NaN'` pasaba este CHECK. Por eso se
-- agrega `valor_total::text not in ('NaN', 'Infinity', '-Infinity')` —
-- expresión estable (la representación textual de estos tres valores
-- especiales es parte del comportamiento documentado de `numeric`, no
-- depende de configuración regional/locale) y verificable a simple vista.
-- `Infinity`/`-Infinity` NO pueden llegar siquiera a evaluar este CHECK en
-- una columna `numeric(15,2)` (precisión/escala declaradas): Postgres los
-- rechaza ANTES, al convertir el literal a ese tipo, con
-- `SQLSTATE 22003 (numeric_value_out_of_range) — numeric field overflow`
-- (verificado localmente contra PostgreSQL 15.8). El filtro de todas formas
-- los nombra explícitos en el CHECK — documentación ejecutable de la
-- intención ("finito", no solo "no negativo") que sigue siendo correcta si
-- algún día la columna cambiara a un `numeric` sin precisión/escala (donde
-- Postgres SÍ admite Infinity/-Infinity como valores de columna).
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'contrato_items_modo_precio_valor_total_check'
     and conrelid = 'public.contrato_items'::regclass;

  if not found then
    alter table public.contrato_items
      add constraint contrato_items_modo_precio_valor_total_check
      check (
        (modo_precio = 'por_persona' and valor_total is null)
        or
        (
          modo_precio = 'total'
          and valor_total is not null
          and valor_total >= 0
          and valor_total::text not in ('NaN', 'Infinity', '-Infinity')
        )
      );
  elsif v_def is distinct from 'CHECK ((((modo_precio = ''por_persona''::text) AND (valor_total IS NULL)) OR ((modo_precio = ''total''::text) AND (valor_total IS NOT NULL) AND (valor_total >= (0)::numeric) AND ((valor_total)::text <> ALL (ARRAY[''NaN''::text, ''Infinity''::text, ''-Infinity''::text])))))' then
    raise exception 'ABORTADO: el CHECK contrato_items_modo_precio_valor_total_check existe con otra definicion: %.', v_def;
  end if;
end $$;

comment on column public.contrato_items.modo_precio is
  'Cómo se debe leer el total de esta línea. "por_persona" (default, todas las filas existentes): comportamiento de siempre, total = adultos × tarifa_adulto + ninos × tarifa_nino (ver ContratoDocumento.tsx/contenido-actions.ts). "total" (Fase 3F-2, aún sin ningún flujo que lo escriba): la línea trae su propio valor_total ya compuesto — típicamente una tarifa Bernalo (comisión aplicada una sola vez al total, no por columna, ver lib/calc/unidadAlojamiento.ts) — y adultos/ninos/tarifa_adulto/tarifa_nino de esta fila NO son autoridad de precio, solo lo que quede en su default. Los renderers/inserts de aplicación todavía NO distinguen los dos modos (eso es 3F-3): una fila "total" hoy sumaría $0 en las pantallas existentes hasta que se actualicen.';
comment on column public.contrato_items.valor_total is
  'Solo para modo_precio=''total'': el precio YA compuesto de la línea, obligatorio, no negativo y finito (nunca se recalcula desde adultos/ninos/tarifa_adulto/tarifa_nino). NULL siempre que modo_precio=''por_persona''. El CHECK contrato_items_modo_precio_valor_total_check rechaza explícitamente NaN (que de otro modo pasa ">= 0" por el orden de comparación de numeric) e Infinity/-Infinity (ya rechazados antes, por overflow de precisión/escala del tipo numeric(15,2), SQLSTATE 22003).';

-- ══════════════════════════════════════════════════════════════════════════
-- B) contrato_alojamiento_bernalo: snapshot PRIVADO por habitación
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.contrato_alojamiento_bernalo (
  id                bigint generated always as identity primary key,

  numero_contrato   text not null references public.ventas(numero_contrato) on delete cascade,

  -- Id ESTABLE de la habitación física dentro de ESTE contrato — mismo
  -- formato `${acomodacion}-${índice}` que ya produce
  -- `construirHabitacionesUI`/`construirPayloadHabitaciones` (Fase 3D,
  -- lib/reservar/ocupacionPorHabitacion.ts). No es la PK: la identidad
  -- interna de la fila es `id`; esta es la identidad de NEGOCIO que
  -- permite reconciliar contra el carrito/checkout sin adivinar por orden.
  habitacion_id     text not null,

  -- Orden de despliegue en el documento — independiente de `habitacion_id`
  -- (que ya es estable, pero no necesariamente el orden de presentación).
  orden             integer not null default 0,

  -- Espejo de catálogo (mismo criterio que hotel_tarifas_unidad, 173): no
  -- son la fuente de verdad (esa es `snapshot`), permiten listar/filtrar sin
  -- abrir el JSON. `hotel_id` con SET NULL: si el hotel del catálogo se
  -- borra, el snapshot histórico del contrato no debe desaparecer ni
  -- quedar huérfano de fila — solo pierde el vínculo de catálogo.
  hotel_id          bigint references public.hoteles(id) on delete set null,
  hotel_nombre      text not null,
  categoria         text,
  alimentacion      text,

  adultos           integer not null,
  -- Edades EXACTAS de los menores de ESTA habitación (Fase 3D: nunca un
  -- conteo agregado ni un arreglo plano de todo el contrato — cada
  -- habitación conserva su propia asociación habitación↔edad).
  edades_menores    jsonb not null default '[]'::jsonb,

  -- El SnapshotAlojamiento COMPLETO del motor (Fase 3A,
  -- construirSnapshotAlojamiento): tarifaId, versionTarifario, valores,
  -- capacidad, distribución, menores clasificados, desglose, temporada,
  -- totalBruto/totalNeto, ajusteComercial (comisión) y fuente del
  -- documento. PRIVADO: nunca se expone a un cliente ni a un rol externo.
  snapshot          jsonb not null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint contrato_alojamiento_bernalo_habitacion_id_check
    check (btrim(habitacion_id) <> ''),
  constraint contrato_alojamiento_bernalo_hotel_nombre_check
    check (btrim(hotel_nombre) <> ''),
  constraint contrato_alojamiento_bernalo_orden_check
    check (orden >= 0),
  constraint contrato_alojamiento_bernalo_adultos_check
    check (adultos >= 0),
  -- Solo forma (arreglo/objeto JSON) — la coherencia de CONTENIDO (edades
  -- reales, forma exacta del SnapshotAlojamiento) es responsabilidad del
  -- motor TypeScript (Fase 3A/3F-3), no de un CHECK que duplicaría esa
  -- validación en SQL.
  constraint contrato_alojamiento_bernalo_edades_menores_array_check
    check (jsonb_typeof(edades_menores) = 'array'),
  constraint contrato_alojamiento_bernalo_snapshot_objeto_check
    check (jsonb_typeof(snapshot) = 'object'),

  -- Una habitación física no puede aparecer dos veces en el mismo contrato.
  constraint contrato_alojamiento_bernalo_contrato_habitacion_key
    unique (numero_contrato, habitacion_id)
);

comment on table public.contrato_alojamiento_bernalo is
  'Snapshot PRIVADO por habitación física de un contrato Bernalo (hoteles con modelo_tarifario = ''unidad''). Una fila por habitación, con el SnapshotAlojamiento completo del motor (lib/calc/unidadAlojamiento.ts, Fase 3A) en la columna snapshot — neto, bruto, comisión y fuente del documento de origen: NUNCA se muestra a un cliente ni a un rol externo. RLS activa SIN NINGUNA policy en esta fase (ni siquiera para roles internos): solo service_role puede leer/escribir, desde una frontera server-side que Fase 3F-2 NO construye todavía (esa frontera, y la eventual policy interna para resolver el documento, quedan para una fase posterior). Sin backfill: nace vacía. FK a ventas ON DELETE CASCADE (el snapshot no tiene sentido sin su contrato) y a hoteles ON DELETE SET NULL (perder el vínculo de catálogo no debe borrar el snapshot histórico). Sin trigger de inmutabilidad a propósito: bloquear el DELETE rompería revertir_contrato_incompleto/eliminar_contrato, que dependen de que ON DELETE CASCADE limpie esta tabla sin intervención manual.';
comment on column public.contrato_alojamiento_bernalo.habitacion_id is
  'Id ESTABLE de la habitación física (formato "${acomodacion}-${índice}", mismo que produce construirHabitacionesUI/construirPayloadHabitaciones en lib/reservar/ocupacionPorHabitacion.ts, Fase 3D). Único por contrato — ver contrato_alojamiento_bernalo_contrato_habitacion_key.';
comment on column public.contrato_alojamiento_bernalo.snapshot is
  'SnapshotAlojamiento COMPLETO devuelto por construirSnapshotAlojamiento (lib/calc/unidadAlojamiento.ts): tarifaId, versionTarifario, valores, capacidad, distribución, menoresClasificados, desglose, temporada, totalBruto/totalNeto, ajusteComercial (comisión) y fuente. Debe ser un objeto JSON (CHECK de forma); el contenido exacto lo garantiza el motor TypeScript, no esta tabla. PRIVADO — nunca se expone al público ni al cliente final.';
comment on column public.contrato_alojamiento_bernalo.hotel_id is
  'Espejo de catálogo (lib/reservar/*), ON DELETE SET NULL: si el hotel se borra del catálogo, el snapshot histórico del contrato permanece intacto, solo pierde el vínculo.';
comment on column public.contrato_alojamiento_bernalo.edades_menores is
  'Edades EXACTAS (enteros) de los menores de ESTA habitación únicamente — Fase 3D nunca aplana la asociación habitación↔edad en un arreglo global del contrato. Debe ser un arreglo JSON (CHECK de forma); vacío por default (sin menores).';

create index if not exists contrato_alojamiento_bernalo_contrato_idx
  on public.contrato_alojamiento_bernalo (numero_contrato);

-- ── RLS: activa, SIN NINGUNA policy (mismo criterio que
-- contrato_financiero_pendiente, migración 172) ─────────────────────────────
-- El snapshot es un dato comercial privado (neto/bruto/comisión/fuente) que
-- ni siquiera los roles internos deben poder leer todavía por REST/RLS: la
-- resolución del documento/PDF necesita una frontera server-side explícita
-- (qué rol, con qué filtro de contrato) que esta fase NO decide. Sin ninguna
-- policy, únicamente `service_role` (que bypassa RLS) puede tocar la tabla —
-- ni `anon`, ni `authenticated` sin policy, alcanzan una sola fila.
alter table public.contrato_alojamiento_bernalo enable row level security;

commit;
