-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 176 (`contrato_items.modo_precio/valor_total` +
-- tabla nueva `public.contrato_alojamiento_bernalo`).
--
-- ⚠️ Si en el intervalo alguna otra rama/hotfix ya empezó a escribir líneas
-- `modo_precio = 'total'` o snapshots en `contrato_alojamiento_bernalo`
-- (Fase 3F-2 en sí NO escribe nada — pero este rollback debe ser seguro
-- incluso si 3F-3 ya se adelantó), ese dato de negocio se PIERDE con el
-- `drop table`/`drop column`. Por eso el bloque `do` de abajo AVISA (raise
-- notice) cuántas filas se van a perder ANTES de tocar nada. Si ese número no
-- es el esperado (debería ser 0 mientras 3F-2 siga sin integrarse), cancelar
-- y revisar.
--
-- Qué revierte:
--   · `public.contrato_alojamiento_bernalo` completa (PK, las dos FK, las
--     seis CHECK, la UNIQUE, el índice — se van con la tabla).
--   · `contrato_items.modo_precio` / `contrato_items.valor_total` y sus dos
--     CHECK — el resto de la tabla (adultos/ninos/tarifa_adulto/tarifa_nino/
--     descripcion/orden) NO se toca.
--
-- Qué NO hay que revertir:
--   · Ninguna fila de `contrato_items` existente antes de la 176: sus
--     columnas legado no cambian, solo pierden las dos columnas nuevas.
--   · `ventas`/`hoteles`: la 176 nunca las tocó.
--   · El código TypeScript: nada de la aplicación lee/escribe estas columnas
--     ni esta tabla todavía (3F-2 es solo estructura) — revertir el SQL con
--     el código desplegado deja el sistema funcionando exactamente igual que
--     antes, sin errores en runtime.
--
-- Sin `cascade` en el `drop table` a propósito: nada debe depender de esta
-- tabla en esta fase. Si Postgres rechaza el drop por una dependencia, esa
-- dependencia es un hallazgo (algo se enganchó y no debería), no un
-- obstáculo a forzar.
--
--   psql -d <base> -v ON_ERROR_STOP=1 -f rollback_176_contrato_precio_total_y_alojamiento_bernalo.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- Informativo: qué se pierde. En su propio DO para que el aviso salga ANTES
-- de tocar nada, y tolera que la tabla/columnas ya no existan (rollback
-- idempotente).
do $$
declare
  v_snapshots        bigint;
  v_lineas_total     bigint;
begin
  if to_regclass('public.contrato_alojamiento_bernalo') is not null then
    execute 'select count(*) from public.contrato_alojamiento_bernalo' into v_snapshots;
    raise notice 'rollback_176: se perderan % snapshots de contrato_alojamiento_bernalo (neto/bruto/comision/fuente por habitacion). Mientras 3F-2 siga sin integrarse, esperado = 0.', v_snapshots;
    if v_snapshots > 0 then
      raise notice 'rollback_176: si ese numero no es el esperado, CANCELAR ahora (Ctrl-C / rollback) y revisar antes de continuar -- alguien ya esta escribiendo snapshots Bernalo.';
    end if;
  else
    raise notice 'rollback_176: contrato_alojamiento_bernalo no existe (nada que revertir de esa tabla)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contrato_items' and column_name = 'modo_precio'
  ) then
    execute $q$select count(*) from public.contrato_items where modo_precio = 'total'$q$ into v_lineas_total;
    raise notice 'rollback_176: se perderan % lineas de contrato_items con modo_precio=''total'' (su valor_total desaparece; las columnas legado adultos/ninos/tarifa_adulto/tarifa_nino de esas filas NO son autoridad de precio, asi que la linea quedaria sin ningun total valido). Mientras 3F-2 siga sin integrarse, esperado = 0.', v_lineas_total;
    if v_lineas_total > 0 then
      raise notice 'rollback_176: si ese numero no es el esperado, CANCELAR ahora (Ctrl-C / rollback) y revisar antes de continuar.';
    end if;
  else
    raise notice 'rollback_176: contrato_items.modo_precio no existe (nada que revertir de esas columnas)';
  end if;
end $$;

drop table if exists public.contrato_alojamiento_bernalo;

alter table public.contrato_items drop constraint if exists contrato_items_modo_precio_valor_total_check;
alter table public.contrato_items drop constraint if exists contrato_items_modo_precio_check;
alter table public.contrato_items drop column if exists valor_total;
alter table public.contrato_items drop column if exists modo_precio;

commit;

\echo '=== Verificacion: las columnas nuevas y la tabla nueva ya no existen ==='
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='contrato_items' and column_name in ('modo_precio','valor_total')) as columnas_restantes_contrato_items,
  (to_regclass('public.contrato_alojamiento_bernalo') is null) as tabla_bernalo_borrada,
  (select count(*) from pg_class where relname like 'contrato_alojamiento_bernalo%') as objetos_restantes_bernalo,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='contrato_alojamiento_bernalo') as policies_restantes_bernalo;
\echo 'esperado: columnas_restantes_contrato_items = 0 | tabla_bernalo_borrada = t | objetos_restantes_bernalo = 0 | policies_restantes_bernalo = 0'

\echo '=== Verificacion: contrato_items conserva TODAS sus filas y columnas legado intactas ==='
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'contrato_items'
order by ordinal_position;
\echo 'esperado: exactamente id, numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden -- igual que antes de la 176'

select count(*) as contrato_items_total from public.contrato_items;
\echo 'esperado: el mismo conteo que antes del rollback (el rollback solo quita columnas, ninguna fila de contrato_items se borra)'

\echo '=== Verificacion: ventas/hoteles sin cambios ==='
select
  (select count(*) from public.ventas)  as ventas_total,
  (select count(*) from public.hoteles) as hoteles_total;
\echo 'esperado: los mismos conteos que antes del rollback (el rollback nunca las toco)'
