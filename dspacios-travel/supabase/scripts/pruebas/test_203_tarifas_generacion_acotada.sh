#!/bin/sh
# ───────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL · migración 203. Crea una base DESECHABLE dentro del contenedor
# de Supabase LOCAL, corre test_203_tarifas_generacion_acotada.sql (con la
# migración incrustada en lugar de su línea `\ir`) y borra la base al final,
# pase o falle. Nunca toca la base `postgres` ni una remota.
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/pruebas/test_203_tarifas_generacion_acotada.sh [contenedor]
# ───────────────────────────────────────────────────────────────────────────
set -eu
CT="${1:-supabase_db_sbqvrckukbjzhtzqpyzg}"
DB="prueba_203_$(date +%s)"
AQUI="$(cd "$(dirname "$0")" && pwd)"
MIGRACION="$AQUI/../../migrations/20260601000203_tarifas_generacion_acotada_historial.sql"
PSQL="psql -h 127.0.0.1 -U postgres -X -q -v ON_ERROR_STOP=1"

limpiar() {
  docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true
}
trap limpiar EXIT

docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "create database $DB"
awk -v mig="$MIGRACION" -v esq="$AQUI/test_203_esquema_minimo.sql" '
  /^\\ir .*20260601000203_tarifas_generacion_acotada_historial\.sql/ { while ((getline l < mig) > 0) print l; next }
  /^\\ir test_203_esquema_minimo\.sql/ { while ((getline l < esq) > 0) print l; next }
  { print }
' "$AQUI/test_203_tarifas_generacion_acotada.sql" \
  | docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -f -

# Script de auditoría de solo lectura: corre sin errores y no cambia nada.
ANTES="$(docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -t -A -c "select (select count(*) from public.tarifa_hotel)||'/'||(select count(*) from public.tarifa_hotel_historial)")"
docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -f - < "$AQUI/../auditoria_tarifas_recuperables_lectura.sql" > /dev/null
DESPUES="$(docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -t -A -c "select (select count(*) from public.tarifa_hotel)||'/'||(select count(*) from public.tarifa_hotel_historial)")"
if [ "$ANTES" = "$DESPUES" ]; then
  echo "OK    auditoria_tarifas_recuperables_lectura.sql corre sin errores y no escribe ($ANTES)"
else
  echo "FALLO el script de auditoría cambió datos: $ANTES -> $DESPUES"; exit 1
fi

# Rollback sobre la misma base: retira funciones y triggers, conserva los historiales.
RES="$(docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -t -A -F ' ' -f - < "$AQUI/../rollback_203_tarifas_generacion_acotada.sql" | tail -1)"
if [ "$RES" = "t t t" ]; then
  echo "OK    rollback retira funciones y triggers y conserva ambos historiales"
else
  echo "FALLO rollback: $RES"; exit 1
fi
