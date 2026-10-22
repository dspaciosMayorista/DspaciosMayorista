#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# API · hotfix 225 (cierre) (netos de empaquetados por rol) por HTTP: PostgREST local con JWT HS256 firmados con un
# secreto LOCAL aleatorio, sobre una base DESECHABLE (CI o local). Nunca Supabase remoto.
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_225_api.sh <contenedor> [plantilla] [red]
#   plantilla = cadena 001-223 (aquí se aplican la 224 y, a continuación, la 225: estado FINAL del hotfix)
#
# Es el equivalente exacto de lo que un usuario con su token puede pedir a la API de Supabase, sin pasar por
# la aplicación: GET /rest/v1/empaquetados?select=*  y  GET /rest/v1/empaquetados_basica?select=*.
#
#   H   PostgREST listo
#   T   tabla base: anon, venta y agencia no reciben filas ni el importe; control_vuelo, operaciones y
#       superadmin SÍ reciben el neto (la prueba no es vacía)
#   V   vista empaquetados_basica: venta alcanza las filas, sin la columna de costo; pedir la columna da error
#   E   embed por armado_empaquetados y historial: ningún camino lateral al neto
#   W   escritura y RPC de control: venta no escribe ni controla; control_vuelo sí (el editor sigue funcionando)
#
# Límite: demuestra el comportamiento de PostgREST con el secreto LOCAL; no prueba la configuración de claves
# ni de "Exposed schemas" del proyecto Supabase real, ni GraphQL (pg_graphql no corre en este arnés).
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla225}"
RED="${3:-red225}"
export MSYS_NO_PATHCONV=1
valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_225_api.sh <contenedor> [plantilla] [red]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
valido "$RED" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Red inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PW="${PGPASSWORD_225:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
IMAGEN_PGRST=ghcr.io/supabase/postgrest:v16.1
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_225a $SUF"
DB="t225_api_$SUF"
PGRST="pgrst225_$SUF"
PSA="docker exec -i -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_ADMIN -X -q -v ON_ERROR_STOP=1"
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
i=1
until $PSA -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>"$TMP/cb.err"; do
  [ "$i" -lt 8 ] || { cat "$TMP/cb.err" >&2; exit 1; }
  i=$((i + 1)); sleep 2
done
$PSA -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null
$PSA -d "$DB" > "$TMP/env.out" 2>&1 <<'SQL' || { echo "No se pudo preparar auth.uid()/auth.role() en la base de prueba: $(tail -3 "$TMP/env.out" | cut -c1-300)" >&2; exit 1; }
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
SQL
for n in 20260601000224_neto_empaquetados_por_rol 20260601000225_neto_empaquetados_cierre; do
  docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -v ON_ERROR_STOP=1 \
    < "$APP/supabase/migrations/$n.sql" > "$TMP/m.out" 2>&1 \
    || { echo "No se pudo aplicar $n: $(cut -c1-400 "$TMP/m.out")"; exit 1; }
done

