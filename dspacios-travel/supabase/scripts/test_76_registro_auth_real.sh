#!/bin/bash
# #76 — Registro B2B con código de referido contra Auth REAL local: base desechable (copia de la plantilla + migraciones 340/341/342) + la pila de real_62/pila.sh (GoTrue v2.197, PostgREST, Mailpit, gateway)
# y las Server Actions reales (pruebas/registroReferidoAuthReal76.real.ts). El correo SOLO llega a Mailpit local. Todo con prefijo v1real_ y en loopback; se baja y se borra al terminar.
# Uso (desde dspacios-travel/):  bash supabase/scripts/test_76_registro_auth_real.sh <contenedor_pg> <plantilla>        NUNCA contra una base real.
# Aviso: usa los nombres de contenedor v1real_* de real_62/pila.sh; si otra sesión tiene esa pila arriba, NO lo ejecutes (la bajaría).
set -u -o pipefail
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PL="${2:?plantilla}"
R=supabase/scripts/real_62; M=supabase/migrations
if docker ps --format '{{.Names}}' | grep -q '^v1real_'; then echo "Hay una pila v1real_* en marcha (de otra sesión): no se toca." >&2; exit 2; fi
TOKEN="$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"; DB="blk2_auth_$TOKEN"
# Ruta de estilo Windows (C:/…): la entienden a la vez Git Bash (pila.sh) y Node; el /tmp de Git Bash no es el mismo directorio para Node.
CFG="C:/tmp/blk2auth_$TOKEN"; mkdir -p "$CFG"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
limpiar() { st=$?; bash "$R/pila.sh" bajar "$CFG" "$CT" >/dev/null 2>&1; $PS -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1; rm -rf "$CFG"; exit "$st"; }
trap limpiar EXIT
node "$R/claves.mjs" "$CFG" >/dev/null
# Puertos propios de esta corrida (los de claves.mjs podrían estar en uso por otra sesión).
node -e "const f='$CFG/config.json';const fs=require('fs');const c=JSON.parse(fs.readFileSync(f,'utf8'));c.puertos={gateway:19480,auth:19481,rest:19482,correo:19483,app:3047,storage:19484};fs.writeFileSync(f,JSON.stringify(c,null,2))"
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PL' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PL" >/dev/null || exit 2
for f in 20260601000340_aviso_cotizacion_publica 20260601000341_referidos 20260601000342_registro_b2b_codigo_referido; do $PS -d "$DB" < "$M/$f.sql" >/dev/null 2>"$CFG/mig.err" || { cat "$CFG/mig.err" >&2; echo "FALLÓ $f" >&2; exit 1; }; echo "  aplicada: $f"; done
PILA_DB="$DB" PILA_SIN_MIGRACIONES=1 PILA_OTP_EXP=600 bash "$R/pila.sh" subir "$CFG" "$CT" "$PL" || exit 2
cfg() { node -p "require('$CFG/config.json').$1"; }
env REAL76_GATEWAY="http://127.0.0.1:$(cfg puertos.gateway)" REAL76_ANON="$(cfg anonKey)" REAL76_SERVICE="$(cfg serviceKey)" REAL76_CORREO="$(cfg puertos.correo)" REAL76_CONTENEDOR="$CT" REAL76_BASE="$DB" \
  node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs --test --test-force-exit --test-timeout=240000 --test-concurrency=1 pruebas/registroReferidoAuthReal76.real.ts 2>&1 \
  | grep -v ExperimentalWarning | grep -v "^(node:" | grep -v "Use .node" | grep -v "register(" | grep -v "^--import"
exit "${PIPESTATUS[0]}"
