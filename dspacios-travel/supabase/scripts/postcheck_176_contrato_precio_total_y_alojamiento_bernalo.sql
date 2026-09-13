-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK de la migración 176 (`contrato_items.modo_precio/valor_total` +
-- tabla nueva `public.contrato_alojamiento_bernalo`).
-- SOLO LECTURA. Correr DESPUÉS de aplicar la 176.
--
-- Verifica lo que la migración PROMETE:
--   A) contrato_items: las dos columnas nuevas existen con el tipo/
--      nullability/default esperado;
--   B) contrato_items: los dos CHECK existen con la definición exacta;
--   C) TODA fila existente de contrato_items quedó modo_precio='por_persona'
--      y valor_total=null (sin excepción — la migración no reescribe nada);
--   D) contrato_alojamiento_bernalo: columnas, tipos, nullability y default;
--   E) contrato_alojamiento_bernalo: las dos FK (ventas CASCADE, hoteles SET
--      NULL) y las seis restricciones CHECK + la UNIQUE;
--   F) el índice de listado existe;
--   G) RLS está ACTIVA y NO hay ninguna policy (ni para anon/authenticated
--      ni para ningún rol interno) — solo service_role puede tocarla;
--   H) sin seed: la tabla nueva está vacía;
--   I) ninguna tabla ajena cambió de conteo respecto al preflight.
--
--   psql -d <base> -v ON_ERROR_STOP=1 -f postcheck_176_contrato_precio_total_y_alojamiento_bernalo.sql
-- ───────────────────────────────────────────────────────────────────────────

\echo '=== A) contrato_items: columnas nuevas — tipo, nullability, default ==='
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'contrato_items'
  and column_name in ('modo_precio', 'valor_total')
order by column_name;
\echo 'esperado:'
\echo '  modo_precio | text          | NO  | ''por_persona''::text'
\echo '  valor_total | numeric       | YES | (null)'

\echo '=== B) contrato_items: los dos CHECK, definicion exacta ==='
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.contrato_items'::regclass
  and conname in ('contrato_items_modo_precio_check', 'contrato_items_modo_precio_valor_total_check')
order by conname;
\echo 'esperado:'
\echo '  contrato_items_modo_precio_check             | CHECK ((modo_precio = ANY (ARRAY[''por_persona''::text, ''total''::text])))'
\echo '  contrato_items_modo_precio_valor_total_check | CHECK ((((modo_precio = ''por_persona''::text) AND (valor_total IS NULL)) OR ((modo_precio = ''total''::text) AND (valor_total IS NOT NULL) AND (valor_total >= (0)::numeric) AND ((valor_total)::text <> ALL (ARRAY[''NaN''::text, ''Infinity''::text, ''-Infinity''::text])))))'
\echo 'CORRECCION: la definicion DEBE incluir el filtro "(valor_total)::text <> ALL (ARRAY[''NaN'',''Infinity'',''-Infinity''])" -- sin el, un valor_total=''NaN'' pasa ">= 0" (NaN compara como mayor que cualquier valor real en numeric) y la fila queda aceptada en silencio.'

\echo '=== C) TODA fila existente de contrato_items quedo por_persona + valor_total null ==='
select
  count(*) as filas_totales,
  count(*) filter (where modo_precio = 'por_persona' and valor_total is null) as filas_legado_correctas,
  count(*) filter (where modo_precio <> 'por_persona' or valor_total is not null) as filas_alteradas
from public.contrato_items;
\echo 'esperado: filas_alteradas = 0 y filas_legado_correctas = filas_totales (la migracion NO reescribe/recalcula nada)'

