#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# SOPORTES DE PAGO (#86) · arnés de STORAGE REAL: storage-api local + PostgreSQL local con el esquema 001-280 y la migración 281 (bucket soportes-pago).
# Mide tamaño, tipos, acceso, sobrescritura, URL firmada (subida y lectura), mismos bytes y memoria/concurrencia (pruebas/support/storage281.mjs).
# SOLO Docker local desechable. Nada habla con Supabase remoto. No pide ni imprime credenciales: todo secreto es aleatorio y vive solo en esta corrida.
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_281_storage.sh <base_nueva> [contenedor_pg] [plantilla]
#     base_nueva  ^t281s_[a-z0-9_]{1,40}$ y que NO exista (se crea desde la plantilla y se borra al final; KEEP=1 la conserva).
#     Imagen de storage-api: STORAGE281_IMAGEN (por defecto public.ecr.aws/supabase/storage-api:v1.84.19, ya presente en este equipo).
# Si storage-api no arranca (imagen ausente, sin red, esquema incompatible) el script termina con «NO EJECUTABLE» y código 4: nunca inventa resultados.
# Propiedad: borra solo lo que crea (contenedor con etiqueta dspacios.test281s=<token>, red red281s_<token>, volumen vol281s_<token>, la base con su marca).
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"; CT="${2:-pg86soportes}"; PLANTILLA="${3:-plantilla86}"
IMAGEN="${STORAGE281_IMAGEN:-public.ecr.aws/supabase/storage-api:v1.84.19}"
export MSYS_NO_PATHCONV=1
ok() { printf '%s' "$1" | grep -Eq "$2"; }
ok "$DB" '^t281s_[a-z0-9_]{1,40}$' || { echo "Base inválida: ^t281s_[a-z0-9_]{1,40}\$." >&2; exit 2; }
ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 8)"; SECRETO="local-281s-$(hex 24)"
ST="stg281s_$(hex 4)"; RED="red281s_$TOKEN"; VOL="vol281s_$TOKEN"; MARCA="test_281_storage $TOKEN"
AQUI="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$AQUI/../.." && pwd)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
BASE_PROPIA=0; RED_PROPIA=0
limpiar() {
  st=$?
  docker rm -f "$ST" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  if [ "$RED_PROPIA" = 1 ]; then docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true; fi
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    marca="$($PS -d postgres -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'" 2>/dev/null || true)"
    if [ "$marca" = "$MARCA" ]; then for i in 1 2 3 4 5; do $PS -d postgres -c "drop database $DB" >/dev/null 2>&1 && break; sleep 2; done; fi
  fi
  exit "$st"
}
trap limpiar EXIT
docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
docker image inspect "$IMAGEN" >/dev/null 2>&1 || { echo "NO EJECUTABLE: la imagen $IMAGEN no está en este equipo (y este script no descarga nada)." >&2; exit 4; }
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

# Tokens (HS256) con el secreto aleatorio de esta corrida.
jwt() { node -e 'const c=require("crypto");const b=s=>Buffer.from(s).toString("base64url");const h=b(JSON.stringify({alg:"HS256",typ:"JWT"}));const p=b(JSON.stringify({...JSON.parse(process.argv[2]),exp:Math.floor(Date.now()/1000)+7200}));console.log(h+"."+p+"."+c.createHmac("sha256",process.argv[1]).update(h+"."+p).digest("base64url"))' "$SECRETO" "$1"; }
SERVICE_KEY="$(jwt '{"role":"service_role"}')"; ANON_KEY="$(jwt '{"role":"anon"}')"; AUTH_KEY="$(jwt '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000281999"}')"

CLAVE_ST="s281$(hex 10)"
# El rol de Storage de la imagen no trae contraseña útil: se fija una aleatoria en ESTE contenedor local (no toca nada remoto).
$PS -d postgres -c "alter role supabase_storage_admin with login password '$CLAVE_ST'" >/dev/null
docker network create "$RED" >/dev/null; RED_PROPIA=1
docker network connect "$RED" "$CT" >/dev/null
docker volume create "$VOL" >/dev/null
docker run -d --name "$ST" --network "$RED" --label "dspacios.test281s=$TOKEN" -v "$VOL:/var/lib/storage" -p "127.0.0.1::5000" \
  -e ANON_KEY="$ANON_KEY" -e SERVICE_KEY="$SERVICE_KEY" -e AUTH_JWT_SECRET="$SECRETO" -e PGRST_JWT_SECRET="$SECRETO" -e JWT_SECRET="$SECRETO" \
  -e DATABASE_URL="postgres://supabase_storage_admin:$CLAVE_ST@$CT:5432/$DB" -e POSTGREST_URL="http://127.0.0.1:3000" \
  -e FILE_SIZE_LIMIT=52428800 -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e TENANT_ID=stub -e REGION=stub -e GLOBAL_S3_BUCKET=stub \
  -e ENABLE_IMAGE_TRANSFORMATION=false -e UPLOAD_FILE_SIZE_LIMIT=52428800 -e UPLOAD_FILE_SIZE_LIMIT_STANDARD=5242880 \
  -e PGOPTIONS="-c search_path=storage,public" "$IMAGEN" >/dev/null
PUERTO="$(docker port "$ST" 5000/tcp | head -1 | sed 's/.*://')"
i=0
until curl.exe -s -o ./.st281.$$ -w '%{http_code}' "http://127.0.0.1:$PUERTO/status" 2>/dev/null | grep -qx 200; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then docker logs "$ST" 2>&1 | tail -15 >&2; rm -f ./.st281.$$; echo "NO EJECUTABLE: storage-api no arrancó contra este esquema (ver registro arriba)." >&2; exit 4; fi
  sleep 1
done
rm -f ./.st281.$$
# La migración 281 se aplica DESPUÉS de que storage-api migre su propio esquema: así el bucket nace con las columnas reales de Storage.
$PS -1 -d "$DB" -f - < "$APP/supabase/migrations/20260601000281_soportes_pago.sql" >/dev/null
cd "$APP"
STORAGE_URL="http://127.0.0.1:$PUERTO" SERVICE_KEY="$SERVICE_KEY" ANON_KEY="$ANON_KEY" AUTH_KEY="$AUTH_KEY" node --expose-gc pruebas/support/storage281.mjs
