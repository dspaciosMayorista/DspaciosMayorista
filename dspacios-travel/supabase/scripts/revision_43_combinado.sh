#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# REVISIÓN VISUAL DEL DUEÑO — árbol combinado (#43/#60 + lote). SOLO LOCAL, DATOS SINTÉTICOS.
#   preparar : comprueba que el build corresponda al código, crea la base `revision43` (plantilla local4360_base + 293→302 +
#              fixtures sintéticos), levanta GoTrue y PostgREST propios y carga los datos de revisión con las ACCIONES REALES
#              (recorrido_43_e6.mjs en modo «revision»): Semana/Fin de semana a 550.000, promoción del hotel 9307 configurada y
#              generada (etiqueta por acomodación) y un cambio PENDIENTE persistente en «P3 TARDIA». Crea los usuarios de revisión.
#   servir   : gateway Supabase en 127.0.0.1:54390 (el que trae incrustado el build) + `next start` en 127.0.0.1:3046. Queda en primer plano.
#   detener  : para los contenedores de la revisión (la base se conserva).
#   limpiar  : borra contenedores, red, rol y la base `revision43`.
# Usa el MISMO secreto local fijo del humo: el build incrusta la URL y la clave anónima (NEXT_PUBLIC_*).
# No toca la base del dueño (dspacios_local4360) ni la del lote (lote_revision). Solo loopback.
# Uso (desde dspacios-travel/): sh supabase/scripts/revision_43_combinado.sh preparar|servir|detener|limpiar
# ─────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
ACCION="${1:?accion: preparar|servir|detener|limpiar}"
CT=pg4360; PLANTILLA=local4360_base; DB=revision43; ROL=rev43_rest; RED=rev43; REST=rev43-rest; AUTH=rev43-auth
P_SB=54390; P_APP=3046; ETIQUETA=dspacios.revision43=1
SECRETO="humo43-local-secreto-solo-pruebas-0123456789"
CLAVE_USUARIOS='Revision43!'
jwt() { node -e "const c=require('node:crypto');const b=s=>Buffer.from(s).toString('base64url');const h=b(JSON.stringify({alg:'HS256',typ:'JWT'})),p=b(JSON.stringify({role:'$1',exp:1924992000}));console.log(h+'.'+p+'.'+c.createHmac('sha256','$SECRETO').update(h+'.'+p).digest('base64url'))"; }
ANON="$(jwt anon)"; SERVICIO="$(jwt service_role)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
CFG="$LOCALAPPDATA/dspacios-local4360/config.json"
# Contraseña de supabase_auth_admin: la MISMA que fija local4360.ps1 (rol global de pg4360), así no se cambia nada para ese entorno.
CLAVE_AUTH="$(node -e "console.log(require(process.argv[1]).rolesPassword)" "$CFG")"
existe() { [ -n "$(docker ps -aq --filter "name=^$1\$")" ]; }

