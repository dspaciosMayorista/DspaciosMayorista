#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL de la migración 298 (#43/#60 3b, parámetros por grupo). NUNCA contra una base real.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_298_calculadora_grupos_generales.sh <contenedor> <plantilla>
# Estado de Producción: 293 + 295 + 297 (con fixtures) y BASES GUARDADAS CON LA 297 antes de la 298 →
# preflight 298 → 298 → postcheck (huellas idénticas) → reaplicar → pruebas SQL → rollback protegido →
# rollback → preflight → reaplicar → postcheck.
# ─────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; DB="t298_$$"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
SQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
trap '$SQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
$SQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$SQL -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for f in supabase/migrations/20260601000293_vigencia_grupos_dias_inactivos.sql supabase/scripts/fixture_293_vigencia_grupos_dias.sql \
         supabase/migrations/20260601000295_grupos_dias_propuesta.sql supabase/scripts/fixture_295_grupos_dias_propuesta.sql \
         supabase/migrations/20260601000297_calculadora_grupos_dias.sql supabase/scripts/fixture_297_calculadora_grupos_dias.sql \
         supabase/scripts/fixture_298_calculadora_grupos_generales.sql; do
  $SQL -d "$DB" < "$f" >/dev/null 2>&1 || { echo "No se pudo cargar $f"; exit 2; }
done
# Bases de Semana guardadas CON LA 297 (como estarán en Producción antes de aplicar la 298).
$SQL -d "$DB" >/dev/null <<'EOF'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
set role authenticated;
select public.grupos_dias_guardar_calculadora(930101, public.grupos_dias_config(930101)->>'huella', '00000000-0000-4000-8000-0000000c0001', 'dubai',
  (select version from public.hotel_calculadora where hotel_id = 9301), null, '[{"categoria":"Estándar","precio":100000}]'::jsonb,
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","tipo_habitacion":"Estándar","alimentacion":"PAM","neto_doble":100000}]'::jsonb);
EOF

lectura() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -q -v ON_ERROR_STOP=1 -At -F '|' < "$1"; }
todos_ok() { for c in $2; do e="$(echo "$1" | awk -F'|' -v o="$c" '$1 == o { print $5 }')"; [ "$e" = OK ] || { fallo "$3 control $c = ${e:-∅}"; return; }; done; ok "$3: controles $2 en OK"; }
campo() { echo "$1" | awk -F'|' -v o="$2" '$1 == o { print $3 }'; }
PREF=supabase/scripts/preflight_298_calculadora_grupos_generales.sql
POSTC=supabase/scripts/postcheck_298_calculadora_grupos_generales.sql
MIG=supabase/migrations/20260601000298_calculadora_grupos_generales.sql

echo "--- preflight 298"
PRE="$(lectura $PREF)"; echo "$PRE"
todos_ok "$PRE" "1 2 3 4 5 6" "preflight"
[ "$(campo "$PRE" 10)" = 1 ] && ok "hay bases guardadas con la 297 antes de la 298" || fallo "no hay bases previas para probar compatibilidad"
$SQL -d "$DB" < $MIG >/dev/null 2>&1 && ok "298 aplicada" || fallo "298 no se aplicó"
POST="$(lectura $POSTC)"; echo "$POST"
todos_ok "$POST" "1 2 3 4 5 6 7 8 9 10" "postcheck"
for par in "11 7" "12 8" "13 9" "14 10"; do
  set -- $par
  [ "$(campo "$POST" "$1")" = "$(campo "$PRE" "$2")" ] && ok "postcheck $1 = preflight $2 (sin cambios de datos)" || fallo "postcheck $1 distinto del preflight $2"
done
$SQL -d "$DB" < $MIG >/dev/null 2>&1 && ok "la 298 se reaplica sin error" || fallo "la 298 no es reaplicable"

echo "--- pruebas SQL"
if SALIDA="$($SQL -d "$DB" < supabase/scripts/test_298_calculadora_grupos_generales.sql 2>&1)"; then
  echo "$SALIDA" | sed -n 's/.*NOTICE:  //p'; ok "pruebas SQL: $(echo "$SALIDA" | grep -c 'NOTICE:  OK') aserciones"
else
  echo "$SALIDA" | sed -n 's/.*\(NOTICE\|ERROR\):  //p' | tail -15; fallo "pruebas SQL"
fi

echo "--- rollback protegido"
if $SQL -d "$DB" < supabase/scripts/rollback_298_calculadora_grupos_generales.sql >/dev/null 2>&1; then fallo "el rollback corrió con parámetros propios"
else ok "rollback abortado con parámetros propios"; fi
$SQL -d "$DB" -c "update public.hotel_calculadora_grupo_bases set generales = null" >/dev/null
$SQL -d "$DB" < supabase/scripts/rollback_298_calculadora_grupos_generales.sql >/dev/null && ok "rollback sin parámetros propios corre" || fallo "rollback"
todos_ok "$(lectura $PREF)" "1 2 3 4 5 6" "tras el rollback (esquema como la 297; 293/295/297 intactas)"
$SQL -d "$DB" < $MIG >/dev/null 2>&1
todos_ok "$(lectura $POSTC)" "1 2 3 4 5 6 7 8 9 10" "postcheck tras reaplicar"
echo "=== $FALLOS fallo(s)"
[ "$FALLOS" -eq 0 ]
