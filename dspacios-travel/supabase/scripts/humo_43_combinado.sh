#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# HUMO + REVISIÓN VISUAL del árbol combinado (#43/#60 + lote): build de producción contra un Supabase local desechable, datos del recorrido de la entrega 6,
# generación ⇒ publicación ⇒ lectura de la tarjeta ⇒ cotización precargada (550.000, nunca 500.000) + CONTEO de solicitudes con y sin
# promociones (por fechas y sobre tarifa publicada). NUNCA contra una base real.
# Uso (desde dspacios-travel/):  sh supabase/scripts/recorrido_43_e6.sh <contenedor_pg> <plantilla>
#   «Antes» (código de HEAD sobre la misma base): R6_MODO=conteo R6_ARBOL=<ruta a dspacios-travel de un worktree limpio de HEAD> sh …
# Base desechable (cadena 293 → 302 + fixtures de las entregas 5 y 6) y PostgREST propio en red propia. Lo borra todo al final.
# ─────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
# `next start`, rutas clave y capturas de Edge a 375 px y 1280 px (humo_43_combinado.mjs). NUNCA contra una base real.
# Uso (desde dspacios-travel/):  sh supabase/scripts/humo_43_combinado.sh <contenedor_pg> <plantilla> <carpeta_capturas>
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"
IMAGEN_REST="${IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
SALIDA="${3:?carpeta de capturas}"
P_SB=54390; P_APP=3046; P_WEB=3047
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
# Secreto FIJO de esta prueba local: el build incrusta la URL y la clave anónima (NEXT_PUBLIC_*), así que deben ser las del humo.
SECRETO="humo43-local-secreto-solo-pruebas-0123456789"
ANON="$(node -e "const c=require('node:crypto');const b=s=>Buffer.from(s).toString('base64url');const h=b(JSON.stringify({alg:'HS256',typ:'JWT'})),p=b(JSON.stringify({role:'anon',exp:1924992000}));console.log(h+'.'+p+'.'+c.createHmac('sha256','$SECRETO').update(h+'.'+p).digest('base64url'))")"
SERVICIO="$(node -e "const c=require('node:crypto');const b=s=>Buffer.from(s).toString('base64url');const h=b(JSON.stringify({alg:'HS256',typ:'JWT'})),p=b(JSON.stringify({role:'service_role',exp:1924992000}));console.log(h+'.'+p+'.'+c.createHmac('sha256','$SECRETO').update(h+'.'+p).digest('base64url'))")"
if [ -z "${H_SIN_BUILD:-}" ]; then
echo "--- build de producción (Supabase del humo: http://127.0.0.1:$P_SB)"
rm -rf .next
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$P_SB" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON" SUPABASE_SERVICE_ROLE_KEY="$SERVICIO" NEXT_TELEMETRY_DISABLED=1 \
  NODE_OPTIONS=--max-old-space-size=6144 npx next build > "$SALIDA.build.log" 2>&1 || { tail -20 "$SALIDA.build.log"; echo "FALLO build"; exit 1; }
grep -a "Compiled successfully" "$SALIDA.build.log"
else echo "--- build: se reutiliza el de la corrida anterior (H_SIN_BUILD)"; fi
TOKEN="$(hex 6)"; DB="h43_$TOKEN"; ROL="h43_auth_$TOKEN"; CLAVE="c$(hex 10)"; RED="redh43_$TOKEN"; REST="pgrsth43_$TOKEN"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
limpiar() { st=$?; docker rm -f "$REST" >/dev/null 2>&1 || true; docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for f in supabase/scripts/fixture_293_vigencia_grupos_dias.sql supabase/migrations/20260601000295_grupos_dias_propuesta.sql supabase/scripts/fixture_295_grupos_dias_propuesta.sql \
         supabase/migrations/20260601000297_calculadora_grupos_dias.sql supabase/scripts/fixture_297_calculadora_grupos_dias.sql \
         supabase/migrations/20260601000298_calculadora_grupos_generales.sql supabase/migrations/20260601000299_grupos_dias_activacion.sql supabase/scripts/fixture_299_grupos_dias_activacion.sql \
         supabase/migrations/20260601000300_promociones_grupo.sql supabase/migrations/20260601000301_promociones_acumulacion.sql supabase/migrations/20260601000302_desde_estadia_real.sql \
         supabase/scripts/fixture_recorrido_43_e5.sql supabase/scripts/fixture_recorrido_43_e6.sql; do
  ERR="$($PS -d "$DB" < "$f" 2>&1)" || { echo "No se pudo cargar $f"; echo "$ERR" | tail -5; exit 2; }
done
$PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null; docker network connect "$RED" "$CT"
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1::3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
URL="http://127.0.0.1:$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
for i in $(seq 1 30); do node -e "fetch('$URL/').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},500)"; done
ARGS="--experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs"
echo "--- datos: recorrido real de la entrega 6 (grupos activos, paquetes generados y publicados)"
R6_RAIZ="$(pwd -W)" R6_MODO=completo R6_REST="$URL" R6_SECRETO="$SECRETO" R6_PS="$PS -d $DB" node $ARGS supabase/scripts/recorrido_43_e6.mjs 2>&1 | grep -aE "^(OK|FALLO)|^===" 
echo "--- humo y capturas"
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$P_SB" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON" SUPABASE_SERVICE_ROLE_KEY="$SERVICIO" NEXT_TELEMETRY_DISABLED=1 \
  H_REST="$URL" H_SECRETO="$SECRETO" H_SALIDA="$SALIDA" H_PUERTO_SB=$P_SB H_PUERTO_APP=$P_APP H_PUERTO_WEB=$P_WEB node supabase/scripts/humo_43_combinado.mjs
