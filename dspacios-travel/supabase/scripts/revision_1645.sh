#!/bin/sh
# REVISIÓN VISUAL DEL DUEÑO — #16 (fechas heredadas) y #45 (descripción de habitaciones por hotel). SOLO LOCAL, DATOS SINTÉTICOS.
# Base `revision1645` = copia de `revision43` (que NO se toca) + migración 303 aplicada SOLO aquí. Servicios propios (nombres rev1645-*).
#   base      : crea revision1645 (plantilla revision43), aplica la 303 y corre su postcheck. Una sola vez.
#   servicios : red + PostgREST + GoTrue propios (puertos 54396/54397).
#   servir    : gateway Supabase 127.0.0.1:54395 (el que trae incrustado el build) + `next start` en 127.0.0.1:3047. Primer plano.
#   detener   : para los contenedores (la base se conserva).
#   limpiar   : borra contenedores, red, rol y la base revision1645 (NO toca revision43).
# El build debe hacerse con NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54395 y la clave anónima de `anon` (ver la acción `claves`).
# Usuarios (heredados de revision43): dueno@revision43.test (superadmin) / operaciones@revision43.test — contraseña Revision43!
# Uso (desde dspacios-travel/): sh supabase/scripts/revision_1645.sh base|servicios|claves|servir|detener|limpiar
set -eu
export MSYS_NO_PATHCONV=1
ACCION="${1:?accion: base|servicios|claves|servir|detener|limpiar}"
CT=pg4360; PLANTILLA=revision43; DB=revision1645; ROL=rev1645_rest; RED=rev1645; REST=rev1645-rest; AUTH=rev1645-auth
P_SB=54395; P_APP=3047; P_REST=54396; P_AUTH=54397; ETIQUETA=dspacios.revision1645=1
SECRETO="humo43-local-secreto-solo-pruebas-0123456789"
jwt() { node -e "const c=require('node:crypto');const b=s=>Buffer.from(s).toString('base64url');const h=b(JSON.stringify({alg:'HS256',typ:'JWT'})),p=b(JSON.stringify({role:'$1',exp:1924992000}));console.log(h+'.'+p+'.'+c.createHmac('sha256','$SECRETO').update(h+'.'+p).digest('base64url'))"; }
ANON="$(jwt anon)"; SERVICIO="$(jwt service_role)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
CFG="$LOCALAPPDATA/dspacios-local4360/config.json"
case "$ACCION" in
claves) echo "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$P_SB"; echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON" ;;
base)
  docker start "$CT" >/dev/null
  for i in $(seq 1 30); do $PS -d postgres -c "select 1" >/dev/null 2>&1 && break; sleep 1; done
  [ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = "0" ] || { echo "FALLO: $DB ya existe (usa 'limpiar' para empezar de cero)"; exit 1; }
  $PS -d postgres -c "create database $DB template $PLANTILLA"
  $PS -d "$DB" < supabase/migrations/20260601000303_hotel_categoria_descripcion.sql
  $PS -d "$DB" -F ' | ' < supabase/scripts/postcheck_303_hotel_categoria_descripcion.sql ;;
servicios)
  CLAVE_AUTH="$(node -e "console.log(require(process.argv[1]).rolesPassword)" "$CFG")"
  CLAVE_REST="r$(od -An -N10 -tx1 /dev/urandom | tr -d ' \n')"
  $PS -d postgres -c "drop role if exists $ROL" >/dev/null; $PS -d postgres -c "create role $ROL login noinherit password '$CLAVE_REST'" >/dev/null
  $PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
  $PS -d postgres -c "alter role supabase_auth_admin with password '$CLAVE_AUTH'" >/dev/null
  docker network create --label "$ETIQUETA" "$RED" >/dev/null; docker network connect --alias "$CT" "$RED" "$CT"
  docker run -d --name "$REST" --label "$ETIQUETA" --network "$RED" -p 127.0.0.1:$P_REST:3000 -e PGRST_DB_URI="postgres://$ROL:$CLAVE_REST@$CT:5432/$DB" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" public.ecr.aws/supabase/postgrest:v16.4 >/dev/null
  docker run -d --name "$AUTH" --label "$ETIQUETA" --network "$RED" -p 127.0.0.1:$P_AUTH:9999 \
    -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL="http://127.0.0.1:$P_SB/auth/v1" \
    -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$CLAVE_AUTH@$CT:5432/$DB?search_path=auth" \
    -e GOTRUE_SITE_URL="http://127.0.0.1:$P_APP" -e GOTRUE_URI_ALLOW_LIST="http://127.0.0.1:$P_APP/**" -e GOTRUE_DISABLE_SIGNUP=true \
    -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_EXP=3600 \
    -e GOTRUE_JWT_SECRET="$SECRETO" -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_EXTERNAL_PHONE_ENABLED=false \
    public.ecr.aws/supabase/gotrue:v2.197.0 >/dev/null
  for i in $(seq 1 180); do node -e "Promise.all([fetch('http://127.0.0.1:$P_REST/'),fetch('http://127.0.0.1:$P_AUTH/health')]).then(r=>process.exit(r.every(x=>x.ok)?0:1),()=>process.exit(1))" && break; sleep 1; done
  node -e "fetch('http://127.0.0.1:$P_AUTH/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" || { echo "FALLO: GoTrue no respondió (docker logs $AUTH)"; exit 1; }
  echo "OK    PostgREST y GoTrue responden" ;;
servir)
  docker start "$CT" >/dev/null; docker start "$REST" "$AUTH" >/dev/null
  grep -rqs "127.0.0.1:$P_SB" .next/static/chunks || { echo "FALLO: el build no apunta al gateway local 127.0.0.1:$P_SB (reconstruir con la acción 'claves')"; exit 1; }
  NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$P_SB" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON" SUPABASE_SERVICE_ROLE_KEY="$SERVICIO" \
    V_PUERTO_SB=$P_SB V_PUERTO_APP=$P_APP V_REST=http://127.0.0.1:$P_REST V_AUTH=http://127.0.0.1:$P_AUTH V_GUARDIA="$(pwd -W)/supabase/scripts/local4360/guardia_red_local4360.cjs" \
    node supabase/scripts/revision_1645_servidor.mjs ;;
detener) docker stop "$REST" "$AUTH" >/dev/null 2>&1 || true; echo "detenidos $REST y $AUTH (la base $DB se conserva)" ;;
limpiar)
  docker rm -f "$REST" "$AUTH" >/dev/null 2>&1 || true
  docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  $PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" >/dev/null
  $PS -d postgres -c "drop database if exists $DB" >/dev/null; $PS -d postgres -c "drop role if exists $ROL" >/dev/null
  echo "limpio: contenedores, red, rol y base $DB borrados (revision43 intacta)" ;;
*) echo "acción desconocida: $ACCION"; exit 1 ;;
esac
