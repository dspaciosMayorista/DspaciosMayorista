-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 173 (`public.hotel_tarifas_unidad`).
--
-- ⚠️ DESTRUCTIVO. `drop table` borra las FILAS, y a diferencia de los rollbacks
-- de columnas (170, 172) acá no hay nada que "solo se pierda el vínculo": la
-- tabla entera es datos que alguien cargó. Con la fase 1 sin integrar, esos
-- datos no alimentan ninguna cotización todavía, así que perderlos no deja al
-- sistema calculando mal — pero hay que volver a cargarlos.
--
-- Por eso el bloque `do` de abajo AVISA (raise notice) cuántas filas se van a
-- perder ANTES del drop, y cuántas están en estado 'publicada'. Si ese número
-- no es el esperado, cancelar y revisar.
--
-- Qué revierte:
--   · `public.hotel_tarifas_unidad` completa (la PK, la FK a hoteles, las seis
--     restricciones, la unique, el índice de listado y las cuatro policies se
--     van con la tabla — no hay que borrarlos aparte).
--
-- Qué NO hay que revertir:
--   · Ninguna otra tabla. La 173 no tocó nada existente.
--   · El código TypeScript. `lib/calc/tarifaAlojamientoPersistida.ts` solo
--     ADAPTA una fila que recibe; no consulta la base, así que sin la tabla
--     simplemente no se lo puede llamar con datos reales. Nada del flujo
--     comercial lo invoca todavía (fase 1: sin integración), de modo que
--     revertir el SQL con el código desplegado deja el sistema funcionando
--     igual que antes, sin errores en runtime. Si más adelante se integra,
--     este archivo hay que revertirlo JUNTO con el código.
--
-- Sin `cascade` a propósito: nada debe depender de esta tabla. Si Postgres
-- rechaza el drop por una dependencia, esa dependencia es un hallazgo (algo se
-- enganchó y no debería), no un obstáculo a forzar.
--
--   psql -d <base> -v ON_ERROR_STOP=1 -f rollback_173_tarifas_alojamiento_unidad.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- Informativo: qué se pierde. Va en su propio DO para que el aviso salga
-- ANTES del drop, y tolera que la tabla no exista (rollback idempotente).
do $$
declare
  v_filas     bigint;
  v_publicadas bigint;
begin
  if to_regclass('public.hotel_tarifas_unidad') is null then
    raise notice 'rollback_173: la tabla hotel_tarifas_unidad no existe (nada que revertir)';
    return;
  end if;

  execute 'select count(*) from public.hotel_tarifas_unidad' into v_filas;
  execute 'select count(*) from public.hotel_tarifas_unidad where estado = ''publicada''' into v_publicadas;

  raise notice 'rollback_173: se perderán % tarifas de alojamiento por unidad (% de ellas PUBLICADAS). Con la fase 1 sin integrar no alimentan ninguna cotización todavía, pero hay que volver a cargarlas.', v_filas, v_publicadas;

  if v_filas > 0 then
    raise notice 'rollback_173: si ese número no es el esperado, CANCELAR ahora (Ctrl-C / rollback) y revisar antes de continuar.';
  end if;
end $$;

drop table if exists public.hotel_tarifas_unidad;

commit;

\echo '=== Verificación: la tabla ya no existe y no dejó restos ==='
select
  to_regclass('public.hotel_tarifas_unidad') is null as tabla_borrada,
  (select count(*) from pg_class where relname like 'hotel_tarifas_unidad%') as objetos_restantes,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'hotel_tarifas_unidad') as policies_restantes,
  (select count(*) from pg_constraint con
     join pg_class rel on rel.oid = con.conrelid
    where rel.relname like 'hotel_tarifas_unidad%') as constraints_restantes;
\echo 'esperado: tabla_borrada = t | objetos_restantes = 0 | policies_restantes = 0 | constraints_restantes = 0'

\echo '=== Verificación: ninguna tabla existente se vio afectada ==='
select
  (select count(*) from public.hoteles)      as hoteles_total,
  (select count(*) from public.tarifa_hotel) as tarifa_hotel_total;
\echo 'esperado: los mismos conteos que antes del rollback (el rollback solo borra la tabla nueva)'
