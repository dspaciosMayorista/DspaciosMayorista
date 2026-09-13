-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la migración 176 (`contrato_items.modo_precio/valor_total` +
-- tabla nueva `public.contrato_alojamiento_bernalo`).
-- SOLO LECTURA — no modifica nada. Correr ANTES de aplicar la 176.
--
-- La 176 agrega DOS columnas a `contrato_items` (con dos CHECK) y crea UNA
-- tabla nueva (con FKs a `ventas`/`hoteles`, un índice, RLS activa y CERO
-- policies). No toca ninguna fila existente. Precondiciones:
--
--   1) `public.contrato_items` existe con su forma actual (adultos/ninos/
--      tarifa_adulto/tarifa_nino/orden) — es la tabla que se amplía.
--   2) Las columnas `modo_precio`/`valor_total` todavía NO existen en
--      `contrato_items` (si existen, la 176 ya se aplicó — idempotente,
--      reaplicar es un no-op, pero conviene saber por qué se corre de nuevo).
--   3) Los nombres de los DOS CHECK de `contrato_items` están libres.
--   4) `public.ventas` y `public.hoteles` existen y sus llaves de destino
--      (`numero_contrato text`, `id bigint`) tienen el tipo esperado — son
--      el destino de las dos FK de la tabla nueva.
--   5) La tabla `contrato_alojamiento_bernalo` todavía NO existe.
--   6) El nombre del índice de listado está libre.
--   7) INFORMATIVO — cuántas filas existentes de `contrato_items` hay hoy
--      (deben quedar exactamente igual, todas en modo_precio='por_persona',
--      después de la migración).
--
--   psql -d <base> -v ON_ERROR_STOP=1 -f preflight_176_contrato_precio_total_y_alojamiento_bernalo.sql
-- ───────────────────────────────────────────────────────────────────────────

\echo '=== 1) contrato_items existe con su forma actual ==='
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'contrato_items'
order by ordinal_position;
\echo 'esperado: id, numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden (sin modo_precio/valor_total todavia)'

\echo '=== 2) modo_precio/valor_total todavia NO existen ==='
select count(*) as columnas_ya_definidas
from information_schema.columns
where table_schema = 'public' and table_name = 'contrato_items'
  and column_name in ('modo_precio', 'valor_total');
\echo 'esperado: 0 (si es > 0, la 176 ya se aplico; reaplicar es no-op, pero confirmar por que)'

\echo '=== 3) los nombres de los CHECK de contrato_items estan libres ==='
select count(*) as constraints_ya_definidas
from pg_constraint
where conrelid = 'public.contrato_items'::regclass
  and conname in ('contrato_items_modo_precio_check', 'contrato_items_modo_precio_valor_total_check');
\echo 'esperado: 0'
\echo 'NOTA (correccion de finitud): si constraints_ya_definidas > 0 porque una version PREVIA e INCOMPLETA de la 176 ya corrio (sin el filtro NaN/Infinity/-Infinity en contrato_items_modo_precio_valor_total_check), la migracion actual ABORTA con un error explicito -- no reemplaza en silencio un CHECK mas laxo por uno mas estricto. Hay que revertir esa version previa primero (rollback_176) y volver a aplicar esta version corregida.'

\echo '=== 4) ventas.numero_contrato es text; hoteles.id es bigint (destino de las FK) ==='
select
  (select data_type from information_schema.columns
    where table_schema='public' and table_name='ventas' and column_name='numero_contrato') as tipo_ventas_numero_contrato,
  (select data_type from information_schema.columns
    where table_schema='public' and table_name='hoteles' and column_name='id') as tipo_hoteles_id;
\echo 'esperado: tipo_ventas_numero_contrato = text | tipo_hoteles_id = bigint'
\echo 'si alguno no coincide, el create table de la 176 falla al crear la FK correspondiente'

\echo '=== 5) contrato_alojamiento_bernalo todavia no existe ==='
select
  to_regclass('public.contrato_alojamiento_bernalo') is null as tabla_aun_no_existe,
  (select count(*) from pg_class where relname = 'contrato_alojamiento_bernalo' and relkind = 'r') as objetos_con_ese_nombre;
\echo 'esperado: tabla_aun_no_existe = t (f = la 176 ya se aplico; reaplicar es no-op, pero confirmar por que)'

\echo '=== 6) el nombre del indice de listado esta libre ==='
select to_regclass('public.contrato_alojamiento_bernalo_contrato_idx') is null as nombre_indice_libre;
\echo 'esperado: t'

\echo '=== 7) INFORMATIVO: filas actuales de contrato_items (deben conservarse exactas tras la migracion) ==='
select count(*) as contrato_items_total from public.contrato_items;
\echo 'comparar este numero contra el mismo conteo en el postcheck -- debe ser IDENTICO (la 176 no toca ninguna fila existente)'

\echo '=== 8) referencia: ninguna migracion previa creo la tabla nueva (no deberia haber historia) ==='
select count(*) as columnas_de_contrato_alojamiento_bernalo_ya_definidas
from information_schema.columns
where table_schema = 'public' and table_name = 'contrato_alojamiento_bernalo';
\echo 'esperado: 0 (si es > 0, la tabla ya existe: ver el punto 5)'