UID_SUP='00000000-0000-0000-0000-000000225101'
UID_OPE='00000000-0000-0000-0000-000000225102'
UID_CTL='00000000-0000-0000-0000-000000225103'
UID_VEN='00000000-0000-0000-0000-000000225104'
UID_AGE='00000000-0000-0000-0000-000000225105'
$PSA -d "$DB" >"$TMP/fx.out" 2>&1 <<SQL || { echo "Fixtures: $(tail -5 "$TMP/fx.out")"; exit 1; }
begin;
insert into auth.users (id, email) values
  ('$UID_SUP', 'a225-sup@x.test'), ('$UID_OPE', 'a225-ope@x.test'), ('$UID_CTL', 'a225-ctl@x.test'),
  ('$UID_VEN', 'a225-ven@x.test'), ('$UID_AGE', 'a225-age@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('$UID_SUP', 'a225-sup@x.test', 'A225 super', 'superadmin', true, 'mayorista'),
  ('$UID_OPE', 'a225-ope@x.test', 'A225 operaciones', 'operaciones', true, 'mayorista'),
  ('$UID_CTL', 'a225-ctl@x.test', 'A225 control', 'control_vuelo', true, 'mayorista'),
  ('$UID_VEN', 'a225-ven@x.test', 'A225 venta', 'venta', true, 'mayorista'),
  ('$UID_AGE', 'a225-age@x.test', 'A225 agencia', 'agencia', true, 'mayorista')
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
delete from public.empaquetado_cambios;
delete from public.empaquetados;
-- La 220 valida el destino aéreo al vincular un empaquetado a un paquete (trigger diferido): paquete y vuelo, al mismo destino.
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (99010, 'A225 DESTINO', 'CTG', 'Colombia', true);
insert into public.empaquetados (id, record, aerolinea, ruta, fecha_ida, destino_id, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, compra_inicio, compra_fin, activo, notas) values
  (98001, 'A225E1', 'AEROTEST', 'BOG - CTG - BOG', current_date + 40, 99010, 424242.42, 500000, 31337, current_date - 3, current_date + 30, true, 'neto 424242'),
  (98002, null, 'AEROTEST', 'BOG - SMR - BOG', current_date + 50, null, 313131.31, 400000, 0, null, null, false, null);
insert into public.empaquetado_cambios (empaquetado_id, detalle, nota, registrado_por) values (98001, 'Record: (vacio) a A225E1', 'alta de prueba', 'A224');
insert into public.armado_paquetes (id, nombre, destino_id) values (98301, 'A225 paquete', 99010);
insert into public.armado_empaquetados (paquete_id, empaquetado_id) values (98301, 98001);
commit;
SQL
uno() { $PSA -d "$DB" -t -A -c "$1"; }
ok "A0 base con la 224 y la 225 aplicadas y fixtures confirmadas (2 empaquetados, neto 424242.42)"

SECRETO="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
CLAVE_AUTH="auth_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
$PSA -d postgres -c "alter role authenticator with login password '$CLAVE_AUTH'" >/dev/null
docker rm -f "$PGRST" >/dev/null 2>&1 || true
docker run -d --name "$PGRST" --network "$RED" -p 127.0.0.1:3225:3000 \
  -e PGRST_DB_URI="postgres://authenticator:$CLAVE_AUTH@$CT:5432/$DB" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" \
  "$IMAGEN_PGRST" >/dev/null
BASE="http://127.0.0.1:3225"
i=0; while [ "$i" -lt 90 ]; do [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/" || true)" = 200 ] && break; sleep 1; i=$((i + 1)); done
[ "$i" -lt 90 ] && ok "H1 PostgREST local listo con secreto JWT local" || { fallo "H1 PostgREST no respondió: $(docker logs --tail 5 "$PGRST" 2>&1 | tr '\n' ' ')"; exit 1; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
firmar() {
  h="$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)"; p="$(printf '%s' "$1" | b64url)"
  s="$(printf '%s' "$h.$p" | openssl dgst -sha256 -hmac "$2" -binary | b64url)"; printf '%s.%s.%s' "$h" "$p" "$s"
}
ahora="$(date +%s)"
tok() { firmar "{\"sub\":\"$1\",\"role\":\"authenticated\",\"aud\":\"authenticated\",\"exp\":$((ahora + 3600))}" "$SECRETO"; }
T_SU="$(tok "$UID_SUP")"; T_OP="$(tok "$UID_OPE")"; T_CT="$(tok "$UID_CTL")"; T_VE="$(tok "$UID_VEN")"; T_AG="$(tok "$UID_AGE")"
# $1 método, $2 ruta, $3 token o '-', $4 cuerpo JSON o '-'. Cuerpo de la respuesta en $TMP/h.body; imprime el código HTTP.
pedir() {
  if [ "$3" = - ]; then AUTH="X-Sin-Token: 1"; else AUTH="Authorization: Bearer $3"; fi
  if [ "$4" = - ]; then
    curl -s -o "$TMP/h.body" -w '%{http_code}' -X "$1" -H "$AUTH" -H 'Prefer: return=representation' "$BASE$2" || echo 000
  else
    curl -s -o "$TMP/h.body" -w '%{http_code}' -X "$1" -H "$AUTH" -H 'Content-Type: application/json' -H 'Prefer: return=representation' -d "$4" "$BASE$2" || echo 000
  fi
}
cuerpo() { tr '\n' ' ' < "$TMP/h.body" | cut -c1-300; }
es_error() { [ "$1" -ge 400 ] 2>/dev/null; }
es_ok() { [ "$1" -ge 200 ] 2>/dev/null && [ "$1" -lt 300 ]; }
sin_importe() { ! grep -Eq '424242|313131|31337' "$TMP/h.body"; }
filas() { grep -o '"id":' "$TMP/h.body" | wc -l | tr -d ' '; }
vacio() { [ "$(tr -d ' \n' < "$TMP/h.body")" = '[]' ]; }

# ══ T · tabla base ═══════════════════════════════════════════════════════════════════════════
c="$(pedir GET '/empaquetados?select=*' - -)"
{ es_error "$c" || vacio; } && sin_importe && ok "T1 anon pide la tabla completa y no recibe filas ni importes ($c)" || fallo "T1 anon: $c $(cuerpo)"
c="$(pedir GET '/empaquetados?select=*' "$T_VE" -)"
es_ok "$c" && vacio && sin_importe && ok "T2 venta pide select=* de la tabla base: 0 filas, sin importes ($c)" || fallo "T2 venta: $c $(cuerpo)"
c="$(pedir GET '/empaquetados?select=tarifa_proveedor,fee_infante,notas' "$T_VE" -)"
{ { es_ok "$c" && vacio; } || es_error "$c"; } && sin_importe && ok "T3 venta pide solo las columnas de costo: nada ($c)" || fallo "T3 venta: $c $(cuerpo)"
c="$(pedir GET '/empaquetados?select=*&tarifa_proveedor=gt.0' "$T_VE" -)"
{ { es_ok "$c" && vacio; } || es_error "$c"; } && sin_importe && ok "T4 venta filtrando por el neto tampoco obtiene nada ($c)" || fallo "T4 venta: $c $(cuerpo)"
c="$(pedir GET '/empaquetados?select=*' "$T_AG" -)"
es_ok "$c" && vacio && sin_importe && ok "T5 agencia: 0 filas, sin importes ($c)" || fallo "T5 agencia: $c $(cuerpo)"
c="$(pedir GET '/empaquetados?select=id,tarifa_proveedor' "$T_CT" -)"
es_ok "$c" && [ "$(filas)" = 2 ] && grep -q '424242.42' "$TMP/h.body" && ok "T6 control_vuelo SÍ recibe el neto de las 2 filas (la prueba no es vacía) ($c)" || fallo "T6 control_vuelo: $c $(cuerpo)"
c="$(pedir GET '/empaquetados?select=id,tarifa_proveedor' "$T_OP" -)"
es_ok "$c" && [ "$(filas)" = 2 ] && grep -q '424242.42' "$TMP/h.body" && ok "T7 operaciones recibe el neto ($c)" || fallo "T7 operaciones: $c $(cuerpo)"
c="$(pedir GET '/empaquetados?select=id,tarifa_proveedor' "$T_SU" -)"
es_ok "$c" && [ "$(filas)" = 2 ] && grep -q '313131.31' "$TMP/h.body" && ok "T8 superadmin recibe el neto ($c)" || fallo "T8 superadmin: $c $(cuerpo)"

# ══ V · vista empaquetados_basica ════════════════════════════════════════════════════════════
c="$(pedir GET '/empaquetados_basica?select=*' "$T_VE" -)"
es_ok "$c" && [ "$(filas)" = 2 ] && sin_importe && ! grep -q 'tarifa_proveedor\|fee_infante\|tarifa_para_empaquetar\|estado_pago\|notas' "$TMP/h.body" \
  && ok "V1 venta alcanza las 2 filas por la vista y no trae ninguna columna de costo ($c)" || fallo "V1 venta vista: $c $(cuerpo)"
c="$(pedir GET '/empaquetados_basica?select=id,activo,compra_inicio,compra_fin&id=eq.98001' "$T_VE" -)"
es_ok "$c" && [ "$(filas)" = 1 ] && grep -q '"activo":true' "$TMP/h.body" && ok "V2 venta lee activo y ventana de compra de un empaquetado por id (lo que usa la reserva) ($c)" || fallo "V2 $c $(cuerpo)"
c="$(pedir GET '/empaquetados_basica?select=tarifa_proveedor' "$T_VE" -)"
es_error "$c" && grep -q '42703' "$TMP/h.body" && ok "V3 pedir tarifa_proveedor a la vista falla con columna inexistente ($c)" || fallo "V3 $c $(cuerpo)"
c="$(pedir GET '/empaquetados_basica?select=tarifa_proveedor' "$T_SU" -)"
es_error "$c" && ok "V4 ni superadmin puede pedirla a la vista ($c)" || fallo "V4 $c $(cuerpo)"
c="$(pedir GET '/empaquetados_basica?select=*' "$T_AG" -)"
es_ok "$c" && vacio && ok "V5 agencia: la vista devuelve 0 filas ($c)" || fallo "V5 agencia vista: $c $(cuerpo)"
c="$(pedir GET '/empaquetados_basica?select=*' - -)"
es_error "$c" && sin_importe && ok "V6 anon no tiene permiso sobre la vista ($c)" || fallo "V6 anon vista: $c $(cuerpo)"
c="$(pedir GET '/empaquetados_basica?select=*' "$T_CT" -)"
es_ok "$c" && [ "$(filas)" = 2 ] && ok "V7 control_vuelo también alcanza la vista ($c)" || fallo "V7 control_vuelo vista: $c $(cuerpo)"

# ══ E · caminos laterales ════════════════════════════════════════════════════════════════════
c="$(pedir GET '/armado_empaquetados?select=*,empaquetados(tarifa_proveedor,fee_infante)' "$T_VE" -)"
{ { es_ok "$c" && vacio; } || es_error "$c"; } && sin_importe && ok "E1 venta no alcanza el neto por el embed de armado_empaquetados ($c)" || fallo "E1 $c $(cuerpo)"
c="$(pedir GET '/armado_empaquetados?select=*,empaquetados(tarifa_proveedor)' "$T_OP" -)"
es_ok "$c" && grep -q '424242.42' "$TMP/h.body" && ok "E2 operaciones SÍ alcanza el neto por el embed (el armado interno sigue funcionando) ($c)" || fallo "E2 $c $(cuerpo)"
c="$(pedir GET '/empaquetado_cambios?select=*' "$T_VE" -)"
es_ok "$c" && sin_importe && ok "E3 el historial que sigue leyendo venta no trae importes ($c)" || fallo "E3 $c $(cuerpo)"

# ══ W · escritura y RPC de control ═══════════════════════════════════════════════════════════
ANTES="$(uno "select tarifa_proveedor::text || '|' || coalesce(record, '') from public.empaquetados where id = 98001")"
c="$(pedir PATCH '/empaquetados?id=eq.98001' "$T_VE" '{"tarifa_proveedor":0}')"
{ { es_ok "$c" && vacio; } || es_error "$c"; } && [ "$(uno "select tarifa_proveedor::text || '|' || coalesce(record, '') from public.empaquetados where id = 98001")" = "$ANTES" ] \
  && ok "W1 venta no puede cambiar el neto ($c); el dato no cambió" || fallo "W1 $c $(cuerpo)"
c="$(pedir POST /empaquetados "$T_VE" '{"fecha_ida":"2030-01-01","tarifa_proveedor":1}')"
es_error "$c" && [ "$(uno "select count(*) from public.empaquetados")" = 2 ] && ok "W2 venta no inserta empaquetados ($c)" || fallo "W2 $c $(cuerpo)"
c="$(pedir POST /rpc/actualizar_control_empaquetado "$T_VE" '{"p_empaquetado_id":98001,"p_record":"ZZ225","p_estado_emision":"emitido","p_estado_pago":"pagado","p_nota":"venta"}')"
es_error "$c" && [ "$(uno "select coalesce(record, '') from public.empaquetados where id = 98001")" = 'A225E1' ] && ok "W3 venta no puede usar la RPC de control de emisión ($c); el record no cambió" || fallo "W3 $c $(cuerpo)"
c="$(pedir POST /rpc/actualizar_control_empaquetado - '{"p_empaquetado_id":98001,"p_record":"ZZ225","p_estado_emision":"emitido","p_estado_pago":"pagado","p_nota":"anon"}')"
es_error "$c" && [ "$(uno "select coalesce(record, '') from public.empaquetados where id = 98001")" = 'A225E1' ] && ok "W4 anon no puede usar la RPC de control ($c)" || fallo "W4 $c $(cuerpo)"
c="$(pedir POST /rpc/actualizar_control_empaquetado "$T_CT" '{"p_empaquetado_id":98001,"p_record":"A225OK","p_estado_emision":"emitido","p_estado_pago":"pagado","p_nota":"control_vuelo"}')"
es_ok "$c" && [ "$(uno "select coalesce(record, '') from public.empaquetados where id = 98001")" = 'A225OK' ] && ok "W5 control_vuelo actualiza el control de emisión por la RPC ($c)" || fallo "W5 $c $(cuerpo)"
c="$(pedir PATCH '/empaquetados?id=eq.98001' "$T_CT" '{"tarifa_proveedor":500000.5}')"
es_ok "$c" && [ "$(uno "select tarifa_proveedor::text from public.empaquetados where id = 98001")" = '500000.50' ] && ok "W6 control_vuelo edita el neto (el editor de vuelos sigue funcionando) ($c)" || fallo "W6 $c $(cuerpo)"
c="$(pedir POST /empaquetados "$T_CT" '{"fecha_ida":"2030-02-02","tarifa_proveedor":10}')"
es_ok "$c" && [ "$(uno "select count(*) from public.empaquetados")" = 3 ] && ok "W7 control_vuelo crea un empaquetado ($c)" || fallo "W7 $c $(cuerpo)"
c="$(pedir PATCH '/empaquetados?id=eq.98002' "$T_OP" '{"fee_infante":99}')"
es_ok "$c" && [ "$(uno "select fee_infante::text from public.empaquetados where id = 98002")" = '99.00' ] && ok "W8 operaciones edita ($c)" || fallo "W8 $c $(cuerpo)"

echo ""
if [ "$FALLOS" = 0 ]; then echo "TEST 225 API: TODO OK ($OKS comprobaciones)"; else echo "TEST 225 API: $FALLOS FALLO(S) de $((OKS + FALLOS))"; exit 1; fi
