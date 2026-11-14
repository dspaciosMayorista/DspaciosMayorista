#!/bin/sh
# ────────────────────────────────────────────────────────────────────────────
# Lanzador GENÉRICO de una prueba `*.pg.ts` (acciones REALES de la aplicación → PostgREST propio → Postgres) sobre una copia desechable de una plantilla de esquema.
# Crea una base nueva desde la plantilla, aplica las migraciones indicadas (ya aplicadas se omiten por idempotencia propia de cada una), levanta un PostgREST en red propia,
# corre la prueba con las variables <PREFIJO>_BASE / _CONTENEDOR / _POSTGREST / _JWT_SECRET y lo borra todo al terminar (KEEP=1 conserva la base).
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_pg_local.sh <contenedor_pg> <plantilla> <PREFIJO_ENV> <pruebas/archivo.pg.ts> [migración.sql ...]
# Ej.: sh supabase/scripts/test_pg_local.sh pg304 plantilla304 PG102 pruebas/cotizacionAsistidaB2B102.pg.ts supabase/migrations/20260601000304_contrato_resumen_precios.sql supabase/migrations/20260601000305_recobro_comision_reserva.sql
# NUNCA contra una base real.
# ────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; PRE="${3:?prefijo de variables, p. ej. PG102}"; PRUEBA="${4:?archivo .pg.ts}"; shift 4
printf '%s' "$PRE" | grep -Eq '^PG[0-9]{2,3}$' || { echo "Prefijo inválido (PGnn)." >&2; exit 2; }
IMAGEN_REST="${IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; DB="tpg_$TOKEN"; ROL="tpg_auth_$TOKEN"; CLAVE="c$(hex 10)"; RED="redtpg_$TOKEN"; REST="pgrsttpg_$TOKEN"; SECRETO="local-tpg-$(hex 24)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
limpiar() { st=$?; docker rm -f "$REST" >/dev/null 2>&1 || true; docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  [ "${KEEP:-}" = 1 ] || $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true
  $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for m in "$@"; do
  $PS -d "$DB" < "$m" >/dev/null 2>"/tmp/mpg.$TOKEN.err" || { cat "/tmp/mpg.$TOKEN.err" >&2; echo "FALLÓ $m" >&2; exit 1; }
  echo "  aplicada: $(basename "$m")"
done
rm -f "/tmp/mpg.$TOKEN.err"
$PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null; docker network connect "$RED" "$CT"
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1::3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
URL="http://127.0.0.1:$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
for i in $(seq 1 30); do node -e "fetch('$URL/').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},500)"; done
echo "PostgREST en $URL contra $DB"
env "PG_ACCIONES_REALES=${PG_REACT:-0}" "${PRE}_BASE=$DB" "${PRE}_CONTENEDOR=$CT" "${PRE}_POSTGREST=$URL" "${PRE}_JWT_SECRET=$SECRETO" \
  node $( [ "${PG_REACT:-}" = 1 ] && echo "--experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs --experimental-loader ./pruebas/support/reactLoader.mjs" || echo "--experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoaderRelativo.mjs" ) \
       --test --test-force-exit --test-timeout=240000 --test-concurrency=1 --test-reporter="${REPORTER:-spec}" "$PRUEBA" 2>&1 \
  | grep -v ExperimentalWarning | grep -v "^(node:" | grep -v "Use .node" | grep -v "register(" | grep -v "^--import"
