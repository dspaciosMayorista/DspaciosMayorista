#!/bin/sh
# ────────────────────────────────────────────────────────
# GATES SQL DE LA 258 EN UN POSTGRES LOCAL DESECHABLE (nunca la base compartida).
# Orden: 255 → 256 aplicadas → preflight → 258 → postcheck → test_258_composicion.sql → reaplicación idempotente → rollback → postcheck revertido → 258 otra vez.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_258_gates.sh <contenedor> [base]
#   contenedor  contenedor desechable con el esquema HASTA la 254 (preparar_esquema_local.sh, plantilla255).  base: por defecto plantilla255.
# La 257 está reservada para B2B: esta cadena NO la aplica ni la necesita.
# ────────────────────────────────────────────────────────
set -u
CT="${1:-}"; PLANT="${2:-plantilla255}"
export MSYS_NO_PATHCONV=1
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_258_gates.sh <contenedor> [base]" >&2; exit 2; }
printf '%s' "$PLANT" | grep -Eq '^[a-z0-9_]+$' || { echo "base inválida" >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIGS="$AQUI/../migrations"
DB=gate258
P() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -v ON_ERROR_STOP=1 -X -q "$@"; }
PASO() { printf '\n══ %s\n' "$1"; }
FALLAS=0
fallo() { echo "  >> FALLA: $1"; FALLAS=$((FALLAS+1)); }
M258="$MIGS/20260601000258_composicion_publicada.sql"

docker exec -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d template1 -X -q -c "drop database if exists $DB" -c "create database $DB template $PLANT" || { echo "no se pudo clonar $PLANT"; exit 3; }

PASO "0a. migración 259 (ya aplicada en producción; el preflight de la 258 la exige)"
P < "$AQUI/../migrations/20260601000259_publicador_tarifario_limite_acotado.sql" >/dev/null 2>&1 && echo "  259 aplicada" || fallo "la 259 falló o no está en el árbol (integrar origin/main antes de correr este gate)"

PASO "0. migraciones 255 y 256 (prerrequisitos de orden; la 258 no las toca)"
P < "$MIGS/20260601000255_servicio_suplementos_franja.sql" >/dev/null 2>&1 && echo "  255 aplicada" || fallo "la 255 falló"
P < "$MIGS/20260601000256_disponibilidad_servicios_por_fecha.sql" >/dev/null 2>&1 && echo "  256 aplicada" || fallo "la 256 falló"

PASO "1. preflight (solo lectura)"
{ echo "begin read only;"; cat "$AQUI/preflight_258_composicion_publicada.sql"; echo "rollback;"; } | P | tee /tmp/pf258.txt
grep -q "BLOQUEA" /tmp/pf258.txt && fallo "el preflight bloquea"

PASO "2. migración 258 (una transacción)"
P < "$M258" >/dev/null 2>&1 && echo "  aplicada" || fallo "la migración falló"

PASO "3. postcheck"
{ echo "begin read only;"; cat "$AQUI/postcheck_258_composicion_publicada.sql"; echo "rollback;"; } | P | tee /tmp/pc258.txt
grep -q "FALLA" /tmp/pc258.txt && fallo "el postcheck reporta FALLA"

