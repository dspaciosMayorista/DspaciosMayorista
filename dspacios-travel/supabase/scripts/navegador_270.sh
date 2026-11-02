#!/bin/sh
# 270 (#120): entorno LOCAL para revisar la tarjeta y el formulario en un navegador real. Levanta Postgres(base desechable)+PostgREST+proxy y ESPERA hasta que exista el archivo de parada;
# al salir borra TODO lo que creó (contenedores, red, rol, base). Uso (desde dspacios-travel/): sh supabase/scripts/navegador_270.sh <base ^t270e_[a-z0-9_]{1,30}$> <puerto_proxy> <archivo_env_salida> <archivo_parada> [contenedor_pg] [plantilla]
set -eu
DB="${1:-}"; PUERTO="${2:-}"; ENV_SALIDA="${3:-}"; PARADA="${4:-}"; CT="${5:-pg255local}"; PLANTILLA="${6:-plantilla255}"
. "$(dirname "$0")/entorno_270_local.sh"
$PS -d "$DB" < "$AQUI/fixtures_270_navegador.sql" >/dev/null
node "$(cygpath -m "$AQUI/proxy_rest_270.mjs" 2>/dev/null || echo "$AQUI/proxy_rest_270.mjs")" "$PUERTO" "$REST_URL" &
PROXY_PID=$!
trap 'kill $PROXY_PID 2>/dev/null || true; limpiar' EXIT
b64u() { printf '%s' "$1" | openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { h="$(b64u '{"alg":"HS256","typ":"JWT"}')"; p="$(b64u "{\"role\":\"$1\"${2:+,\"sub\":\"$2\",\"session_id\":\"$3\"},\"exp\":4102444800}")"; s="$(printf '%s' "$h.$p" | openssl dgst -sha256 -hmac "$SECRETO" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')"; printf '%s.%s.%s' "$h" "$p" "$s"; }
{
  echo "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$PUERTO"
  echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$(jwt anon)"
  echo "SUPABASE_SERVICE_ROLE_KEY=$(jwt service_role)"
  echo "CRON_SECRET=cron-local-270"
  echo "NAV_USER_JWT=$(jwt authenticated 00000000-0000-0000-0000-000000270001 5e550000-0000-0000-0000-000000270001)"
} > "$ENV_SALIDA"
echo "== LISTO: proxy en http://127.0.0.1:$PUERTO · env en $ENV_SALIDA · crea $PARADA para terminar =="
while [ ! -e "$PARADA" ]; do sleep 2; done