\echo '=== D) contrato_alojamiento_bernalo: columnas, tipos, nullability, default ==='
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'contrato_alojamiento_bernalo'
order by ordinal_position;
\echo 'esperado (en este orden):'
\echo '  id              | bigint                   | NO  | identity (generated always as identity)'
\echo '  numero_contrato | text                     | NO  | (null)'
\echo '  habitacion_id   | text                     | NO  | (null)'
\echo '  orden           | integer                  | NO  | 0'
\echo '  hotel_id        | bigint                   | YES | (null)'
\echo '  hotel_nombre    | text                     | NO  | (null)'
\echo '  categoria       | text                     | YES | (null)'
\echo '  alimentacion    | text                     | YES | (null)'
\echo '  adultos         | integer                  | NO  | (null, sin default -- obligatorio en el insert)'
\echo '  edades_menores  | jsonb                    | NO  | ''[]''::jsonb'
\echo '  snapshot        | jsonb                    | NO  | (null, sin default -- obligatorio en el insert)'
\echo '  created_at      | timestamp with time zone | NO  | now()'
\echo '  updated_at      | timestamp with time zone | NO  | now()'

\echo '=== E) contrato_alojamiento_bernalo: FKs ==='
select con.conname, pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
where con.conrelid = 'public.contrato_alojamiento_bernalo'::regclass and con.contype = 'f'
order by con.conname;
\echo 'esperado:'
\echo '  contrato_alojamiento_bernalo_hotel_id_fkey           | FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE SET NULL'
\echo '  contrato_alojamiento_bernalo_numero_contrato_fkey    | FOREIGN KEY (numero_contrato) REFERENCES ventas(numero_contrato) ON DELETE CASCADE'

\echo '=== E2) contrato_alojamiento_bernalo: CHECK + UNIQUE ==='
select con.conname, con.contype, pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
where con.conrelid = 'public.contrato_alojamiento_bernalo'::regclass and con.contype in ('c', 'u')
order by con.contype, con.conname;
\echo 'esperado:'
\echo '  contrato_alojamiento_bernalo_adultos_check              (c) CHECK (adultos >= 0)'
\echo '  contrato_alojamiento_bernalo_edades_menores_array_check (c) CHECK (jsonb_typeof(edades_menores) = ''array''::text)'
\echo '  contrato_alojamiento_bernalo_habitacion_id_check        (c) CHECK (btrim(habitacion_id) <> ''''::text)'
\echo '  contrato_alojamiento_bernalo_hotel_nombre_check         (c) CHECK (btrim(hotel_nombre) <> ''''::text)'
\echo '  contrato_alojamiento_bernalo_orden_check                (c) CHECK (orden >= 0)'
\echo '  contrato_alojamiento_bernalo_snapshot_objeto_check      (c) CHECK (jsonb_typeof(snapshot) = ''object''::text)'
\echo '  contrato_alojamiento_bernalo_contrato_habitacion_key    (u) UNIQUE (numero_contrato, habitacion_id)'

\echo '=== F) indice de listado por numero_contrato ==='
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'contrato_alojamiento_bernalo'
order by indexname;
\echo 'esperado: contrato_alojamiento_bernalo_contrato_idx (numero_contrato), ademas de la PK y el indice implicito de la UNIQUE'

\echo '=== G) RLS activa y CERO policies (ni publicas ni internas) ==='
select relrowsecurity as rls_activa
from pg_class where relname = 'contrato_alojamiento_bernalo';
\echo 'esperado: rls_activa = t'

select count(*) as policies_totales
from pg_policies
where schemaname = 'public' and tablename = 'contrato_alojamiento_bernalo';
\echo 'esperado: 0 -- ninguna policy en absoluto (solo service_role, que bypassa RLS, puede tocar la tabla en esta fase)'

\echo '=== H) sin seed: la tabla nueva esta vacia ==='
select count(*) as filas_en_la_tabla_nueva from public.contrato_alojamiento_bernalo;
\echo 'esperado: 0'

\echo '=== I) ninguna tabla ajena cambio de conteo (comparar contra el preflight) ==='
select
  (select count(*) from public.ventas)         as ventas_total,
  (select count(*) from public.hoteles)        as hoteles_total,
  (select count(*) from public.contrato_items) as contrato_items_total;
\echo 'esperado: los mismos conteos que en el preflight (ventas_total/hoteles_total intactos; contrato_items_total identico -- ninguna fila se inserto/borro)'
