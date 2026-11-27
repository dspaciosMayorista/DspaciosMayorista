#!/bin/sh
# #78 residual · aviso interno por una cotización pública (migración 340). Corre el recorrido REAL (acciones de la app + campana → PostgREST → PostgreSQL) sobre una base desechable creada
# desde una plantilla de esquema que traiga hasta la 326 (la 340 se aplica aquí). NUNCA contra una base real; el contenedor y la plantilla deben ser locales.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_78_aviso_cotizacion_publica.sh <contenedor_pg> <plantilla> [con340|sin340]
#   - `sin340` mide la línea base (esquema de main sin la 340): las pruebas que cubren el aviso DEBEN fallar (la función no existe).
set -eu
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; MODO="${3:-con340}"
M=supabase/migrations
if [ "$MODO" = "con340" ]; then EXTRA="$M/20260601000340_aviso_cotizacion_publica.sql"; else EXTRA=""; fi
# shellcheck disable=SC2086
PG_REACT=1 sh supabase/scripts/test_pg_local.sh "$CT" "$PLANTILLA" PG78 pruebas/avisoCotizacionPublica78.pg.ts $EXTRA
