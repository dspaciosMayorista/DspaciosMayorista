#!/bin/sh
# 270 (#120): hotel bajo solicitud. SOLO Docker local y desechable (misma plantilla que test_266). Aplica 255..268 (la 269 de SalesBot #56 no es de esta rama), luego la 270 DOS veces (idempotente) y corre el SQL de prueba.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_270_hotel_a_solicitud.sh <base_nueva ^t270_[a-z0-9_]{1,40}$> [contenedor] [plantilla 001-254]
set -eu
DB="${1:-}"; CT="${2:-pg255local}"; PLANTILLA="${3:-plantilla255}"; export MSYS_NO_PATHCONV=1
printf '%s' "$DB" | grep -Eq '^t270_[a-z0-9_]{1,40}$' || { echo "Base inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$AQUI/../.." && pwd)"; M="$APP/supabase/migrations"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
trap '[ "${KEEP:-}" = 1 ] || $PS -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1' EXIT
$PS -d postgres -c "create database $DB template $PLANTILLA"
for n in $(seq 255 268); do
  for f in "$M"/20260601000${n}_*.sql; do [ -e "$f" ] && { $PS -d "$DB" < "$f" >/dev/null 2>&1 || { echo "falló $f" >&2; exit 1; }; }; done
done
$PS -d "$DB" < "$AQUI/test_259_semilla.sql" >/dev/null
echo "== APLICA 270 (dos veces: idempotente) =="
$PS -d "$DB" < "$M/20260601000270_hotel_a_solicitud.sql" >/dev/null
$PS -d "$DB" < "$M/20260601000270_hotel_a_solicitud.sql" >/dev/null
echo "== PRUEBAS 270 =="
$PS -d "$DB" < "$AQUI/test_270_hotel_a_solicitud.sql" 2>&1 | sed 's/^NOTICE:  //' | grep -E "^ *(OK|FALLA)|RESUMEN|ERROR"
echo "== ROLLBACK 270 (debe correr limpio: la prueba termina en ROLLBACK y no deja datos) =="
$PS -d "$DB" < "$AQUI/rollback_270_hotel_a_solicitud.sql" 2>&1 | grep -E "ABORTADO|ERROR|COMMIT" || true
