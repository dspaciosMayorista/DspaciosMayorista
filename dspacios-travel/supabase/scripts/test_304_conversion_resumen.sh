#!/bin/sh
# ────────────────────────────────────────────────────────────────────────────
# #94 · migración 304: CONVERSIÓN REAL del carrito (acciones de la aplicación) contra PostgreSQL + PostgREST locales y DESECHABLES.
# Crea una base nueva desde una plantilla (esquema completo hasta la 302, SIN la 304), le aplica la 304, levanta un PostgREST propio en red propia y corre
# pruebas/resumenContrato94.pg.ts: resumen que llega al contrato, relectura desde las dos rutas de documento, fallo de guardado + reintento, histórico e inconsistencias.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_304_conversion_resumen.sh <contenedor_pg> <plantilla>
# Lo borra todo al terminar (KEEP=1 conserva la base). NUNCA contra una base real.
# ────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"
IMAGEN_REST="${IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; DB="t94_$TOKEN"; ROL="t94_auth_$TOKEN"; CLAVE="c$(hex 10)"; RED="redt94_$TOKEN"; REST="pgrstt94_$TOKEN"; SECRETO="local-t94-$(hex 24)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
limpiar() { st=$?; docker rm -f "$REST" >/dev/null 2>&1 || true; docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  if [ "${KEEP:-}" != 1 ]; then $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; fi
  $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PS -d "$PLANTILLA" -c "select coalesce(to_regclass('public.contrato_resumen_precios')::text,'-')")" = "-" ] || { echo "La plantilla ya tiene la 304; se esperaba una anterior." >&2; exit 2; }
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
echo "== aplicando la migración 304 sobre la copia =="
$PS -d "$DB" < supabase/migrations/20260601000304_contrato_resumen_precios.sql >/dev/null 2>"/tmp/m304.$TOKEN.err" || { cat "/tmp/m304.$TOKEN.err" >&2; echo "FALLÓ la 304" >&2; exit 1; }
rm -f "/tmp/m304.$TOKEN.err"
# La imagen trae el auth.uid() antiguo (solo request.jwt.claim.sub): se redefine para leer también request.jwt.claims.
$PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null; docker network connect "$RED" "$CT"
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1::3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
URL="http://127.0.0.1:$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
for i in $(seq 1 30); do node -e "fetch('$URL/').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},500)"; done
echo "PostgREST en $URL contra $DB"
PG94_BASE="$DB" PG94_CONTENEDOR="$CT" PG94_POSTGREST="$URL" PG94_JWT_SECRET="$SECRETO" \
  node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoaderRelativo.mjs \
       --test --test-force-exit --test-timeout=180000 --test-concurrency=1 --test-reporter=spec pruebas/resumenContrato94.pg.ts 2>&1 \
  | grep -v ExperimentalWarning | grep -v "^(node:" | grep -v "Use .node" | grep -v "register(" | grep -v "^--import"
