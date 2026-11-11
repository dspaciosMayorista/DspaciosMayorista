#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────
# PRUEBA del diagnóstico preflight_vigencias_grupos_43_60_lectura.sql
# SOLO en un contenedor Postgres LOCAL DESECHABLE (se crea y se elimina aquí; nunca una base real).
# Requiere Docker y la imagen postgres:17 ya descargada. Uso (desde dspacios-travel/):  sh supabase/scripts/test_preflight_vigencias_grupos_43_60.sh
#
# Pasada 1: fixture completo -> cada control con su valor y estado exactos.
# Pasada 2: solo hoteles limpios + el de fechas inválidas -> los controles 5–9 deben salir INCOMPLETO, no OK.
# Además: la consulta no escribe (huella md5 de las tablas igual antes y después, con default_transaction_read_only).
# ─────────────────────────────────────────────────────────────────────────
set -eu
CT="pg_preflight_43_60_$$"
export MSYS_NO_PATHCONV=1
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
trap 'docker rm -f "$CT" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$CT" -e POSTGRES_PASSWORD=x postgres:17 >/dev/null
n=0; until docker exec "$CT" pg_isready -U postgres >/dev/null 2>&1 && docker exec "$CT" psql -U postgres -qc "select 1" >/dev/null 2>&1; do
  n=$((n + 1)); [ $n -ge 30 ] && { echo "El contenedor no arrancó"; exit 2; }; sleep 1
done
PSQL="docker exec -i $CT psql -U postgres -X -q -v ON_ERROR_STOP=1"
docker cp supabase/scripts/fixture_preflight_vigencias_grupos_43_60.sql "$CT":/tmp/fixture.sql
docker cp supabase/scripts/preflight_vigencias_grupos_43_60_lectura.sql "$CT":/tmp/consulta.sql
$PSQL -f /tmp/fixture.sql

huella() { $PSQL -At -c "select md5(coalesce((select string_agg(t::text, ',' order by t::text) from tarifa_hotel t),'') || coalesce((select string_agg(t::text, ',' order by t::text) from hotel_temporadas t),''))"; }
correr() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$CT" psql -U postgres -X -q -v ON_ERROR_STOP=1 -At -F '|' -f /tmp/consulta.sql; }
verifica() { # orden observado estado
  obs="$(echo "$SALIDA" | awk -F'|' -v o="$1" '$1 == o { print $3; exit }')"
  est="$(echo "$SALIDA" | awk -F'|' -v o="$1" '$1 == o { print $5; exit }')"
  [ "$obs" = "$2" ] && [ "$est" = "$3" ] && ok "control $1: observado=$obs estado=$est" || fallo "control $1: esperado $2 / $3, obtenido ${obs:-∅} / ${est:-∅}"
}

H0="$(huella)"
SALIDA="$(correr)" || { echo "La consulta falló"; echo "$SALIDA"; exit 1; }
[ "$(huella)" = "$H0" ] && ok "la consulta no modificó datos (huella igual, sesión de solo lectura)" || fallo "la consulta modificó datos"
echo "$SALIDA" | cut -c1-200

echo "--- pasada 1: fixture completo"
verifica 0 365 INFO
verifica 1 1 REVISAR
verifica 2 1 REVISAR
verifica 3 6 REVISAR
verifica 4 1 INCOMPLETO
verifica 5 5 "REVISAR (INCOMPLETO)"
verifica 6 3 "REVISAR (INCOMPLETO)"
verifica 7 6 "REVISAR (INCOMPLETO)"   # hotel 3 (doble, 3 noches) + hotel 9 (doble, 3 noches)
verifica 8 2 "REVISAR (INCOMPLETO)"
verifica 9 2 "REVISAR (INCOMPLETO)"   # hotel 9 triple y hotel 10 doble (el caso pedido)
verifica 10 1 INFO
verifica 11 4 INFO
verifica 12 1 INFO
verifica 13 2 INFO   # hoteles 8 y 12: configurados sin ninguna tarifa
verifica 14 1 INFO
verifica 15 1 INFO
[ "$(echo "$SALIDA" | grep -c '^3\.0')" = 6 ] && ok "6 filas de detalle de fechas inválidas" || fallo "detalle de fechas inválidas"
echo "$SALIDA" | grep -q 'hotel 10 · Estándar / PAM · doble sin precio en ninguna vigencia' && ok "caso pedido: sencilla con precio y doble sin precio -> la doble aparece como falta" || fallo "no apareció la doble del hotel 10"
echo "$SALIDA" | grep -q 'hotel 9 · Estándar / PAM · doble · vigencia "PUENTE" tiene fila pero sin precio en esa acomodación' && ok "doble faltante en una vigencia con fila de sencilla (hotel 9)" || fallo "no apareció la doble de PUENTE en el hotel 9"
[ "$(echo "$SALIDA" | grep -c '^7.0')" = 2 ] && ok "detalle del control 7: 2 combinaciones acomodación×vigencia (hotel 3 y hotel 9)" || fallo "detalle del control 7"
echo "$SALIDA" | grep -q 'sencilla · vigencia' && fallo "la sencilla (con precio) no debería aparecer como falta" || ok "la sencilla con precio no aparece como falta"

echo "--- pasada 2: solo hoteles 7 (limpio) y 11 (fechas inválidas)"
$PSQL -c "delete from tarifa_hotel where hotel_id not in (7,11); delete from hotel_temporadas where hotel_id not in (7,11); delete from hotel_acomodaciones; delete from hotel_categorias where hotel_id not in (7,11); delete from hotel_regimenes where hotel_id not in (7,11);"
SALIDA="$(correr)"
verifica 3 6 REVISAR
verifica 4 1 INCOMPLETO
for c in 5 6 7 8 9; do verifica $c 0 INCOMPLETO; done

echo "--- pasada 3: sin hotel de fechas inválidas -> OK"
$PSQL -c "delete from tarifa_hotel where hotel_id = 11; delete from hotel_temporadas where hotel_id = 11;"
SALIDA="$(correr)"
verifica 3 0 OK
verifica 4 0 OK
for c in 5 6 7 8 9; do verifica $c 0 OK; done

[ "$FALLOS" = 0 ] && echo "TODO OK" || { echo "$FALLOS FALLO(S)"; exit 1; }
