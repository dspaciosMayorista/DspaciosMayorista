#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL de la migración 300 (#43/#60 entrega 4). NUNCA contra una base real.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_300_promociones_grupo.sh <contenedor> <plantilla>
#   <plantilla>: la misma de la 299 (p. ej. local4360_base en pg4360: Producción con la 293).
#   Carga la cadena de la 299 (fixtures 293/295/297 + 299 + fixture_299) → preflight 300 → 300 → postcheck
#   (mismas huellas) → reaplicar → pruebas SQL → rollback protegido (aborta con reglas) → limpiar → rollback →
#   reaplicar → postcheck.
# ─────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; DB="t300_$$"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
SQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
trap '$SQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT

$SQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$SQL -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for f in supabase/scripts/fixture_293_vigencia_grupos_dias.sql supabase/migrations/20260601000295_grupos_dias_propuesta.sql \
         supabase/scripts/fixture_295_grupos_dias_propuesta.sql supabase/migrations/20260601000297_calculadora_grupos_dias.sql \
         supabase/scripts/fixture_297_calculadora_grupos_dias.sql supabase/migrations/20260601000299_grupos_dias_activacion.sql \
         supabase/scripts/fixture_299_grupos_dias_activacion.sql; do
  $SQL -d "$DB" < "$f" >/dev/null 2>&1 || { echo "No se pudo cargar $f"; exit 2; }
done

lectura() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -q -v ON_ERROR_STOP=1 -At -F '|' < "$1"; }
todos_ok() { for c in $2; do e="$(echo "$1" | awk -F'|' -v o="$c" '$1 == o { print $5 }')"; [ "$e" = OK ] || { fallo "$3 control $c = ${e:-∅}"; return; }; done; ok "$3: controles $2 en OK"; }
campo() { echo "$1" | awk -F'|' -v o="$2" '$1 == o { print $3 }'; }
MIG=supabase/migrations/20260601000300_promociones_grupo.sql
ROLL=supabase/scripts/rollback_300_promociones_grupo.sql

CFG299="$($SQL -d "$DB" -At -c "select md5(prosrc || pg_get_function_result(oid)) from pg_proc where oid = 'public._grupos_43_config(bigint)'::regprocedure")"
echo "--- preflight 300"
PRE="$(lectura supabase/scripts/preflight_300_promociones_grupo.sql)"; echo "$PRE"
todos_ok "$PRE" "1 2 3 4" "preflight"
echo "--- 300"
$SQL -d "$DB" < $MIG >/dev/null 2>&1 && ok "300 aplicada" || fallo "300 no se aplicó"
POST="$(lectura supabase/scripts/postcheck_300_promociones_grupo.sql)"; echo "$POST"
todos_ok "$POST" "1 2 3 4 5 6 7 8 11" "postcheck"
[ "$(campo "$POST" 9)" = "$(campo "$PRE" 5)" ] && ok "vigencias idénticas (sin las columnas nuevas)" || fallo "las vigencias cambiaron"
[ "$(campo "$POST" 10)" = "$(campo "$PRE" 6)" ] && ok "tarifas idénticas" || fallo "las tarifas cambiaron"
$SQL -d "$DB" < $MIG >/dev/null 2>&1 && ok "la 300 se reaplica sin error" || fallo "la 300 no es reaplicable"

echo "--- pruebas SQL"
if SALIDA="$($SQL -d "$DB" < supabase/scripts/test_300_promociones_grupo.sql 2>&1)"; then
  echo "$SALIDA" | sed -n 's/.*NOTICE:  //p'; ok "pruebas SQL: $(echo "$SALIDA" | grep -c 'NOTICE:  OK') aserciones"
else
  echo "$SALIDA" | sed -n 's/.*\(NOTICE\|ERROR\):  //p' | tail -15; fallo "pruebas SQL"
fi

echo "--- concurrencia: dos sesiones guardan sobre la MISMA foto"
$SQL -d "$DB" -c "insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, promo_base_id) values (930120, 9301, 'CARRERA', '2027-01-01', '2027-01-31', 7, 'descuento_pct', 930101)" >/dev/null
CARRERA="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -d $DB -X -q"
$CARRERA -v grupo=00000000-0000-4000-8000-0000000c0001 -v valor=10 -v espera=2 < supabase/scripts/test_300_carrera.sql >/dev/null 2>&1 &
PA=$!
sleep 1
RB="$($CARRERA -v grupo=00000000-0000-4000-8000-0000000c0002 -v valor=20 -v espera=0 < supabase/scripts/test_300_carrera.sql 2>&1 || true)"
wait $PA || true
REGLAS="$($SQL -d "$DB" -At -c "select string_agg(valor::text, ',') from public.hotel_promocion_reglas where promocion_id = 930120")"
if echo "$RB" | grep -q "cambió mientras la editabas" && [ "$REGLAS" = "10.00" ]; then ok "carrera: B espera el candado de A y recibe PT409 (foto obsoleta); queda solo lo de A"
else fallo "carrera: B=[$(echo "$RB" | grep -m1 ERROR)] reglas=[$REGLAS]"; fi
$SQL -d "$DB" -c "delete from public.hotel_promocion_reglas where promocion_id = 930120; delete from public.hotel_temporadas where id = 930120" >/dev/null

