#!/bin/sh
# ────────────────────────────────────────────────────────
# ENTORNO LOCAL DESECHABLE para las pruebas de la 262/263 (se hace `.` desde test_262_263_postgrest.sh, test_265_enlace_cxp.sh y el recorrido de venta del PR de la aplicación; no se ejecuta solo).
# Crea: una base nueva clonada de la plantilla (esquema completo SIN la 255), le aplica 255, 256, 258, 259, 262 y 263 (con preflight/postcheck de la 262),
# un rol de login propio, una red docker propia y un PostgREST propio. TODO lo que crea lleva el token de la corrida y se borra al terminar (trap EXIT).
# Nunca toca la base compartida ni la plantilla (solo la lee). Variables que entrega: DB, CT, REST_URL, SECRETO, TOKEN, AQUI, APP, PS.
# Requiere antes: PREFIJO (^t262[a-z]{1,6}$), DB (^<PREFIJO>_[a-z0-9_]{1,30}$), CT, PLANTILLA.
# ────────────────────────────────────────────────────────
export MSYS_NO_PATHCONV=1
IMAGEN_REST="${PG262_IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
nombre_ok() { printf '%s' "$1" | grep -Eq "$2"; }
nombre_ok "$DB" "^${PREFIJO}_[a-z0-9_]{1,30}\$" || { echo "Base inválida: usa un nombre nuevo ^${PREFIJO}_[a-z0-9_]{1,30}\$." >&2; exit 2; }
nombre_ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
nombre_ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
[ "$DB" != "$PLANTILLA" ] || { echo "La base no puede ser la plantilla." >&2; exit 2; }

hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 8)"; SUFIJO="$(hex 5)"
REST="pgrst262_$SUFIJO"; RED="red262_$TOKEN"; ROL="test262_auth_$TOKEN"
SECRETO="local-262-$(hex 24)"; CLAVE="c262$(hex 12)"; MARCA="test_262 $TOKEN"
AQUI="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$AQUI/../.." && pwd)"; MIGS="$APP/supabase/migrations"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
BASE_PROPIA=0; ROL_PROPIO=0; RED_PROPIA=0
limpiar() {
  st=$?
  for intento in 1 2; do
    ids="$(docker ps -aq --filter "label=dspacios.test262=$TOKEN" 2>/dev/null || true)"; [ -z "$ids" ] && break
    docker rm -f $ids >/dev/null 2>&1 || sleep 2
  done
  [ -n "$(docker ps -aq --filter "label=dspacios.test262=$TOKEN" 2>/dev/null || true)" ] && echo "AVISO: quedó un contenedor con etiqueta dspacios.test262=$TOKEN" >&2
  if [ "$RED_PROPIA" = 1 ]; then docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || echo "AVISO: no se pudo borrar la red $RED" >&2; fi
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    marca="$($PS -d postgres -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'" 2>/dev/null || true)"
    if [ "$marca" = "$MARCA" ]; then
      for intento in 1 2 3 4 5; do $PS -d postgres -c "drop database $DB" >/dev/null 2>&1 && break; sleep 2; done
      [ "$($PS -d postgres -c "select count(*) from pg_database where datname='$DB'" 2>/dev/null)" = 0 ] || echo "AVISO: no se pudo borrar $DB" >&2
    else echo "AVISO: $DB no lleva la marca de esta corrida; no se borra." >&2; fi
  fi
  [ "$ROL_PROPIO" = 1 ] && { $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || echo "AVISO: no se pudo borrar el rol $ROL" >&2; }
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe: no se toca." >&2; exit 3; }
[ "$($PS -d "$PLANTILLA" -c "select coalesce(to_regclass('public.servicio_suplementos_franja')::text,'-')")" = "-" ] || { echo "La plantilla ya tiene la 255 aplicada; se esperaba una anterior." >&2; exit 2; }
creada=0
for i in 1 2 3 4 5 6; do
  $PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null 2>&1 || true
  $PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>&1 && { creada=1; break; }
  sleep 1
done
[ "$creada" = 1 ] || { echo "No se pudo crear $DB." >&2; exit 3; }
BASE_PROPIA=1
$PS -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null

