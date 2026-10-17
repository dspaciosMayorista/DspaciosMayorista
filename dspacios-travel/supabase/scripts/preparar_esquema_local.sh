#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# PREPARA EL ESQUEMA VIGENTE EN UN POSTGRES LOCAL DESECHABLE (para probar migraciones).
# Aplica supabase/migrations/*.sql EN ORDEN, cada archivo en UNA transacción (psql -1,
# como los aplica la CLI/SQL editor), y se DETIENE en el primer fallo real mostrando el
# error completo: así un fallo de esquema nunca se disfraza de "cascada" de errores.
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/preparar_esquema_local.sh <contenedor> [hasta] [plantilla]
#     contenedor  contenedor Docker NUEVO y desechable (imagen supabase/postgres) con la base
#                 `postgres` vacía. Se NIEGA si ya existe public.programas (no pisa nada).
#     hasta       último número de migración a aplicar (por defecto 212: el esquema vigente
#                 SIN la 213 ni la 211).
#     plantilla   si se indica (^plantilla[a-z0-9_]*$), al terminar se crea esa base como copia
#                 de `postgres` (la usan test_213_migracion.sh y test_212_carrera.sh).
#
# Crear el contenedor:
#   docker run -d --name pgesquema -e POSTGRES_PASSWORD=postgres public.ecr.aws/supabase/postgres:15.8.1.085
#
# QUÉ ES PREPARACIÓN DEL ENTORNO y QUÉ ES ESQUEMA (lo que antes se confundía):
#   · La imagen no trae inicializado el servicio de Storage: falta storage.buckets.public, y
#     las migraciones de buckets (045, 046, 052, 055, 080, 113, 138) lo necesitan. Se agrega
#     aquí (entorno, no esquema de la app).
#   · Los archivos se aplican con psql -1: la 015 (semilla) usa una tabla temporal
#     `on commit drop` y solo funciona dentro de UNA transacción.
#   · Si el servidor deja de responder (caída de un proceso + recuperación automática) se espera
#     hasta 3 min a que vuelva y se reintenta el mismo archivo (hasta 4 intentos); eso es el
#     ENTORNO, no el esquema; igual si es el motor de Docker el que devuelve error (API 500). Cualquier otro error detiene el script en seco con su mensaje.
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
HASTA="${2:-212}"
PLANTILLA="${3:-}"
export MSYS_NO_PATHCONV=1
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: preparar_esquema_local.sh <contenedor> [hasta] [plantilla]" >&2; exit 2; }
printf '%s' "$HASTA" | grep -Eq '^[0-9]{1,3}$' || { echo "'hasta' debe ser un número de migración." >&2; exit 2; }
[ -z "$PLANTILLA" ] || printf '%s' "$PLANTILLA" | grep -Eq '^plantilla[a-z0-9_]*$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PSQL="docker exec -i -e PGPASSWORD=${PGPASSWORD_ESQUEMA:-postgres} $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
for i in $(seq 1 40); do $PSQL -d postgres -c 'select 1' >/dev/null 2>&1 && break; sleep 3; done
$PSQL -d postgres -c 'select 1' >/dev/null 2>&1 || { echo "Postgres no responde en $CT." >&2; exit 2; }
[ "$($PSQL -d postgres -t -A -c "select coalesce(to_regclass('public.programas')::text, 'no')")" = no ] || { echo "$CT ya tiene el esquema (public.programas existe): usa un contenedor nuevo." >&2; exit 3; }

# Preparación del entorno (NO es esquema de la app).
$PSQL -d postgres -c "alter table storage.buckets add column if not exists public boolean default false" >/dev/null
echo "Entorno preparado: storage.buckets.public presente."

OK=0; REINTENTOS=0
for f in $(ls "$APP"/supabase/migrations/*.sql | sort); do
  n="$(basename "$f")"
  num="$(printf '%s' "$n" | sed -E 's/^2026060100([0-9]{4})_.*/\1/' | sed -E 's/^0+//')"
  [ -n "$num" ] || num=0
  [ "$num" -le "$HASTA" ] || continue
  intento=1
  while :; do
    if $PSQL -d postgres -1 < "$f" >/dev/null 2>"$TMP/err"; then OK=$((OK + 1)); break; fi
    if grep -Eqi 'could not connect|connection to server|server closed the connection|terminating connection|the database system is|crash of another server process|Internal Server Error for API route|error during connect|Cannot connect to the Docker daemon|dockerDesktopLinuxEngine' "$TMP/err" && [ "$intento" -lt 4 ]; then
      # Fallo del ENTORNO (p. ej. un proceso de Postgres cayó y el servidor hace recuperación
      # automática, que en Docker Desktop puede tardar más de un minuto): se espera a que
      # vuelva a aceptar consultas y se reintenta el MISMO archivo (cada archivo va en una
      # transacción, así que lo interrumpido se deshizo).
      REINTENTOS=$((REINTENTOS + 1)); echo "  (reintento $intento de $n: el servidor no respondió; esperando a que se recupere)"; intento=$((intento + 1))
      for w in $(seq 1 60); do $PSQL -d postgres -c 'select 1' >/dev/null 2>&1 && break; sleep 3; done
      continue
    fi
    echo "FALLO DE ESQUEMA en $n (se detiene aquí):" >&2
    cat "$TMP/err" >&2
    exit 1
  done
done
echo "Esquema aplicado: $OK migraciones hasta la $HASTA, $REINTENTOS reintento(s) por fallos de conexión, 0 fallos de esquema."

# Verificación mínima del resultado.
[ "$($PSQL -d postgres -t -A -c "select (to_regclass('public.programas') is not null)::int + (to_regclass('public.programa_ciudades') is not null)::int + (to_regprocedure('public.mi_rol()') is not null)::int + (to_regprocedure('public.clave_ciudad_ruta(text)') is not null or $HASTA < 212)::int")" = 4 ] \
  || { echo "El esquema quedó incompleto." >&2; exit 1; }

if [ -n "$PLANTILLA" ]; then
  for i in 1 2 3 4 5 6 7 8; do
    $PSQL -d template1 -t -A -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'postgres' and pid <> pg_backend_pid()" >/dev/null
    if $PSQL -d template1 -c "create database $PLANTILLA template postgres" 2>/dev/null; then echo "Plantilla $PLANTILLA creada."; exit 0; fi
    sleep 1
  done
  echo "No se pudo crear la plantilla $PLANTILLA (conexiones abiertas en postgres)." >&2; exit 1
fi
