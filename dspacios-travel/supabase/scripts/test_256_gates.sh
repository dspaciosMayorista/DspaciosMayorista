#!/bin/sh
# ────────────────────────────────────────────────────────
# GATES SQL DE LA 256 EN UN POSTGRES LOCAL DESECHABLE (nunca la base compartida).
# Orden: (255 aplicada) → preflight → 256 → postcheck → test_256_disponibilidad.sql → reaplicación idempotente → rollback → estado tras el rollback → 256 otra vez.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_256_gates.sh <contenedor> [base]
#   contenedor  contenedor desechable con el esquema HASTA la 254 (preparar_esquema_local.sh, plantilla255).  base: por defecto plantilla255.
# ────────────────────────────────────────────────────────
set -u
CT="${1:-}"; PLANT="${2:-plantilla255}"
export MSYS_NO_PATHCONV=1
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_256_gates.sh <contenedor> [base]" >&2; exit 2; }
printf '%s' "$PLANT" | grep -Eq '^[a-z0-9_]+$' || { echo "base inválida" >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIGS="$AQUI/../migrations"
DB=gate256
P() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -v ON_ERROR_STOP=1 -X -q "$@"; }
PASO() { printf '\n══ %s\n' "$1"; }
FALLAS=0
fallo() { echo "  >> FALLA: $1"; FALLAS=$((FALLAS+1)); }

docker exec -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d template1 -X -q -c "drop database if exists $DB" -c "create database $DB template $PLANT" || { echo "no se pudo clonar $PLANT"; exit 3; }

PASO "0a. migración 259 (ya aplicada en producción; el preflight de la 256 la exige)"
P < "$AQUI/../migrations/20260601000259_publicador_tarifario_limite_acotado.sql" >/dev/null 2>&1 && echo "  259 aplicada" || fallo "la 259 falló o no está en el árbol (integrar origin/main antes de correr este gate)"

PASO "0. migración 255 (prerrequisito de orden; la 256 no la toca)"
P < "$MIGS/20260601000255_servicio_suplementos_franja.sql" >/dev/null 2>&1 && echo "  aplicada" || fallo "la 255 falló"

PASO "1. preflight (solo lectura)"
{ echo "begin read only;"; cat "$AQUI/preflight_256_disponibilidad_servicios.sql"; echo "rollback;"; } | P | tee /tmp/pf256.txt
grep -q "BLOQUEA" /tmp/pf256.txt && fallo "el preflight bloquea"

PASO "2. migración 256 (una transacción)"
P < "$MIGS/20260601000256_disponibilidad_servicios_por_fecha.sql" >/dev/null 2>&1 && echo "  aplicada" || fallo "la migración falló"

PASO "3. postcheck"
{ echo "begin read only;"; cat "$AQUI/postcheck_256_disponibilidad_servicios.sql"; echo "rollback;"; } | P | tee /tmp/pc256.txt
grep -q "FALLA" /tmp/pc256.txt && fallo "el postcheck reporta FALLA"

PASO "4. test_256_disponibilidad.sql"
P < "$AQUI/test_256_disponibilidad.sql" 2>&1 | grep -E "FALLO|TEST 256|comprobaciones" | tee /tmp/t256.txt
grep -q "TODO OK" /tmp/t256.txt || fallo "test_256_disponibilidad.sql no cerró en TODO OK"

PASO "5. reaplicación idempotente de la 256"
P < "$MIGS/20260601000256_disponibilidad_servicios_por_fecha.sql" >/dev/null 2>&1 && echo "  reaplicada sin error" || fallo "la reaplicación falló"

PASO "6. rollback de la 256"
P < "$AQUI/rollback_256_disponibilidad_servicios.sql" >/dev/null 2>&1 && echo "  revertida" || fallo "el rollback falló"
{ echo "begin read only;"; cat "$AQUI/postcheck_256_disponibilidad_servicios.sql"; echo "rollback;"; } | P > /tmp/pc256b.txt
N_FALLAS=$(grep -c "FALLA" /tmp/pc256b.txt)
if [ "$N_FALLAS" -ge 3 ]; then echo "  OK   tras el rollback el postcheck reporta la 256 revertida ($N_FALLAS FALLA esperados)"; else fallo "tras el rollback el postcheck no refleja la reversión"; fi
PASO "6b. la 254 sigue intacta tras el rollback (huella del publicador y de la vista)"
{ echo "begin read only;"; cat "$AQUI/preflight_256_disponibilidad_servicios.sql"; echo "rollback;"; } | P | tee /tmp/pf256b.txt | grep -E "huella|254"
grep -q "BLOQUEA" /tmp/pf256b.txt && fallo "tras el rollback el publicador/vista no son los de la 254"

PASO "7. 256 otra vez tras el rollback"
P < "$MIGS/20260601000256_disponibilidad_servicios_por_fecha.sql" >/dev/null 2>&1 && echo "  aplicada" || fallo "no se pudo reaplicar tras el rollback"
P < "$AQUI/test_256_disponibilidad.sql" 2>&1 | grep -E "FALLO|TEST 256" | tee /tmp/t256b.txt
grep -q "TODO OK" /tmp/t256b.txt || fallo "la batería falla tras rollback + reaplicación"

docker exec -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d template1 -X -q -c "drop database if exists $DB"
printf '\n'
if [ "$FALLAS" -eq 0 ]; then echo "TODOS LOS GATES 256 OK"; else echo "GATES 256: $FALLAS FALLA(S)"; exit 1; fi
