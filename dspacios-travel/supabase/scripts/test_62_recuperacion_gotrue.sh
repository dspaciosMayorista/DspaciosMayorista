#!/usr/bin/env bash
# #62 — recorrido real de recuperación/cambio de contraseña contra GoTrue + Mailpit LOCALES y desechables (Postgres propio, red docker propia, sin salida a Internet).
# Contenedores y red con prefijo b2b62_ (todo se borra al terminar). Memoria acotada: db 512m, auth 160m, mail 64m. No toca ningún otro contenedor.
# Los correos solo llegan a Mailpit (sin SMTP real). Uso (desde dspacios-travel/):  bash supabase/scripts/test_62_recuperacion_gotrue.sh
set -u
export MSYS_NO_PATHCONV=1
DB=b2b62_db; AUTH=b2b62_auth; MAIL=b2b62_mail; NET=b2b62_net
PUERTO_AUTH="${B2B62_PUERTO_AUTH:-19062}"; PUERTO_MAIL="${B2B62_PUERTO_MAIL:-19063}"
IMG_DB=public.ecr.aws/supabase/postgres:15.8.1.085
IMG_AUTH=public.ecr.aws/supabase/gotrue:v2.197.0
IMG_MAIL=public.ecr.aws/supabase/mailpit:v1.31.3
SECRETO="local-62-$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
CLAVE_DB=postgres
AQUI="$(cd "$(dirname "$0")" && pwd)"
limpiar() { docker rm -f "$AUTH" "$MAIL" "$DB" >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1; }
trap limpiar EXIT
limpiar
docker network create "$NET" >/dev/null || exit 2

docker run -d --name "$DB" --network "$NET" --memory 512m -e POSTGRES_PASSWORD="$CLAVE_DB" "$IMG_DB" >/dev/null || exit 2
for i in $(seq 1 90); do docker exec "$DB" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
sleep 4
# Preparación del ENTORNO (no del esquema de la app): el esquema auth debe ser de supabase_auth_admin para que GoTrue migre.
docker exec -e PGPASSWORD="$CLAVE_DB" "$DB" psql -h 127.0.0.1 -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "alter user supabase_auth_admin with password '$CLAVE_DB';" \
  -c "create schema if not exists auth authorization supabase_auth_admin;" \
  -c "alter schema auth owner to supabase_auth_admin;" \
  -c "grant all on schema auth to supabase_auth_admin;" || { echo "no se pudo preparar el esquema auth"; exit 2; }

docker run -d --name "$MAIL" --network "$NET" --memory 64m -p "127.0.0.1:$PUERTO_MAIL:8025" "$IMG_MAIL" >/dev/null || exit 2
docker run -d --name "$AUTH" --network "$NET" --memory 160m -p "127.0.0.1:$PUERTO_AUTH:9999" \
  -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL="http://127.0.0.1:$PUERTO_AUTH" \
  -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$CLAVE_DB@$DB:5432/postgres?search_path=auth" \
  -e GOTRUE_SITE_URL=http://localhost:3000 -e GOTRUE_URI_ALLOW_LIST="http://localhost:3000/**" \
  -e GOTRUE_JWT_SECRET="$SECRETO" -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=false \
  -e GOTRUE_SMTP_HOST="$MAIL" -e GOTRUE_SMTP_PORT=1025 -e GOTRUE_SMTP_ADMIN_EMAIL=no-responder@local.test -e GOTRUE_SMTP_SENDER_NAME="D'spacios local" \
  -e GOTRUE_RATE_LIMIT_EMAIL_SENT=100 -e GOTRUE_MAILER_URLPATHS_RECOVERY=/verify -e GOTRUE_PASSWORD_MIN_LENGTH=6 \
  -e GOTRUE_LOG_LEVEL=warn "$IMG_AUTH" >/dev/null || exit 2

# La primera migración de GoTrue puede tardar más de un minuto.
LISTO=0
for i in $(seq 1 150); do
  if curl.exe -s -o ./.b2b62.$$ -w "%{http_code}" "http://127.0.0.1:$PUERTO_AUTH/health" 2>/dev/null | grep -q 200; then LISTO=1; break; fi
  sleep 2
done
rm -f ./.b2b62.$$
if [ "$LISTO" != 1 ]; then echo "GoTrue no arrancó. Registro:"; docker logs "$AUTH" 2>&1 | tail -25; exit 2; fi

cd "$AQUI/../.." && B2B62_AUTH="http://127.0.0.1:$PUERTO_AUTH" B2B62_MAIL="http://127.0.0.1:$PUERTO_MAIL" B2B62_SECRET="$SECRETO" node supabase/scripts/test_62_recuperacion_gotrue.mjs
RC=$?
if [ "$RC" -ne 0 ]; then echo "--- registro de GoTrue (últimas líneas) ---"; docker logs "$AUTH" 2>&1 | tail -25; fi
exit $RC
