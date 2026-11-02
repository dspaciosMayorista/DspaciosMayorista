#!/bin/sh
# 270 (#120): recorrido REAL (solicitud sin importes → neta → precio completo → conversión → contrato/vuelo/sillas/CxP) contra PostgreSQL + PostgREST locales.
# SOLO Docker local y desechable. Uso (desde dspacios-travel/):  sh supabase/scripts/test_270_e2e.sh <base_nueva ^t270e_[a-z0-9_]{1,30}$> [contenedor_pg] [plantilla 001-254]
set -eu
DB="${1:-}"; CT="${2:-pg255local}"; PLANTILLA="${3:-plantilla255}"
. "$(dirname "$0")/entorno_270_local.sh"
cd "$APP"
PG270_BASE="$DB" PG270_CONTENEDOR="$CT" PG270_POSTGREST="$REST_URL" PG270_JWT_SECRET="$SECRETO" \
  node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoaderRelativo.mjs \
       --test --test-force-exit --test-timeout=240000 --test-concurrency=1 --test-reporter="${PG270_REPORTER:-spec}" ${PG270_PATRON:+--test-name-pattern=$PG270_PATRON} pruebas/hotelASolicitud270.pg.ts