case "$ACCION" in
preparar)
  echo "--- 1) el build corresponde al código actual"
  [ -f .next/BUILD_ID ] || { echo "FALLO: no hay build (.next/BUILD_ID)"; exit 1; }
  NUEVOS="$(find . -newer .next/BUILD_ID -type f -not -path './node_modules/*' -not -path './.next/*' -not -path './.git/*' -not -name '*.tsbuildinfo' | grep -vE '^\./(docs|pruebas|supabase)/' || true)"  # tsbuildinfo = caché de tsc, no código
  [ -z "$NUEVOS" ] || { echo "FALLO: hay código posterior al build:"; echo "$NUEVOS"; exit 1; }
  grep -rqs "127.0.0.1:$P_SB" .next/static/chunks || { echo "FALLO: el build no apunta al gateway local 127.0.0.1:$P_SB"; exit 1; }
  echo "OK    build $(cat .next/BUILD_ID) ($(date -r .next/BUILD_ID '+%Y-%m-%d %H:%M')): ningún archivo de la app es posterior; apunta a 127.0.0.1:$P_SB"
  echo "--- 2) base sintética $DB"
  docker start "$CT" >/dev/null
  for i in $(seq 1 30); do $PS -d postgres -c "select 1" >/dev/null 2>&1 && break; sleep 1; done
  [ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = "0" ] || { echo "FALLO: $DB ya existe (usa 'servir', o 'limpiar' para empezar de cero)"; exit 1; }
  # Una sesión recién terminada tarda un momento en soltar la plantilla: se reintenta.
  for i in 1 2 3 4 5; do
    $PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
    $PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>&1 && break
    [ "$i" = 5 ] && { echo "FALLO: no se pudo copiar $PLANTILLA (sigue en uso)"; exit 1; }; sleep 2
  done
  for f in supabase/scripts/fixture_293_vigencia_grupos_dias.sql supabase/migrations/20260601000295_grupos_dias_propuesta.sql supabase/scripts/fixture_295_grupos_dias_propuesta.sql \
           supabase/migrations/20260601000297_calculadora_grupos_dias.sql supabase/scripts/fixture_297_calculadora_grupos_dias.sql \
           supabase/migrations/20260601000298_calculadora_grupos_generales.sql supabase/migrations/20260601000299_grupos_dias_activacion.sql supabase/scripts/fixture_299_grupos_dias_activacion.sql \
           supabase/migrations/20260601000300_promociones_grupo.sql supabase/migrations/20260601000301_promociones_acumulacion.sql supabase/migrations/20260601000302_desde_estadia_real.sql \
           supabase/scripts/fixture_recorrido_43_e5.sql supabase/scripts/fixture_recorrido_43_e6.sql supabase/scripts/fixture_revision_43.sql supabase/scripts/local4360/dueno_auth_local4360.sql; do
    ERR="$($PS -d "$DB" < "$f" 2>&1)" || { echo "FALLO al cargar $f"; echo "$ERR" | tail -5; exit 2; }
  done
  $PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
  echo "OK    migraciones 293→302 (provisionales 298–302) + fixtures sintéticos"
  echo "--- 3) servicios (PostgREST y GoTrue propios, red $RED)"
  CLAVE_REST="r$(od -An -N10 -tx1 /dev/urandom | tr -d ' \n')"
  $PS -d postgres -c "drop role if exists $ROL" >/dev/null; $PS -d postgres -c "create role $ROL login noinherit password '$CLAVE_REST'" >/dev/null
  $PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
  $PS -d postgres -c "alter role supabase_auth_admin with password '$CLAVE_AUTH'" >/dev/null
  docker network create --label "$ETIQUETA" "$RED" >/dev/null; docker network connect --alias "$CT" "$RED" "$CT"
  docker run -d --name "$REST" --label "$ETIQUETA" --network "$RED" -p 127.0.0.1:54391:3000 -e PGRST_DB_URI="postgres://$ROL:$CLAVE_REST@$CT:5432/$DB" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" public.ecr.aws/supabase/postgrest:v16.4 >/dev/null
  docker run -d --name "$AUTH" --label "$ETIQUETA" --network "$RED" -p 127.0.0.1:54392:9999 \
    -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL="http://127.0.0.1:$P_SB/auth/v1" \
    -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$CLAVE_AUTH@$CT:5432/$DB?search_path=auth" \
    -e GOTRUE_SITE_URL="http://127.0.0.1:$P_APP" -e GOTRUE_URI_ALLOW_LIST="http://127.0.0.1:$P_APP/**" -e GOTRUE_DISABLE_SIGNUP=true \
    -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_EXP=3600 \
    -e GOTRUE_JWT_SECRET="$SECRETO" -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_EXTERNAL_PHONE_ENABLED=false \
    public.ecr.aws/supabase/gotrue:v2.197.0 >/dev/null
  for i in $(seq 1 180); do node -e "Promise.all([fetch('http://127.0.0.1:54391/'),fetch('http://127.0.0.1:54392/health')]).then(r=>process.exit(r.every(x=>x.ok)?0:1),()=>process.exit(1))" && break; sleep 1; done
  node -e "fetch('http://127.0.0.1:54392/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" || { echo "FALLO: GoTrue no respondió (docker logs $AUTH)"; exit 1; }
  echo "OK    PostgREST y GoTrue responden"
  echo "--- 4) datos de revisión con las acciones reales"
  R6_RAIZ="$(pwd -W)" R6_MODO=revision R6_REST="http://127.0.0.1:54391" R6_SECRETO="$SECRETO" R6_PS="$PS -d $DB" \
    node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs supabase/scripts/recorrido_43_e6.mjs 2>&1 | grep -aE "^(OK|FALLO)|^===|9307 del|tarjeta|fila publicada"
  echo "--- 5) usuarios de revisión (contraseña sintética $CLAVE_USUARIOS)"
  for u in "dueno@revision43.test|Dueño Revisión|superadmin" "operaciones@revision43.test|Operaciones Revisión|operaciones"; do
    EMAIL="${u%%|*}"; RESTO="${u#*|}"; NOMBRE="${RESTO%%|*}"; ROLU="${RESTO#*|}"
    node -e "fetch('http://127.0.0.1:54392/admin/users',{method:'POST',headers:{apikey:'$SERVICIO',authorization:'Bearer $SERVICIO','content-type':'application/json'},body:JSON.stringify({email:'$EMAIL',password:process.argv[1],email_confirm:true})}).then(async r=>{if(!r.ok){console.error(await r.text());process.exit(1)}})" "$CLAVE_USUARIOS"
    $PS -d "$DB" -c "insert into public.usuarios (id, email, nombre, rol, tenant, activo) select id, email, '$NOMBRE', '$ROLU', 'mayorista', true from auth.users where email = '$EMAIL' on conflict (id) do update set rol = excluded.rol, tenant = excluded.tenant, activo = true" >/dev/null
    echo "OK    $EMAIL ($ROLU)"
  done
  echo "=== preparado. Siguiente: sh supabase/scripts/revision_43_combinado.sh servir"
  ;;
servir)
  docker start "$CT" >/dev/null; docker start "$REST" "$AUTH" >/dev/null
  NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$P_SB" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON" SUPABASE_SERVICE_ROLE_KEY="$SERVICIO" \
    V_PUERTO_SB=$P_SB V_PUERTO_APP=$P_APP V_REST=http://127.0.0.1:54391 V_AUTH=http://127.0.0.1:54392 V_GUARDIA="$(pwd -W)/supabase/scripts/local4360/guardia_red_local4360.cjs" \
    node supabase/scripts/revision_43_servidor.mjs
  ;;
detener)
  docker stop "$REST" "$AUTH" >/dev/null 2>&1 || true
  echo "detenidos $REST y $AUTH (la base $DB se conserva; pg4360 sigue como estaba)"
  ;;
limpiar)
  docker rm -f "$REST" "$AUTH" >/dev/null 2>&1 || true
  docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  $PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" >/dev/null
  $PS -d postgres -c "drop database if exists $DB" >/dev/null; $PS -d postgres -c "drop role if exists $ROL" >/dev/null
  echo "limpio: contenedores, red, rol y base $DB borrados"
  ;;
*) echo "acción desconocida: $ACCION"; exit 1 ;;
esac
