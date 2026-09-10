-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK de la migración 173 (`public.hotel_tarifas_unidad`).
-- SOLO LECTURA. Correr DESPUÉS de aplicar la 173.
--
-- Verifica lo que la migración PROMETE, no solo que "no falló":
--   A) la tabla existe con las 13 columnas, tipos y default esperados;
--   B) la FK apunta a hoteles(id) con ON DELETE CASCADE;
--   C) las siete RESTRICCIONES están (estado, página, payload objeto,
--      coherencia id/version del payload, ids no vacíos) y la ÚNICA global
--      por tarifa+versión;
--   D) el índice de listado existe;
--   E) RLS está ACTIVA y hay exactamente 4 policies (select/insert/update/
--      delete), todas con el mismo conjunto de roles;
--   F) la migración NO creó funciones, triggers ni RPC — es lo que la fase 1
--      promete explícitamente;
--   G) NO hubo seed ni backfill: la tabla está vacía y ninguna tabla existente
--      cambió de conteo respecto al preflight;
--   H) el catálogo DECLARA la frontera de producto: esta tabla cubre solo
--      tarifas regulares por noche (persona/pareja/habitación/apartamento) y
--      NO es el tarifario Bernalo completo.
--
--   psql -d <base> -v ON_ERROR_STOP=1 -f postcheck_173_tarifas_alojamiento_unidad.sql
-- ───────────────────────────────────────────────────────────────────────────

\echo '=== A) columnas: tipo, nullability y default ==='
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'hotel_tarifas_unidad'
order by ordinal_position;
\echo 'esperado (en este orden):'
\echo '  id                | bigint                   | NO  | nextval(...bigserial...)'
\echo '  hotel_id          | bigint                   | NO  | (null)'
\echo '  tarifa_id         | text                     | NO  | (null)'
\echo '  version_tarifario | text                     | NO  | (null)'
\echo '  temporada         | text                     | YES | (null)'
\echo '  categoria         | text                     | YES | (null)'
\echo '  alimentacion      | text                     | YES | (null)'
\echo '  estado            | text                     | NO  | ''borrador''::text'
\echo '  fuente_documento  | text                     | YES | (null)'
\echo '  fuente_pagina     | integer                  | YES | (null)'
\echo '  payload           | jsonb                    | NO  | (null)'
\echo '  created_at        | timestamp with time zone | NO  | now()'
\echo '  updated_at        | timestamp with time zone | NO  | now()'

\echo '=== B) FK -> hoteles(id) ON DELETE CASCADE ==='
select con.conname, pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public' and rel.relname = 'hotel_tarifas_unidad' and con.contype = 'f';
\echo 'esperado: FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE'
\echo 'NOTA: cascade es deliberado — una tarifa por unidad sin su hotel no tiene sentido y no debe quedar huérfana'

\echo '=== C) restricciones (check + unique) ==='
select con.conname, con.contype, pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public' and rel.relname = 'hotel_tarifas_unidad'
  and con.contype in ('c', 'u')
order by con.contype, con.conname;
\echo 'esperado:'
\echo '  hotel_tarifas_unidad_estado_check          (c) CHECK (estado = ANY (ARRAY[''borrador'', ''publicada'', ''inactiva'']))'
\echo '  hotel_tarifas_unidad_pagina_check          (c) CHECK (fuente_pagina IS NULL OR fuente_pagina > 0)'
\echo '  hotel_tarifas_unidad_payload_objeto_check  (c) CHECK (jsonb_typeof(payload) = ''object''::text)'
\echo '  hotel_tarifas_unidad_payload_id_check      (c) CHECK (payload ? ''id'' AND tarifa_id = payload ->> ''id'')'
\echo '  hotel_tarifas_unidad_payload_version_check (c) CHECK (payload ? ''versionTarifario'' AND version_tarifario = payload ->> ''versionTarifario'')'
\echo '  hotel_tarifas_unidad_tarifa_id_check       (c) CHECK (btrim(tarifa_id) <> ''''::text)'
\echo '  hotel_tarifas_unidad_version_check         (c) CHECK (btrim(version_tarifario) <> ''''::text)'
\echo '  hotel_tarifas_unidad_tarifa_version_key    (u) UNIQUE (tarifa_id, version_tarifario)'

\echo '=== D) índice de listado ==='
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'hotel_tarifas_unidad'
order by indexname;
\echo 'esperado: hotel_tarifas_unidad_hotel_estado_idx | CREATE INDEX ... (hotel_id, estado)'
\echo 'y la PK hotel_tarifas_unidad_pkey sobre (id) — más el índice implícito de la unique'

