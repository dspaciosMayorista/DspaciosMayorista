#!/bin/sh
# ────────────────────────────────────────────────────────
# APP → BASE · límite propio y acotado del publicador del tarifario (migración 259, 20260601000259_publicador_tarifario_limite_acotado.sql).
# Reproduce el síntoma del paquete 73 con PostgreSQL + PostgREST REALES (la ruta de la app): el 33 (3.187 filas) publica y el 73 (12.669) se cancela con 57014 a los 8 s
# (limitando la CPU del contenedor de Postgres); aplica la 259; mide ANTES/DESPUÉS con 3.187, 7.413 y 12.669 filas y comprueba: el límite rige por PostgREST (no por SQL
# directo), la espera por candado sigue acotada, rollback ante timeout y ante error (filas anteriores y generación publicada intactas), concurrencia sobre el mismo paquete.
# SOLO Docker local y desechable. Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_259_publicador_limite.sh <base_nueva> [contenedor_pg] [plantilla]
#     base_nueva    nombre NUEVO ^t259_[a-z0-9_]{1,40}$ que NO exista; se crea desde la plantilla y se borra al final (KEEP=1 la conserva).
#     contenedor_pg postgres local desechable (por defecto pg259).
#     plantilla     base con las migraciones 001-254 (preparar_esquema_local.sh <contenedor> 254 plantilla259). Solo se lee.
# Propiedad (lo único que este script toca): la base nueva, un contenedor PostgREST propio con etiqueta dspacios.test259=<token>, y la cuota de CPU del contenedor de
# Postgres (se restaura al final). ⚠️ La limitación de CPU afecta a TODO lo que corra en ese contenedor: usa uno desechable.
# ────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg259}"
PLANTILLA="${3:-plantilla259}"
IMAGEN_REST="${PG259_IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
export MSYS_NO_PATHCONV=1

nombre_ok() { printf '%s' "$1" | grep -Eq "$2"; }
nombre_ok "$DB" '^t259_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t259_[a-z0-9_]{1,40}\$." >&2; exit 2; }
nombre_ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
nombre_ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
[ "$DB" != "$PLANTILLA" ] || { echo "La base no puede ser la plantilla." >&2; exit 2; }

hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 8)"
REST="pgrst259_$(hex 5)"
SECRETO="local-259-$(hex 24)"
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
MIGRACION="$APP/supabase/migrations/20260601000259_publicador_tarifario_limite_acotado.sql"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
[ -f "$MIGRACION" ] || { echo "No encuentro la migración 259." >&2; exit 2; }

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
$PS -d postgres -c "select 1" >/dev/null 2>&1 || { echo "Postgres no responde en $CT." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe: usa otro nombre." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
NANO_PREVIO="$(docker inspect -f '{{.HostConfig.NanoCpus}}' "$CT")"

BASE_PROPIA=0
limpiar() {
  st=$?
  docker update --cpus "$(awk "BEGIN{print ${NANO_PREVIO:-0}/1000000000}")" "$CT" >/dev/null 2>&1 || true
  ids="$(docker ps -aq --filter "label=dspacios.test259=$TOKEN" 2>/dev/null || true)"
  [ -n "$ids" ] && docker rm -f $ids >/dev/null 2>&1 || true
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    $PS -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || echo "AVISO: no se pudo borrar la base $DB" >&2
  fi
  exit $st
}
trap limpiar EXIT INT TERM

$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
BASE_PROPIA=1
# Migraciones PREVIAS opcionales (rutas separadas por espacio): permiten medir bajo las reglas de otras migraciones aún no integradas (p. ej. 256/258 del hotfix de traslados).
# Se leen desde donde estén; no se copian al repo. Deben ser posteriores a la plantilla y anteriores a la 259.
if [ -n "${MIGRACIONES_PREVIAS:-}" ]; then
  for f in $MIGRACIONES_PREVIAS; do
    [ -f "$f" ] || { echo "No existe la migración previa $f" >&2; exit 2; }
    echo "== migración previa: $(basename "$f") =="
    $PS -d "$DB" < "$f" >/dev/null
  done
fi
echo "== semilla (forma del paquete 73) =="
$PS -d "$DB" < "$AQUI/test_259_semilla.sql"
# El publicador debe estar SIN límites propios (estado previo a la 259): si la plantilla ya la trae, la prueba no mide el ANTES.
[ "$($PS -d "$DB" -c "select count(*) from pg_proc where proname = 'publicar_tarifario_resultado' and 'statement_timeout=30s' = any (proconfig)")" = 0 ] || { echo "La plantilla ya trae la 259: usa una con 001-254." >&2; exit 2; }

# PostgREST propio delante de la base (como Supabase: roles authenticator/authenticated con statement_timeout 8 s y lock_timeout 8 s).
$PS -d "$DB" -c "alter role authenticator with password 'postgres'" >/dev/null
docker run -d --name "$REST" --label "dspacios.test259=$TOKEN" --link "$CT:db" -p 127.0.0.1::3000 \
  -e PGRST_DB_URI="postgres://authenticator:postgres@db:5432/$DB" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" \
  -e PGRST_SERVER_HOST=0.0.0.0 "$IMAGEN_REST" >/dev/null
PUERTO="$(docker port "$REST" 3000/tcp | head -n1 | sed 's/.*://')"
for i in $(seq 1 40); do curl -s -m 2 -o /dev/null "http://127.0.0.1:$PUERTO/" && break; sleep 1; done

winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf "%s" "$1"; fi; }
# Recorridos de la publicación por lotes (migración 260), con el generador REAL (Server Action) y PostgREST+Postgres reales; se lanzan desde dspacios-travel/ (necesitan mocks de módulos y el alias @/):
#   RECORRIDO=1  test_recorrido_73.mjs → bandera ENCENDIDA (activación, visibilidad completa, sin mezcla con la generación anterior, composición 258) y equivalencia con el publicador monolítico (bandera apagada).
#   RUTA=1       test_260_ruta.mjs     → la ruta /api/cron/publicacion-tarifario (respaldo sin pg_cron).
# Ambos aplican la 259 y la 260 por su cuenta sobre la base nueva.
SCRIPT_NODE="test_259_publicador_limite.mjs"; NODE_FLAGS=""
if [ "${RECORRIDO:-}" = 1 ]; then SCRIPT_NODE="test_recorrido_73.mjs"; NODE_FLAGS="--experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs"; fi
if [ "${RUTA:-}" = 1 ]; then SCRIPT_NODE="test_260_ruta.mjs"; NODE_FLAGS="--experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs"; fi
CT="$CT" DB="$DB" URL="http://127.0.0.1:$PUERTO/rpc/" SECRET="$SECRETO" MIGRACION="$(winpath "$MIGRACION")" PROTOTIPO="$(winpath "$APP/supabase/migrations/20260601000260_publicacion_tarifario_por_lotes.sql")" APP="$(winpath "$APP")" node $NODE_FLAGS "$(winpath "$AQUI/$SCRIPT_NODE")"
