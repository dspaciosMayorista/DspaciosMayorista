#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# APP → RPC · #30 contrato manual NETO (migración 206) y facturación transaccional (208).
# Trayecto REAL: formulario → crearContrato → @supabase/ssr → PostgREST →
# aplicar_neto_contrato_manual, con la prueba pruebas/contratoManualNeto206.pg.ts.
# SOLO Docker local y desechable (nunca remoto, nunca Preview).
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_206_app_rpc.sh <base_nueva> [contenedor_pg] [plantilla]
#     base_nueva    nombre NUEVO: ^t206_[a-z0-9_]{1,40}$ y que NO exista. Se crea
#                   desde la plantilla (001–205) y se borra al final
#                   (KEEP=1 la conserva para inspección).
#     contenedor_pg supabase/postgres local publicado en 127.0.0.1:$PG206_PUERTO_PG
#                   (por defecto pg30_neto, puerto 55430). No se modifica.
#     plantilla     base con 001–205 aplicadas (plantilla205). Solo se lee.
#
# Propiedad (lo único que este script borra):
#   · la base: solo si ESTE script la creó con éxito y lleva su marca (comment
#     con el token de la corrida). Si ya existía o el CREATE falla, no se toca.
#   · un rol de login propio test206_auth_<token> para PostgREST (en vez de
#     cambiar la contraseña del rol `authenticator`, que es compartido).
#   · un contenedor PostgREST propio, nombre único pgrst206_<sufijo> y etiqueta
#     dspacios.test206=<token>; se elimina solo por esa etiqueta. Si el nombre
#     ya existe, el script termina sin tocarlo. Puerto local libre elegido por
#     Docker. PG206_SUFIJO (^[a-z0-9]{6,16}$) fija el sufijo, solo para probar.
#   PG206_FILTRO: patrón de nombre de prueba (--test-name-pattern) para correr
#   solo algunos casos, p. ej. "^(FACT|CXP)".
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg30_neto}"
PLANTILLA="${3:-plantilla205}"
PUERTO_PG="${PG206_PUERTO_PG:-55430}"
IMAGEN_REST="${PG206_IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.1}"
export MSYS_NO_PATHCONV=1

nombre_ok() { printf '%s' "$1" | grep -Eq "$2"; }
nombre_ok "$DB" '^t206_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t206_[a-z0-9_]{1,40}\$." >&2; exit 2; }
nombre_ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
nombre_ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
[ "$DB" != "$PLANTILLA" ] || { echo "La base no puede ser la plantilla." >&2; exit 2; }

hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 8)"
SUFIJO="${PG206_SUFIJO:-$(hex 5)}"
nombre_ok "$SUFIJO" '^[a-z0-9]{6,16}$' || { echo "PG206_SUFIJO inválido." >&2; exit 2; }
REST="pgrst206_$SUFIJO"
ROL="test206_auth_$TOKEN"
SECRETO="local-206-$(hex 24)"
CLAVE="c206$(hex 12)"
MARCA="test_206_app_rpc $TOKEN"
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"

BASE_PROPIA=0
ROL_PROPIO=0
limpiar() {
  st=$?
  # Contenedor: solo el que lleva NUESTRA etiqueta (nunca por nombre).
  # Reintenta una vez y avisa si queda: con Docker Desktop un `rm -f` sobre
  # un contenedor que está muriendo puede fallar en silencio.
  for intento in 1 2; do
    ids="$(docker ps -aq --filter "label=dspacios.test206=$TOKEN" 2>/dev/null || true)"
    [ -z "$ids" ] && break
    docker rm -f $ids >/dev/null 2>&1 || sleep 2
  done
  [ -n "$(docker ps -aq --filter "label=dspacios.test206=$TOKEN" 2>/dev/null || true)" ] && echo "AVISO: quedó el contenedor con etiqueta dspacios.test206=$TOKEN" >&2
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    marca="$($PS -d postgres -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'" 2>/dev/null || true)"
    if [ "$marca" = "$MARCA" ]; then
      # DROP sin FORCE (ya no queda el PostgREST propio): en pg30_neto, varios
      # `drop … with (force)` precedieron caídas del servidor (TimescaleDB).
      borrada=0
      for intento in 1 2 3 4 5; do
        if $PS -d postgres -c "drop database $DB" >/dev/null 2>&1; then borrada=1; break; fi
        sleep 2
      done
      [ "$borrada" = 1 ] || echo "AVISO: no se pudo borrar $DB (sigue con su marca; bórrala a mano)" >&2
    else
      echo "AVISO: $DB no lleva la marca de esta corrida; no se borra." >&2
    fi
  fi
  [ "$ROL_PROPIO" = 1 ] && { $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || echo "AVISO: no se pudo borrar el rol $ROL" >&2; }
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

