#!/bin/sh
# ENTORNO LOCAL del recorrido NAVEGADO de #76/#78 (aviso interno por cotización pública y referidos) con la app COMPILADA (`next start`): base desechable desde una plantilla con la cadena hasta la 326 + las 340, 341 y 342 +
# semilla sintética (`humo_block2_semilla.sql`) + PostgREST + proxy mínimo (`humo_14a_proxy.mjs`) + `next start`. Queda en marcha hasta que exista <salida>/parar y escribe <salida>/env.json
# (base, secreto, puertos) para `humo_block2_recorrido.mjs`. El `.next` debe compilarse con NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54471 y NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-local-304.
# Uso (desde dspacios-travel/):  sh supabase/scripts/entorno_block2_local.sh <contenedor_pg> <plantilla> <carpeta_salida>      NUNCA contra una base real. KEEP=1 conserva la base.
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; SALIDA="${3:?carpeta de salida}"
IMAGEN_REST="${IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
PUERTO_APP=3071; PUERTO_REST=54470; PUERTO_PROXY=54471
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; DB="b2_$TOKEN"; ROL="b2_auth_$TOKEN"; CLAVE="c$(hex 10)"; RED="redb2_$TOKEN"; REST="pgrstb2_$TOKEN"; SECRETO="local-b2-$(hex 24)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
PIDS=""
limpiar() { st=$?
  for p in $PIDS; do kill "$p" >/dev/null 2>&1 || true; done
  powershell -NoProfile -Command "foreach (\$p in $PUERTO_APP, $PUERTO_PROXY) { Get-NetTCPConnection -LocalPort \$p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue } }" >/dev/null 2>&1 || true
  docker rm -f "$REST" >/dev/null 2>&1 || true; docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  [ "${KEEP:-}" = 1 ] || $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true
  $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
mkdir -p "$SALIDA"
for p in $PUERTO_APP $PUERTO_PROXY; do
  powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) { exit 1 }" >/dev/null 2>&1 || { echo "El puerto $p ya está en uso." >&2; exit 2; }
done
[ -f .next/BUILD_ID ] || { echo "Falta .next compilado." >&2; exit 2; }
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for M in supabase/migrations/20260601000340_aviso_cotizacion_publica.sql supabase/migrations/20260601000341_referidos.sql supabase/migrations/20260601000342_registro_b2b_codigo_referido.sql; do
  $PS -d "$DB" < "$M" >/dev/null 2>&1 || { echo "FALLÓ $M" >&2; exit 1; }
done
$PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
$PS -d "$DB" < supabase/scripts/humo_block2_semilla.sql >/dev/null
docker network create "$RED" >/dev/null; docker network connect "$RED" "$CT"
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1:$PUERTO_REST:3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
for i in $(seq 1 30); do node -e "fetch('http://127.0.0.1:$PUERTO_REST/').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},500)"; done
firmar() { ROLJWT="$1" SECRETO="$SECRETO" node -e "const c=require('crypto');const b=s=>Buffer.from(s).toString('base64url');const h=b(JSON.stringify({alg:'HS256',typ:'JWT'}));const p=b(JSON.stringify({role:process.env.ROLJWT,exp:Math.floor(Date.now()/1000)+14400}));process.stdout.write(h+'.'+p+'.'+c.createHmac('sha256',process.env.SECRETO).update(h+'.'+p).digest('base64url'))"; }
JWT_SERVICIO="$(firmar service_role)"; JWT_ANON="$(firmar anon)"
HUMO_PUERTO="$PUERTO_PROXY" HUMO_ANON_JWT="$JWT_ANON" HUMO_REST="http://127.0.0.1:$PUERTO_REST" node supabase/scripts/humo_14a_proxy.mjs > "$SALIDA/proxy.log" 2>&1 &
PIDS="$PIDS $!"
SUPABASE_SERVICE_ROLE_KEY="$JWT_SERVICIO" CRON_SECRET="humo-b2" npx next start -p "$PUERTO_APP" -H 127.0.0.1 > "$SALIDA/app.log" 2>&1 &
PIDS="$PIDS $!"
for i in $(seq 1 60); do node -e "fetch('http://127.0.0.1:$PUERTO_APP/tarifario').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},1000)"; done
printf '{"db":"%s","contenedor":"%s","secreto":"%s","app":"http://127.0.0.1:%s","rest":"http://127.0.0.1:%s"}\n' "$DB" "$CT" "$SECRETO" "$PUERTO_APP" "$PUERTO_REST" > "$SALIDA/env.json"
echo "LISTO $DB"
until [ -f "$SALIDA/parar" ]; do sleep 2; done
