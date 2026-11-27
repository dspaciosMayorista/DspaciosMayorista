#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# REAL-ACTION DRIVER for block 1 (Codex F1/F2): the REAL server actions (`convertirCotizacion`, `generarVoucherVuelo`) against a disposable
# Postgres + PostgREST, with SEPARATE user sessions, a pause after the header insert and an injected downstream failure.
# Usage (from dspacios-travel/):  sh supabase/scripts/recorrido_block1.sh <pg_container> <template_db> [out_dir]
#   template_db = a database with migrations 001-326 (migrations 334-338 and the fixture are applied here).
# Raw output goes to <out_dir>/recorrido_block1.log (default: docs/tecnico/evidence-block1-r2/). Everything is dropped at the end (RB1_KEEP=1 keeps the DB).
# ─────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?container}"; PLANTILLA="${2:?template}"; SALIDA="${3:-docs/tecnico/evidence-block1-r2}"
IMAGEN_REST="${IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; DB="rb1_$TOKEN"; ROL="rb1_auth_$TOKEN"; CLAVE="c$(hex 10)"; RED="redrb1_$TOKEN"; REST="pgrstrb1_$TOKEN"; SECRETO="local-rb1-$(hex 24)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
limpiar() { st=$?; docker rm -f "$REST" >/dev/null 2>&1 || true; docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  if [ "${RB1_KEEP:-0}" != "1" ]; then $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true; else echo "DB kept: $DB (role $ROL)"; fi; exit "$st"; }
trap limpiar EXIT
mkdir -p "$SALIDA"
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for f in supabase/migrations/20260601000334_destinos_aereos_alternativos_integridad.sql supabase/migrations/20260601000335_vuelos_sistema_exige_componente_aereo.sql \
         supabase/migrations/20260601000336_conversion_cotizacion_reclamo.sql supabase/migrations/20260601000337_voucher_vuelo_atomico.sql supabase/migrations/20260601000338_voucher_vuelo_por_servicio_y_revision.sql supabase/scripts/fixture_recorrido_block1.sql; do
  ERR="$($PS -d "$DB" < "$f" 2>&1)" || { echo "Could not load $f"; echo "$ERR" | tail -5; exit 2; }
done
if [ -n "${RB1_SEMILLA:-}" ]; then ERR="$($PS -d "$DB" < "$RB1_SEMILLA" 2>&1)" || { echo "Could not load $RB1_SEMILLA"; echo "$ERR" | tail -5; exit 2; }; fi
$PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null; docker network connect "$RED" "$CT"
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1::3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
URL="http://127.0.0.1:$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
for i in $(seq 1 30); do node -e "fetch('$URL/').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},500)"; done
echo "PostgREST at $URL against $DB"
ARGS="--experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs"
RB1_REST="$URL" RB1_SECRETO="$SECRETO" RB1_PS="$PS -d $DB" RB1_ESCENARIO="${RB1_ESCENARIO:-todos}" RB1_PREVIO="${RB1_PREVIO:-0}" RB1_SALIDA="$SALIDA" node $ARGS "${RB1_SCRIPT:-supabase/scripts/recorrido_block1.mjs}" 2>&1 \
  | grep -v ExperimentalWarning | grep -v "^(node:" | grep -v "Use .node" | grep -v "register(" | grep -v "^--import" | tee "$SALIDA/${RB1_LOG:-recorrido_block1.log}"
