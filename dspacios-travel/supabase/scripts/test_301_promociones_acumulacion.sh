#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL de la migración 301 (#43/#60 entrega 5). NUNCA contra una base real.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_301_promociones_acumulacion.sh <contenedor> <plantilla>
#   Cadena de la 300 (fixtures 293/295/297 + 299 + fixture_299 + 300) + fixture_301 → preflight 301 → 301 → postcheck
#   (mismas huellas) → reaplicar → pruebas SQL → rollback protegido (aborta con configuraciones) → limpiar → rollback →
#   reaplicar → postcheck.
# ─────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; DB="t301_$$"
FALLOS=0
SCRATCH_P3="$(mktemp -d)"
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
SQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
trap '$SQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT

$SQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$SQL -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for f in supabase/scripts/fixture_293_vigencia_grupos_dias.sql supabase/migrations/20260601000295_grupos_dias_propuesta.sql \
         supabase/scripts/fixture_295_grupos_dias_propuesta.sql supabase/migrations/20260601000297_calculadora_grupos_dias.sql \
         supabase/scripts/fixture_297_calculadora_grupos_dias.sql supabase/migrations/20260601000299_grupos_dias_activacion.sql \
         supabase/scripts/fixture_299_grupos_dias_activacion.sql supabase/migrations/20260601000300_promociones_grupo.sql \
         supabase/scripts/fixture_301_promociones_acumulacion.sql; do
  $SQL -d "$DB" < "$f" >/dev/null 2>&1 || { echo "No se pudo cargar $f"; exit 2; }
done

lectura() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -q -v ON_ERROR_STOP=1 -At -F '|' < "$1"; }
todos_ok() { for c in $2; do e="$(echo "$1" | awk -F'|' -v o="$c" '$1 == o { print $5 }')"; [ "$e" = OK ] || { fallo "$3 control $c = ${e:-∅}"; return; }; done; ok "$3: controles $2 en OK"; }
campo() { echo "$1" | awk -F'|' -v o="$2" '$1 == o { print $3 }'; }
MIG=supabase/migrations/20260601000301_promociones_acumulacion.sql
ROLL=supabase/scripts/rollback_301_promociones_acumulacion.sql

echo "--- preflight 301"
PRE="$(lectura supabase/scripts/preflight_301_promociones_acumulacion.sql)"; echo "$PRE"
todos_ok "$PRE" "1 2 3 4" "preflight"
echo "--- 301"
if ERR="$($SQL -d "$DB" < $MIG 2>&1)"; then ok "301 aplicada"; else echo "$ERR" | tail -5; fallo "301 no se aplicó"; exit 1; fi
POST="$(lectura supabase/scripts/postcheck_301_promociones_acumulacion.sql)"; echo "$POST"
todos_ok "$POST" "1 2 3 4 5 6 7 11" "postcheck"
[ "$(campo "$POST" 9)" = "$(campo "$PRE" 5)" ] && ok "reglas idénticas (sin las columnas nuevas)" || fallo "las reglas cambiaron"
[ "$(campo "$POST" 10)" = "$(campo "$PRE" 6)" ] && ok "vigencias idénticas" || fallo "las vigencias cambiaron"
[ "$(campo "$POST" 8)" -ge 1 ] && ok "línea base: $(campo "$POST" 8) promoción(es) heredada(s)" || fallo "la promoción que coincidía no quedó heredada"
$SQL -d "$DB" < $MIG >/dev/null 2>&1 && ok "la 301 se reaplica sin error" || fallo "la 301 no es reaplicable"

echo "--- pruebas SQL"
if SALIDA="$($SQL -d "$DB" < supabase/scripts/test_301_promociones_acumulacion.sql 2>&1)"; then
  echo "$SALIDA" | sed -n 's/.*NOTICE:  //p'; ok "pruebas SQL: $(echo "$SALIDA" | grep -c 'NOTICE:  OK') aserciones"
else
  echo "$SALIDA" | sed -n 's/.*\(NOTICE\|ERROR\):  //p' | tail -15; echo "$SALIDA" | grep -v NOTICE | tail -4; fallo "pruebas SQL"
fi

echo "--- P3 con sesiones reales: el pendiente persiste, se reabre en otra sesión y la activación es atómica frente a la concurrencia"
SES="select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-4000-8000-000000009302\",\"session_id\":\"00000000-0000-4000-8000-00000000a302\",\"role\":\"authenticated\"}', false); set role authenticated;"
COMB='{"acumulable":{"ebb":true,"long_stay":true},"orden":["promocion","ebb","long_stay"]}'
$SQL -d "$DB" -c "insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, compra_inicio, compra_fin, regimen_restringido) values
  (930520, 9305, 'P3 TRES', '2027-06-01', '2027-06-30', 10, 'descuento_pct', 6, '2026-01-01', '2026-02-01', 'K3'),
  (930521, 9305, 'P3 CUATRO', '2027-06-01', '2027-06-30', 11, 'descuento_pct', 6, '2026-01-01', '2026-02-01', 'K4')" >/dev/null
for p in 930520 930521; do $SQL -d "$DB" -At -c "$SES select public.promocion_cambio_proponer($p, '{\"compra_fin\":\"2027-05-31\"}')->>'estado'" | grep -qx pendiente \
  && ok "P3 $p: pendiente guardado (sesión cerrada)" || fallo "P3 $p: no quedó pendiente"; done
