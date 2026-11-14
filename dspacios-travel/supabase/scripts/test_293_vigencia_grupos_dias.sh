#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL de la migración 293 (#43/#60 incremento 1). NUNCA contra una base real.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_293_vigencia_grupos_dias.sh <contenedor> <plantilla>
#   <contenedor>: Postgres local con imagen de Supabase (p. ej. pg4360).
#   <plantilla>:  base con el esquema completo hasta la 283 o posterior (p. ej. base4360).
# Crea una base desechable desde la plantilla, la borra al final. Pasos:
#   fixture → preflight (OK + huella) → 293 → postcheck (OK + misma huella) → pruebas SQL
#   → rollback protegido (aborta con un grupo; corre sin grupos) → huella igual → reaplicar → postcheck.
# ─────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; DB="t293_$$"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
ADMIN="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
# La plantilla local se construyó como supabase_admin (dueño de todas las tablas); la 293 y las pruebas
# corren con ese mismo dueño. En Supabase corre como postgres, dueño allí de las tablas.
PSQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -d $DB -X -q -v ON_ERROR_STOP=1"
trap '$ADMIN -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT

$ADMIN -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for f in fixture_293_vigencia_grupos_dias.sql preflight_293_vigencia_grupos_dias.sql postcheck_293_vigencia_grupos_dias.sql \
         rollback_293_vigencia_grupos_dias.sql test_293_vigencia_grupos_dias.sql; do
  docker cp "supabase/scripts/$f" "$CT:/tmp/$f"
done
docker cp supabase/migrations/20260601000293_vigencia_grupos_dias_inactivos.sql "$CT:/tmp/m293.sql"

$ADMIN -d "$DB" -f /tmp/fixture_293_vigencia_grupos_dias.sql >/dev/null

lectura() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$CT" psql -U postgres -d "$DB" -X -q -v ON_ERROR_STOP=1 -At -F '|' -f "/tmp/$1"; }
todos_ok() { # salida, controles que deben ser OK
  for c in $2; do
    e="$(echo "$1" | awk -F'|' -v o="$c" '$1 == o { print $5 }')"
    [ "$e" = "OK" ] || { fallo "$3 control $c = ${e:-∅}"; return; }
  done
  ok "$3: controles $2 en OK"
}
campo() { echo "$1" | awk -F'|' -v o="$2" '$1 == o { print $3 }'; }

echo "--- preflight"
PRE="$(lectura preflight_293_vigencia_grupos_dias.sql)"; echo "$PRE"
todos_ok "$PRE" "1 2 3 4 5 6 7 8 9" "preflight"
[ "$(echo "$PRE" | wc -l)" -eq 13 ] && ok "preflight devuelve 13 filas en una sola consulta" || fallo "preflight: número de filas"
H_PRE="$(campo "$PRE" 11)"; N_PRE="$(campo "$PRE" 10)"

echo "--- migración 293"
$PSQL -f /tmp/m293.sql
echo "--- postcheck"
POST="$(lectura postcheck_293_vigencia_grupos_dias.sql)"; echo "$POST"
todos_ok "$POST" "1 2 3 4 5 6 7 8 9 10 11" "postcheck"
[ "$(campo "$POST" 13)" = "$H_PRE" ] && ok "huella de tarifas idéntica antes y después (ningún dato cambió)" || fallo "la huella de tarifas cambió"
[ "$(campo "$POST" 12)" = "$N_PRE" ] && ok "mismo número de tarifas" || fallo "cambió el número de tarifas"
PRE2="$(lectura preflight_293_vigencia_grupos_dias.sql)"
[ "$(echo "$PRE2" | awk -F'|' '$1==5 {print $5}')" != "OK" ] && ok "preflight detecta la migración ya aplicada" || fallo "preflight no detecta la 293 aplicada"

echo "--- reaplicar la 293 (idempotente)"
$PSQL -f /tmp/m293.sql && ok "la 293 se reaplica sin error" || fallo "la 293 no es reaplicable"

echo "--- pruebas de controles, inactividad, historial, compatibilidad y permisos"
if SALIDA="$($PSQL -f /tmp/test_293_vigencia_grupos_dias.sql 2>&1)"; then
  echo "$SALIDA" | sed -n 's/.*NOTICE:  //p'
  ok "pruebas SQL: $(echo "$SALIDA" | grep -c 'NOTICE:  OK') aserciones"
else
  echo "$SALIDA" | sed -n 's/.*\(NOTICE\|ERROR\):  //p' | tail -15; fallo "pruebas SQL"
fi

echo "--- rollback protegido"
H_ANTES_RB="$(campo "$(lectura postcheck_293_vigencia_grupos_dias.sql)" 13)"
N_ANTES="$($PSQL -At -c "select count(*) from public.hotel_temporada_grupos")"
[ "$N_ANTES" -gt 0 ] && ok "hay $N_ANTES grupo(s) antes de intentar el rollback" || fallo "no hay grupos para probar el rollback protegido"
if $PSQL -f /tmp/rollback_293_vigencia_grupos_dias.sql >/dev/null 2>&1; then fallo "el rollback corrió con grupos existentes"
else
  [ "$($PSQL -At -c "select count(*) from public.hotel_temporada_grupos")" = "$N_ANTES" ] \
    && [ -n "$($PSQL -At -c "select 1 from information_schema.columns where table_name = 'tarifa_hotel' and column_name = 'grupo_id'")" ] \
    && ok "rollback abortado con grupos: nada se borró ni se quitó" || fallo "el rollback abortado tocó datos o esquema"
fi
$PSQL -c "delete from public.hotel_temporada_grupos"
$PSQL -f /tmp/rollback_293_vigencia_grupos_dias.sql && ok "rollback sin grupos corre" || fallo "rollback sin grupos"
PRE3="$(lectura preflight_293_vigencia_grupos_dias.sql)"
todos_ok "$PRE3" "5 6 7 8" "tras el rollback (esquema como antes)"
# Las pruebas G regeneran tarifas del hotel 9303; se compara con la huella justo antes del rollback.
[ "$(campo "$PRE3" 11)" = "$H_ANTES_RB" ] && ok "el rollback no altera ninguna tarifa (huella igual a la previa al rollback)" || fallo "huella tras rollback distinta"
[ "$($PSQL -At -c "select count(*) from public.tarifa_hotel_historial where datos ? 'grupo_id'")" -gt 0 ] && ok "el historial con grupo_id se conserva tras el rollback" || fallo "el rollback tocó el historial"

echo "--- reaplicar tras el rollback"
$PSQL -f /tmp/m293.sql
POST2="$(lectura postcheck_293_vigencia_grupos_dias.sql)"
todos_ok "$POST2" "1 2 3 4 5 6 7 8 9 10 11" "postcheck tras reaplicar"

echo "=== $FALLOS fallo(s)"
[ "$FALLOS" -eq 0 ]
