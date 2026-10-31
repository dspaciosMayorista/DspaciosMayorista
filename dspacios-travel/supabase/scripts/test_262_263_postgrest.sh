#!/bin/sh
# 262/263 POR HTTP contra PostgREST local propio (JWT HS256). SOLO Docker local y desechable.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_262_263_postgrest.sh <base_nueva> [contenedor_pg] [plantilla]
#   base_nueva  ^t262pg_[a-z0-9_]{1,30}$, NUEVA. Se crea desde la plantilla (esquema completo SIN la 255), recibe 255,256,258,259,262,263 y se borra al final (KEEP=1 la conserva).
#   Todo lo que crea (base, rol, red, contenedor PostgREST) lleva el token de la corrida y se elimina al terminar. Ver entorno_262_local.sh.
set -eu
PREFIJO=t262pg; DB="${1:-}"; CT="${2:-pg255local}"; PLANTILLA="${3:-plantilla255}"
. "$(dirname "$0")/entorno_262_local.sh"
cd "$APP"
PG262_BASE="$DB" PG262_CONTENEDOR="$CT" PG262_POSTGREST="$REST_URL" PG262_JWT_SECRET="$SECRETO" node pruebas/postgrest262_263.pg.mjs