V="$($SQL -d "$DB" -At -c "$SES select string_agg((x->>'promocion_id') || ':' || (x->'cambio_pendiente'->'cambios'->>'compra_fin'), ',' order by x->>'promocion_id') from jsonb_array_elements(public.promociones_combinacion_estado(9305)) x where x ? 'cambio_pendiente' and x->'cambio_pendiente' <> 'null'" | tail -1)"
[ "$V" = "930520:2027-05-31,930521:2027-05-31" ] && ok "P3 al reabrir (otra sesión) los pendientes siguen disponibles: $V" || fallo "P3 reabrir: $V"
[ "$($SQL -d "$DB" -At -c "select compra_fin from public.hotel_temporadas where id = 930520")" = 2026-02-01 ] && ok "P3 la versión autorizada sigue vigente" || fallo "P3 la versión autorizada cambió"
# Dos activaciones simultáneas del mismo pendiente: A la retiene 2 s antes de confirmar; B espera el candado y debe ver que ya no está pendiente.
A="$SCRATCH_P3/a.txt"; B="$SCRATCH_P3/b.txt"
( $SQL -d "$DB" -At -c "begin; $SES select public.promocion_cambio_activar(930520, '$COMB')->>'estado'; select pg_sleep(2); commit;" >"$A" 2>&1 ) &
sleep 0.7
$SQL -d "$DB" -At -c "$SES select public.promocion_cambio_activar(930520, '$COMB')->>'estado'" >"$B" 2>&1 || true
wait
grep -qx configurada "$A" && grep -q CAMBIO_NO_PENDIENTE "$B" && ok "P3 dos activaciones simultáneas: una aplica, la otra se rechaza ($(grep -o 'CAMBIO_NO_PENDIENTE' "$B"))" \
  || { cat "$A" "$B"; fallo "P3 activaciones simultáneas"; }
[ "$($SQL -d "$DB" -At -c "select t.compra_fin || '|' || c.estado || '|' || (select count(*) from public.hotel_promocion_cambio_pendiente where promocion_id = 930520) from public.hotel_temporadas t join public.hotel_promocion_combinacion c on c.promocion_id = t.id where t.id = 930520")" = "2027-05-31|configurada|0" ] \
  && ok "P3 aplicado una sola vez" || fallo "P3 estado final tras la carrera"
# Edición directa de la versión vendida mientras otra sesión activa: la activación espera y se rechaza por cambio concurrente.
( $SQL -d "$DB" -At -c "begin; update public.hotel_temporadas set descuento_valor = 4 where id = 930521; select pg_sleep(2); commit;" >"$A" 2>&1 ) &
sleep 0.7
$SQL -d "$DB" -At -c "$SES select public.promocion_cambio_activar(930521, '$COMB')->>'estado'" >"$B" 2>&1 || true
wait
grep -q CAMBIO_CONCURRENTE "$B" && ok "P3 edición concurrente: la activación se rechaza (CAMBIO_CONCURRENTE)" || { cat "$A" "$B"; fallo "P3 edición concurrente"; }
[ "$($SQL -d "$DB" -At -c "select compra_fin || '|' || descuento_valor::int || '|' || (select count(*) from public.hotel_promocion_cambio_pendiente where promocion_id = 930521) from public.hotel_temporadas where id = 930521")" = "2026-02-01|4|1" ] \
  && ok "P3 nada cambió: queda la edición ajena y el pendiente para revisar" || fallo "P3 estado tras edición concurrente"

echo "--- rollback protegido"
if R="$($SQL -d "$DB" < $ROLL 2>&1)"; then fallo "el rollback NO abortó con combinaciones configuradas"; else echo "$R" | grep -o 'ROLLBACK 301 ABORTADO[^.]*' | head -1; ok "rollback abortado (protegido)"; fi
# Limpiar lo que el rollback protege: las promociones de prueba (su combinación cae en cascada) y las reglas retenidas.
$SQL -d "$DB" -c "begin; delete from public.hotel_temporadas where hotel_id = 9305 and coalesce(tipo, 'tarifa') <> 'tarifa'; delete from public.hotel_reglas_descuento where not autorizada; update public.hotel_reglas_descuento set propuesta = null where propuesta is not null; commit;" >/dev/null
if $SQL -d "$DB" < $ROLL >/dev/null 2>&1; then ok "rollback aplicado"; else fallo "rollback no se aplicó"; fi
[ "$($SQL -d "$DB" -At -c "select (to_regclass('public.hotel_promocion_combinacion') is null and (select count(*) from information_schema.columns where table_name = 'hotel_reglas_descuento' and column_name in ('autorizada','propuesta')) = 0)::text")" = true ] \
  && ok "rollback: sin tabla ni columnas de la 301" || fallo "rollback incompleto"
$SQL -d "$DB" < $MIG >/dev/null 2>&1 && ok "reaplicar tras el rollback" || fallo "no se reaplica tras el rollback"
POST2="$(lectura supabase/scripts/postcheck_301_promociones_acumulacion.sql)"
todos_ok "$POST2" "1 2 3 4 5 6 7 11" "postcheck tras reaplicar"

echo "=== $FALLOS fallo(s)"
[ "$FALLOS" -eq 0 ]
