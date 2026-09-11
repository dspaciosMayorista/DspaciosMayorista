-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 175 (`hotel_tarifas_unidad.comision_pct`).
--
-- Revierte una columna simple con CHECK, sin default ni backfill. Si algún
-- borrador/tarifa YA se cargó con comisión (payload + columna), ese dato de
-- negocio se pierde de la COLUMNA (el payload jsonb, que es la fuente de
-- verdad, no se toca) — se avisa antes de dropear.
--
-- Qué revierte:
--   · La columna `hotel_tarifas_unidad.comision_pct` (el CHECK se va con
--     la columna).
--
-- Qué NO hay que revertir:
--   · `hoteles` ni `tarifa_hotel`: la 175 nunca las tocó.
--   · El `payload` de cada fila: `comisionPct` sigue ahí adentro; solo se
--     pierde la columna ESPEJO, no el dato de negocio real. Aun así, tras
--     el rollback el adaptador (`lib/calc/tarifaAlojamientoPersistida.ts`)
--     seguirá exigiendo `comision_pct` como columna si el código nuevo
--     sigue desplegado — coordinar el rollback del SQL con el del código,
--     igual que advierten los rollbacks de la 173/174.
--
--   psql -d <base> -v ON_ERROR_STOP=1 -f rollback_175_tarifas_alojamiento_unidad_comision.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

do $$
declare
  v_total     bigint;
  v_con_valor bigint;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'hotel_tarifas_unidad' and column_name = 'comision_pct'
  ) then
    raise notice 'rollback_175: la columna comision_pct no existe (nada que revertir)';
    return;
  end if;

  execute 'select count(*) from public.hotel_tarifas_unidad' into v_total;
  execute 'select count(*) from public.hotel_tarifas_unidad where comision_pct is not null' into v_con_valor;

  raise notice 'rollback_175: de % filas de hotel_tarifas_unidad, % tienen comision_pct cargado. Ese valor de columna se pierde -- el payload jsonb (fuente de verdad real) NO se toca, comisionPct sigue ahi adentro.', v_total, v_con_valor;

  if v_con_valor > 0 then
    raise notice 'rollback_175: si ese numero no es el esperado, CANCELAR ahora (Ctrl-C / rollback) y revisar antes de continuar.';
  end if;
end $$;

alter table public.hotel_tarifas_unidad drop constraint if exists hotel_tarifas_unidad_comision_pct_check;
alter table public.hotel_tarifas_unidad drop column if exists comision_pct;

commit;

\echo '=== Verificación: la columna ya no existe ==='
select count(*) as columnas_restantes
from information_schema.columns
where table_schema = 'public' and table_name = 'hotel_tarifas_unidad' and column_name = 'comision_pct';
\echo 'esperado: 0'

\echo '=== Verificación: hoteles/tarifa_hotel sin cambios y hotel_tarifas_unidad conserva sus filas ==='
select
  (select count(*) from public.hoteles)               as hoteles_total,
  (select count(*) from public.tarifa_hotel)           as tarifa_hotel_total,
  (select count(*) from public.hotel_tarifas_unidad)   as hotel_tarifas_unidad_total;
\echo 'esperado: los mismos conteos que antes del rollback (el rollback solo quita la columna nueva, ninguna fila se borra)'
