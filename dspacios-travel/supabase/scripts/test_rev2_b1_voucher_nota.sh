#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# Rev2 B1-06 — la nota del voucher aéreo según quién abre (aliado pagado / interno / aliado ajeno).
# Sesiones reales + RLS real + acciones reales + base real: pruebas/voucherNota.rev2.pg.ts (arnés de voucherAcceso307.pg.ts).
# SOLO Docker local y desechable. NUNCA toca rev_consolidada (la base del dueño): clona rev_consolidada_base (cadena sin datos del dueño).
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_rev2_b1_voucher_nota.sh <base_nueva> [contenedor_pg] [plantilla]
#   base_nueva     nombre NUEVO ^rev2_b1_[a-z0-9_]{1,30}$ (se crea desde la plantilla y se borra al final; KEEP=1 la conserva)
#   contenedor_pg  por defecto pgrevc (no se modifica salvo la base y el rol propios)
#   plantilla      por defecto rev_consolidada_base (solo se lee)
# Propiedad (lo único que este script borra): la base (si lleva la marca de la corrida), el rol rev2b1_auth_<token> y el contenedor PostgREST con la etiqueta dspacios.rev2b1=<token>.
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pgrevc}"
PLANTILLA="${3:-rev_consolidada_base}"
IMAGEN_REST="${REV2_IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
export MSYS_NO_PATHCONV=1
nombre_ok() { printf '%s' "$1" | grep -Eq "$2"; }
nombre_ok "$DB" '^rev2_b1_[a-z0-9_]{1,30}$' || { echo "Base inválida: usa un nombre nuevo ^rev2_b1_[a-z0-9_]{1,30}\$." >&2; exit 2; }
nombre_ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
nombre_ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
[ "$DB" != "$PLANTILLA" ] && [ "$DB" != "rev_consolidada" ] || { echo "Base no permitida." >&2; exit 2; }

hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 8)"
REST="pgrst_rev2b1_$(hex 4)"
ROL="rev2b1_auth_$TOKEN"
SECRETO="local-rev2-$(hex 24)"
CLAVE="c$(hex 12)"
MARCA="test_rev2_b1 $TOKEN"
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"

BASE_PROPIA=0
ROL_PROPIO=0
limpiar() {
  st=$?
  ids="$(docker ps -aq --filter "label=dspacios.rev2b1=$TOKEN" 2>/dev/null || true)"
  [ -n "$ids" ] && docker rm -f $ids >/dev/null 2>&1 || true
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    marca="$($PS -d postgres -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'" 2>/dev/null || true)"
    if [ "$marca" = "$MARCA" ]; then
      for intento in 1 2 3 4 5; do $PS -d postgres -c "drop database $DB" >/dev/null 2>&1 && break; sleep 2; done
    else echo "AVISO: $DB no lleva la marca de esta corrida; no se borra." >&2; fi
  fi
  [ "$ROL_PROPIO" = 1 ] && { $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || echo "AVISO: no se pudo borrar el rol $ROL" >&2; }
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe: no se toca." >&2; exit 3; }
IP_PG="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$CT" | awk '{print $1}')"
nombre_ok "$IP_PG" '^[0-9.]+$' || { echo "No se pudo leer la IP de $CT." >&2; exit 2; }

$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null || { echo "No se pudo crear $DB." >&2; exit 3; }
BASE_PROPIA=1
$PS -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null
# La imagen local de Postgres lee solo request.jwt.claim.sub (PostgREST v16 fija request.jwt.claims): sin esto mi_rol() da null. Solo en ESTA base desechable.
$PS -d "$DB" >/dev/null <<'SQL'
create or replace function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
SQL
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
ROL_PROPIO=1
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null

docker run -d --name "$REST" --label "dspacios.rev2b1=$TOKEN" --memory 160m -p "127.0.0.1::3000" \
  -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$IP_PG:5432/$DB" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" -e PGRST_DB_USE_LEGACY_GUCS=false -e PGRST_DB_MAX_ROWS=1000 \
  "$IMAGEN_REST" >/dev/null
i=0
until docker logs "$REST" 2>&1 | grep -q "Schema cache loaded"; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { docker logs "$REST" >&2; echo "PostgREST no arrancó" >&2; exit 1; }
  sleep 1
done
PUERTO_REST="$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
nombre_ok "$PUERTO_REST" '^[0-9]+$' || { echo "No se pudo leer el puerto de $REST." >&2; exit 1; }

cd "$APP"
# PG_ACCIONES_REALES=1: sin él el cargador sustituye el criterio de pago por un stub que falla cerrado (como hace test_pg_local.sh con PG_REACT=1).
PG_ACCIONES_REALES=1 PG206_BASE="$DB" PG206_CONTENEDOR="$CT" PG206_POSTGREST="http://127.0.0.1:$PUERTO_REST" PG206_JWT_SECRET="$SECRETO" \
  node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs --experimental-loader ./pruebas/support/reactLoader.mjs \
       --test --test-force-exit --test-timeout=120000 --test-concurrency=1 --test-reporter="${REV2_REPORTER:-spec}" pruebas/voucherNota.rev2.pg.ts
