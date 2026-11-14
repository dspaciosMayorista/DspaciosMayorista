#!/bin/sh
# ENTORNO LOCAL del recorrido #14-A en la app COMPILADA con tarifas sintéticas REALES (motor de precios sin simular): base desechable desde la plantilla + migraciones 304/305(/306) + semilla
# (`humo_14a_semilla_real.sql`) + tarifario publicado con `generarTarifario` + PostgREST + proxy (GoTrue mínimo con varios usuarios) + `next start`. Queda en marcha hasta que exista <salida>/parar
# y escribe <salida>/env.json (base, secreto, puertos) para los recorridos. Uso (desde dspacios-travel/, con .next compilado con NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 y
# NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-local-304):  sh supabase/scripts/entorno_14a_real.sh <contenedor_pg> <plantilla> <carpeta_salida>      NUNCA contra una base real.
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; SALIDA="${3:?carpeta de salida}"
IMAGEN_REST="${IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; DB="e14a_$TOKEN"; ROL="e14a_auth_$TOKEN"; CLAVE="c$(hex 10)"; RED="rede14a_$TOKEN"; REST="pgrste14a_$TOKEN"; SECRETO="local-e14a-$(hex 24)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
PIDS=""
limpiar() { st=$?
  for p in $PIDS; do kill "$p" >/dev/null 2>&1 || true; done
  powershell -NoProfile -Command 'Get-NetTCPConnection -LocalPort 3049 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }' >/dev/null 2>&1 || true
  docker rm -f "$REST" >/dev/null 2>&1 || true; docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  [ "${KEEP:-}" = 1 ] || $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true
  $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
mkdir -p "$SALIDA"
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3049 -State Listen -ErrorAction SilentlyContinue) { exit 1 }" >/dev/null 2>&1 || { echo "El puerto 3049 ya está en uso." >&2; exit 2; }
[ -f .next/BUILD_ID ] || { echo "Falta .next compilado." >&2; exit 2; }
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for M in supabase/migrations/20260601000304_contrato_resumen_precios.sql supabase/migrations/20260601000305_recobro_comision_reserva.sql ${EXTRA_MIGRACIONES:-}; do
  $PS -d "$DB" < "$M" >/dev/null 2>&1 || { echo "FALLÓ $M" >&2; exit 1; }
done
$PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
$PS -d "$DB" -c "insert into public.agencias (tenant, razon_social, nombre_comercial, nit, dv, rnt, correo, banco, tipo_cuenta, numero_cuenta, ciudad) values ('mayorista', 'Agencia de Prueba SAS', 'Agencia de Prueba', '800123456', '7', 'RNT-PRUEBA-1', 'prueba@agencia.test', 'Banco Prueba', 'ahorros', '000-111-222', 'Medellín') on conflict (tenant) do update set razon_social = excluded.razon_social, nit = excluded.nit, rnt = excluded.rnt" >/dev/null
$PS -d "$DB" < supabase/scripts/humo_14a_semilla_real.sql >/dev/null
docker network create "$RED" >/dev/null; docker network connect "$RED" "$CT"
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1:54398:3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
for i in $(seq 1 30); do node -e "fetch('http://127.0.0.1:54398/').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},500)"; done
echo "== tarifario con el motor real =="
H14_BASE="$DB" H14_CONTENEDOR="$CT" H14_POSTGREST="http://127.0.0.1:54398" H14_JWT_SECRET="$SECRETO" H14_PAQUETE=9101 \
  node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoaderRelativo.mjs --test --test-force-exit --test-reporter=dot supabase/scripts/humo_14a_generar_tarifario.ts 2>&1 | grep -E "generarTarifario|✖|fail" || true
JWT_SERVICIO="$(SECRETO="$SECRETO" node -e "const c=require('crypto');const b=s=>Buffer.from(s).toString('base64url');const h=b(JSON.stringify({alg:'HS256',typ:'JWT'}));const p=b(JSON.stringify({role:'service_role',exp:Math.floor(Date.now()/1000)+14400}));process.stdout.write(h+'.'+p+'.'+c.createHmac('sha256',process.env.SECRETO).update(h+'.'+p).digest('base64url'))")"
JWT_ANON="$(SECRETO="$SECRETO" node -e "const c=require('crypto');const b=s=>Buffer.from(s).toString('base64url');const h=b(JSON.stringify({alg:'HS256',typ:'JWT'}));const p=b(JSON.stringify({role:'anon',exp:Math.floor(Date.now()/1000)+14400}));process.stdout.write(h+'.'+p+'.'+c.createHmac('sha256',process.env.SECRETO).update(h+'.'+p).digest('base64url'))")"
HUMO_ANON_JWT="$JWT_ANON" HUMO_REST="http://127.0.0.1:54398" node supabase/scripts/humo_14a_proxy.mjs > "$SALIDA/proxy.log" 2>&1 &
PIDS="$PIDS $!"
SUPABASE_SERVICE_ROLE_KEY="$JWT_SERVICIO" CRON_SECRET="humo-14a" npx next start -p 3049 -H 127.0.0.1 > "$SALIDA/app.log" 2>&1 &
PIDS="$PIDS $!"
for i in $(seq 1 60); do node -e "fetch('http://127.0.0.1:3049/tarifario').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},1000)"; done
printf '{"db":"%s","contenedor":"%s","secreto":"%s","app":"http://127.0.0.1:3049","rest":"http://127.0.0.1:54398"}\n' "$DB" "$CT" "$SECRETO" > "$SALIDA/env.json"
echo "LISTO $DB"
until [ -f "$SALIDA/parar" ]; do sleep 2; done
