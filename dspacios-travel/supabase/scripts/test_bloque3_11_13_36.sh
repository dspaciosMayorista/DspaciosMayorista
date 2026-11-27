#!/bin/sh
# Bloque 3 (#11/#13/#36): recorrido REAL (módulos de producción -> PostgREST -> PostgreSQL) sobre una base DESECHABLE creada desde una plantilla con la cadena hasta la 326; aplica las migraciones 343 y 344 aquí (344 = revisión del dueño: alertas con «Revisado», fuentes de hotel/servicio y presencia paginada).
# NUNCA contra una base real; el contenedor y la plantilla deben ser locales.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_bloque3_11_13_36.sh <contenedor_pg> <plantilla>
set -eu
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"
PG_REACT=1 sh supabase/scripts/test_pg_local.sh "$CT" "$PLANTILLA" PG111 pruebas/bloque3_11_13_36.pg.ts "${MIG_343:-supabase/migrations/20260601000343_presencia_y_avisos_compra.sql}" "${MIG_344:-supabase/migrations/20260601000344_alertas_compra_y_presencia_paginada.sql}"
