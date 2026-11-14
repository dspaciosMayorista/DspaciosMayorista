#!/bin/sh
# ────────────────────────────────────────────────────────────────────────────
# HUMO LOCAL de #14-A (recobro del carrito) sobre la aplicación COMPILADA — derivado de humo_304_documentos.sh (HUMO LOCAL de la 304 (#94)): la aplicación COMPILADA (`next build` hecho con NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399) sirve `/c/[token]` y `/contrato/[numero]`
# de contratos REALES creados por la conversión (con resumen y sin él, histórico) contra Postgres + PostgREST locales; se capturan escritorio, móvil 375, impresión y PDF.
# Uso (desde dspacios-travel/, con .next ya construido):  sh supabase/scripts/humo_304_documentos.sh <contenedor_pg> <plantilla> <carpeta_salida>
# Puertos (solo loopback): PostgREST 54398 · proxy/GoTrue mínimo 54399 · app 3049. Lo borra todo al terminar. NUNCA contra una base real.
# ────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; SALIDA="${3:?carpeta de salida}"
IMAGEN_REST="${IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; DB="h14a_$TOKEN"; ROL="h14a_auth_$TOKEN"; CLAVE="c$(hex 10)"; RED="redh14a_$TOKEN"; REST="pgrsth14a_$TOKEN"; SECRETO="local-h14a-$(hex 24)"
UID_SUPER="00000000-0000-0000-0000-000000102007"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
PIDS=""
limpiar() { st=$?
  for p in $PIDS; do kill "$p" >/dev/null 2>&1 || true; done
  # En Windows `npx next start` deja el proceso de node huérfano: se cierra por el puerto (solo el de esta corrida: 3049).
  powershell -NoProfile -Command 'Get-NetTCPConnection -LocalPort 3049 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }' >/dev/null 2>&1 || true
  docker rm -f "$REST" >/dev/null 2>&1 || true; docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  [ "${KEEP:-}" = 1 ] || $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true
  $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
mkdir -p "$SALIDA"
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3049 -State Listen -ErrorAction SilentlyContinue) { exit 1 }" >/dev/null 2>&1 || { echo "El puerto 3049 ya está en uso: ciérralo antes del humo." >&2; exit 2; }
[ -f .next/BUILD_ID ] || { echo "Falta .next (haz npm run build con NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399)." >&2; exit 2; }
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for M in supabase/migrations/20260601000304_contrato_resumen_precios.sql supabase/migrations/20260601000305_recobro_comision_reserva.sql; do
  $PS -d "$DB" < "$M" >/dev/null 2>&1 || { echo "FALLÓ $M" >&2; exit 1; }
done
$PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
# #49: el documento exige la fila de `agencias` del tenant (sin respaldo). Identidad SINTÉTICA, nunca los NIT/RNT reales.
$PS -d "$DB" -c "insert into public.agencias (tenant, razon_social, nombre_comercial, nit, dv, rnt, correo, banco, tipo_cuenta, numero_cuenta, ciudad) values ('mayorista', 'Agencia de Prueba SAS', 'Agencia de Prueba', '800123456', '7', 'RNT-PRUEBA-1', 'prueba@agencia.test', 'Banco de Prueba', 'Cuenta de prueba', '000-000000-00', 'Ciudad de Prueba') on conflict (tenant) do update set razon_social = excluded.razon_social, nombre_comercial = excluded.nombre_comercial, nit = excluded.nit, dv = excluded.dv, rnt = excluded.rnt, correo = excluded.correo, banco = excluded.banco, tipo_cuenta = excluded.tipo_cuenta, numero_cuenta = excluded.numero_cuenta, ciudad = excluded.ciudad" >/dev/null
docker network create "$RED" >/dev/null; docker network connect "$RED" "$CT"
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1:54398:3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
for i in $(seq 1 30); do node -e "fetch('http://127.0.0.1:54398/').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},500)"; done

echo "== 1) contratos reales por la conversión (pruebas/cotizacionAsistidaB2B102.pg.ts) =="
PG102_BASE="$DB" PG102_CONTENEDOR="$CT" PG102_POSTGREST="http://127.0.0.1:54398" PG102_JWT_SECRET="$SECRETO" \
  node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoaderRelativo.mjs \
       --test --test-force-exit --test-timeout=180000 --test-concurrency=1 --test-reporter=dot pruebas/cotizacionAsistidaB2B102.pg.ts 2>&1 | grep -E "^ℹ (pass|fail)" || true
