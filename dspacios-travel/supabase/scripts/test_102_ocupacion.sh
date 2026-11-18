#!/bin/sh
# ────────────────────────────────────────────────────────────────────────────
# #102 · Ocupación de la búsqueda general, Vista tabla y noche adicional.
# Ejecuta pruebas/ocupacionBusqueda102.pg.ts (o la prueba que se indique) con las acciones REALES de la aplicación → PostgREST propio → Postgres,
# sobre una copia DESECHABLE de una plantilla de esquema. No necesita migraciones nuevas (#102 no cambia el esquema).
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_102_ocupacion.sh [contenedor_pg] [plantilla] [archivo.pg.ts]
#   Por defecto: pg304 plantilla304 pruebas/ocupacionBusqueda102.pg.ts.  KEEP=1 conserva la base al terminar.
# Propiedad (lo único que borra): la base tpg102_<token>, el rol tpg102_auth_<token>, la red y el contenedor PostgREST propios. NUNCA toca una base real.
# ────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:-pg304}"; PLANTILLA="${2:-plantilla304}"; PRUEBA="${3:-pruebas/ocupacionBusqueda102.pg.ts}"
IMAGEN_REST="${IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; DB="tpg102_$TOKEN"; ROL="tpg102_auth_$TOKEN"; CLAVE="c$(hex 10)"; RED="red102_$TOKEN"; REST="pgrst102_$TOKEN"; SECRETO="local-102-$(hex 24)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
limpiar() { st=$?; docker rm -f "$REST" >/dev/null 2>&1 || true; docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  [ "${KEEP:-}" = 1 ] || $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true
  $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
$PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null; docker network connect "$RED" "$CT"
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1::3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
URL="http://127.0.0.1:$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
for i in $(seq 1 30); do node -e "fetch('$URL/').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},500)"; done
echo "PostgREST en $URL contra $DB"
env PG102_BASE="$DB" PG102_CONTENEDOR="$CT" PG102_POSTGREST="$URL" PG102_JWT_SECRET="$SECRETO" \
  node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoaderRelativo.mjs \
       --test --test-force-exit --test-timeout=240000 --test-concurrency=1 --test-reporter="${REPORTER:-spec}" "$PRUEBA" 2>&1 \
  | grep -v ExperimentalWarning | grep -v "^(node:" | grep -v "Use .node" | grep -v "register(" | grep -v "^--import"