PASO "3b. cobertura de evidencia por pareja paquete + fecha (prueba negativa: evidencia de SOLO una de dos fechas sigue incompleta)"
COB() { { echo "begin;"; cat "$AQUI/test_258_cobertura_fixture.sql"; [ "$1" = completa ] && cat "$AQUI/test_258_cobertura_completa.sql"; cat "$AQUI/postcheck_258_composicion_publicada.sql"; echo "rollback;"; } | P -A -t -F '|'; }
CAMPO() { awk -F'|' -v n="$2" -v c="$3" '$1==n{print $c}' "$1"; }
COB parcial > /tmp/cob258a.txt 2>&1
esperado='faltan 6 de 9 fechas · 5 paquetes · 9101:2/2,9102:1/2,9104:1/1,9105:1/1,9106:1/1'
[ "$(CAMPO /tmp/cob258a.txt 12 3)" = "$esperado" ] && echo "  OK   fila 12 lista exactamente las parejas faltantes (9102 con 1 de 2 fechas sigue incompleto; 9103 completo y 9107 inactivo no aparecen)" || fallo "fila 12 parcial inesperada: $(CAMPO /tmp/cob258a.txt 12 3)"
[ "$(CAMPO /tmp/cob258a.txt 12 5)" = "PENDIENTE" ] && echo "  OK   fila 12 = PENDIENTE (no FALLA)" || fallo "fila 12 debería ser PENDIENTE"
case "$(CAMPO /tmp/cob258a.txt 99 5)" in "MIGRACIÓN 258 VERIFICADA"*) echo "  OK   resultado 1 (migración) VERIFICADA aunque falte regenerar";; *) fallo "resultado 1 debería ser VERIFICADA: $(CAMPO /tmp/cob258a.txt 99 5)";; esac
case "$(CAMPO /tmp/cob258a.txt 100 5)" in "NO APTO: falta regenerar"*) echo "  OK   resultado 2 (hotfix) NO APTO con cobertura incompleta";; *) fallo "resultado 2 debería ser NO APTO: $(CAMPO /tmp/cob258a.txt 100 5)";; esac
COB completa > /tmp/cob258b.txt 2>&1
[ "$(CAMPO /tmp/cob258b.txt 12 3)" = "faltan 0 de 9 fechas · 0 paquetes · -" ] && [ "$(CAMPO /tmp/cob258b.txt 12 5)" = "OK" ] && echo "  OK   al completar la evidencia la fila 12 converge a 0 faltantes" || fallo "la cobertura completa no converge: $(CAMPO /tmp/cob258b.txt 12 3)"
case "$(CAMPO /tmp/cob258b.txt 100 5)" in "APTO: cobertura completa"*) echo "  OK   resultado 2 (hotfix) APTO con cobertura completa";; *) fallo "resultado 2 debería ser APTO: $(CAMPO /tmp/cob258b.txt 100 5)";; esac
[ "$(P -A -t -c "select count(*) from public.armado_paquetes where id between 9101 and 9107")" = "0" ] && echo "  OK   el fixture no dejó datos (rollback)" || fallo "el fixture dejó datos"

PASO "4. test_258_composicion.sql"
P < "$AQUI/test_258_composicion.sql" 2>&1 | grep -E "FALLO|TEST 258|comprobaciones" | tee /tmp/t258.txt
grep -q "TODO OK" /tmp/t258.txt || fallo "test_258_composicion.sql no cerró en TODO OK"

PASO "5. reaplicación idempotente de la 258"
P < "$M258" >/dev/null 2>&1 && echo "  reaplicada sin error" || fallo "la reaplicación falló"

PASO "6. rollback de la 258"
P < "$AQUI/rollback_258_composicion_publicada.sql" >/dev/null 2>&1 && echo "  revertida" || fallo "el rollback falló"
{ echo "begin read only;"; cat "$AQUI/postcheck_258_composicion_publicada.sql"; echo "rollback;"; } | P > /tmp/pc258b.txt
N_FALLAS=$(grep -c "FALLA" /tmp/pc258b.txt)
if [ "$N_FALLAS" -ge 3 ]; then echo "  OK   tras el rollback el postcheck reporta la 258 revertida ($N_FALLAS FALLA esperados)"; else fallo "tras el rollback el postcheck no refleja la reversión"; fi
PASO "6b. la 256 sigue intacta tras el rollback"
{ echo "begin read only;"; cat "$AQUI/postcheck_256_disponibilidad_servicios.sql"; echo "rollback;"; } | P > /tmp/pc256c.txt
grep -q "FALLA" /tmp/pc256c.txt && fallo "tras el rollback de la 258 la 256 quedó alterada" || echo "  OK   postcheck 256 sin FALLA"

PASO "7. 258 otra vez tras el rollback"
P < "$M258" >/dev/null 2>&1 && echo "  aplicada" || fallo "no se pudo reaplicar tras el rollback"
P < "$AQUI/test_258_composicion.sql" 2>&1 | grep -E "FALLO|TEST 258" | tee /tmp/t258b.txt
grep -q "TODO OK" /tmp/t258b.txt || fallo "la batería falla tras rollback + reaplicación"

docker exec -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d template1 -X -q -c "drop database if exists $DB"
printf '\n'
if [ "$FALLAS" -eq 0 ]; then echo "TODOS LOS GATES 258 OK"; else echo "GATES 258: $FALLAS FALLA(S)"; exit 1; fi
