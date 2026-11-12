#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL de la migración 297 (#43/#60 entrega 3b). NUNCA contra una base real.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_297_calculadora_grupos_dias.sh <contenedor> <plantilla>
#   <plantilla>: esquema equivalente a Producción SIN la 293 (p. ej. plantilla_prod287); el script aplica
#   293 + fixture_293 + 295 + fixture_295 (estado de Producción) → preflight 297 → 297 → postcheck (mismas
#   huellas) → reaplicar → fixture_297 → pruebas SQL → rollback protegido (aborta con bases) → rollback →
#   preflight (esquema como antes) → reaplicar → postcheck.
# ─────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; DB="t297_$$"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
SQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
trap '$SQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT

$SQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$SQL -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for f in supabase/migrations/20260601000293_vigencia_grupos_dias_inactivos.sql supabase/scripts/fixture_293_vigencia_grupos_dias.sql \
         supabase/migrations/20260601000295_grupos_dias_propuesta.sql supabase/scripts/fixture_295_grupos_dias_propuesta.sql; do
  $SQL -d "$DB" < "$f" >/dev/null 2>&1 || { echo "No se pudo cargar $f"; exit 2; }
done

lectura() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -q -v ON_ERROR_STOP=1 -At -F '|' < "$1"; }
todos_ok() { for c in $2; do e="$(echo "$1" | awk -F'|' -v o="$c" '$1 == o { print $5 }')"; [ "$e" = OK ] || { fallo "$3 control $c = ${e:-∅}"; return; }; done; ok "$3: controles $2 en OK"; }
campo() { echo "$1" | awk -F'|' -v o="$2" '$1 == o { print $3 }'; }
PREF=supabase/scripts/preflight_297_calculadora_grupos_dias.sql
POSTC=supabase/scripts/postcheck_297_calculadora_grupos_dias.sql
MIG=supabase/migrations/20260601000297_calculadora_grupos_dias.sql

echo "--- preflight 297"
PRE="$(lectura $PREF)"; echo "$PRE"
todos_ok "$PRE" "1 2 3 4 5 6 7 8" "preflight"
echo "--- 297"
$SQL -d "$DB" < $MIG >/dev/null 2>&1 && ok "297 aplicada" || fallo "297 no se aplicó"
POST="$(lectura $POSTC)"; echo "$POST"
todos_ok "$POST" "1 2 3 4 5 6 7 8 9 10 11" "postcheck"
for par in "12 9" "13 10" "14 11" "15 12"; do
  set -- $par
  [ "$(campo "$POST" "$1")" = "$(campo "$PRE" "$2")" ] && ok "postcheck $1 = preflight $2 (sin cambios de datos)" || fallo "postcheck $1 distinto del preflight $2"
done
$SQL -d "$DB" < $MIG >/dev/null 2>&1 && ok "la 297 se reaplica sin error" || fallo "la 297 no es reaplicable"

$SQL -d "$DB" < supabase/scripts/fixture_297_calculadora_grupos_dias.sql >/dev/null
echo "--- pruebas SQL"
if SALIDA="$($SQL -d "$DB" < supabase/scripts/test_297_calculadora_grupos_dias.sql 2>&1)"; then
  echo "$SALIDA" | sed -n 's/.*NOTICE:  //p'; ok "pruebas SQL: $(echo "$SALIDA" | grep -c 'NOTICE:  OK') aserciones"
else
  echo "$SALIDA" | sed -n 's/.*\(NOTICE\|ERROR\):  //p' | tail -15; fallo "pruebas SQL"
fi

echo "--- rollback protegido"
N="$($SQL -d "$DB" -At -c "select count(*) from public.hotel_calculadora_grupo_bases")"
[ "$N" -gt 0 ] && ok "hay $N fila(s) de bases antes del rollback" || fallo "no quedaron bases para probar el rollback"
if $SQL -d "$DB" < supabase/scripts/rollback_297_calculadora_grupos_dias.sql >/dev/null 2>&1; then fallo "el rollback corrió con bases"
else [ "$($SQL -d "$DB" -At -c "select count(*) from public.hotel_calculadora_grupo_bases")" = "$N" ] && ok "rollback abortado con bases: nada se borró" || fallo "el rollback abortado tocó datos"; fi
$SQL -d "$DB" -c "delete from public.hotel_calculadora_grupo_bases" >/dev/null
H_ANTES="$(lectura $POSTC)"
$SQL -d "$DB" < supabase/scripts/rollback_297_calculadora_grupos_dias.sql >/dev/null && ok "rollback sin bases corre" || fallo "rollback sin bases"
PRE2="$(lectura $PREF)"
todos_ok "$PRE2" "1 2 3 4 5 6 7 8" "tras el rollback (esquema como antes de la 297; 293 y 295 intactas)"
for par in "9 12" "10 13" "11 14"; do
  set -- $par
  [ "$(campo "$PRE2" "$1")" = "$(campo "$H_ANTES" "$2")" ] && ok "el rollback no altera datos (preflight $1)" || fallo "datos distintos tras el rollback (preflight $1)"
done
$SQL -d "$DB" < $MIG >/dev/null 2>&1
todos_ok "$(lectura $POSTC)" "1 2 3 4 5 6 7 8 9 10 11" "postcheck tras reaplicar"

echo "=== $FALLOS fallo(s)"
[ "$FALLOS" -eq 0 ]
