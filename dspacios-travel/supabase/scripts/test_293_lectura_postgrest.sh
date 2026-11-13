#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# #43/#60 incremento 2 — LECTURA COMBINADA (vigencias + grupos incrustados) por HTTP contra un
# PostgREST LOCAL propio, con JWT por rol. SOLO Docker local y desechable.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_293_lectura_postgrest.sh <contenedor_pg> <plantilla>
# Crea una base nueva desde la plantilla, aplica la 293, carga el fixture de la 293, levanta PostgREST
# en una red propia y corre pruebas/lecturaGrupos293.pg.mjs. Borra base, rol, red y contenedor al final.
# ─────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"
IMAGEN_REST="${IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; DB="t293rest_$TOKEN"; ROL="t293_auth_$TOKEN"; CLAVE="c$(hex 10)"; RED="red293_$TOKEN"; REST="pgrst293_$TOKEN"
SECRETO="local-293-$(hex 24)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
limpiar() {
  st=$?
  docker rm -f "$REST" >/dev/null 2>&1 || true
  docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true
  docker network rm "$RED" >/dev/null 2>&1 || true
  $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true
  $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true
  exit "$st"
}
trap limpiar EXIT

$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
$PS -d "$DB" < supabase/migrations/20260601000293_vigencia_grupos_dias_inactivos.sql >/dev/null
$PS -d "$DB" < supabase/scripts/fixture_293_vigencia_grupos_dias.sql >/dev/null
# Esquema FINAL del frente (#43/#60): los cargadores actuales leen además columnas de la 300 (promo_base_id…) y la combinación de la 301;
# sin ellas su lectura real responde 400 por otra razón. Solo esquema (sin fixtures): esta prueba mira la lectura de los grupos.
for m in 295_grupos_dias_propuesta 297_calculadora_grupos_dias 298_calculadora_grupos_generales 299_grupos_dias_activacion 300_promociones_grupo 301_promociones_acumulacion 302_desde_estadia_real; do
  $PS -d "$DB" < "supabase/migrations/20260601000${m}.sql" >/dev/null 2>&1 || { echo "No se pudo aplicar la ${m}"; exit 2; }
done
# ENTORNO (no esquema): la imagen local trae el auth.uid() antiguo, que solo lee request.jwt.claim.sub;
# PostgREST v16 fija request.jwt.claims. Se usa la definición de Supabase, que lee ambas.
$PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null
docker network connect "$RED" "$CT"
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1::3000" \
  -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
PUERTO="$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
URL="http://127.0.0.1:$PUERTO"
for i in $(seq 1 30); do curl.exe -s -o ./.t293.$$ "$URL/" 2>/dev/null && break; node -e "setTimeout(()=>{},500)"; done
rm -f ./.t293.$$
echo "PostgREST $IMAGEN_REST en $URL contra $DB"
T293_URL="$URL" T293_SECRETO="$SECRETO" T293_SQL="$PS -d $DB" node pruebas/lecturaGrupos293.pg.mjs
