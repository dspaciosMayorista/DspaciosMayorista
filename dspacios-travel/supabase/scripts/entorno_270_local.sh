#!/bin/sh
# ────────────────────────────────────────────────────────
# ENTORNO LOCAL DESECHABLE para las pruebas de la 270 (#120). Se hace `.` desde test_270_e2e.sh; no se ejecuta solo. Modelo: entorno_262_local.sh.
# Crea: una base nueva clonada de la plantilla (esquema completo hasta la 254), le aplica 255..268, la 270 y la 271 (con preflight y postcheck de cada una, una consulta cada uno),
# un rol de login propio, una red docker propia y un PostgREST propio. TODO lleva el token de la corrida y se borra al terminar (trap EXIT; KEEP=1 conserva la base).
# Nunca toca la base compartida ni la plantilla (solo la lee). Entrega: DB, CT, REST_URL, SECRETO, TOKEN, AQUI, APP, PS.
# Requiere antes: DB (^t270e_[a-z0-9_]{1,30}$), CT, PLANTILLA. La 269 es de SalesBot #56 y NO se aplica aquí.
# ────────────────────────────────────────────────────────
export MSYS_NO_PATHCONV=1
IMAGEN_REST="${PG270_IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
nombre_ok() { printf '%s' "$1" | grep -Eq "$2"; }
nombre_ok "$DB" '^t270e_[a-z0-9_]{1,30}$' || { echo "Base inválida: usa un nombre nuevo ^t270e_[a-z0-9_]{1,30}\$." >&2; exit 2; }
nombre_ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
nombre_ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
[ "$DB" != "$PLANTILLA" ] || { echo "La base no puede ser la plantilla." >&2; exit 2; }

hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 8)"; SUFIJO="$(hex 5)"
REST="pgrst270_$SUFIJO"; RED="red270_$TOKEN"; ROL="test270_auth_$TOKEN"
SECRETO="local-270-$(hex 24)"; CLAVE="c270$(hex 12)"; MARCA="test_270 $TOKEN"
AQUI="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$AQUI/../.." && pwd)"; MIGS="$APP/supabase/migrations"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
BASE_PROPIA=0; ROL_PROPIO=0; RED_PROPIA=0
limpiar() {
  st=$?
  for intento in 1 2; do
    ids="$(docker ps -aq --filter "label=dspacios.test270=$TOKEN" 2>/dev/null || true)"; [ -z "$ids" ] && break
    docker rm -f $ids >/dev/null 2>&1 || sleep 2
  done
  [ -n "$(docker ps -aq --filter "label=dspacios.test270=$TOKEN" 2>/dev/null || true)" ] && echo "AVISO: quedó un contenedor con etiqueta dspacios.test270=$TOKEN" >&2
  if [ "$RED_PROPIA" = 1 ]; then docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || echo "AVISO: no se pudo borrar la red $RED" >&2; fi
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    marca="$($PS -d postgres -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'" 2>/dev/null || true)"
    if [ "$marca" = "$MARCA" ]; then
      for intento in 1 2 3 4 5; do $PS -d postgres -c "drop database $DB" >/dev/null 2>&1 && break; sleep 2; done
      [ "$($PS -d postgres -c "select count(*) from pg_database where datname='$DB'" 2>/dev/null)" = 0 ] || echo "AVISO: no se pudo borrar $DB" >&2
    else echo "AVISO: $DB no lleva la marca de esta corrida; no se borra." >&2; fi
  fi
  [ "$ROL_PROPIO" = 1 ] && { $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || echo "AVISO: no se pudo borrar el rol $ROL" >&2; }
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe: no se toca." >&2; exit 3; }
creada=0
for i in 1 2 3 4 5 6; do
  $PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null 2>&1 || true
  $PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>&1 && { creada=1; break; }
  sleep 1
done
[ "$creada" = 1 ] || { echo "No se pudo crear $DB." >&2; exit 3; }
BASE_PROPIA=1
$PS -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null

echo "== aplica 255..268 =="
for n in $(seq 255 268); do
  for f in "$MIGS"/20260601000${n}_*.sql; do
    [ -e "$f" ] || continue
    $PS -d "$DB" < "$f" >/dev/null 2>"/tmp/m270.$TOKEN.err" || { cat "/tmp/m270.$TOKEN.err" >&2; echo "FALLÓ $f" >&2; exit 1; }
  done