# Con el esquema hasta la 304/305 y los datos de la 102 se eligen los contratos por sus importes exactos (ver docs/tecnico/recobro-carrito-14a-diseno-2026-11-13.md §8).
pick() { $PS -d "$DB" -c "$1"; }
NETO="$(pick "select v.numero_contrato || '|' || v.share_token || '|' || c.share_token from public.ventas v join public.cotizaciones c on c.id = v.cotizacion_origen_id join public.contrato_resumen_precios r on r.numero_contrato = v.numero_contrato where v.modo_compra = 'neta' and v.recobro_total = 100000 and v.precio_venta = 1420000 order by v.numero_contrato limit 1")"
DIRECTO="$(pick "select v.numero_contrato || '|' || v.share_token || '|' || c.share_token from public.ventas v join public.cotizaciones c on c.id = v.cotizacion_origen_id where v.modo_compra = 'comisionable' and v.recobro_total = 100000 and v.recobro_aliado = 50000 and v.precio_venta = 1100000 order by v.numero_contrato limit 1")"
SINDIST="$(pick "select v.numero_contrato || '|' || v.share_token || '|' || c.share_token from public.ventas v join public.cotizaciones c on c.id = v.cotizacion_origen_id where v.modo_compra = 'comisionable' and v.recobro_total = 100000 and v.recobro_aliado = 0 and v.comision_b2b = 90000 order by v.numero_contrato limit 1")"
[ -n "$NETO" ] && [ -n "$DIRECTO" ] && [ -n "$SINDIST" ] || { echo "No se hallaron los contratos esperados (NETO='$NETO' DIRECTO='$DIRECTO' SINDIST='$SINDIST')." >&2; exit 1; }
N_NETO="${NETO%%|*}"; R_NETO="${NETO#*|}"; T_NETO="${R_NETO%%|*}"; C_NETO="${R_NETO##*|}"
N_DIR="${DIRECTO%%|*}"; R_DIR="${DIRECTO#*|}"; T_DIR="${R_DIR%%|*}"; C_DIR="${R_DIR##*|}"
N_SIN="${SINDIST%%|*}"; R_SIN="${SINDIST#*|}"; T_SIN="${R_SIN%%|*}"; C_SIN="${R_SIN##*|}"
echo "  NETO 2 adultos+niño+tour: $N_NETO · aliado directo con distribución: $N_DIR · asistida sin distribución: $N_SIN"

echo "== 2) proxy + aplicación compilada =="
JWT_SERVICIO="$(SECRETO="$SECRETO" node -e "const c=require('crypto');const b=s=>Buffer.from(s).toString('base64url');const h=b(JSON.stringify({alg:'HS256',typ:'JWT'}));const p=b(JSON.stringify({role:'service_role',exp:Math.floor(Date.now()/1000)+7200}));process.stdout.write(h+'.'+p+'.'+c.createHmac('sha256',process.env.SECRETO).update(h+'.'+p).digest('base64url'))")"
JWT_ANON="$(SECRETO="$SECRETO" node -e "const c=require('crypto');const b=s=>Buffer.from(s).toString('base64url');const h=b(JSON.stringify({alg:'HS256',typ:'JWT'}));const p=b(JSON.stringify({role:'anon',exp:Math.floor(Date.now()/1000)+7200}));process.stdout.write(h+'.'+p+'.'+c.createHmac('sha256',process.env.SECRETO).update(h+'.'+p).digest('base64url'))")"
HUMO_ANON_JWT="$JWT_ANON" HUMO_REST="http://127.0.0.1:54398" HUMO_UID="$UID_SUPER" node supabase/scripts/humo_304_proxy.mjs > "$SALIDA/proxy.log" 2>&1 &
PIDS="$PIDS $!"
SUPABASE_SERVICE_ROLE_KEY="$JWT_SERVICIO" CRON_SECRET="humo-304" npx next start -p 3049 -H 127.0.0.1 > "$SALIDA/app.log" 2>&1 &
PIDS="$PIDS $!"
for i in $(seq 1 60); do node -e "fetch('http://127.0.0.1:3049/tarifario').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},1000)"; done

echo "== 3) capturas =="
PAGINAS="[{\"nombre\":\"calentamiento\",\"ruta\":\"/c/$T_NETO\",\"sesion\":false},{\"nombre\":\"neto-c\",\"ruta\":\"/c/$T_NETO\",\"sesion\":false},{\"nombre\":\"neto-contrato\",\"ruta\":\"/contrato/$N_NETO\",\"sesion\":true},{\"nombre\":\"neto-cotizacion\",\"ruta\":\"/cot/$C_NETO\",\"sesion\":false},{\"nombre\":\"directo-c\",\"ruta\":\"/c/$T_DIR\",\"sesion\":false},{\"nombre\":\"directo-cotizacion\",\"ruta\":\"/cot/$C_DIR\",\"sesion\":false},{\"nombre\":\"sindist-c\",\"ruta\":\"/c/$T_SIN\",\"sesion\":false},{\"nombre\":\"sindist-cotizacion\",\"ruta\":\"/cot/$C_SIN\",\"sesion\":false}]"
HUMO_APP="http://127.0.0.1:3049" HUMO_SALIDA="$SALIDA" HUMO_SECRETO="$SECRETO" HUMO_UID="$UID_SUPER" HUMO_PAGINAS="$PAGINAS" node supabase/scripts/humo_304_capturas.mjs
echo "$N_NETO|$N_DIR|$N_SIN" > "$SALIDA/numeros.txt"
echo "== 4) formulario del carrito (recobro) en la app compilada =="
HUMO_APP="http://127.0.0.1:3049" HUMO_SALIDA="$SALIDA" HUMO_SECRETO="$SECRETO" HUMO_UID="$UID_SUPER" HUMO_ALIADO="Viajes Aurora 102 · Agencia" node supabase/scripts/humo_14a_formulario.mjs
