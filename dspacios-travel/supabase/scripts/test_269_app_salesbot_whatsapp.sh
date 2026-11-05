#!/usr/bin/env bash
# Prueba LOCAL de CONCURRENCIA REAL del canal WhatsApp de SalesBot (#56): el almacén de producción (lib/whatsapp/almacen.ts) contra
# Postgres + PostgREST reales en contenedores desechables. NUNCA contra Supabase real.
# REQUIERE la migración 269 (PR de esquema) ya fusionada: aplica supabase/migrations/20260601000269_salesbot_whatsapp.sql tal cual.
# Requisitos: Docker, imágenes public.ecr.aws/supabase/postgres:15.8.1.085 y public.ecr.aws/supabase/postgrest:v16.4, Node >= 22.
# Se corre desde dspacios-travel/:   sh supabase/scripts/test_269_app_salesbot_whatsapp.sh
set -eu
export MSYS_NO_PATHCONV=1
MIG=supabase/migrations/20260601000269_salesbot_whatsapp.sql
[ -f "$MIG" ] || { echo "Falta $MIG: este script requiere el PR de esquema (migración 269) ya fusionado."; exit 1; }
PG=pg269app; RS=pgrst269app; PORT_RS=3279; PORT_PROXY=3280
SQL="docker exec -i -e PGPASSWORD=postgres $PG psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q"
limpiar() { docker rm -f "$RS" "$PG" >/dev/null 2>&1 || true; [ -n "${PROXY_PID:-}" ] && kill "$PROXY_PID" 2>/dev/null || true; }
trap limpiar EXIT
limpiar

docker run -d --name "$PG" -e POSTGRES_PASSWORD=postgres public.ecr.aws/supabase/postgres:15.8.1.085 >/dev/null
# La imagen arranca, se reinicia una vez al terminar su init y recién ahí queda estable: se espera dos veces.
esperar() { for i in $(seq 1 90); do docker exec -e PGPASSWORD=postgres "$PG" psql -U supabase_admin -d postgres -qtAc "select 1" >/dev/null 2>&1 && return 0; sleep 2; done; echo "Postgres no arrancó"; exit 1; }
esperar; sleep 10; esperar
$SQL -c "create table public.usuarios (id uuid primary key);" # única dependencia externa de la 269 (FK atendido_por)
$SQL -f - < "$MIG"

# PostgREST real + proxy que quita el prefijo /rest/v1 que antepone supabase-js.
JWT_SECRET="secreto-solo-para-pruebas-locales-0123456789"
$SQL -c "alter role authenticator with password 'postgres';"
docker run -d --name "$RS" --link "$PG":db -p "$PORT_RS":3000 -e PGRST_DB_URI="postgres://authenticator:postgres@db:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT_SECRET" public.ecr.aws/supabase/postgrest:v16.4 >/dev/null
sleep 4
KEY=$(node -e '
const c=require("crypto"),b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}),p=b({role:"service_role",exp:Math.floor(Date.now()/1000)+3600});
console.log(h+"."+p+"."+c.createHmac("sha256",process.argv[1]).update(h+"."+p).digest("base64url"));' "$JWT_SECRET")
node -e '
const http=require("http");
http.createServer((q,r)=>{const u=q.url.replace(/^\/rest\/v1/,"");const p=http.request({host:"127.0.0.1",port:+process.argv[1],path:u,method:q.method,headers:q.headers},(s)=>{r.writeHead(s.statusCode,s.headers);s.pipe(r)});q.pipe(p)}).listen(+process.argv[2]);' "$PORT_RS" "$PORT_PROXY" &
PROXY_PID=$!
sleep 1

echo "== concurrencia real (almacén de producción → PostgREST → Postgres) =="
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$PORT_PROXY" SUPABASE_SERVICE_ROLE_KEY="$KEY" \
  node --experimental-strip-types --import ./supabase/scripts/sin_server_only.mjs --experimental-loader ./pruebas/support/aliasLoader.mjs supabase/scripts/test_269_concurrencia_real.ts
echo "TODO OK"
