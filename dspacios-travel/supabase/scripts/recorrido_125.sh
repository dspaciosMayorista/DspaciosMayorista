#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# RECORRIDO LOCAL REAL de #125 (promoción que sigue la base ganadora + un niño gratis por habitación) con el CÓDIGO REAL de las acciones de servidor:
#   Reservar: crearCotizacion → convertirCotizacion · Carrito: crearSolicitudReserva → convertirCotizacionCarrito,
# y se RELEE de la base: composición, ventas (precio/costo del hotel), contrato_items, CxP del hotel, resumen por pasajero y resumen congelado del contrato.
# computarReserva NO se simula. NUNCA contra una base real: clona una plantilla local y lo borra todo al salir.
# Uso (desde dspacios-travel/):  MSYS_NO_PATHCONV=1 sh supabase/scripts/recorrido_125.sh [contenedor_pg=pg304] [plantilla=plantilla304]
# ──────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:-pg304}"; PLANTILLA="${2:-plantilla304}"
IMAGEN_REST="${IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; DB="r125j_$TOKEN"; ROL="r125j_auth_$TOKEN"; CLAVE="c$(hex 10)"; RED="redr125j_$TOKEN"; REST="pgrstr125j_$TOKEN"; SECRETO="local-r125j-$(hex 24)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
ARRANCO_PG=0
if [ "$(docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null)" != "true" ]; then docker start "$CT" >/dev/null; ARRANCO_PG=1; sleep 6; fi
limpiar() { st=$?; docker rm -f "$REST" >/dev/null 2>&1 || true; docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  $PS -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true
  # pg304 es compartido: solo se devuelve a «detenido» si este script lo arrancó y ningún otro entorno (rev-*, local*, r125-*) está corriendo.
  if [ "$ARRANCO_PG" = "1" ] && [ -z "$(docker ps --format '{{.Names}}' | grep -E '^(rev-|local|r125-)' || true)" ]; then docker stop "$CT" >/dev/null 2>&1 || true; fi
  exit "$st"; }
trap limpiar EXIT
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
# INTEGRADO (#1, #53, #102, #105, #106, #124, #125 + O1-O4/U1): el esquema COMBINADO en orden numérico 303 → … → 311 (307 #53, 308 #1, 309 #106, 310 #125, 311 O3), luego el fixture.
for n in 303 304 305 306 307 308 309 310 311 fixture; do
  if [ "$n" = "fixture" ]; then f=supabase/scripts/fixture_recorrido_125.sql; else f="$(ls supabase/migrations/20260601000${n}_*.sql)"; fi
  ERR="$($PS -d "$DB" < "$f" 2>&1)" || { echo "No se pudo cargar $f"; echo "$ERR" | tail -5; exit 2; }
done
$PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null; docker network connect "$RED" "$CT"
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1::3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
URL="http://127.0.0.1:$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
for i in $(seq 1 30); do node -e "fetch('$URL/').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},500)"; done
echo "PostgREST en $URL contra $DB"
ARGS="--experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs"
SAL="$(mktemp)"; set +e
R125_REST="$URL" R125_SECRETO="$SECRETO" R125_PS="$PS -d $DB" node $ARGS supabase/scripts/recorrido_125.mjs > "$SAL" 2>&1; ST=$?; set -e
grep -v ExperimentalWarning "$SAL" | grep -v "^(node:" | grep -v "Use .node" | grep -v "register(" | grep -v "^--import" || true
rm -f "$SAL"; exit $ST
