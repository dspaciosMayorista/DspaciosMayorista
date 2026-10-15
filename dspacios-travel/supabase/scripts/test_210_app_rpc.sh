#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# APP → RPC · #44 / K15 (migración 210, 20260601000210_financiero_contrato_reentrada.sql).
# Trayecto REAL por HTTP: `registrarFinancieroContrato` (lib/reservar/financieroContrato.ts) →
# PostgREST propio → registrar_financiero_contrato / revertir_contrato_incompleto, y los permisos
# efectivos por rol (anon / authenticated / service_role) y por agencia, con la prueba
# pruebas/financieroContrato210.pg.ts. SOLO Docker local y desechable (nunca remoto, nunca Preview).
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_210_app_rpc.sh <base_nueva> [contenedor_pg] [plantilla]
#     base_nueva    nombre NUEVO: ^t210_[a-z0-9_]{1,40}$ y que NO exista. Se crea desde la
#                   plantilla (001–205), recibe 207 + 210 y se borra al final (KEEP=1 la conserva).
#     contenedor_pg postgres local publicado en 127.0.0.1:$PG210_PUERTO_PG (por defecto pg206b_eb3bbf43, 55440).
#     plantilla     base con 001–205 aplicadas (plantilla205). Solo se lee.
#
# Propiedad (lo único que este script borra): la base (solo si lleva la marca de ESTA corrida),
# un rol de login propio test210_auth_<token> y un contenedor PostgREST propio pgrst210_<sufijo>
# (etiqueta dspacios.test210=<token>, se elimina solo por esa etiqueta). Si el nombre ya existe,
# termina sin tocarlo.
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg206b_eb3bbf43}"
PLANTILLA="${3:-plantilla205}"
PUERTO_PG="${PG210_PUERTO_PG:-55440}"
IMAGEN_REST="${PG210_IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.1}"
export MSYS_NO_PATHCONV=1

nombre_ok() { printf '%s' "$1" | grep -Eq "$2"; }
nombre_ok "$DB" '^t210_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t210_[a-z0-9_]{1,40}\$." >&2; exit 2; }
nombre_ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
nombre_ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
[ "$DB" != "$PLANTILLA" ] || { echo "La base no puede ser la plantilla." >&2; exit 2; }

hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 8)"
SUFIJO="${PG210_SUFIJO:-$(hex 5)}"
nombre_ok "$SUFIJO" '^[a-z0-9]{6,16}$' || { echo "PG210_SUFIJO inválido." >&2; exit 2; }
REST="pgrst210_$SUFIJO"
ROL="test210_auth_$TOKEN"
SECRETO="local-210-$(hex 24)"
CLAVE="c210$(hex 12)"
MARCA="test_210_app_rpc $TOKEN"
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
    ids="$(docker ps -aq --filter "label=dspacios.test210=$TOKEN" 2>/dev/null || true)"
    [ -z "$ids" ] && break
    docker rm -f $ids >/dev/null 2>&1 || sleep 2
  done
  [ -n "$(docker ps -aq --filter "label=dspacios.test210=$TOKEN" 2>/dev/null || true)" ] && echo "AVISO: quedó el contenedor con etiqueta dspacios.test210=$TOKEN" >&2
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
# 207 (la base de la secuencia #44) y luego la 210. La 207 trae su propio BEGIN/COMMIT; la 210 va en UNA
# transacción y, si falla, el runner termina y limpia lo suyo.
$PS -d "$DB" < "$APP/supabase/migrations/20260601000207_crm_contactos_acceso.sql" >/dev/null 2>&1 || { echo "La migración 207 falló en $DB." >&2; exit 1; }
$PS -d "$DB" -1 < "$APP/supabase/migrations/20260601000210_financiero_contrato_reentrada.sql" >/dev/null || { echo "La migración 210 falló en $DB." >&2; exit 1; }
$PS -d "$DB" -c "select to_regclass('public.asientos_contables_cxp_referencia_uk') is not null and exists (select 1 from information_schema.columns where table_name = 'ventas' and column_name = 'financiero_registrado_en')" | grep -qx t

# ── Rol de login propio para PostgREST (no se toca `authenticator`) ────
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
ROL_PROPIO=1
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null

# ── PostgREST propio (nombre único + etiqueta de la corrida) ──────────
docker run -d --name "$REST" --label "dspacios.test210=$TOKEN" -p "127.0.0.1::3000" \
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
PG210_BASE="$DB" PG210_CONTENEDOR="$CT" PG210_POSTGREST="http://127.0.0.1:$PUERTO_REST" PG210_JWT_SECRET="$SECRETO"   node --experimental-strip-types --experimental-loader ./pruebas/support/aliasLoader.mjs        --test --test-force-exit --test-timeout=120000 --test-concurrency=1 --test-reporter="${PG210_REPORTER:-spec}" ${PG210_FILTRO:+--test-name-pattern="$PG210_FILTRO"} pruebas/financieroContrato210.pg.ts
