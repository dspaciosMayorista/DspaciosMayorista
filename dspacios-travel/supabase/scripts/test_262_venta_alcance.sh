#!/bin/sh
# 262: recorrido de venta REAL (generarTarifario → buscarReceptivos → cotización → convertirCotizacionCarrito → contrato y CxP) contra PostgreSQL+PostgREST locales.
# SOLO Docker local y desechable. Uso (desde dspacios-travel/):  sh supabase/scripts/test_262_venta_alcance.sh <base_nueva> [contenedor_pg] [plantilla]
#   base_nueva ^t262v_[a-z0-9_]{1,30}$ NUEVA (se borra al final; KEEP=1 la conserva). Plantilla: esquema completo SIN la 255. Ver entorno_262_local.sh.
set -eu
PREFIJO=t262v; DB="${1:-}"; CT="${2:-pg255local}"; PLANTILLA="${3:-plantilla255}"
. "$(dirname "$0")/entorno_262_local.sh"
cd "$APP"
PG262_BASE="$DB" PG262_CONTENEDOR="$CT" PG262_POSTGREST="$REST_URL" PG262_JWT_SECRET="$SECRETO" \
  node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoaderRelativo.mjs \
       --test --test-force-exit --test-timeout=180000 --test-concurrency=1 --test-reporter="${PG262_REPORTER:-spec}" pruebas/alcance262.pg.ts
