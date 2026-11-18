#!/bin/sh
# ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
# #124 — Reproduce, with the REAL server actions and a REAL Postgres + PostgREST, every path that can make
# `guardarCalculadora` answer "La calculadora cambió desde que la abriste…". Throw-away database copied from the local4360 photo
# (synthetic data, schema through 299). NEVER run against a real database.
# Usage (from dspacios-travel/):  sh supabase/scripts/repro_124_conflicto_calculadora.sh [pg_container] [template_db]
# Defaults: pg4360 + dspacios_local4360_semilla. Removes the database, the role, the network and the PostgREST container at the end.
# ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:-pg4360}"; PLANTILLA="${2:-dspacios_local4360_semilla}"
IMAGEN_REST="${IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; DB="r124_$TOKEN"; ROL="r124_auth_$TOKEN"; CLAVE="c$(hex 10)"; RED="redr124_$TOKEN"; REST="pgrstr124_$TOKEN"; SECRETO="local-r124-$(hex 24)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
limpiar() { st=$?; docker rm -f "$REST" >/dev/null 2>&1 || true; docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  $PS -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
$PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
# The photo is at schema 299; the actions at origin/main expect 300-302 (promotions by group, accumulation, real-stay "from").
for f in supabase/migrations/20260601000300_promociones_grupo.sql supabase/migrations/20260601000301_promociones_acumulacion.sql supabase/migrations/20260601000302_desde_estadia_real.sql; do
  ERR="$($PS -d "$DB" < "$f" 2>&1)" || { echo "Could not load $f"; echo "$ERR" | tail -5; exit 2; }
done
# Live sessions: the RLS of the global catalogue needs session_id in the JWT + a living auth.sessions row (+ agency context for superadmin).
$PS -d "$DB" -c "insert into auth.sessions (id, user_id, created_at) values ('00000000-0000-4000-8000-0000000a1240', 'da5a0c23-2b3e-42b5-a36d-6ed5c041150c', now()), ('00000000-0000-4000-8000-0000000a1241', 'd01aeaca-6789-4ba2-a6db-70526b640a25', now()); insert into public.sesion_agencia (session_id, user_id, tenant) values ('00000000-0000-4000-8000-0000000a1241', 'd01aeaca-6789-4ba2-a6db-70526b640a25', 'mayorista')" >/dev/null
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null; docker network connect "$RED" "$CT"
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1::3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
URL="http://127.0.0.1:$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
for i in $(seq 1 30); do node -e "fetch('$URL/').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},500)"; done
echo "PostgREST at $URL against $DB"
ARGS="--experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs"
R124_REST="$URL" R124_SECRETO="$SECRETO" R124_PS="$PS -d $DB" node $ARGS supabase/scripts/repro_124_conflicto_calculadora.mjs 2>&1 \
  | grep -v ExperimentalWarning | grep -v "^(node:" | grep -v "Use .node" | grep -v "register(" | grep -v "^--import"
