#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL de la migración 299 (#43/#60 entrega 3c). NUNCA contra una base real.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_299_grupos_dias_activacion.sh <contenedor> <plantilla> [con298]
#   <plantilla>: esquema equivalente a Producción CON la 293 y sin la 295 (p. ej. local4360_base en pg4360).
#   Aplica fixture_293 + 295 + fixture_295 + 297 + fixture_297 (+ 298 si se pide) → preflight 299 → 299 →
#   postcheck (mismas huellas) → reaplicar → fixture_299 → pruebas SQL → rollback protegido (aborta con grupos
#   activos) → volver a «todos los días» → rollback → reaplicar → postcheck.
# ─────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; CON298="${3:-}"; DB="t299_$$"
FALLOS=0
SCRATCH299="$(mktemp)"
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
SQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
T=t299r_$$
trap '$SQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1; $SQL -d postgres -c "drop database if exists $T" >/dev/null 2>&1 || true' EXIT

$SQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$SQL -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
CARGA="supabase/scripts/fixture_293_vigencia_grupos_dias.sql supabase/migrations/20260601000295_grupos_dias_propuesta.sql
       supabase/scripts/fixture_295_grupos_dias_propuesta.sql supabase/migrations/20260601000297_calculadora_grupos_dias.sql
       supabase/scripts/fixture_297_calculadora_grupos_dias.sql"
[ -n "$CON298" ] && CARGA="$CARGA supabase/migrations/20260601000298_calculadora_grupos_generales.sql"
for f in $CARGA; do
  $SQL -d "$DB" < "$f" >/dev/null 2>&1 || { echo "No se pudo cargar $f"; exit 2; }
done
[ -n "$CON298" ] && echo "(con la 298 aplicada antes)"

lectura() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -q -v ON_ERROR_STOP=1 -At -F '|' < "$1"; }
todos_ok() { for c in $2; do e="$(echo "$1" | awk -F'|' -v o="$c" '$1 == o { print $5 }')"; [ "$e" = OK ] || { fallo "$3 control $c = ${e:-∅}"; return; }; done; ok "$3: controles $2 en OK"; }
campo() { echo "$1" | awk -F'|' -v o="$2" '$1 == o { print $3 }'; }
PREF=supabase/scripts/preflight_299_grupos_dias_activacion.sql
POSTC=supabase/scripts/postcheck_299_grupos_dias_activacion.sql
MIG=supabase/migrations/20260601000299_grupos_dias_activacion.sql
ROLL=supabase/scripts/rollback_299_grupos_dias_activacion.sql

echo "--- preflight 299"
PRE="$(lectura $PREF)"; echo "$PRE"
todos_ok "$PRE" "1 2 3 4 5 6 7" "preflight"
echo "--- 299"
$SQL -d "$DB" < $MIG >/dev/null 2>&1 && ok "299 aplicada" || fallo "299 no se aplicó"
POST="$(lectura $POSTC)"; echo "$POST"
todos_ok "$POST" "1 2 3 4 5 6 7 8 9 10" "postcheck"
for par in "13 8" "14 9" "15 10"; do
  set -- $par
  [ "$(campo "$POST" "$1")" = "$(campo "$PRE" "$2")" ] && ok "postcheck $1 = preflight $2 (sin cambios de datos)" || fallo "postcheck $1 distinto del preflight $2"
done
$SQL -d "$DB" < $MIG >/dev/null 2>&1 && ok "la 299 se reaplica sin error" || fallo "la 299 no es reaplicable"

$SQL -d "$DB" < supabase/scripts/fixture_299_grupos_dias_activacion.sql >/dev/null
echo "--- pruebas SQL"
if SALIDA="$($SQL -d "$DB" < supabase/scripts/test_299_grupos_dias_activacion.sql 2>&1)"; then
  echo "$SALIDA" | sed -n 's/.*NOTICE:  //p'; ok "pruebas SQL: $(echo "$SALIDA" | grep -c 'NOTICE:  OK') aserciones"
else
  echo "$SALIDA" | sed -n 's/.*\(NOTICE\|ERROR\):  //p' | tail -15; fallo "pruebas SQL"
fi