done
echo "== PREFLIGHT 270 =="
PRE="$($PS -d "$DB" -F '|' < "$AQUI/preflight_270_hotel_a_solicitud.sql")"; echo "$PRE" | cut -c1-200
echo "$PRE" | grep -Eq "[|]FALLA *$" && { echo "Preflight 270 con FALLA." >&2; exit 1; }
echo "$PRE" | grep -Eq "^99[|].*[|]OK *$" || { echo "Preflight 270: veredicto global no es OK." >&2; exit 1; }
$PS -d "$DB" < "$MIGS/20260601000270_hotel_a_solicitud.sql" >/dev/null 2>"/tmp/m270.$TOKEN.err" || { cat "/tmp/m270.$TOKEN.err" >&2; exit 1; }
$PS -d "$DB" < "$MIGS/20260601000270_hotel_a_solicitud.sql" >/dev/null 2>"/tmp/m270.$TOKEN.err" || { cat "/tmp/m270.$TOKEN.err" >&2; echo "la 270 no es idempotente" >&2; exit 1; }
echo "  migración 270 aplicada (dos veces: idempotente)"
echo "== POSTCHECK 270 =="
POST="$($PS -d "$DB" -F '|' < "$AQUI/postcheck_270_hotel_a_solicitud.sql")"; echo "$POST" | cut -c1-200
echo "$POST" | grep -Eq "[|]FALLA *$" && { echo "Postcheck 270 con FALLA." >&2; exit 1; }
echo "$POST" | grep -Eq "^99[|].*[|]OK *$" || { echo "Postcheck 270: veredicto global no es OK." >&2; exit 1; }
echo "== PREFLIGHT 271 =="
PRE="$($PS -d "$DB" -F '|' < "$AQUI/preflight_271_reparto_neta_solicitud.sql")"; echo "$PRE" | cut -c1-220
echo "$PRE" | grep -Eq "[|]FALLA *$" && { echo "Preflight 271 con FALLA." >&2; exit 1; }
echo "$PRE" | grep -Eq "^99[|].*[|]OK *$" || { echo "Preflight 271: veredicto global no es OK." >&2; exit 1; }
for vez in 1 2; do
  $PS -d "$DB" < "$MIGS/20260601000271_reparto_neta_solicitud.sql" >/dev/null 2>"/tmp/m270.$TOKEN.err" || { cat "/tmp/m270.$TOKEN.err" >&2; echo "FALLÓ la 271 (vez $vez)" >&2; exit 1; }
done
echo "  migración 271 aplicada (dos veces: idempotente)"
echo "== POSTCHECK 271 =="
POST="$($PS -d "$DB" -F '|' < "$AQUI/postcheck_271_reparto_neta_solicitud.sql")"; echo "$POST" | cut -c1-220
echo "$POST" | grep -Eq "[|]FALLA *$" && { echo "Postcheck 271 con FALLA." >&2; exit 1; }
echo "$POST" | grep -Eq "^99[|].*[|]OK *$" || { echo "Postcheck 271: veredicto global no es OK." >&2; exit 1; }
rm -f "/tmp/m270.$TOKEN.err"

# Entorno (NO es esquema de la app): auth.uid()/auth.role() leen el JWT de request.jwt.claims.
$PS -d "$DB" >/dev/null <<'SQL'
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
SQL
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null; ROL_PROPIO=1
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null; RED_PROPIA=1
docker network connect "$RED" "$CT" >/dev/null
docker run -d --name "$REST" --network "$RED" --label "dspacios.test270=$TOKEN" -p "127.0.0.1::3000" \
  -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
i=0
until docker logs "$REST" 2>&1 | grep -q "Schema cache loaded"; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { docker logs "$REST" >&2; echo "PostgREST no arrancó" >&2; exit 1; }; sleep 1
done
PUERTO_REST="$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
nombre_ok "$PUERTO_REST" '^[0-9]+$' || { echo "No se pudo leer el puerto de $REST." >&2; exit 1; }
REST_URL="http://127.0.0.1:$PUERTO_REST"
echo "== PostgREST $REST en $REST_URL contra $DB =="
