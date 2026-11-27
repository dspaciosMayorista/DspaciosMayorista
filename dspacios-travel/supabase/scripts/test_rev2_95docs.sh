#!/bin/sh
# REV2 (B95-02/15/16/18/19, 2026-11-26) — variante del runner R2 para la cadena consolidada: clona la base `rev_consolidada_base` (cadena 327→343 SIN datos del dueño; NUNCA `rev_consolidada`), aplica 346 + 347 y corre
# pruebas/f95docsFidelidad.rev2.pg.ts (o R2_ARCHIVOS). Mismas garantías: base nueva desechable, PostgREST propio, nada del dueño. Cubre además lo que cubría R2:
#   R2-1 generarPlanCobro con la 332 (fuentes derivadas por la base), R2-2 reserva → reclasificar el paquete → elegir el mismo opcional → quitarlo,
#   R2-3 comparativa manual → hija elegida → contrato → documento del cliente (leído de nuevo).
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_r2_95_acciones.sh <base_nueva> [contenedor_pg] [plantilla]
#   base_nueva ^r2a_[a-z0-9_]{1,30}$ NUEVA (se borra al final; KEEP=1 la conserva). Plantilla: esquema con la 307 (+ lo previo), SIN la 331/332 (se aplican aquí). Por defecto pg304 / t307.
# Nunca toca la plantilla (solo la lee), ni bases de revisión del dueño. Todo lo que crea lleva el token de la corrida y se borra al terminar.
set -eu
export MSYS_NO_PATHCONV=1
DB="${1:-}"; CT="${2:-pgrevc}"; PLANTILLA="${3:-rev_consolidada_base}"
printf '%s' "$DB" | grep -Eq '^r2a_[a-z0-9_]{1,30}$' || { echo "Base inválida: usa un nombre nuevo ^r2a_[a-z0-9_]{1,30}\$." >&2; exit 2; }
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
printf '%s' "$PLANTILLA" | grep -Eq '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
case "$PLANTILLA" in rev_consolidada_base) ;; rev_*|dspacios_*) echo "Esa plantilla es de revisión/propia del dueño: no se usa (solo rev_consolidada_base, sin datos del dueño)." >&2; exit 2;; esac
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; REST="pgrstr2_$TOKEN"; RED="redr2_$TOKEN"; ROL="r2a_auth_$TOKEN"; SECRETO="${R2_SECRETO:-local-r2-$(hex 24)}"; CLAVE="c$(hex 12)"; MARCA="test_r2_95 $TOKEN"
AQUI="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$AQUI/../.." && pwd)"; MIGS="$APP/supabase/migrations"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
BASE_PROPIA=0; ROL_PROPIO=0; RED_PROPIA=0
limpiar() {
  st=$?
  docker rm -f "$REST" >/dev/null 2>&1 || true
  if [ "$RED_PROPIA" = 1 ]; then docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true; fi
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    marca="$($PS -d postgres -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'" 2>/dev/null || true)"
    [ "$marca" = "$MARCA" ] && for i in 1 2 3 4 5; do $PS -d postgres -c "drop database $DB" >/dev/null 2>&1 && break; sleep 2; done
  fi
  [ "$ROL_PROPIO" = 1 ] && $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true
  exit "$st"
}
trap limpiar EXIT
docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe: no se toca." >&2; exit 3; }
creada=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  $PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>&1 && { creada=1; break; }
  sleep 1
done
[ "$creada" = 1 ] || { echo "No se pudo crear $DB." >&2; exit 3; }
BASE_PROPIA=1
$PS -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null
LISTA_MIG="346_hotel_contrato_origen_compra 347_conversion_hoteles_contrato"
# R2_SIN_347=1: control NEGATIVO (sin la 347 el contrato convertido NO trae contrato_hoteles).
[ "${R2_SIN_347:-0}" = 1 ] && LISTA_MIG="346_hotel_contrato_origen_compra"
for n in $LISTA_MIG; do
  $PS -d "$DB" < "$MIGS/20260601000$n.sql" >/dev/null && echo "  migración ${n%%_*} aplicada" || { echo "FALLÓ la ${n%%_*}" >&2; exit 1; }
done
# Entorno (NO es esquema de la app): auth.uid()/auth.role() leen el JWT de request.jwt.claims (PostgREST ≥ 12 ya no fija request.jwt.claim.*).
$PS -d "$DB" >/dev/null <<'SQL'
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
SQL
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null; ROL_PROPIO=1
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null; RED_PROPIA=1
docker network connect "$RED" "$CT" >/dev/null
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1:${R2_PUERTO_REST:-}:3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" public.ecr.aws/supabase/postgrest:v16.4 >/dev/null
i=0
until docker logs "$REST" 2>&1 | grep -q "Schema cache loaded"; do i=$((i + 1)); [ "$i" -gt 60 ] && { docker logs "$REST" >&2; echo "PostgREST no arrancó" >&2; exit 1; }; sleep 1; done
PUERTO="$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
REST_URL="http://127.0.0.1:$PUERTO"
echo "== PostgREST $REST en $REST_URL contra $DB =="
cd "$APP"
# strip-types + alias por defecto (acciones del servidor); el DOCUMENTO del cliente (TSX) se renderiza aparte con reactLoader (pruebas/r2Documento95.react.ts) sobre las filas que vuelca este recorrido (R2_EVIDENCIA).
R2_LOADER="${R2_LOADER:-aliasLoaderRelativo.mjs}"
if [ "$R2_LOADER" = "reactLoader.mjs" ]; then OPC_NODE="--experimental-test-module-mocks --experimental-loader ./pruebas/support/reactLoader.mjs"; else OPC_NODE="--experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/$R2_LOADER"; fi
ARCHIVOS="${R2_ARCHIVOS:-pruebas/f95docsFidelidad.rev2.pg.ts}"
set +e
PG95_EVIDENCIA="${R2_EVIDENCIA:-}" PG262_BASE="$DB" PG262_CONTENEDOR="$CT" PG262_POSTGREST="$REST_URL" PG262_JWT_SECRET="$SECRETO" PG95_BASE="$DB" PG95_CONTENEDOR="$CT" PG95_POSTGREST="$REST_URL" PG95_JWT_SECRET="$SECRETO" \
  node $OPC_NODE \
       --test --test-force-exit --test-timeout=240000 --test-concurrency=1 --test-reporter="${PG95_REPORTER:-spec}" ${R2_FILTRO:+--test-name-pattern="$R2_FILTRO"} $ARCHIVOS
RC=$?
set -e
# R2_DESPUES: comando que corre sobre la MISMA base y el MISMO PostgREST antes de limpiar (pantallas compiladas, PDF). Variables: R2_REST_URL, R2_DB, R2_CT, R2_SECRETO_JWT.
if [ -n "${R2_DESPUES:-}" ]; then
  R2_REST_URL="$REST_URL" R2_DB="$DB" R2_CT="$CT" R2_SECRETO_JWT="$SECRETO" sh -c "$R2_DESPUES" || RC=$?
fi
exit $RC
