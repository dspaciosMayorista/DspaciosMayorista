#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# API · #39 (migraciones 216 + 217) por HTTP: PostgREST local con JWT HS256 firmados con un
# secreto LOCAL aleatorio, sobre una base DESECHABLE (CI o local). Nunca Supabase remoto.
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_216_api.sh <contenedor> [plantilla] [red]
#
#   X   exposición: p39_priv no existe para la API (REST: 404/406) ni para GraphQL (introspección
#       como anon, authenticated y service_role, consultas y mutations). X6: con p39_priv
#       AGREGADO al search_path, anon/authenticated siguen sin verlo (no tienen USAGE) y
#       service_role sí lo ve (control positivo: a él solo lo protege la configuración)
#   D   escrituras directas por REST con la frontera activa (authenticated y service_role)
#   O   firmas antiguas por REST: la 198 llamada directo no escribe; las puertas nuevas sí
#   L   lotes (Prefer: params=multiple-objects): cada llamada al wrapper con su autorización;
#       la 198 en lote falla entera
#   A   ACL de las RPC nuevas por HTTP (authenticated no ejecuta las de servidor)
#
# Límite: demuestra el comportamiento de PostgREST con el secreto LOCAL; no prueba la
# configuración de claves ni de "Exposed schemas" del proyecto Supabase real.
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla216}"
RED="${3:-red216}"
export MSYS_NO_PATHCONV=1
valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_216_api.sh <contenedor> [plantilla] [red]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
valido "$RED" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Red inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PW="${PGPASSWORD_216:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
IMAGEN_PGRST=ghcr.io/supabase/postgrest:v16.1
DIR_CT=/tmp/s216a
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_216a $SUF"
DB="t216_api_$SUF"
PGRST="pgrst216_$SUF"
PSA="docker exec -i -w $DIR_CT -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_ADMIN -X -q -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0
OKS=0
ok()    { echo "OK    $1"; OKS=$((OKS + 1)); }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
limpiar() {
  st=$?
  docker rm -f "$PGRST" >/dev/null 2>&1 || true
  if [ "${KEEP:-}" != 1 ]; then
    m="$($PSA -d postgres -t -A -c "select coalesce((select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'), '<ausente>')" 2>/dev/null || true)"
    [ "$m" = "$MARCA" ] && $PSA -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
docker exec "$CT" sh -c "rm -rf $DIR_CT && mkdir -p $DIR_CT"
docker exec -i "$CT" sh -c "cat > $DIR_CT/test_216_fixtures.sql" < "$AQUI/test_216_fixtures.sql"
i=1
until $PSA -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>"$TMP/cb.err"; do
  [ "$i" -lt 8 ] || { cat "$TMP/cb.err" >&2; exit 1; }
  i=$((i + 1)); sleep 2
done
$PSA -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null
# Entorno: auth.uid() de Supabase alojado (PostgREST deja el JWT en request.jwt.claims).
$PSA -d "$DB" >/dev/null <<'SQL'
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
SQL
for m in 20260601000216_cotizacion_manual_edicion_frontera.sql 20260601000217_cotizacion_manual_cierre_frontera.sql; do
  docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -v ON_ERROR_STOP=1 \
    < "$APP/supabase/migrations/$m" > "$TMP/m.out" 2>&1 || { echo "No se pudo aplicar $m: $(cut -c1-400 "$TMP/m.out")"; exit 1; }
done
printf 'begin;\n\\ir test_216_fixtures.sql\ncommit;\n' | $PSA -d "$DB" > "$TMP/fx.out" 2>&1 || { echo "Fixtures: $(tail -5 "$TMP/fx.out")"; exit 1; }
uno() { $PSA -d "$DB" -t -A -c "$1"; }

# Datos (por las puertas nuevas, como el servidor).
C_EDIT="$(uno "select t216.crear('admin')")"
C_PAG="$(uno "select t216.crear('admin')")"; P_PAG="$(uno "select t216.pagar($C_PAG, 450000, 'api-pag')")"
C_L1A="$(uno "select t216.crear('admin')")"; C_L1B="$(uno "select t216.crear('admin')")"
C_L2A="$(uno "select t216.crear('admin')")"; uno "select t216.pagar($C_L2A, 450000, 'api-l2a')" >/dev/null
C_L2B="$(uno "select t216.crear('admin')")"; uno "select t216.pagar($C_L2B, 450000, 'api-l2b')" >/dev/null
C_O="$(uno "select t216.crear('admin')")"
ADMIN="$(uno "select t216.u('admin')")"; VENTA="$(uno "select t216.u('ventaA')")"
FOTO() { uno "select md5(to_jsonb(c)::text) from public.cotizaciones c where id = $1"; }
ok "A0 datos sembrados por las RPC reales (cotizaciones $C_EDIT, $C_PAG, …)"

SECRETO="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
CLAVE_AUTH="auth_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
$PSA -d postgres -c "alter role authenticator with login password '$CLAVE_AUTH'" >/dev/null
docker rm -f "$PGRST" >/dev/null 2>&1 || true
docker run -d --name "$PGRST" --network "$RED" -p 127.0.0.1:3216:3000 \
  -e PGRST_DB_URI="postgres://authenticator:$CLAVE_AUTH@$CT:5432/$DB" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" \
  "$IMAGEN_PGRST" >/dev/null
BASE="http://127.0.0.1:3216"
i=0; while [ "$i" -lt 90 ]; do [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/" || true)" = 200 ] && break; sleep 1; i=$((i + 1)); done
[ "$i" -lt 90 ] && ok "H1 PostgREST local listo con secreto JWT local" || { fallo "H1 PostgREST no respondió: $(docker logs --tail 5 "$PGRST" 2>&1 | tr '\n' ' ')"; exit 1; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
firmar() {
  h="$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)"; p="$(printf '%s' "$1" | b64url)"
  s="$(printf '%s' "$h.$p" | openssl dgst -sha256 -hmac "$2" -binary | b64url)"; printf '%s.%s.%s' "$h" "$p" "$s"
}
ahora="$(date +%s)"
tok() { firmar "{\"sub\":\"$1\",\"role\":\"authenticated\",\"aud\":\"authenticated\",\"exp\":$((ahora + 3600))}" "$SECRETO"; }
T_AD="$(tok "$ADMIN")"; T_VA="$(tok "$VENTA")"
T_SR="$(firmar "{\"role\":\"service_role\",\"exp\":$((ahora + 3600))}" "$SECRETO")"
pedir() { # $1 método, $2 ruta, $3 token o '-', $4 cuerpo o '-', $5 encabezado extra o '-' ; cuerpo en $TMP/h.body, imprime el código
  if [ "$3" = - ]; then AUTH="X-Sin-Token: 1"; else AUTH="Authorization: Bearer $3"; fi
  if [ "$5" = - ]; then EXTRA="X-T216: 1"; else EXTRA="$5"; fi
  if [ "$4" = - ]; then
    curl -s -w '%{stderr}%{http_code}' -X "$1" -H "$AUTH" -H "$EXTRA" "$BASE$2" 2>&1 >"$TMP/h.body" || echo 000
  else
    curl -s -w '%{stderr}%{http_code}' -X "$1" -H "$AUTH" -H "$EXTRA" -H 'Content-Type: application/json' -d "$4" "$BASE$2" 2>&1 >"$TMP/h.body" || echo 000
  fi
}
cuerpo() { tr '\n' ' ' < "$TMP/h.body" | cut -c1-300; }

# ══ X · exposición ═══════════════════════════════════════════════════════
for t in "$T_AD" "$T_SR"; do
  c="$(pedir POST /rpc/emitir "$t" '{"p_cotizacion_id":1,"p_operacion":"pago","p_actor_id":null}' -)"
  [ "$c" = 404 ] && ok "X1 /rpc/emitir en public: 404 (no existe fuera de p39_priv)" || fallo "X1 $c $(cuerpo)"
  c="$(pedir POST /rpc/emitir "$t" '{"p_cotizacion_id":1,"p_operacion":"pago","p_actor_id":null}' 'Content-Profile: p39_priv')"
  [ "$c" = 406 ] && ok "X2 Content-Profile p39_priv: 406 (esquema no expuesto)" || fallo "X2 $c $(cuerpo)"
  c="$(pedir GET '/autorizacion_emitida?select=*' "$t" - 'Accept-Profile: p39_priv')"
  [ "$c" = 406 ] && ok "X3 Accept-Profile p39_priv: 406" || fallo "X3 $c $(cuerpo)"
done
c="$(pedir POST /rpc/frontera_activa "$T_SR" '{}' -)"
[ "$c" = 404 ] && ok "X4 /rpc/frontera_activa: 404" || fallo "X4 $c $(cuerpo)"
# GraphQL (H3). pg_graphql solo refleja los esquemas del search_path EFECTIVO de la sesión (los
# que el rol puede usar; ver postcheck_208 C16), y `set role` no cambia el search_path. Por eso:
#   X5   search_path por defecto (lo que hace el endpoint): nada de p39_priv para ningún rol, en
#        consultas NI en mutations (`emitir`/`cerrar`/`autorizada` son VOLATILE: serían
#        Mutation); X5.1: authenticated y service_role sí muestran mutations reales.
#   X6   p39_priv AGREGADO al search_path: anon y authenticated siguen sin verlo. Lo que lo
#        impide es que no tienen USAGE sobre el esquema, no la configuración.
#   X6.1 control positivo: con p39_priv en el search_path, service_role SÍ ve `emitir` y
#        `composicion_coincide` (tiene USAGE y EXECUTE porque los wrappers INVOKER los usan). Así
#        X6 no es trivial, y queda dicho que a service_role solo lo protege la configuración
#        (p39_priv fuera de search_path y de pgrst.db_schemas: C21/C22 del postcheck 216).
# Los patrones toleran camelCase (inflección de pg_graphql): `frontera_?activa`, etc.
P39_GQL='p39|autorizacion_?emitida|autorizacion_?cerrada|suspension_?edicion|emitir|cerrar|autorizada|frontera_?activa|componentes_?manual|composicion_?coincide'
INTRO='{ __schema { types { name } queryType { fields { name } } mutationType { fields { name } } } }'
gql() { # $1 rol, $2 search_path a fijar ('' = el de la sesión, sin tocar)
  sp=""
  [ -z "$2" ] || sp="set search_path = $2; "
  docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_ADMIN" -d "$DB" -X -q -t -A \
    -c "set role $1; ${sp}select graphql.resolve(\$\$ $INTRO \$\$)::text" 2>&1 || true
}
intro_ok() { printf '%s' "$1" | grep -q '"Query"' && printf '%s' "$1" | grep -q '"mutationType"' && ! printf '%s' "$1" | grep -q '"errors"'; }
if $PSA -d "$DB" -c "create extension if not exists pg_graphql" > "$TMP/gq.out" 2>&1 \
   && $PSA -d "$DB" -c "grant usage on schema graphql to anon, authenticated, service_role; grant execute on all functions in schema graphql to anon, authenticated, service_role" >> "$TMP/gq.out" 2>&1; then
  for rol in anon authenticated service_role; do
    R="$(gql "$rol" '')"
    if intro_ok "$R" && ! printf '%s' "$R" | grep -qiE "$P39_GQL"; then
      ok "X5 GraphQL ($rol, search_path por defecto): introspección (consultas y mutations) sin nada de p39_priv"
    else fallo "X5 GraphQL ($rol): $(printf '%s' "$R" | cut -c1-300)"; fi
    if [ "$rol" != anon ]; then
      printf '%s' "$R" | grep -q '"insertInto' && ok "X5.1 GraphQL ($rol): la introspección sí trae mutations (la ausencia no es trivial)" \
        || fallo "X5.1 GraphQL ($rol): sin mutations en la introspección: $(printf '%s' "$R" | cut -c1-300)"
    fi
  done
  for rol in anon authenticated; do
    R="$(gql "$rol" 'public, p39_priv')"
    if intro_ok "$R" && ! printf '%s' "$R" | grep -qiE "$P39_GQL"; then
      ok "X6 GraphQL ($rol, p39_priv en el search_path): sigue sin ver nada de p39_priv (sin USAGE)"
    else fallo "X6 GraphQL ($rol, p39_priv en el search_path): $(printf '%s' "$R" | cut -c1-300)"; fi
  done
  R="$(gql service_role 'public, p39_priv')"
  if intro_ok "$R" && printf '%s' "$R" | grep -qiE 'emitir' && printf '%s' "$R" | grep -qiE 'composicion_?coincide'; then
    ok "X6.1 GraphQL (service_role, p39_priv en el search_path): control positivo, SÍ ve emitir y composicion_coincide"
  else fallo "X6.1 GraphQL (service_role) control positivo sin emitir/composicion_coincide: $(printf '%s' "$R" | cut -c1-300)"; fi
else fallo "X5 no se pudo preparar pg_graphql: $(tail -3 "$TMP/gq.out" | tr '\n' ' ')"; fi

# ══ A · ACL de las RPC por HTTP ══════════════════════════════════════════
c="$(pedir POST /rpc/edicion_cotizaciones_habilitada "$T_AD" '{}' -)"
[ "$c" = 200 ] && grep -q true "$TMP/h.body" && ok "A1 authenticated consulta la habilitación: 200 true" || fallo "A1 $c $(cuerpo)"
c="$(pedir POST /rpc/edicion_cotizaciones_habilitada - '{}' -)"
[ "$c" = 401 ] && ok "A2 anon no consulta la habilitación: 401" || fallo "A2 $c $(cuerpo)"
# Con argumentos VÁLIDOS: el único motivo para fallar es el permiso (42501), no la firma.
a3() { # $1 función, $2 cuerpo
  c="$(pedir POST "/rpc/$1" "$T_AD" "$2" -)"
  [ "$c" = 403 ] && grep -q 42501 "$TMP/h.body" && ok "A3 authenticated no ejecuta $1: 403 (42501)" || fallo "A3 $1: $c $(cuerpo)"
}
a3 crear_cotizacion_manual "{\"p_usuario_id\":\"$ADMIN\",\"p_tenant\":\"mayorista\",\"p_cabecera\":{},\"p_servicios\":[]}"
a3 editar_servicios_cotizacion_manual "{\"p_usuario_id\":\"$ADMIN\",\"p_cotizacion_id\":$C_EDIT,\"p_rev_esperada\":1,\"p_motivo\":\"x\",\"p_servicios\":[],\"p_cambios\":{}}"
a3 actualizar_recobro_ninos_manual "{\"p_usuario_id\":\"$ADMIN\",\"p_cotizacion_id\":$C_EDIT,\"p_rev_esperada\":1,\"p_motivo\":\"x\",\"p_cambios\":{}}"
a3 anular_pago_previo_controlado "{\"p_pago_id\":$P_PAG,\"p_usuario_id\":\"$ADMIN\",\"p_motivo\":\"x\"}"
a3 convertir_cotizacion_manual_controlada "{\"p_cotizacion_id\":$C_PAG,\"p_usuario_id\":\"$ADMIN\"}"
a3 convertir_cotizacion_a_contrato "{\"p_cotizacion_id\":$C_PAG,\"p_usuario_id\":\"$ADMIN\"}"
a3 anular_pago_previo "{\"p_pago_id\":$P_PAG,\"p_usuario_id\":\"$ADMIN\",\"p_motivo\":\"x\"}"

# ══ D · escrituras directas por REST ═════════════════════════════════════
F0="$(FOTO "$C_EDIT")"
for par in "$T_AD:authenticated" "$T_VA:venta" "$T_SR:service_role"; do
  t="${par%%:*}"; n="${par#*:}"
  c="$(pedir PATCH "/cotizaciones?id=eq.$C_EDIT" "$t" '{"precio_venta":1}' -)"
  [ "$c" = 403 ] && grep -q FRONTERA_39 "$TMP/h.body" && ok "D1 $n PATCH precio: 403 FRONTERA_39" || fallo "D1 $n $c $(cuerpo)"
  c="$(pedir PATCH "/cotizaciones?id=eq.$C_EDIT" "$t" '{"condicion_pago_congelada_en":"2026-01-01T00:00:00Z","monto_exigido_total":0,"monto_exigido_total_cop":0,"trm_autoritativa":9999}' -)"
  [ "$c" = 403 ] && grep -q FRONTERA_39 "$TMP/h.body" && ok "D2 $n PATCH del PRIMER congelado sin pago: 403" || fallo "D2 $n $c $(cuerpo)"
  c="$(pedir PATCH "/cotizaciones?id=eq.$C_EDIT" "$t" '{"estado":"convertida"}' -)"
  [ "$c" = 403 ] && ok "D3 $n PATCH estado convertida: 403" || fallo "D3 $n $c $(cuerpo)"
  c="$(pedir POST /cotizacion_servicios "$t" "{\"cotizacion_id\":$C_EDIT,\"tipo_servicio\":\"hotel\",\"valor\":5}" -)"
  [ "$c" = 403 ] && ok "D4 $n POST servicios: 403" || fallo "D4 $n $c $(cuerpo)"
  c="$(pedir DELETE "/cotizacion_servicios?cotizacion_id=eq.$C_EDIT" "$t" - -)"
  [ "$c" = 403 ] && ok "D5 $n DELETE servicios: 403" || fallo "D5 $n $c $(cuerpo)"
  c="$(pedir POST /cotizaciones "$t" '{"tenant":"mayorista","tipo":"manual","estado":"abierta","payload":{},"moneda":"COP","precio_venta":1,"vigencia_hasta":"2099-01-01"}' -)"
  [ "$c" = 403 ] && ok "D6 $n POST de una manual: 403" || fallo "D6 $n $c $(cuerpo)"
  c="$(pedir DELETE "/cotizaciones?id=eq.$C_EDIT" "$t" - -)"
  [ "$c" = 403 ] && ok "D7 $n DELETE de una manual: 403" || fallo "D7 $n $c $(cuerpo)"
done
[ "$(FOTO "$C_EDIT")" = "$F0" ] && ok "D8 la cotización no cambió en nada" || fallo "D8 cambió"
c="$(pedir PATCH "/cotizaciones?id=eq.$C_EDIT" "$T_VA" '{"vigencia_hasta":"2099-01-02"}' -)"
{ [ "$c" = 204 ] || [ "$c" = 200 ]; } && [ "$(uno "select vigencia_hasta from public.cotizaciones where id = $C_EDIT")" = 2099-01-02 ] \
  && ok "D9 PATCH solo de vigencia (venta, ajena): pasa como hoy ($c)" || fallo "D9 $c $(cuerpo)"
c="$(pedir PATCH "/cotizaciones?id=eq.$C_EDIT" "$T_VA" '{"vigencia_hasta":"2099-01-03","precio_venta":2}' -)"
[ "$c" = 403 ] && [ "$(uno "select vigencia_hasta from public.cotizaciones where id = $C_EDIT")" = 2099-01-02 ] \
  && ok "D10 PATCH vigencia + precio: 403 y nada cambia (V13)" || fallo "D10 $c $(cuerpo)"
c="$(pedir POST /cotizacion_pagos_previos "$T_SR" "{\"cotizacion_id\":$C_PAG,\"tenant\":\"mayorista\",\"monto_cop\":1,\"monto_moneda\":1,\"moneda\":\"COP\",\"forma_pago\":\"Transferencia\",\"referencia\":\"R-API\",\"registrado_por_id\":\"$ADMIN\"}" -)"
[ "$c" = 403 ] && grep -q FRONTERA_39 "$TMP/h.body" && ok "D11 service_role POST de un pago: 403 FRONTERA_39" || fallo "D11 $c $(cuerpo)"
c="$(pedir PATCH "/cotizacion_pagos_previos?id=eq.$P_PAG" "$T_SR" '{"estado":"anulado"}' -)"
[ "$c" = 403 ] && ok "D12 service_role PATCH anular un pago sin la operación: 403" || fallo "D12 $c $(cuerpo)"
c="$(pedir DELETE "/cotizacion_pagos_previos?id=eq.$P_PAG" "$T_SR" - -)"
[ "$c" = 403 ] && ok "D13 service_role DELETE de un pago: 403" || fallo "D13 $c $(cuerpo)"
c="$(pedir DELETE "/cotizacion_condiciones?cotizacion_id=eq.$C_PAG" "$T_SR" - -)"
[ "$c" = 403 ] && grep -q FRONTERA_39 "$TMP/h.body" && ok "D14 service_role DELETE de condiciones congeladas: 403 FRONTERA_39" || fallo "D14 $c $(cuerpo)"
c="$(pedir PATCH "/cotizaciones?id=eq.$C_PAG" "$T_SR" '{"condicion_pago_congelada_en":null}' -)"
[ "$c" = 403 ] && ok "D15 service_role quita el congelado (\"nunca tuvo pago\"): 403" || fallo "D15 $c $(cuerpo)"
[ "$(uno "select estado || '/' || (select count(*) from public.cotizacion_condiciones where cotizacion_id = $C_PAG) from public.cotizacion_pagos_previos where id = $P_PAG")" = "activo/2" ] \
  && ok "D16 el pago y sus condiciones siguen intactos" || fallo "D16"

# ══ O · firmas antiguas por REST ═════════════════════════════════════════
HOY="$(uno "select public.fecha_negocio()::text")"
ARGS_198="$(uno "select json_build_object('p_cotizacion_id', $C_O, 'p_valor', 100000, 'p_moneda', 'COP', 'p_trm', 1, 'p_forma_pago', 'Transferencia',
   'p_referencia', 'REF-O1', 'p_fecha_pago', '$HOY', 'p_usuario_id', '$ADMIN', 'p_idempotency_key', 'api-o1',
   'p_snapshot', t216.snap($C_O), 'p_exigido_total_moneda', t216.exigido($C_O), 'p_pct_efectivo', null)::text")"
c="$(pedir POST /rpc/registrar_pago_previo "$T_SR" "$ARGS_198" -)"
[ "$c" = 403 ] && grep -q FRONTERA_39 "$TMP/h.body" && [ "$(uno "select count(*) from public.cotizacion_pagos_previos where cotizacion_id = $C_O")" = 0 ] \
  && ok "O1 /rpc/registrar_pago_previo (198) directo: 403 FRONTERA_39, sin pago" || fallo "O1 $c $(cuerpo)"
c="$(pedir POST /rpc/convertir_cotizacion_a_contrato "$T_SR" "{\"p_cotizacion_id\":$C_PAG,\"p_usuario_id\":\"$ADMIN\"}" -)"
[ "$c" = 403 ] && grep -q FRONTERA_39 "$TMP/h.body" && [ "$(uno "select count(*) from public.ventas where cotizacion_id = $C_PAG")" = 0 ] \
  && ok "O2 /rpc/convertir_cotizacion_a_contrato (198) directo: 403, sin contrato" || fallo "O2 $c $(cuerpo)"
c="$(pedir POST /rpc/anular_pago_previo "$T_SR" "{\"p_pago_id\":$P_PAG,\"p_usuario_id\":\"$ADMIN\",\"p_motivo\":\"x\"}" -)"
[ "$c" = 403 ] && [ "$(uno "select estado from public.cotizacion_pagos_previos where id = $P_PAG")" = activo ] \
  && ok "O3 /rpc/anular_pago_previo (198) directo: 403, el pago sigue activo" || fallo "O3 $c $(cuerpo)"
ARGS_REV="$(printf '%s' "$ARGS_198" | sed "s/}\$/, \"p_rev_esperada\": $(uno "select t216.rev($C_O)")}/")"
c="$(pedir POST /rpc/registrar_pago_previo_rev "$T_SR" "$ARGS_REV" -)"
[ "$c" = 200 ] && grep -q 'OK|' "$TMP/h.body" && ok "O4 la puerta nueva por REST (service_role): 200 $(cuerpo)" || fallo "O4 $c $(cuerpo)"
c="$(pedir POST /rpc/convertir_cotizacion_manual_controlada "$T_SR" "{\"p_cotizacion_id\":$C_PAG,\"p_usuario_id\":\"$ADMIN\"}" -)"
[ "$c" = 200 ] && [ "$(uno "select count(*) from public.ventas where cotizacion_id = $C_PAG")" = 1 ] && ok "O5 conversión por la puerta nueva: 200 $(cuerpo)" || fallo "O5 $c $(cuerpo)"

# ══ L · lotes ════════════════════════════════════════════════════════════
LOTE="$(uno "select json_agg(json_build_object('p_cotizacion_id', c, 'p_valor', 100000, 'p_moneda', 'COP', 'p_trm', 1, 'p_forma_pago', 'Transferencia',
   'p_referencia', 'REF-L1-' || c, 'p_fecha_pago', '$HOY', 'p_usuario_id', '$ADMIN', 'p_idempotency_key', 'api-l1-' || c,
   'p_rev_esperada', t216.rev(c), 'p_snapshot', t216.snap(c), 'p_exigido_total_moneda', t216.exigido(c), 'p_pct_efectivo', null))::text
   from unnest(array[$C_L1A, $C_L1B]::bigint[]) c")"
E0="$(uno "select count(*) from p39_priv.autorizacion_emitida")"
c="$(pedir POST /rpc/registrar_pago_previo_rev "$T_SR" "$LOTE" 'Prefer: params=multiple-objects')"
if [ "$c" = 200 ] && [ "$(uno "select count(*) from public.cotizacion_pagos_previos where cotizacion_id in ($C_L1A, $C_L1B)")" = 2 ] \
   && [ "$(uno "select count(*) from p39_priv.autorizacion_emitida")" = "$((E0 + 2))" ] \
   && [ "$(uno "select count(*) from p39_priv.autorizacion_emitida e where not exists (select 1 from p39_priv.autorizacion_cerrada x where x.autorizacion_id = e.id)")" = 0 ]; then
  ok "L1 lote de 2 pagos por el wrapper: 2 pagos, 2 autorizaciones, todas cerradas"
else fallo "L1 $c $(cuerpo)"; fi
c="$(pedir POST /rpc/convertir_cotizacion_a_contrato "$T_SR" "[{\"p_cotizacion_id\":$C_L2A,\"p_usuario_id\":\"$ADMIN\"},{\"p_cotizacion_id\":$C_L2B,\"p_usuario_id\":\"$ADMIN\"}]" 'Prefer: params=multiple-objects')"
[ "$c" = 403 ] && [ "$(uno "select count(*) from public.ventas where cotizacion_id in ($C_L2A, $C_L2B)")" = 0 ] \
  && ok "L2 la 198 en lote falla entera: 403 y ningún contrato" || fallo "L2 $c $(cuerpo)"
c="$(pedir POST /rpc/convertir_cotizacion_manual_controlada "$T_SR" "[{\"p_cotizacion_id\":$C_L2A,\"p_usuario_id\":\"$ADMIN\"},{\"p_cotizacion_id\":$C_L2B,\"p_usuario_id\":\"$ADMIN\"}]" 'Prefer: params=multiple-objects')"
[ "$c" = 200 ] && [ "$(uno "select count(*) from public.ventas where cotizacion_id in ($C_L2A, $C_L2B)")" = 2 ] \
  && ok "L3 lote de conversiones por el wrapper: 2 contratos" || fallo "L3 $c $(cuerpo)"

docker rm -f "$PGRST" >/dev/null 2>&1 || true
echo "------------------------------------------------------------"
echo "Resultado: $OKS OK, $FALLOS FALLO(S)"
if [ "$FALLOS" = 0 ]; then echo "TEST 216 API: TODO OK"; else echo "TEST 216 API: $FALLOS FALLO(S)"; exit 1; fi
