#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# PORTAL B2B (#65) · recorrido de integración REAL: cargadores y páginas del portal (app/portal/b2b/*, lib/portal/*, lib/auth/*) por HTTP contra PostgREST
# propio y PostgreSQL local desechable con el esquema 001-254 (la plantilla), con sesiones `authenticated` de dos aliados (RLS y RPC reales).
# Solo se simulan la sesión (auth.getUser) y next/headers; ningún dato ni permiso. SOLO Docker local y desechable.
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_65_portal_b2b.sh <base_nueva> [contenedor_pg] [plantilla]
#     base_nueva    nombre NUEVO: ^t65_[a-z0-9_]{1,40}$ y que NO exista. Se crea desde la plantilla (001-254) y se borra al final (KEEP=1 la conserva).
#     contenedor_pg postgres local desechable (por defecto pg65portal).
#     plantilla     base con 001-254 aplicadas (preparar_esquema_local.sh <contenedor> 254 plantilla65). Solo se lee.
#
# Propiedad (lo único que este script borra): la base (solo si lleva la marca de ESTA corrida), un rol de login propio test65_auth_<token>, una red
# docker propia red65_<token> y un contenedor PostgREST propio pgrst65_<sufijo> (etiqueta dspacios.test65=<token>). Si el nombre ya existe, termina sin tocarlo.
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg65portal}"
PLANTILLA="${3:-plantilla65}"
IMAGEN_REST="${PG65_IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
export MSYS_NO_PATHCONV=1

nombre_ok() { printf '%s' "$1" | grep -Eq "$2"; }
nombre_ok "$DB" '^t65_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t65_[a-z0-9_]{1,40}\$." >&2; exit 2; }
nombre_ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
nombre_ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
[ "$DB" != "$PLANTILLA" ] || { echo "La base no puede ser la plantilla." >&2; exit 2; }

hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 8)"
SUFIJO="${PG65_SUFIJO:-$(hex 5)}"
nombre_ok "$SUFIJO" '^[a-z0-9]{6,16}$' || { echo "PG65_SUFIJO inválido." >&2; exit 2; }
REST="pgrst65_$SUFIJO"
RED="red65_$TOKEN"
ROL="test65_auth_$TOKEN"
SECRETO="local-65-$(hex 24)"
CLAVE="c65$(hex 12)"
MARCA="test_65_portal_b2b $TOKEN"
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"

BASE_PROPIA=0
ROL_PROPIO=0
RED_PROPIA=0
limpiar() {
  st=$?
  for intento in 1 2; do
    ids="$(docker ps -aq --filter "label=dspacios.test65=$TOKEN" 2>/dev/null || true)"
    [ -z "$ids" ] && break
    docker rm -f $ids >/dev/null 2>&1 || sleep 2
  done
  [ -n "$(docker ps -aq --filter "label=dspacios.test65=$TOKEN" 2>/dev/null || true)" ] && echo "AVISO: quedó el contenedor con etiqueta dspacios.test65=$TOKEN" >&2
  if [ "$RED_PROPIA" = 1 ]; then
    docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true
    docker network rm "$RED" >/dev/null 2>&1 || echo "AVISO: no se pudo borrar la red $RED" >&2
  fi
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    marca="$($PS -d postgres -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'" 2>/dev/null || true)"
    if [ "$marca" = "$MARCA" ]; then
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

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
if [ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" != 0 ]; then
  echo "La base $DB ya existe: no se toca. Usa otro nombre." >&2; exit 3
fi
if docker inspect "$REST" >/dev/null 2>&1; then echo "El contenedor $REST ya existe: no se toca." >&2; exit 3; fi

# Base propia desde la plantilla (con reintentos: la plantilla no puede tener sesiones abiertas) + la 238.
creada=0
for i in 1 2 3 4 5 6; do
  $PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null 2>&1 || true
  if $PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>&1; then creada=1; break; fi
  sleep 1
done
[ "$creada" = 1 ] || { echo "No se pudo crear $DB: no se toca nada." >&2; exit 3; }
BASE_PROPIA=1
$PS -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null
$PS -d "$DB" -c "select exists (select 1 from information_schema.columns where table_name = 'aliados' and column_name = 'activo')" | grep -qx t

# Entorno (NO es esquema de la app): el auth.uid()/auth.role() de Supabase alojado leen el JWT de request.jwt.claims (PostgREST ya no fija los GUC legados).
$PS -d "$DB" >/dev/null <<'SQL'
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
SQL

# Rol de login propio para PostgREST y red propia (PostgREST llega al Postgres por nombre de contenedor).
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
ROL_PROPIO=1
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null
RED_PROPIA=1
docker network connect "$RED" "$CT" >/dev/null

docker run -d --name "$REST" --network "$RED" --label "dspacios.test65=$TOKEN" -p "127.0.0.1::3000" \
  -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" -e PGRST_DB_MAX_ROWS=1000 \
  "$IMAGEN_REST" >/dev/null
i=0
until docker logs "$REST" 2>&1 | grep -q "Schema cache loaded"; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { docker logs "$REST" >&2; echo "PostgREST no arrancó" >&2; exit 1; }
  sleep 1
done
PUERTO_REST="$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
nombre_ok "$PUERTO_REST" '^[0-9]+$' || { echo "No se pudo leer el puerto de $REST." >&2; exit 1; }

cd "$APP"
PG65_BASE="$DB" PG65_CONTENEDOR="$CT" PG65_POSTGREST="http://127.0.0.1:$PUERTO_REST" PG65_JWT_SECRET="$SECRETO" \
  node --experimental-test-module-mocks --experimental-loader ./pruebas/support/reactLoader.mjs \
       --test --test-force-exit --test-timeout=180000 --test-concurrency=1 --test-reporter="${PG65_REPORTER:-spec}" \
       ${PG65_FILTRO:+--test-name-pattern="$PG65_FILTRO"} pruebas/portalB2B65.pg.ts