echo "--- rollback protegido"
CLAIMS="select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-4000-8000-000000009302\",\"session_id\":\"00000000-0000-4000-8000-00000000a302\",\"role\":\"authenticated\"}', false), set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);"
$SQL -d "$DB" >/dev/null <<EOF || true
$CLAIMS
select public.grupos_dias_activar(930101, public._grupos_43_config(930101)->>'huella', public._grupos_43_habilitaciones(930101));
EOF
N="$($SQL -d "$DB" -At -c "select count(*) from public.hotel_temporada_grupos where activo")"
[ "$N" -gt 0 ] && ok "hay $N grupo(s) activo(s) antes del rollback" || fallo "no quedaron grupos activos para probar el rollback"
# Transacción del CLIENTE con sentencias separadas: escritura válida → comprobada → escritura con empate → COMMIT.
HV="$($SQL -d "$DB" -At -c "select md5(string_agg(to_jsonb(t)::text, E'\n' order by t.id)) from public.hotel_temporadas t")"
SAL="$(printf 'begin;\nupdate public.hotel_temporadas set prioridad = 3 where id = 930106;\nset constraints all immediate;\nupdate public.hotel_temporadas set prioridad = 1 where id = 930106;\ncommit;\n' | docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -q 2>&1)"
echo "$SAL" | grep -q EMPATE_PRIORIDAD && [ "$($SQL -d "$DB" -At -c "select md5(string_agg(to_jsonb(t)::text, E'\n' order by t.id)) from public.hotel_temporadas t")" = "$HV" ] \
  && ok "transacción del cliente: la 2ª escritura con empate tras una comprobación se rechaza y no queda nada (tampoco la 1ª)" \
  || fallo "transacción del cliente con empate tras comprobar: $(echo "$SAL" | grep -m1 ERROR)"
H1="$($SQL -d "$DB" -At -c "select md5(string_agg(to_jsonb(t)::text, E'\n' order by t.id)) from public.tarifa_hotel t")"
if $SQL -d "$DB" < $ROLL >/dev/null 2>&1; then fallo "el rollback corrió con grupos activos"
else [ "$($SQL -d "$DB" -At -c "select md5(string_agg(to_jsonb(t)::text, E'\n' order by t.id)) from public.tarifa_hotel t")" = "$H1" ] \
       && ok "rollback abortado con grupos activos: nada cambió" || fallo "el rollback abortado tocó datos"; fi
$SQL -d "$DB" >/dev/null <<EOF || true
$CLAIMS
select public.grupos_dias_volver_todos(930101, public._grupos_43_config(930101)->>'huella',
  (select jsonb_agg(distinct jsonb_build_object('tipo_habitacion', tipo_habitacion, 'alimentacion', alimentacion, 'grupo_id', grupo_id))
     from public.tarifa_hotel where grupo_id = '00000000-0000-4000-8000-0000000c0001'));
EOF
H2="$($SQL -d "$DB" -At -c "select md5(string_agg(to_jsonb(t)::text, E'\n' order by t.id)) from public.tarifa_hotel t")"
$SQL -d "$DB" < $ROLL >/dev/null 2>&1 && ok "rollback aplicado (sin grupos activos)" || fallo "el rollback no se aplicó"
[ "$($SQL -d "$DB" -At -c "select md5(string_agg(to_jsonb(t)::text, E'\n' order by t.id)) from public.tarifa_hotel t")" = "$H2" ] \
  && ok "el rollback no cambió tarifas" || fallo "el rollback cambió tarifas"
R="$(lectura $PREF)"
todos_ok "$R" "1 2 3 4 5 6 7" "preflight tras el rollback (esquema como antes)"
# Las funciones restauradas son LITERALMENTE las originales (295, 297, 237): se comparan con una base sin la 299.
FN="'_grupos_43_config','_grupos_43_bloquear_y_comparar','grupos_dias_guardar','grupos_dias_borrar','grupos_dias_guardar_calculadora','generar_tarifas_hotel_calculadora'"
Q="select md5(string_agg(proname || ':' || prosrc || ':' || provolatile::text || ':' || prosecdef::text, E'\n' order by proname)) from pg_proc where pronamespace = 'public'::regnamespace and proname in ($FN)"
$SQL -d postgres -c "create database $T template $PLANTILLA" >/dev/null
for f in $CARGA; do $SQL -d $T < $f >/dev/null 2>&1; done
QD="select proname || '=' || md5(prosrc || ':' || provolatile::text || ':' || prosecdef::text) from pg_proc where pronamespace = 'public'::regnamespace and proname in ($FN) order by proname"
ORIG="$($SQL -d $T -At -c "$Q")"; ORIGD="$($SQL -d $T -At -c "$QD")"; $SQL -d postgres -c "drop database $T" >/dev/null
[ "$($SQL -d "$DB" -At -c "$Q")" = "$ORIG" ] && ok "rollback: las 6 funciones redefinidas son idénticas a las originales" \
  || { fallo "rollback: alguna función restaurada difiere de la original"; echo "$ORIGD" > "$SCRATCH299.orig"; $SQL -d "$DB" -At -c "$QD" | diff "$SCRATCH299.orig" - | sed 's/^/      /'; }
$SQL -d "$DB" < $MIG >/dev/null 2>&1 && ok "299 reaplicada tras el rollback" || fallo "299 no se reaplicó tras el rollback"
POST2="$(lectura $POSTC)"
todos_ok "$POST2" "1 2 3 4 5 6 7 8 9 10" "postcheck tras reaplicar"

echo "=== $FALLOS fallo(s)"
exit $FALLOS
