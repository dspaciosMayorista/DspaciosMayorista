-- ───────────────────────────────────────────────────────────────────────────
-- 175 · COMISIÓN BERNALO en `hotel_tarifas_unidad` (columna espejo)
--
-- QUÉ RESUELVE
-- La semántica comercial de la tarifa Bernalo quedó confirmada (ronda 8 del
-- motor puro, `lib/calc/unidadAlojamiento.ts`): la tarifa capturada es
-- BRUTA/comisionable — ej. bruto 500.000, comisión 20%, neto a pagar
-- 400.000. La comisión depende de la TEMPORADA (no es una constante del
-- hotel ni del sistema) y se aplica una sola vez sobre el total bruto
-- completo. `TarifaAlojamiento.comisionPct` (obligatoria en el motor desde
-- esa ronda) ya vive en el `payload` de cada fila de `hotel_tarifas_unidad`
-- — esta migración agrega la columna ESPEJO `comision_pct`, mismo patrón que
-- `temporada`/`categoria`/`alimentacion` de la migración 173: un valor que
-- se puede listar/filtrar por SQL sin abrir el JSON, y que el adaptador
-- (`lib/calc/tarifaAlojamientoPersistida.ts`) verifica que coincida
-- exactamente con `payload.comisionPct`.
--
-- NO SE MODIFICA LA MIGRACIÓN 173 (ya fusionada/aplicada) — esta es una
-- extensión ADITIVA aparte, mismo criterio que la 174 sobre `hoteles`.
--
-- ⚠️ SIN BACKFILL, A PROPÓSITO. Las filas de `hotel_tarifas_unidad` cargadas
-- antes de esta ronda tienen un `payload` SIN `comisionPct` (era un campo
-- que no existía) — no hay ningún porcentaje real que inventarles. La
-- columna nace `numeric` NULLABLE, SIN DEFAULT: toda fila preexistente
-- queda con `comision_pct = null`. Eso es exactamente correcto, no un
-- descuido — el adaptador la trata como fail-closed: `payload` sin
-- `comisionPct` ya se rechaza en `validarFormaTarifa` (nunca llega siquiera
-- a comparar columnas), y aunque alguna fila insólita tuviera el payload
-- con comisión pero la columna en null, el adaptador rechaza esa
-- incoherencia igual que cualquier otro espejo desalineado. NINGUNA fila
-- vieja se interpreta jamás como "0% de comisión" — 0% es un valor
-- COMERCIAL válido (igual que cualquier otro porcentaje) que alguien debe
-- cargar explícitamente, no un default que esta migración deba inventar.
--
-- CHECK coherente con el motor: `comision_pct is null or (>= 0 and < 100)`
-- — null se permite a nivel de columna (las filas viejas deben poder seguir
-- existiendo sin comisión) pero un valor NO nulo debe caer en el mismo
-- rango [0,100) que exige `validarTarifaNumerica`. 100% dejaría un neto de
-- $0 (deja de ser una tarifa vendible); un valor negativo o >= 100 no tiene
-- sentido comercial.
--
-- ADITIVA, IDEMPOTENTE y TRANSACCIONAL (`begin`/`commit`, mismo criterio que
-- 163/172/173/174): `add column if not exists` + verificación de definición
-- compatible antes del CHECK (mismo patrón que la 163/174).
--
-- Preflight / postcheck / rollback en `supabase/scripts/` (175). El
-- preflight INFORMA cuántas filas existentes quedarían sin comisión (para
-- que quien aplique la migración lo sepa de antemano) — no inventa ningún
-- porcentaje para ellas.
-- ───────────────────────────────────────────────────────────────────────────

begin;

do $$
declare
  v_tipo text;
  v_nullable text;
  v_default text;
begin
  select data_type, is_nullable, column_default
    into v_tipo, v_nullable, v_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'hotel_tarifas_unidad'
     and column_name = 'comision_pct';

  if found and (
    v_tipo is distinct from 'numeric'
    or v_nullable is distinct from 'YES'
    or v_default is not null
  ) then
    raise exception 'ABORTADO: hotel_tarifas_unidad.comision_pct existe con una definicion incompatible (tipo=%, nullable=%, default=%).', v_tipo, v_nullable, v_default;
  end if;
end $$;

alter table public.hotel_tarifas_unidad
  add column if not exists comision_pct numeric;

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'hotel_tarifas_unidad_comision_pct_check'
     and conrelid = 'public.hotel_tarifas_unidad'::regclass;

  if not found then
    alter table public.hotel_tarifas_unidad
      add constraint hotel_tarifas_unidad_comision_pct_check
      check (comision_pct is null or (comision_pct >= 0 and comision_pct < 100));
  elsif v_def is distinct from 'CHECK (((comision_pct IS NULL) OR ((comision_pct >= (0)::numeric) AND (comision_pct < (100)::numeric))))' then
    raise exception 'ABORTADO: el CHECK hotel_tarifas_unidad_comision_pct_check existe con otra definicion: %.', v_def;
  end if;
end $$;

comment on column public.hotel_tarifas_unidad.comision_pct is
  'Espejo de payload.comisionPct (comisión Bernalo, confirmada: la tarifa capturada es bruta/comisionable, la comisión depende de la temporada y se aplica una sola vez sobre el total bruto completo — ver lib/calc/unidadAlojamiento.ts). Nullable SIN backfill: las filas cargadas antes de esta columna no tienen comisión real que inventarles y quedan en null a propósito. El adaptador (lib/calc/tarifaAlojamientoPersistida.ts) exige comisionPct en el payload (falla cerrado si falta, nunca asume 0%) y verifica que esta columna coincida exactamente con payload.comisionPct, igual que temporada/categoria/alimentacion.';

commit;
