#!/usr/bin/env bash
# #62 (V1) — PILA LOCAL REAL y aislada para la app compilada: Postgres con el esquema completo (copia de una plantilla), GoTrue, PostgREST, Mailpit y el gateway.
# Todo con prefijo v1real_ y en loopback; el correo SOLO llega a Mailpit (sin SMTP real). No toca otros contenedores ni bases (la base se llama v1_real).
#   bash pila.sh subir <carpeta_config> <contenedor_pg> <plantilla>     bash pila.sh bajar <carpeta_config> <contenedor_pg>
# Variables opcionales (revisión consolidada del dueño): PILA_DB=<base existente> (NO se crea desde plantilla ni se borra al bajar), PILA_SIN_MIGRACIONES=1, PILA_STORAGE_DIR=<carpeta con los archivos de Storage>, PILA_OTP_EXP=<segundos de vida del código (por defecto 20)>.
# <carpeta_config> contiene config.json (claves.mjs). La plantilla debe traer el esquema completo (preparar_esquema_local.sh … plantillab2b).
set -u -o pipefail
export MSYS_NO_PATHCONV=1
ACCION="${1:-}"; CFG="${2:-}"; PG="${3:-pgb2b}"; PLANTILLA="${4:-plantillab2b}"
[ -n "$ACCION" ] && [ -f "$CFG/config.json" ] || { echo "Uso: pila.sh subir|bajar <carpeta_config> [contenedor_pg] [plantilla]"; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
c() { node -p "require('$CFG/config.json').$1"; }
SECRETO="$(c jwtSecret)"; CLAVE="$(c rolesPassword)"; P_GW="$(c puertos.gateway)"; P_AUTH="$(c puertos.auth)"; P_REST="$(c puertos.rest)"; P_MAIL="$(c puertos.correo)"; P_APP="$(c puertos.app)"; P_STOR="$(c puertos.storage)"; P_TPL=19085
DB="${PILA_DB:-v1_real}"; NET=v1real_net; AUTH=v1real_auth; REST=v1real_rest; MAIL=v1real_mail; STOR=v1real_stor
PSQL="docker exec -i -e PGPASSWORD=postgres $PG psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"

bajar() {
  # El pid de Git Bash no es el de Windows: el gateway se detiene por el PUERTO que ocupa (es propio de esta pila).
  powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort $P_GW -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" >/dev/null 2>&1
  powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort 19085 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" >/dev/null 2>&1
  rm -f "$CFG/gateway.pid"
  docker rm -f "$AUTH" "$REST" "$MAIL" "$STOR" >/dev/null 2>&1
  docker network disconnect "$NET" "$PG" >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1
  [ -n "${PILA_DB:-}" ] || $PSQL -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1   # una base de revisión indicada con PILA_DB nunca se borra
}
if [ "$ACCION" = "bajar" ]; then bajar; echo "pila v1real bajada"; exit 0; fi

bajar
docker start "$PG" >/dev/null || { echo "no arranca $PG"; exit 2; }
for i in $(seq 1 60); do docker exec "$PG" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done; sleep 3
# CREATE DATABASE … TEMPLATE exige que nadie esté conectado a la plantilla (un proceso de fondo puede estarlo un instante tras arrancar el contenedor): se cierran y se reintenta.
COPIADA=0
if [ -n "${PILA_DB:-}" ]; then
  [ "$($PSQL -t -A -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = 1 ] || { echo "no existe la base $DB"; exit 2; }
  COPIADA=1
else
for i in 1 2 3 4 5; do
  $PSQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null 2>&1
  if $PSQL -d postgres -c "create database $DB template $PLANTILLA" 2>/dev/null; then COPIADA=1; break; fi; sleep 3
done
fi
[ "$COPIADA" = 1 ] || { echo "no se pudo copiar la plantilla $PLANTILLA"; exit 2; }
$PSQL -d postgres -c "alter role authenticator with password '$CLAVE'; alter role supabase_auth_admin with password '$CLAVE'; alter role supabase_storage_admin with password '$CLAVE';" || exit 2
# Entorno (no esquema de la app): el esquema auth debe ser de supabase_auth_admin y auth.sessions necesita updated_at (ver local4360/dueno_auth_local4360.sql).
$PSQL -d $DB -f - < "$AQUI/../local4360/dueno_auth_local4360.sql" || exit 2
# La plantilla trae 001-314; las migraciones posteriores de ESTE bloque (316: recuperaciones_consumidas; 317: NETO en la dinámica B2B normal, #48) se aplican sobre la copia, con su propio preflight/postcheck fuera de aquí.
[ "${PILA_SIN_MIGRACIONES:-0}" = 1 ] || for M in "$AQUI"/../../migrations/20260601000316_*.sql "$AQUI"/../../migrations/20260601000317_*.sql "$AQUI"/../../migrations/20260601000318_*.sql "$AQUI"/../../migrations/20260601000319_*.sql "$AQUI"/../../migrations/20260601000322_*.sql "$AQUI"/../../migrations/20260601000323_*.sql "$AQUI"/../../migrations/20260601000324_*.sql; do $PSQL -d $DB -f - < "$M" || exit 2; done
# auth.uid() de la imagen solo lee request.jwt.claim.sub; PostgREST v16 entrega request.jwt.claims.
$PSQL -d $DB -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" || exit 2

docker network create "$NET" >/dev/null || exit 2
docker network connect "$NET" "$PG" --alias v1real_pg || exit 2
docker run -d --name "$MAIL" --network "$NET" --memory 64m -p "127.0.0.1:$P_MAIL:8025" public.ecr.aws/supabase/mailpit:v1.31.3 >/dev/null || exit 2
# OTP_EXP=20 s: permite probar un enlace VENCIDO esperando 25 s; los demás recorridos usan el enlace al instante. Límites de frecuencia altos solo para esta base de prueba.
(cd "$AQUI" && nohup node -e "require('http').createServer((q,r)=>{r.setHeader('content-type','text/html; charset=utf-8');r.end(require('fs').readFileSync('plantilla_confirmacion_codigo.html'))}).listen($P_TPL,'0.0.0.0')" > "$CFG/plantilla.log" 2>&1 &)
docker run -d --name "$AUTH" --network "$NET" --memory 192m -p "127.0.0.1:$P_AUTH:9999" \
  -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL="http://127.0.0.1:$P_GW" -e GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify -e GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify -e GOTRUE_MAILER_URLPATHS_INVITE=/auth/v1/verify -e GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify \
  -e GOTRUE_DB_DRIVER=postgres -e "GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:$CLAVE@v1real_pg:5432/$DB?search_path=auth" \
  -e GOTRUE_SITE_URL="http://localhost:$P_APP" -e "GOTRUE_URI_ALLOW_LIST=http://localhost:$P_APP/**,http://127.0.0.1:$P_APP/**" \
  -e GOTRUE_DISABLE_SIGNUP=true -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_EXP=3600 -e "GOTRUE_JWT_SECRET=$SECRETO" \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=false -e GOTRUE_EXTERNAL_PHONE_ENABLED=false -e GOTRUE_MAILER_OTP_EXP=${PILA_OTP_EXP:-20} -e "GOTRUE_MAILER_TEMPLATES_CONFIRMATION=http://host.docker.internal:$P_TPL/" -e "GOTRUE_MAILER_SUBJECTS_CONFIRMATION=Tu código de verificación" -e GOTRUE_SMTP_MAX_FREQUENCY=1s \
  -e GOTRUE_SMTP_HOST="$MAIL" -e GOTRUE_SMTP_PORT=1025 -e GOTRUE_SMTP_ADMIN_EMAIL=no-responder@local.test -e GOTRUE_SMTP_SENDER_NAME="D'spacios local" \
  -e GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 -e GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UPS=1000 -e GOTRUE_RATE_LIMIT_TOKEN_REFRESH=1000 -e GOTRUE_RATE_LIMIT_VERIFY=1000 -e GOTRUE_PASSWORD_MIN_LENGTH=6 \
  -e GOTRUE_LOG_LEVEL=warn public.ecr.aws/supabase/gotrue:v2.197.0 >/dev/null || exit 2
docker run -d --name "$REST" --network "$NET" --memory 160m -p "127.0.0.1:$P_REST:3000" \
  -e "PGRST_DB_URI=postgres://authenticator:$CLAVE@v1real_pg:5432/$DB" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e "PGRST_JWT_SECRET=$SECRETO" -e PGRST_DB_USE_LEGACY_GUCS=false -e PGRST_DB_MAX_ROWS=1000 \
  public.ecr.aws/supabase/postgrest:v16.4 >/dev/null || exit 2

docker run -d --name "$STOR" --network "$NET" --memory 256m $( [ -n "${PILA_STORAGE_DIR:-}" ] && echo "-v ${PILA_STORAGE_DIR}:/var/lib/storage" || echo "--tmpfs /var/lib/storage:rw,size=256m" ) -p "127.0.0.1:$P_STOR:5000" \
  -e "ANON_KEY=$(c anonKey)" -e "SERVICE_KEY=$(c serviceKey)" -e "PGRST_JWT_SECRET=$SECRETO" -e "AUTH_JWT_SECRET=$SECRETO" \
  -e "POSTGREST_URL=http://$REST:3000" -e "DATABASE_URL=postgres://supabase_storage_admin:$CLAVE@v1real_pg:5432/$DB" \
  -e FILE_SIZE_LIMIT=52428800 -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage \
  -e TENANT_ID=v1real -e REGION=local -e GLOBAL_S3_BUCKET=v1real -e ENABLE_IMAGE_TRANSFORMATION=false \
  public.ecr.aws/supabase/storage-api:v1.84.19 >/dev/null || exit 2

LISTO=0
for i in $(seq 1 180); do
  if curl.exe -s -o ./.v1.$$ -w "%{http_code}" "http://127.0.0.1:$P_AUTH/health" 2>/dev/null | grep -q 200; then LISTO=1; break; fi; sleep 2
done; rm -f ./.v1.$$
[ "$LISTO" = 1 ] || { echo "GoTrue no arrancó:"; docker logs "$AUTH" 2>&1 | tail -20; exit 2; }
sleep 3
STOK=0
for i in $(seq 1 90); do
  if curl.exe -s -o ./.v1s.$ -w "%{http_code}" "http://127.0.0.1:$P_STOR/status" 2>/dev/null | grep -q 200; then STOK=1; break; fi; sleep 2
done; rm -f ./.v1s.$
[ "$STOK" = 1 ] || { echo "storage-api no arrancó:"; docker logs "$STOR" 2>&1 | tail -20; exit 2; }
(cd "$AQUI" && ANON_ALIAS="${V1_ANON_ALIAS:-}" ANON_REAL="$(c anonKey)" nohup node gateway.mjs "$P_GW" "$P_AUTH" "$P_REST" "$P_STOR" > "$CFG/gateway.log" 2>&1 & echo $! > "$CFG/gateway.pid")
sleep 2
curl.exe -s -o ./.v1.$$ -w "gateway→auth %{http_code}\n" "http://127.0.0.1:$P_GW/auth/v1/health"; rm -f ./.v1.$$
echo "pila v1real lista: gateway :$P_GW  correo :$P_MAIL"