\echo '=== E) RLS activa y exactamente 4 policies, mismo conjunto de roles ==='
select relrowsecurity as rls_activa
from pg_class where relname = 'hotel_tarifas_unidad';

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'hotel_tarifas_unidad'
order by cmd;
\echo 'esperado: rls_activa = t y 4 filas: DELETE, INSERT, SELECT, UPDATE'
\echo 'cada una con roles = {public} y su expresión citando:'
\echo '  mi_rol() = ANY (ARRAY[''superadmin''::text, ''gerencia''::text, ''administracion''::text, ''operaciones''::text])'
\echo 'que NINGUNA cite ''venta'' ni ''anon''.'

\echo '=== E2) ninguna policy alcanza a anon (la fase 1 no expone nada al público) ==='
select count(*) as policies_que_mencionan_anon
from pg_policies
where schemaname = 'public' and tablename = 'hotel_tarifas_unidad'
  and (coalesce(qual, '') ilike '%anon%' or coalesce(with_check, '') ilike '%anon%' or 'anon' = any(roles));
\echo 'esperado: 0'

\echo '=== F) la migración no creó funciones ni triggers (alcance explícito de la fase 1) ==='
select count(*) as triggers_en_la_tabla
from pg_trigger
where tgrelid = 'public.hotel_tarifas_unidad'::regclass and not tgisinternal;

select count(*) as funciones_nuevas_de_173
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname ilike '%tarifa%unidad%';
\echo 'esperado: triggers_en_la_tabla = 0 | funciones_nuevas_de_173 = 0'
\echo 'si aparece una función, la 173 se modificó después de aprobarse — revisar el archivo antes de confiar en esta tabla'

\echo '=== G) sin seed ni backfill ==='
select count(*) as filas_en_la_tabla_nueva from public.hotel_tarifas_unidad;
\echo 'esperado: 0 (la 173 no carga datos; las tarifas las carga la administración de producto después)'

select
  (select count(*) from public.hoteles) as hoteles_total,
  (select count(*) from public.tarifa_hotel) as tarifa_hotel_total;
\echo 'esperado: ambos EXACTAMENTE iguales a los del preflight.'
\echo 'un tarifa_hotel_total distinto significa que la 173 tocó tarifas existentes, y NO debe hacerlo.'

\echo '=== G2) sobre la única fila de prueba (si se insertó alguna para validar, borrarla antes de esto) ==='
-- Si se cargó una fila de prueba para validar el adaptador, esto confirma que el
-- payload quedó como objeto y que las columnas espejo no se auto-rellenaron.
select
  count(*)                                                as filas,
  count(*) filter (where jsonb_typeof(payload) = 'object') as payloads_objeto,
  count(*) filter (where estado = 'borrador')              as en_borrador,
  count(*) filter (where tarifa_id = payload ->> 'id'
                     and version_tarifario = payload ->> 'versionTarifario') as identidad_coherente
from public.hotel_tarifas_unidad;
\echo 'esperado: payloads_objeto = filas | identidad_coherente = filas'

\echo '=== H) el catálogo declara la FRONTERA DE PRODUCTO de esta entrega ==='
-- Esta tabla NO es el tarifario Bernalo completo: cubre solo tarifas regulares
-- por noche (persona/pareja/habitación/apartamento). Quien mire la base sin
-- abrir el repo tiene que poder verlo ahí mismo — por eso la frontera vive en
-- los comentarios de la tabla y de la columna `payload`, y por eso se verifica.
select
  coalesce(obj_description('public.hotel_tarifas_unidad'::regclass), '') ilike '%NO es el tarifario Bernalo completo%' as tabla_declara_alcance,
  coalesce(obj_description('public.hotel_tarifas_unidad'::regclass), '') ilike '%día de sol%' as tabla_nombra_productos_excluidos,
  coalesce(obj_description('public.hotel_tarifas_unidad'::regclass), '') ilike '%hotel_temporadas%' as calendario_autoritativo_documentado,
  coalesce(
    col_description('public.hotel_tarifas_unidad'::regclass,
      (select ordinal_position from information_schema.columns
        where table_schema = 'public' and table_name = 'hotel_tarifas_unidad' and column_name = 'payload')),
    ''
  ) ilike '%EXACTAMENTE esas claves%' as payload_exige_claves_exactas;
\echo 'esperado: las cuatro en t'
\echo 'si alguna es f, el archivo de la 173 perdió la frontera o se aplicó otra versión: revisar el archivo antes de confiar en esta tabla'