echo "--- concurrencia: dos cambios que por separado no empatan y juntos sí"
$SQL -d "$DB" >/dev/null <<'EOS'
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, promo_base_id) values
  (930140, 9301, 'SESGO A', '2027-01-01', '2027-01-31', 5, 'descuento_pct', 930101),
  (930141, 9301, 'SESGO B', '2027-01-01', '2027-01-31', 6, 'descuento_pct', 930101);
insert into public.hotel_promocion_reglas (promocion_id, grupo_id, valor) values
  (930140, '00000000-0000-4000-8000-0000000c0001', 10), (930141, '00000000-0000-4000-8000-0000000c0001', 15);
EOS
$CARRERA -v id=930140 -v espera=2 < supabase/scripts/test_300_carrera_empate.sql >/dev/null 2>&1 & PA=$!
sleep 1
RB="$($CARRERA -v id=930141 -v espera=0 < supabase/scripts/test_300_carrera_empate.sql 2>&1 || true)"
wait $PA || true
N7="$($SQL -d "$DB" -At -c "select count(*) from public.hotel_temporadas where id in (930140, 930141) and prioridad = 7")"
NC="$($SQL -d "$DB" -At -c "select jsonb_array_length(public._promo_300_conflictos(930101))")"
[ "$N7" = "1" ] && [ "$NC" = "0" ] && ok "sesgo: exactamente uno confirmó y no quedó ningún conflicto guardado" || fallo "sesgo: con prioridad 7 = $N7, conflictos = $NC (B: $(echo "$RB" | grep -m1 ERROR))"
$SQL -d "$DB" -c "delete from public.hotel_promocion_reglas where promocion_id in (930140, 930141); update public.hotel_temporadas set promo_base_id = null where id in (930140, 930141); delete from public.hotel_temporadas where id in (930140, 930141)" >/dev/null

echo "--- rollback protegido"
H="$($SQL -d "$DB" -At -c "select md5(string_agg(to_jsonb(t)::text, E'\n' order by t.id)) from public.hotel_temporadas t")"
if $SQL -d "$DB" < $ROLL >/dev/null 2>&1; then fallo "el rollback corrió con promociones que usan la 300"
else [ "$($SQL -d "$DB" -At -c "select md5(string_agg(to_jsonb(t)::text, E'\n' order by t.id)) from public.hotel_temporadas t")" = "$H" ] \
       && ok "rollback abortado con reglas: nada cambió" || fallo "el rollback abortado tocó datos"; fi
$SQL -d "$DB" -c "delete from public.hotel_promocion_reglas; update public.hotel_temporadas set promo_base_id = null where promo_base_id is not null; delete from public.hotel_temporadas where id between 930110 and 930113 or id = 930410" >/dev/null
$SQL -d "$DB" < $ROLL >/dev/null 2>&1 && ok "rollback sin uso: aplicado" || fallo "rollback sin uso falló"
[ "$($SQL -d "$DB" -At -c "select md5(prosrc || pg_get_function_result(oid)) from pg_proc where oid = 'public._grupos_43_config(bigint)'::regprocedure")" = "$CFG299" ] && ok "rollback: la configuración de la 299 queda idéntica a la original" || fallo "rollback: _grupos_43_config no es la de la 299"
PRE2="$(lectura supabase/scripts/preflight_300_promociones_grupo.sql)"
todos_ok "$PRE2" "1 2 3 4" "tras el rollback el preflight vuelve a OK"
$SQL -d "$DB" < $MIG >/dev/null 2>&1 && ok "reaplicada tras el rollback" || fallo "no se reaplicó tras el rollback"
todos_ok "$(lectura supabase/scripts/postcheck_300_promociones_grupo.sql)" "1 2 3 4 5 6 7 8 11" "postcheck final"

echo "=== fallos: $FALLOS"
[ "$FALLOS" -eq 0 ]
