#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# #127 — ENTORNO LOCAL DE REVISIÓN (SOLO local, datos sintéticos, base DESECHABLE). Nada toca producción ni otras bases.
#   Postgres  : el contenedor desechable del que se pasa el nombre (imagen supabase/postgres) con la base PROPIA `rev127` = copia de la plantilla (esquema hasta la 311) + migración 315 + semilla_127.sql.
#   Servicios : GoTrue (login real) + PostgREST, cada uno en su contenedor `rev127-*`, y un gateway Node mínimo (gateway_127.cjs) en 127.0.0.1:54381 que reproduce las rutas /auth/v1 y /rest/v1 de Kong.
#   App       : build de producción local (next build / next start) en 127.0.0.1:3081 — lo lanza quien verifica, con las variables que imprime `preparar`.
# Uso (desde dspacios-travel/):  sh supabase/scripts/localreview127/entorno_127_local.sh <preparar|detener> <contenedor_pg> <plantilla>
# Claves y secretos: se generan al azar en cada `preparar` y se guardan SOLO en $REV127_DIR (por defecto $TEMP/rev127); nunca se imprimen en logs de la app ni se escriben en el repositorio.
# ──────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
ACCION="${1:?preparar|detener}"; CT="${2:?contenedor pg}"; PLANTILLA="${3:-plantilla127}"
AQUI="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$AQUI/../../.." && pwd)"
DIR="${REV127_DIR:-${TEMP:-/tmp}/rev127}"; mkdir -p "$DIR"
DB=rev127; RED=red127; C_AUTH=rev127-auth; C_REST=rev127-rest; PUERTO_GW=54381
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"

if [ "$ACCION" = detener ]; then
  powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort $PUERTO_GW -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id supabase/scripts/localreview127/entorno_127_local.sh.OwningProcess -Force }" >/dev/null 2>&1 || true; rm -f "$DIR/gateway.pid"
  docker rm -f "$C_AUTH" "$C_REST" >/dev/null 2>&1 || true
  docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true
  echo "Entorno 127 detenido (base $DB eliminada)."; exit 0
fi
[ "$ACCION" = preparar ] || { echo "Acción desconocida." >&2; exit 2; }

hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
# Secretos estables entre ejecuciones (el build de producción embebe la clave anon: rehacer el entorno no debe invalidarlo).
if [ -f "$DIR/secretos.env" ]; then . "$DIR/secretos.env"; else JWT_SECRETO="rev127-$(hex 24)"; CLAVE_ROLES="r$(hex 10)"; CLAVE_USUARIOS="Rev127-$(hex 4)!"; printf "JWT_SECRETO="%s"
CLAVE_ROLES="%s"
CLAVE_USUARIOS="%s"
" "$JWT_SECRETO" "$CLAVE_ROLES" "$CLAVE_USUARIOS" > "$DIR/secretos.env"; fi
cat > "$DIR/claves.mjs" <<'EOF'
import { createHmac } from "node:crypto";
const [secreto] = process.argv.slice(2);
const b = (s) => Buffer.from(s).toString("base64url");
const firmar = (rol) => { const h = b(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b(JSON.stringify({ role: rol, iss: "rev127", exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 })); return `${h}.${p}.${createHmac("sha256", secreto).update(`${h}.${p}`).digest("base64url")}`; };
console.log(JSON.stringify({ anon: firmar("anon"), service: firmar("service_role") }));
EOF
CLAVES="$(node "$DIR/claves.mjs" "$JWT_SECRETO")"
ANON="$(printf '%s' "$CLAVES" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).anon))")"
SERVICE="$(printf '%s' "$CLAVES" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).service))")"

# Base desechable: copia de la plantilla + 315 + semilla sintética. La 315 es la migración bajo revisión.
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" >/dev/null || true
$PS -d postgres -c "drop database if exists $DB" >/dev/null
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
# La plantilla trae stubs de entorno (auth.jwt, auth.sessions) creados por supabase_admin: GoTrue migra como supabase_auth_admin: auth.jwt() debe ser suyo y auth.sessions (stub de 4 columnas) se descarta para que GoTrue cree la real.
$PS -d "$DB" -c "alter function auth.jwt() owner to supabase_auth_admin; drop table if exists auth.sessions cascade" >/dev/null
$PS -d "$DB" < "$APP/supabase/migrations/20260601000315_tarifario_oculta_por_cierre_general.sql" >/dev/null
$PS -d "$DB" < "$AQUI/semilla_127.sql" >/dev/null
# Roles de los servicios (mismo esquema que la revisión consolidada).
$PS -d postgres <<EOF >/dev/null
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'rev127_rest') then create role rev127_rest noinherit login; end if;
  if not exists (select 1 from pg_roles where rolname = 'rev127_auth') then create role rev127_auth login; end if;
