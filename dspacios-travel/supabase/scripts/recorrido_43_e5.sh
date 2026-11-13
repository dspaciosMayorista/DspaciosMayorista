#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# RECORRIDO LOCAL REAL de #43/#60 (entregas 4 y 5) con el CÓDIGO REAL de las acciones: cotizar por fechas → crear la cotización →
# convertirla en contrato → releer de la BASE la venta, su costo de hotel, la composición guardada y la cuenta por pagar del hotel,
# con descuento POR HABITACIÓN y una regla EBB, en dos configuraciones de combinación (acumula / no acumula). NUNCA contra una base real.
# Uso (desde dspacios-travel/):  sh supabase/scripts/recorrido_43_e5.sh <contenedor_pg> <plantilla>
# Base desechable (cadena de la 299 + 300 + 301 + datos de abajo) y PostgREST propio en red propia. Lo borra todo al final.
# ─────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"
IMAGEN_REST="${IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; DB="r43_$TOKEN"; ROL="r43_auth_$TOKEN"; CLAVE="c$(hex 10)"; RED="redr43_$TOKEN"; REST="pgrstr43_$TOKEN"; SECRETO="local-r43-$(hex 24)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
limpiar() { st=$?; docker rm -f "$REST" >/dev/null 2>&1 || true; docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for f in supabase/scripts/fixture_293_vigencia_grupos_dias.sql supabase/migrations/20260601000295_grupos_dias_propuesta.sql supabase/scripts/fixture_295_grupos_dias_propuesta.sql \
         supabase/migrations/20260601000297_calculadora_grupos_dias.sql supabase/scripts/fixture_297_calculadora_grupos_dias.sql \
         supabase/migrations/20260601000299_grupos_dias_activacion.sql supabase/scripts/fixture_299_grupos_dias_activacion.sql \
         supabase/migrations/20260601000300_promociones_grupo.sql supabase/migrations/20260601000301_promociones_acumulacion.sql supabase/migrations/20260601000302_desde_estadia_real.sql \
         supabase/scripts/fixture_recorrido_43_e5.sql; do
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
R43_REST="$URL" R43_SECRETO="$SECRETO" R43_PS="$PS -d $DB" node $ARGS supabase/scripts/recorrido_43_e5.mjs 2>&1 \
  | grep -v ExperimentalWarning | grep -v "^(node:" | grep -v "Use .node" | grep -v "register(" | grep -v "^--import"
