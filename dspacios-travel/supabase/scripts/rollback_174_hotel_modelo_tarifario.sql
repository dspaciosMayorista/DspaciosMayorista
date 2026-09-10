-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 174 (`hoteles.modelo_tarifario`).
--
-- Revierte una columna simple con default y CHECK. No hay filas "de negocio"
-- que perder: el valor solo decide qué editor se muestra, no una tarifa en
-- sí. Aun así, si algún hotel ya se puso en 'unidad', ese hecho se pierde
-- (vuelve a mostrarse el editor por persona) — se avisa antes de dropear.
--
-- Qué revierte:
--   · La columna `hoteles.modelo_tarifario` (el CHECK se va con la columna).
--
-- Qué NO hay que revertir:
--   · `tarifa_hotel` ni `hotel_tarifas_unidad`: la 174 nunca las tocó.
--   · El código TypeScript que lee `modelo_tarifario` deja de tener la
--     columna — si el rollback se aplica con el código nuevo desplegado, la
--     lectura fallará (columna inexistente); revertir el SQL hay que
--     coordinarlo con el código, igual que advierte el rollback de la 173.
--
--   psql -d <base> -v ON_ERROR_STOP=1 -f rollback_174_hotel_modelo_tarifario.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

do $$
declare
  v_total    bigint;
  v_en_unidad bigint;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'hoteles' and column_name = 'modelo_tarifario'
  ) then
    raise notice 'rollback_174: la columna modelo_tarifario no existe (nada que revertir)';
    return;
  end if;

  execute 'select count(*) from public.hoteles' into v_total;
  execute 'select count(*) from public.hoteles where modelo_tarifario = ''unidad''' into v_en_unidad;

  raise notice 'rollback_174: de % hoteles, % tienen el editor de unidad activo (modelo_tarifario = unidad). Ese hecho se pierde con el rollback -- ningun dato de tarifa_hotel ni hotel_tarifas_unidad se ve afectado.', v_total, v_en_unidad;

  if v_en_unidad > 0 then
    raise notice 'rollback_174: si ese numero no es el esperado, CANCELAR ahora (Ctrl-C / rollback) y revisar antes de continuar.';
  end if;
end $$;

alter table public.hoteles drop constraint if exists hoteles_modelo_tarifario_check;
alter table public.hoteles drop column if exists modelo_tarifario;

commit;

\echo '=== Verificación: la columna ya no existe ==='
select count(*) as columnas_restantes
from information_schema.columns
where table_schema = 'public' and table_name = 'hoteles' and column_name = 'modelo_tarifario';
\echo 'esperado: 0'

\echo '=== Verificación: ninguna tabla de tarifas se vio afectada ==='
select
  (select count(*) from public.hoteles)      as hoteles_total,
  (select count(*) from public.tarifa_hotel) as tarifa_hotel_total;
\echo 'esperado: los mismos conteos que antes del rollback (el rollback solo quita la columna nueva)'