end \$\$;
alter role rev127_rest with password '$CLAVE_ROLES'; alter role rev127_auth with password '$CLAVE_ROLES';
grant anon, authenticated, service_role to rev127_rest; grant supabase_auth_admin to rev127_auth;
alter role rev127_auth in database $DB set role = 'supabase_auth_admin';
EOF
docker network create "$RED" >/dev/null 2>&1 || true
docker network connect --alias "$CT" "$RED" "$CT" >/dev/null 2>&1 || true
docker rm -f "$C_AUTH" "$C_REST" >/dev/null 2>&1 || true
docker run -d --name "$C_AUTH" --network "$RED" -p 127.0.0.1::9999 --memory 128m \
  -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL="http://127.0.0.1:$PUERTO_GW" \
  -e GOTRUE_DB_DRIVER=postgres -e "GOTRUE_DB_DATABASE_URL=postgres://rev127_auth:$CLAVE_ROLES@$CT:5432/$DB?search_path=auth" \
  -e GOTRUE_SITE_URL=http://127.0.0.1:3081 -e "GOTRUE_URI_ALLOW_LIST=http://127.0.0.1:3081/**" -e GOTRUE_DISABLE_SIGNUP=true -e GOTRUE_JWT_ADMIN_ROLES=service_role \
  -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_EXP=3600 -e "GOTRUE_JWT_SECRET=$JWT_SECRETO" \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_EXTERNAL_PHONE_ENABLED=false public.ecr.aws/supabase/gotrue:v2.197.0 >/dev/null
docker run -d --name "$C_REST" --network "$RED" -p 127.0.0.1::3000 --memory 128m \
  -e "PGRST_DB_URI=postgres://rev127_rest:$CLAVE_ROLES@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e "PGRST_JWT_SECRET=$JWT_SECRETO" \
  -e PGRST_DB_USE_LEGACY_GUCS=false -e PGRST_DB_POOL=4 public.ecr.aws/supabase/postgrest:v16.4 >/dev/null
PUERTO_AUTH="$(docker port "$C_AUTH" 9999/tcp | head -1 | sed 's/.*://')"; PUERTO_REST="$(docker port "$C_REST" 3000/tcp | head -1 | sed 's/.*://')"
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort $PUERTO_GW -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id supabase/scripts/localreview127/entorno_127_local.sh.OwningProcess -Force }" >/dev/null 2>&1 || true
node "$(cygpath -w "$AQUI/gateway_127.cjs" 2>/dev/null || echo "$AQUI/gateway_127.cjs")" "$PUERTO_GW" "$PUERTO_AUTH" "$PUERTO_REST" > "$DIR/gateway.log" 2>&1 &
echo $! > "$DIR/gateway.pid"
URL="http://127.0.0.1:$PUERTO_GW"
for i in $(seq 1 240); do
  A="$(node -e "fetch('$URL/auth/v1/health').then(r=>console.log(r.status),()=>console.log(0))")"
  R="$(node -e "fetch('$URL/rest/v1/',{headers:{apikey:'$ANON'}}).then(r=>console.log(r.status),()=>console.log(0))")"
  [ "$A" = 200 ] && [ "$R" = 200 ] && break; sleep 1
done
[ "$A" = 200 ] && [ "$R" = 200 ] || { echo "Los servicios no respondieron (auth=$A rest=$R)." >&2; exit 1; }
# auth.uid() lee los claims del JWT con PGRST_DB_USE_LEGACY_GUCS=false. Se redefine DESPUÉS de que GoTrue migre (su migración comenta auth.uid() y falla si ya lo cambió otro propietario).
$PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
# Usuarios REALES por GoTrue (login verdadero) + su perfil interno.
crear() { # email nombre rol
  node -e "
    fetch('$URL/auth/v1/admin/users',{method:'POST',headers:{apikey:'$SERVICE',authorization:'Bearer $SERVICE','content-type':'application/json'},body:JSON.stringify({email:'$1',password:'$CLAVE_USUARIOS',email_confirm:true})}).then(r=>r.json()).then(j=>{if(!j.id){console.error(JSON.stringify(j));process.exit(1)}})"
  $PS -d "$DB" -c "insert into public.usuarios (id, email, nombre, rol, tenant, activo) select id, email, '$2', '$3', 'mayorista', true from auth.users where email = '$1' on conflict (id) do update set rol = excluded.rol, activo = true"
}
crear admin127@revision.test "Rev Administracion 127" administracion
crear venta127@revision.test "Rev Venta 127" venta
cat > "$DIR/entorno.env" <<EOF
NEXT_PUBLIC_SUPABASE_URL=$URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
REV127_CLAVE_USUARIOS=$CLAVE_USUARIOS
REV127_DB=$DB
REV127_PG=$CT
EOF
echo "Entorno 127 listo: gateway $URL · variables en $DIR/entorno.env (usuarios admin127@revision.test / venta127@revision.test)."
