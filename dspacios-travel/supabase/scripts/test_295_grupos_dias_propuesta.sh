#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL de la migración 295 (#43/#60 incremento 3). NUNCA contra una base real.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_295_grupos_dias_propuesta.sh <contenedor> <plantilla>
#   <plantilla>: esquema hasta la 287 SIN la 293 (p. ej. plantilla_prod287, equivalente a Producción).
# Base desechable: 293 + fixture_293 → preflight 295 → 295 → postcheck (misma huella) → reaplicar →
# fixture_295 → pruebas SQL → rollback protegido (aborta con propuestas) → rollback → reaplicar → postcheck.
# ─────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; DB="t295_$$"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
# La plantilla local es de supabase_admin (dueño de todas las tablas); en Supabase corre como postgres.
SQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
trap '$SQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT

$SQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$SQL -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
$SQL -d "$DB" < supabase/migrations/20260601000293_vigencia_grupos_dias_inactivos.sql >/dev/null 2>&1
$SQL -d "$DB" < supabase/scripts/fixture_293_vigencia_grupos_dias.sql >/dev/null
# ENTORNO: la imagen local trae el auth.uid() antiguo; las pruebas fijan las dos claves del JWT.

lectura() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -q -v ON_ERROR_STOP=1 -At -F '|' < "$1"; }
todos_ok() { for c in $2; do e="$(echo "$1" | awk -F'|' -v o="$c" '$1 == o { print $5 }')"; [ "$e" = OK ] || { fallo "$3 control $c = ${e:-∅}"; return; }; done; ok "$3: controles $2 en OK"; }
campo() { echo "$1" | awk -F'|' -v o="$2" '$1 == o { print $3 }'; }

echo "--- preflight 295"
PRE="$(lectura supabase/scripts/preflight_295_grupos_dias_propuesta.sql)"; echo "$PRE"
todos_ok "$PRE" "1 2 3 4 5 6 7 8" "preflight"
echo "--- 295"
$SQL -d "$DB" < supabase/migrations/20260601000295_grupos_dias_propuesta.sql >/dev/null 2>&1 && ok "295 aplicada" || fallo "295 no se aplicó"
POST="$(lectura supabase/scripts/postcheck_295_grupos_dias_propuesta.sql)"; echo "$POST"
todos_ok "$POST" "1 2 3 4 5 6 7 8 9 10 11" "postcheck"
[ "$(campo "$POST" 12)" = "$(campo "$PRE" 10)" ] && ok "huella de tarifas idéntica antes y después" || fallo "la huella de tarifas cambió"
$SQL -d "$DB" < supabase/migrations/20260601000295_grupos_dias_propuesta.sql >/dev/null 2>&1 && ok "la 295 se reaplica sin error" || fallo "la 295 no es reaplicable"

$SQL -d "$DB" < supabase/scripts/fixture_295_grupos_dias_propuesta.sql >/dev/null
echo "--- pruebas SQL"
if SALIDA="$($SQL -d "$DB" < supabase/scripts/test_295_grupos_dias_propuesta.sql 2>&1)"; then
  echo "$SALIDA" | sed -n 's/.*NOTICE:  //p'; ok "pruebas SQL: $(echo "$SALIDA" | grep -c 'NOTICE:  OK') aserciones"
else
  echo "$SALIDA" | sed -n 's/.*\(NOTICE\|ERROR\):  //p' | tail -15; fallo "pruebas SQL"
fi

echo "--- rollback protegido"
N="$($SQL -d "$DB" -At -c "select count(*) from public.hotel_grupo_tarifa_propuesta")"
[ "$N" -gt 0 ] && ok "hay $N propuesta(s) antes del rollback" || fallo "no quedaron propuestas para probar el rollback"
if $SQL -d "$DB" < supabase/scripts/rollback_295_grupos_dias_propuesta.sql >/dev/null 2>&1; then fallo "el rollback corrió con propuestas"
else [ "$($SQL -d "$DB" -At -c "select count(*) from public.hotel_grupo_tarifa_propuesta")" = "$N" ] && ok "rollback abortado con propuestas: nada se borró" || fallo "el rollback abortado tocó datos"; fi
$SQL -d "$DB" -c "delete from public.hotel_grupo_tarifa_propuesta" >/dev/null
H_ANTES="$(campo "$(lectura supabase/scripts/postcheck_295_grupos_dias_propuesta.sql)" 12)"
$SQL -d "$DB" < supabase/scripts/rollback_295_grupos_dias_propuesta.sql >/dev/null && ok "rollback sin propuestas corre" || fallo "rollback sin propuestas"
PRE2="$(lectura supabase/scripts/preflight_295_grupos_dias_propuesta.sql)"
todos_ok "$PRE2" "1 3 4 5 6 7 8" "tras el rollback (esquema como antes de la 295; la 293 intacta)"
[ "$(campo "$PRE2" 10)" = "$H_ANTES" ] && ok "el rollback no altera ninguna tarifa" || fallo "huella tras rollback distinta"
$SQL -d "$DB" < supabase/migrations/20260601000295_grupos_dias_propuesta.sql >/dev/null 2>&1
todos_ok "$(lectura supabase/scripts/postcheck_295_grupos_dias_propuesta.sql)" "1 2 3 4 5 6 7 8 9 10 11" "postcheck tras reaplicar"

echo "=== $FALLOS fallo(s)"
[ "$FALLOS" -eq 0 ]