# Huellas completas de las dos RPC financieras ANTES de aplicar 255..265: el postcheck 265 exige que sean idénticas al final (la secuencia no las reemplaza).
H_ANTES="$($PS -d "$DB" -c "select md5(replace(pg_get_functiondef('public.registrar_financiero_contrato(text,text,jsonb,jsonb)'::regprocedure), chr(13), '')) || '/' || md5(replace(pg_get_functiondef('public.p63_registrar_financiero(text,text,jsonb,jsonb,bigint)'::regprocedure), chr(13), ''))")"
echo "  huellas md5 de registrar_financiero_contrato / p63_registrar_financiero antes de todo: $H_ANTES"
echo "== preflight 262 (antes de aplicar nada de 255-263) =="
for n in 255_servicio_suplementos_franja 256_disponibilidad_servicios_por_fecha 258_composicion_publicada 259_publicador_tarifario_limite_acotado; do
  $PS -d "$DB" -1 < "$MIGS/20260601000$n.sql" >/dev/null 2>"/tmp/m262.$TOKEN.err" && echo "  migración ${n%%_*} aplicada" || { cat "/tmp/m262.$TOKEN.err" >&2; echo "FALLÓ la ${n%%_*}" >&2; exit 1; }
done
PRE="$($PS -d "$DB" -F '|' < "$APP/supabase/scripts/preflight_262_servicio_tipo_alcance.sql")"; echo "$PRE" | cut -c1-170
echo "$PRE" | grep -Eq "[|] *BLOQUEA *$|NO APLICAR" && { echo "Preflight 262 bloquea." >&2; exit 1; }
$PS -d "$DB" < "$MIGS/20260601000262_servicio_tipo_alcance_rangos_suplemento.sql" >/dev/null 2>"/tmp/m262.$TOKEN.err" && echo "  migración 262 aplicada" || { cat "/tmp/m262.$TOKEN.err" >&2; exit 1; }
$PS -d "$DB" < "$MIGS/20260601000263_reemplazar_precios_alcance.sql" >/dev/null 2>"/tmp/m262.$TOKEN.err" && echo "  migración 263 aplicada" || { cat "/tmp/m262.$TOKEN.err" >&2; exit 1; }
$PS -d "$DB" < "$MIGS/20260601000264_cxp_enlace_servicio_alcance.sql" >/dev/null 2>"/tmp/m262.$TOKEN.err" && echo "  migración 264 aplicada" || { cat "/tmp/m262.$TOKEN.err" >&2; exit 1; }
V264="$($PS -d "$DB" -c "select (select count(*) from information_schema.columns where table_schema='public' and ((table_name='cuentas_por_pagar' and column_name in ('alcance_traslado','contrato_servicio_id')) or (table_name='contrato_servicios' and column_name='servicio_id')))||'/'||(select count(*) from pg_trigger where tgname='cxp_enlazar_servicio_alcance' and not tgisinternal)||'/'||(select count(*) from pg_indexes where indexname='uq_cxp_contrato_servicio')||'/'||(select count(*) from pg_constraint where conname='cuentas_por_pagar_alcance_traslado_chk' and convalidated)||'/'||has_function_privilege('anon','public.tg_cxp_enlazar_servicio_alcance()','execute')::text||'/'||has_function_privilege('authenticated','public.tg_cxp_enlazar_servicio_alcance()','execute')::text")"
[ "$V264" = "3/1/1/1/false/false" ] && echo "  verificación 264 OK (3 columnas/trigger/índice único/CHECK; función sin EXECUTE para anon ni authenticated)" || { echo "Verificación 264 falló: $V264" >&2; exit 1; }
# Verificación de la 265 en UNA consulta: 4 triggers activos/clave_enlace/índice/sin trigger de la 264/permisos de corregir_enlace_cxp_alcance/0 funciones de trigger ejecutables.
verif265() {
  V265="$($PS -d "$DB" -c "select (select count(*) from pg_trigger where tgname in ('cxp_enlace_por_clave','cxp_enlace_inmutable','linea_enlazada_protegida','ventas_completo_exige_enlaces') and not tgisinternal and tgenabled='O')||'/'||(select count(*) from information_schema.columns where table_schema='public' and table_name='contrato_servicios' and column_name='clave_enlace')||'/'||(select count(*) from pg_indexes where indexname='uq_contrato_servicios_clave_enlace')||'/'||(select count(*) from pg_trigger where tgname='cxp_enlazar_servicio_alcance')||'/'||has_function_privilege('anon','public.corregir_enlace_cxp_alcance(bigint,bigint)','execute')::text||'/'||has_function_privilege('authenticated','public.corregir_enlace_cxp_alcance(bigint,bigint)','execute')::text||'/'||(select count(*) from pg_proc p where proname in ('tg_cxp_enlace_por_clave','tg_cxp_enlace_inmutable','tg_linea_enlazada_protegida','tg_ventas_completo_exige_enlaces') and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')))")"
  [ "$V265" = "4/1/1/0/false/true/0" ] && echo "  verificación 265 OK (4 triggers activos, clave_enlace + índice único, sin trigger de la 264, corregir_enlace_cxp_alcance solo authenticated, 0 funciones de trigger ejecutables por anon/authenticated)" || { echo "Verificación 265 falló: $V265" >&2; return 1; }
}
# Aplica la 265 con su preflight y su postcheck (una consulta cada uno, con veredicto). Reutilizable: también la usa test_265_enlace_cxp.sh.
aplicar265() {
  echo "== preflight 265 =="
  PRE265="$($PS -d "$DB" -F '|' < "$APP/supabase/scripts/preflight_265_enlace_cxp_clave.sql")"; echo "$PRE265" | cut -c1-420
  echo "$PRE265" | grep -Eq "[|]NO APLICAR *$" && { echo "Preflight 265 bloquea." >&2; return 1; }
  $PS -d "$DB" < "$MIGS/20260601000265_enlace_cxp_clave_estable.sql" >/dev/null 2>"/tmp/m262.$TOKEN.err" && echo "  migración 265 aplicada" || { cat "/tmp/m262.$TOKEN.err" >&2; return 1; }
  echo "== postcheck 265 =="
  POST265="$(sed "s#PEGAR_HUELLAS_ANTES#$H_ANTES#" "$APP/supabase/scripts/postcheck_265_enlace_cxp_clave.sql" | $PS -d "$DB" -F '|')"; echo "$POST265" | cut -c1-420
  echo "$POST265" | grep -Eq "[|]FALLA *$" && { echo "Postcheck 265 con FALLA." >&2; return 1; }
  echo "$POST265" | grep -Eq "^99[|].*[|]OK *$" || { echo "Postcheck 265: veredicto global no es OK." >&2; return 1; }
  verif265
}
if [ "${PG262_HASTA:-265}" -ge 265 ]; then aplicar265 || exit 1; fi
rm -f "/tmp/m262.$TOKEN.err"
echo "== postcheck 262 =="
POST="$($PS -d "$DB" -F '|' < "$APP/supabase/scripts/postcheck_262_servicio_tipo_alcance.sql")"; echo "$POST" | cut -c1-170
echo "$POST" | grep -Eq "[|] *FALLA *$" && { echo "Postcheck 262 con FALLA." >&2; exit 1; }
echo "$POST" | grep -Eq "^99[|].*[|] *OK *$" || { echo "Postcheck 262: veredicto global no es OK." >&2; exit 1; }

# Entorno (NO es esquema de la app): auth.uid()/auth.role() leen el JWT de request.jwt.claims.
$PS -d "$DB" >/dev/null <<'SQL'
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
SQL
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null; ROL_PROPIO=1
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null; RED_PROPIA=1
docker network connect "$RED" "$CT" >/dev/null
docker run -d --name "$REST" --network "$RED" --label "dspacios.test262=$TOKEN" -p "127.0.0.1::3000" \
  -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
i=0
until docker logs "$REST" 2>&1 | grep -q "Schema cache loaded"; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { docker logs "$REST" >&2; echo "PostgREST no arrancó" >&2; exit 1; }; sleep 1
done
PUERTO_REST="$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
nombre_ok "$PUERTO_REST" '^[0-9]+$' || { echo "No se pudo leer el puerto de $REST." >&2; exit 1; }
REST_URL="http://127.0.0.1:$PUERTO_REST"
echo "== PostgREST $REST en $REST_URL contra $DB =="
