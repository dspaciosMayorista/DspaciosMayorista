-- ───────────────────────────────────────────────────────────────────────────
-- 178 · CONDICIONES DE TARIFA (Dubai) EN contrato_hoteles
--
-- Aprobada en la ronda de continuación "Dubai condiciones/documentos" — cierra
-- el hallazgo pendiente de la ronda anterior: la cotización (carrito) YA
-- persiste `condiciones_tarifa` en `cotizaciones.detalle.hoteles[].condiciones_tarifa`
-- (jsonb ya existente, sin migración), pero `contrato_hoteles` no tenía
-- ningún campo estructurado/jsonb apropiado para conservarlas al convertir —
-- se detuvo la ronda anterior explícitamente antes de crear esta migración.
--
-- `condiciones_tarifa jsonb null` — arreglo de
-- `{ temporada: string; texto: string }[]` (ver `lib/calc/condicionesTarifa.ts`,
-- tipo público `CondicionTarifaAplicada[]`). NULL = sin snapshot que copiar
-- (contrato histórico anterior a esta funcionalidad, o el ítem de la
-- cotización nunca trajo la referencia estable `ref` que la identifica —
-- ver la ronda de continuación para el porqué). Un arreglo `[]` (vacío) es
-- una respuesta distinta y válida: "esta estadía sí tuvo snapshot, y no tuvo
-- ninguna condición de tarifa aplicada" — nunca se confunden.
--
-- CHECK: NULL o `jsonb_typeof(condiciones_tarifa) = 'array'` — blindaje
-- estructural mínimo (no valida el contenido de cada elemento: esa
-- responsabilidad es de `normalizarCondicionesTarifaJSON`, que SIEMPRE corre
-- antes de escribir, en `convertirCotizacionCarrito`, y también antes de
-- renderizar en las 4 superficies de documento — nunca se confía en JSON
-- crudo ni en escritura ni en lectura).
--
-- SOLO se escribe desde `convertirCotizacionCarrito` (persona) — copiando
-- LITERALMENTE el snapshot ya congelado de la cotización, correlacionado por
-- referencia estable (`ref`), NUNCA releyendo `tarifa_hotel`. Un hotel
-- Bernalo (`hoteles.modelo_tarifario = 'unidad'`) NUNCA recibe esta columna
-- poblada — esa rama de conversión ni siquiera pasa por `computarReserva`.
--
-- Migración ADITIVA e idempotente (`add column if not exists`, guarda
-- `if not exists` en el CHECK, filtrada por `conrelid` — el nombre de un
-- constraint es único POR TABLA en Postgres, no global) — se puede re-correr
-- sin duplicar. NO hace backfill: TODOS los contratos existentes (incluidos
-- los creados HOY, antes de que el código de escritura se despliegue) quedan
-- con `condiciones_tarifa = NULL` — es la respuesta correcta ("no hay
-- snapshot que copiar para este contrato"), nunca se inventa una condición
-- retroactiva a partir de `tarifa_hotel` actual (que puede haber cambiado
-- desde que el contrato se firmó).
--
-- ⚠️ Riesgo de despliegue — MUCHO MENOR que el de la migración 177 (esa sí
-- rompe TODAS las reservas si el código se despliega antes de la SQL, porque
-- `computarReserva` selecciona columnas de `tarifa_hotel` incondicionalmente
-- para cualquier hotel persona). Alcance real de ESTA migración, acotado:
--  · Las 2 páginas de COTIZACIÓN (`/cotizacion/[id]`, `/cot/[token]`) NUNCA
--    consultan `contrato_hoteles` — leen exclusivamente
--    `cotizaciones.detalle`. Siguen funcionando exactamente igual antes,
--    durante y después de esta migración, la tengan corrida o no.
--  · Las 2 páginas de CONTRATO (`/contrato/[numero]`, `/c/[token]`) sí leen
--    `contrato_hoteles` vía `select("*")`, pero el campo es OPCIONAL en el
--    tipo (`HotelConNota.condiciones_tarifa?: ... | null`) y `select("*")`
--    simplemente no trae una columna que no existe — no es un `select`
--    explícito por nombre que Postgres/PostgREST pueda rechazar. La AUSENCIA
--    física de la columna, por sí sola, no rompe la selección ni el render de
--    estas 2 páginas (`condicionesTarifaParaRender` normaliza `undefined`
--    igual que cualquier otro valor ausente/inválido → `[]`).
--  · El riesgo real y concreto está en la ESCRITURA:
--    `convertirCotizacionCarrito` hace un INSERT EXPLÍCITO que nombra
--    `condiciones_tarifa` en cada fila de `contrato_hoteles` (hotel
--    "persona"). Ese insert nombra la columna por su nombre, así que si el
--    código se despliega antes de correr esta migración, el insert falla con
--    "column does not exist" — bloqueando la conversión de TODA cotización de
--    carrito con al menos un hotel "persona" (no solo el detalle de
--    condiciones: la conversión completa aborta vía `fallarYRevertirGrupo`).
--  · Por esa única ventana de fallo (escritura, no lectura) se conserva igual
--    el orden obligatorio SQL-antes-que-código de abajo — es innecesario para
--    las 4 páginas de documento, pero necesario para no bloquear conversiones
--    de carrito en el tramo entre desplegar el código y correr la migración.
--  · Deliberadamente NO se implementó un fallback en runtime que atrape ese
--    error de insert y omita la columna — ocultaría el problema real (orden
--    de despliegue) en vez de dejarlo fallar de forma obvia e inmediata.
--
--  ORDEN OBLIGATORIO, sin excepciones ni pasos intercambiados:
--    1) correr `preflight_178_contrato_hoteles_condiciones_tarifa.sql` en el
--       entorno REMOTO real;
--    2) aplicar ESTA migración (178) en el entorno REMOTO;
--    3) correr `postcheck_178_contrato_hoteles_condiciones_tarifa.sql` en el
--       mismo entorno REMOTO;
--    4) recién ENTONCES desplegar el código (`app/tarifario/checkout/actions.ts`,
--       `app/(dashboard)/dashboard/reservar/actions.ts`, las 4 páginas de
--       documento, `lib/calc/condicionesTarifa.ts`).
--
-- Preflight / postcheck / rollback: ver
-- supabase/scripts/{preflight,postcheck,rollback}_178_contrato_hoteles_condiciones_tarifa.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

alter table public.contrato_hoteles
  add column if not exists condiciones_tarifa jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contrato_hoteles_condiciones_tarifa_array_check'
      and conrelid = 'public.contrato_hoteles'::regclass
  ) then
    alter table public.contrato_hoteles add constraint contrato_hoteles_condiciones_tarifa_array_check
      check (
        condiciones_tarifa is null or jsonb_typeof(condiciones_tarifa) = 'array'
      );
  end if;
end $$;

commit;
