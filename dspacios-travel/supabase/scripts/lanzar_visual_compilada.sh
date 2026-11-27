#!/bin/sh
# ────────────────────────────────────────────────────────────────────────────
# Lanzador del arnés de inspección de la app COMPILADA (visual_compilada_lib.mjs): crea una base DESECHABLE desde una plantilla, aplica los SQL indicados
# (migraciones y semilla), levanta un PostgREST propio y corre el script .mjs, que arranca `next start`, el proxy (REST/GoTrue mínimo/Storage en memoria) y Edge por CDP.
# Uso (desde dspacios-travel/ del worktree que tiene el build en .next):
#   sh supabase/scripts/lanzar_visual_compilada.sh <contenedor_pg> <plantilla> <salida> <script.mjs> [archivo.sql ...]
# Todo lo que crea (base, rol, red, contenedor PostgREST) lleva un nombre aleatorio propio y se elimina al terminar (VC_KEEP=1 conserva la base). Nunca toca otra base.
# ────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; SALIDA="${3:?carpeta de salida}"; SCRIPT="${4:?script .mjs}"; shift 4
IMAGEN_REST="${IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; DB="vc_$TOKEN"; ROL="vc_auth_$TOKEN"; CLAVE="c$(hex 10)"; RED="redvc_$TOKEN"; REST="pgrstvc_$TOKEN"; SECRETO="local-vc-$(hex 24)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
limpiar() { st=$?; docker rm -f "$REST" >/dev/null 2>&1 || true; docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  if [ "${VC_KEEP:-0}" != "1" ]; then $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true; else echo "Base conservada: $DB (rol $ROL)"; fi; exit "$st"; }
trap limpiar EXIT
mkdir -p "$SALIDA"
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for f in "$@"; do
  ERR="$($PS -d "$DB" < "$f" 2>&1)" || { echo "No se pudo cargar $f"; echo "$ERR" | tail -6; exit 2; }
  echo "  cargado: $(basename "$f")"
done
$PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null; docker network connect "$RED" "$CT"
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1::3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
URL="http://127.0.0.1:$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
for i in $(seq 1 30); do node -e "fetch('$URL/').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},500)"; done
echo "PostgREST en $URL contra $DB"
RCF="$SALIDA/.rc_$TOKEN"
{ VC_REST="$URL" VC_SECRETO="$SECRETO" VC_PS="$PS -d $DB" VC_SALIDA="$SALIDA" VC_APP_DIR="$(pwd -W 2>/dev/null || pwd)" node "$SCRIPT" 2>&1; echo $? > "$RCF"; }   | grep -v ExperimentalWarning | grep -v "^(node:" | tee "$SALIDA/$(basename "$SCRIPT" .mjs).log" || true
RC="$(cat "$RCF" 2>/dev/null || echo 1)"
exit "$RC"
