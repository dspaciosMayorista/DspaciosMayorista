-- ───────────────────────────────────────────────────────────────────────────
-- Prueba NEGATIVA de la migración 162 (`tarifario_resumen`): colisión de
-- nombre + atomicidad. Correr SOLO contra una base de verificación LOCAL
-- (ver supabase/scripts/pruebas/local-desde-cero.sh), NUNCA contra
-- producción — este script crea y borra una tabla de prueba.
--
-- Requiere: migraciones aplicadas hasta la 160 (la 162 TODAVÍA NO aplicada).
-- Ej.: local-desde-cero.sh dspacios_local 55432 160
--
-- Uso:
--   psql -p 55432 -d dspacios_local -v ON_ERROR_STOP=0 \
--     -f supabase/scripts/pruebas/test_162_atomicidad_colision.sql
--
-- (ON_ERROR_STOP=0 porque el PASO 1 espera que un statement falle a
-- propósito — el script maneja sus propios `\if`/asserts alrededor de eso.)
-- ───────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP 0
\pset pager off

-- ── PASO 0 — estado inicial: la relación no debe existir todavía ───────────
select to_regclass('public.tarifario_resumen') is null as ok_paso0_no_existe_antes;

-- ── PASO 1 — COLISIÓN: crear una tabla con el mismo nombre, luego intentar
--    aplicar la migración 162 tal cual — debe ABORTAR (raise exception) sin
--    dejar rastro, y la tabla original debe seguir intacta. ────────────────
create table public.tarifario_resumen (x integer);
insert into public.tarifario_resumen values (1), (2), (3);

\echo '--- intentando aplicar 162 sobre una colisión (se espera un error) ---'
\i supabase/migrations/20260601000162_tarifario_resumen.sql
\echo '--- fin del intento (arriba debe verse ERROR: La relación public.tarifario_resumen ya existe...) ---'

-- La colisión debe seguir siendo la TABLA original, sin tocar — nunca una
-- vista, y con sus 3 filas intactas (nada se truncó/dropeó a mitad de camino).
select
  c.relkind = 'r' as ok_paso1_sigue_siendo_tabla,
  (select count(*) from public.tarifario_resumen) = 3 as ok_paso1_filas_intactas
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'tarifario_resumen';

-- Ningún privilegio de la migración abortada debe haber quedado aplicado
-- sobre la tabla de colisión (la migración nunca llegó al `grant`, pero se
-- confirma explícitamente: cero grants de select para anon/authenticated
-- más allá de los que la tabla de prueba ya tuviera por defecto — ninguno).
select count(*) = 0 as ok_paso1_sin_grants_filtrados
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'tarifario_resumen'
  and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT';

drop table public.tarifario_resumen;

\set ON_ERROR_STOP 1

-- ── PASO 2 — SIN colisión: la migración real debe aplicar limpio ───────────
\i supabase/migrations/20260601000162_tarifario_resumen.sql

select
  c.relkind = 'v' as ok_paso2_es_vista,
  c.relrowsecurity = false as ok_paso2_relrowsecurity_no_aplica_a_vista -- informativo, no se usa RLS de tabla en una vista
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'tarifario_resumen';

-- security_invoker = true (reloptions trae 'security_invoker=true').
select exists (
  select 1 from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'tarifario_resumen'
    and c.reloptions @> array['security_invoker=true']
) as ok_paso2_security_invoker;

-- Grants finales: SOLO select, SOLO anon+authenticated (ni insert/update/
-- delete, ni PUBLIC, ni ningún otro rol).
select count(*) as grants_select_anon_authenticated
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'tarifario_resumen'
  and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT';
-- Se espera 2 (una fila por rol).

-- Acotado a anon/authenticated/PUBLIC — el propietario de la vista (quien la
-- creó) SIEMPRE aparece con todos los privilegios en information_schema.
-- role_table_grants en cuanto el ACL deja de ser NULL (lo materializa el
-- propio `revoke`/`grant` de la migración) — eso es ownership normal de
-- Postgres, no una fuga; lo que la migración debe garantizar es que NINGÚN
-- otro rol tenga privilegios de escritura.
select count(*) as ok_paso2_cero_grants_de_escritura
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'tarifario_resumen'
  and grantee in ('anon', 'authenticated', 'PUBLIC')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');
-- Se espera 0.

select count(*) as ok_paso2_cero_grants_a_public
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'tarifario_resumen' and grantee = 'PUBLIC';
-- Se espera 0.

-- ── PASO 3 — reintentar aplicar la 162 sobre SU PROPIA vista ya creada
--    también debe abortar (mismo abort de colisión, no un `create or
--    replace` silencioso) — una migración no se re-corre dos veces en este
--    repo, pero si alguien lo intenta por error, debe fallar cerrado, no
--    pisar la vista existente sin avisar. ─────────────────────────────────
\set ON_ERROR_STOP 0
\echo '--- reintentando aplicar 162 sobre la vista ya creada (se espera un error) ---'
\i supabase/migrations/20260601000162_tarifario_resumen.sql
\echo '--- fin del reintento ---'
\set ON_ERROR_STOP 1

select c.relkind = 'v' as ok_paso3_sigue_siendo_la_misma_vista
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'tarifario_resumen';

\echo '=== FIN test_162_atomicidad_colision.sql — revisar que todas las columnas ok_* dieron true y los grants los conteos esperados ==='