# ── Comprobaciones previas (solo lectura): nada existente se toca ──────
docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
if [ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" != 0 ]; then
  echo "La base $DB ya existe: no se toca. Usa otro nombre." >&2; exit 3
fi
if docker inspect "$REST" >/dev/null 2>&1; then
  echo "El contenedor $REST ya existe: no se toca." >&2; exit 3
fi

# ── Base propia: la marca va DESPUÉS de crearla con éxito ──────────────
if ! $PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null; then
  echo "No se pudo crear $DB: no se toca nada." >&2; exit 3
fi
BASE_PROPIA=1
$PS -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null
# 206 y luego 208 (orden de la secuencia #30 B), cada una en UNA transacción y sin silenciar
# errores: si alguna falla, el runner termina y limpia lo suyo. La 208 es la facturación
# transaccional: las pruebas de facturación (FACT/RACE/COMP/K) la exigen.
$PS -d "$DB" -1 < "$APP/supabase/migrations/20260601000206_contrato_manual_neto.sql" >/dev/null || { echo "La migración 206 falló en $DB." >&2; exit 1; }
$PS -d "$DB" -c "select to_regprocedure('public.aplicar_neto_contrato_manual(text,bigint,numeric)') is not null" | grep -qx t
$PS -d "$DB" -1 < "$APP/supabase/migrations/20260601000208_facturacion_transaccional.sql" >/dev/null || { echo "La migración 208 falló en $DB." >&2; exit 1; }
$PS -d "$DB" -c "select to_regprocedure('public.facturar_factura(text,uuid,text,numeric,numeric,numeric,text,text,text,text)') is not null and to_regclass('public.factura_revision_fuera_libros') is not null" | grep -qx t

# ── Rol de login propio para PostgREST (no se toca `authenticator`) ────
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
ROL_PROPIO=1
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null

# ── PostgREST propio (nombre único + etiqueta de la corrida) ──────────
docker run -d --name "$REST" --label "dspacios.test206=$TOKEN" -p "127.0.0.1::3000" \
  --add-host host.docker.internal:host-gateway \
  -e PGRST_DB_URI="postgres://$ROL:$CLAVE@host.docker.internal:$PUERTO_PG/$DB" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" \
  "$IMAGEN_REST" >/dev/null
i=0
until docker logs "$REST" 2>&1 | grep -q "Schema cache loaded"; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { docker logs "$REST" >&2; echo "PostgREST no arrancó" >&2; exit 1; }
  sleep 1
done
PUERTO_REST="$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
nombre_ok "$PUERTO_REST" '^[0-9]+$' || { echo "No se pudo leer el puerto de $REST." >&2; exit 1; }

cd "$APP"
PG206_BASE="$DB" PG206_CONTENEDOR="$CT" PG206_POSTGREST="http://127.0.0.1:$PUERTO_REST" PG206_JWT_SECRET="$SECRETO" \
  node --experimental-test-module-mocks --experimental-loader ./pruebas/support/reactLoader.mjs \
       --test --test-force-exit --test-timeout=120000 --test-concurrency=1 --test-reporter="${PG206_REPORTER:-spec}"        ${PG206_FILTRO:+--test-name-pattern="$PG206_FILTRO"} pruebas/contratoManualNeto206.pg.ts
