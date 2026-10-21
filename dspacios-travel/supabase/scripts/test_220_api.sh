#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# API · #67 (migración 220) por HTTP: PostgREST local con JWT HS256 firmados con un secreto LOCAL
# aleatorio, sobre una base DESECHABLE (CI o local). Nunca Supabase remoto.
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_220_api.sh <contenedor> [plantilla] [red]
#
#   H   PostgREST listo
#   T   tabla de alternativas: anon sin acceso; venta sin filas ni escritura; administración sí
#   R   RPC guardar_destinos_aereos_67: anon y venta rechazados; administración guarda; país distinto,
#       ON sin alternativas y vuelo vinculado incompatible rechazados sin cambios parciales
#   V   vínculos directos por REST (Data API): vuelo fuera de alcance rechazado, lote mezclado todo o
#       nada, vuelo permitido aceptado; ninguna escritura parcial
#   F   funciones internas no expuestas a la API
#
# Límite: demuestra el comportamiento de PostgREST con el secreto LOCAL; no prueba la configuración
# de claves ni de "Exposed schemas" del proyecto Supabase real.
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla220}"
RED="${3:-red220}"
export MSYS_NO_PATHCONV=1
valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_220_api.sh <contenedor> [plantilla] [red]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
valido "$RED" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Red inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PW="${PGPASSWORD_220:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
IMAGEN_PGRST=ghcr.io/supabase/postgrest:v16.1
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_220a $SUF"
DB="t220_api_$SUF"
PGRST="pgrst220_$SUF"
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
docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -v ON_ERROR_STOP=1 \
  < "$APP/supabase/migrations/20260601000220_paquete_destinos_aereos.sql" > "$TMP/m.out" 2>&1 \
  || { echo "No se pudo aplicar la 220: $(cut -c1-400 "$TMP/m.out")"; exit 1; }

UID_ADMIN='00000000-0000-0000-0000-000000220002'
UID_VENTA='00000000-0000-0000-0000-000000220005'
$PSA -d "$DB" >"$TMP/fx.out" 2>&1 <<SQL || { echo "Fixtures: $(tail -5 "$TMP/fx.out")"; exit 1; }
begin;
insert into auth.users (id, email) values ('$UID_ADMIN', 'c220-admin@x.test'), ('$UID_VENTA', 'c220-venta@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('$UID_ADMIN', 'c220-admin@x.test', 'C220 admin', 'administracion', true, 'mayorista'),
  ('$UID_VENTA', 'c220-venta@x.test', 'C220 venta', 'venta', true, 'mayorista')
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values
  (94010, 'A220 JUAN DOLIO', null, 'República Dominicana', true),
  (94020, 'A220 SANTO DOMINGO', 'SDQ', 'República Dominicana', true),
  (94030, 'A220 PUNTA CANA', 'PUJ', 'República Dominicana', true),
  (94040, 'A220 CARTAGENA', 'CTG', 'Colombia', true);
insert into public.bloqueos_vuelo (id, record, ruta, fecha_ida, fecha_regreso, cupos_total, destino_id) values
  (94101, 'A220PUJ', 'BOG - PUJ - BOG', current_date + 40, current_date + 44, 10, 94030),
  (94102, 'A220JDO', 'BOG - JDO - BOG', current_date + 40, current_date + 44, 10, 94010),
  (94103, 'A220CTG', 'BOG - CTG - BOG', current_date + 40, current_date + 44, 10, 94040);
insert into public.armado_paquetes (id, nombre, destino_id) values (94301, 'A220 Juan Dolio', 94010);
commit;
SQL
uno() { $PSA -d "$DB" -t -A -c "$1"; }
# Estado de referencia del paquete (para comprobar que un rechazo no dejó cambios parciales).
ESTADO() { uno "select (select destinos_aereos_alternativos::text from public.armado_paquetes where id = 94301) || '|' ||
                       (select coalesce(string_agg(destino_id::text, ',' order by destino_id), '') from public.armado_paquete_destinos_aereos where paquete_id = 94301) || '|' ||
                       (select coalesce(string_agg(bloqueo_id::text, ',' order by bloqueo_id), '') from public.armado_vuelos where paquete_id = 94301)"; }
ok "A0 base con la 220 y fixtures confirmadas"

SECRETO="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
CLAVE_AUTH="auth_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
$PSA -d postgres -c "alter role authenticator with login password '$CLAVE_AUTH'" >/dev/null
docker rm -f "$PGRST" >/dev/null 2>&1 || true
docker run -d --name "$PGRST" --network "$RED" -p 127.0.0.1:3220:3000 \
  -e PGRST_DB_URI="postgres://authenticator:$CLAVE_AUTH@$CT:5432/$DB" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" \
  "$IMAGEN_PGRST" >/dev/null
BASE="http://127.0.0.1:3220"
i=0; while [ "$i" -lt 90 ]; do [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/" || true)" = 200 ] && break; sleep 1; i=$((i + 1)); done
[ "$i" -lt 90 ] && ok "H1 PostgREST local listo con secreto JWT local" || { fallo "H1 PostgREST no respondió: $(docker logs --tail 5 "$PGRST" 2>&1 | tr '\n' ' ')"; exit 1; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
firmar() {
  h="$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)"; p="$(printf '%s' "$1" | b64url)"
  s="$(printf '%s' "$h.$p" | openssl dgst -sha256 -hmac "$2" -binary | b64url)"; printf '%s.%s.%s' "$h" "$p" "$s"
}
ahora="$(date +%s)"
tok() { firmar "{\"sub\":\"$1\",\"role\":\"authenticated\",\"aud\":\"authenticated\",\"exp\":$((ahora + 3600))}" "$SECRETO"; }
T_AD="$(tok "$UID_ADMIN")"; T_VE="$(tok "$UID_VENTA")"
pedir() { # $1 método, $2 ruta, $3 token o '-', $4 cuerpo o '-' ; cuerpo en $TMP/h.body, imprime el código
  if [ "$3" = - ]; then AUTH="X-Sin-Token: 1"; else AUTH="Authorization: Bearer $3"; fi
  if [ "$4" = - ]; then
    curl -s -w '%{stderr}%{http_code}' -X "$1" -H "$AUTH" -H 'Prefer: return=minimal' "$BASE$2" 2>&1 >"$TMP/h.body" || echo 000
  else
    curl -s -w '%{stderr}%{http_code}' -X "$1" -H "$AUTH" -H 'Content-Type: application/json' -H 'Prefer: return=minimal' -d "$4" "$BASE$2" 2>&1 >"$TMP/h.body" || echo 000
  fi
}
cuerpo() { tr '\n' ' ' < "$TMP/h.body" | cut -c1-300; }
es_error() { [ "$1" -ge 400 ] 2>/dev/null; }
es_ok() { [ "$1" -ge 200 ] 2>/dev/null && [ "$1" -lt 300 ]; }

# ══ T · tabla de alternativas ════════════════════════════════════════════════════════════════
c="$(pedir GET '/armado_paquete_destinos_aereos?select=*' - -)"
es_error "$c" && ok "T1 anon no lee la tabla ($c)" || fallo "T1 anon leyó la tabla: $c $(cuerpo)"
c="$(pedir POST /armado_paquete_destinos_aereos "$T_VE" '{"paquete_id":94301,"destino_id":94030}')"
es_error "$c" && [ "$(ESTADO)" = 'false||' ] && ok "T2 venta no escribe alternativas ($c) y no cambió nada" || fallo "T2 venta escribió: $c $(cuerpo) estado=$(ESTADO)"
c="$(pedir POST /armado_paquete_destinos_aereos "$T_AD" '{"paquete_id":94301,"destino_id":94040}')"
es_error "$c" && grep -q 'destino_aereo_config' "$TMP/h.body" && [ "$(ESTADO)" = 'false||' ] \
  && ok "T3 alternativa de OTRO país rechazada por REST ($c) sin cambios" || fallo "T3 $c $(cuerpo) estado=$(ESTADO)"

# ══ R · RPC ═══════════════════════════════════════════════════════════════════════════════════
BODY='{"p_paquete_id":94301,"p_destino_id":94010,"p_activo":true,"p_destinos":[94020,94030]}'
c="$(pedir POST /rpc/guardar_destinos_aereos_67 - "$BODY")"
es_error "$c" && [ "$(ESTADO)" = 'false||' ] && ok "R1 anon no ejecuta la RPC ($c)" || fallo "R1 $c $(cuerpo)"
c="$(pedir POST /rpc/guardar_destinos_aereos_67 "$T_VE" "$BODY")"
es_error "$c" && [ "$(ESTADO)" = 'false||' ] && ok "R2 venta rechazada por la RPC ($c) sin cambios" || fallo "R2 $c $(cuerpo) estado=$(ESTADO)"
c="$(pedir POST /rpc/guardar_destinos_aereos_67 "$T_AD" '{"p_paquete_id":94301,"p_destino_id":94010,"p_activo":true,"p_destinos":[94040]}')"
es_error "$c" && [ "$(ESTADO)" = 'false||' ] && ok "R3 país distinto rechazado ($c) sin cambios parciales" || fallo "R3 $c $(cuerpo) estado=$(ESTADO)"
c="$(pedir POST /rpc/guardar_destinos_aereos_67 "$T_AD" '{"p_paquete_id":94301,"p_destino_id":94010,"p_activo":true,"p_destinos":[]}')"
es_error "$c" && [ "$(ESTADO)" = 'false||' ] && ok "R4 ON sin alternativas rechazado ($c)" || fallo "R4 $c $(cuerpo) estado=$(ESTADO)"
c="$(pedir POST /rpc/guardar_destinos_aereos_67 "$T_AD" "$BODY")"
es_ok "$c" && [ "$(ESTADO)" = 'true|94020,94030|' ] && ok "R5 administración guarda check + dos alternativas ($c)" || fallo "R5 $c $(cuerpo) estado=$(ESTADO)"

# ══ V · vínculos directos por la Data API ═══════════════════════════════════════════════════
c="$(pedir POST /armado_vuelos "$T_AD" '{"paquete_id":94301,"bloqueo_id":94103}')"
es_error "$c" && [ "$(ESTADO)" = 'true|94020,94030|' ] && ok "V1 vuelo de OTRO país rechazado por REST ($c)" || fallo "V1 $c $(cuerpo) estado=$(ESTADO)"
c="$(pedir POST /armado_vuelos "$T_AD" '[{"paquete_id":94301,"bloqueo_id":94101},{"paquete_id":94301,"bloqueo_id":94103}]')"
es_error "$c" && [ "$(ESTADO)" = 'true|94020,94030|' ] && ok "V2 lote mezclado: todo o nada, no quedó el vuelo válido ($c)" || fallo "V2 $c $(cuerpo) estado=$(ESTADO)"
c="$(pedir POST /armado_vuelos "$T_AD" '[{"paquete_id":94301,"bloqueo_id":94101},{"paquete_id":94301,"bloqueo_id":94102}]')"
es_ok "$c" && [ "$(ESTADO)" = 'true|94020,94030|94101,94102' ] && ok "V3 lote permitido (Punta Cana + Juan Dolio) aceptado ($c)" || fallo "V3 $c $(cuerpo) estado=$(ESTADO)"
c="$(pedir POST /rpc/guardar_destinos_aereos_67 "$T_AD" '{"p_paquete_id":94301,"p_destino_id":94010,"p_activo":false,"p_destinos":[]}')"
es_error "$c" && grep -q 'destino_aereo_vinculos' "$TMP/h.body" && [ "$(ESTADO)" = 'true|94020,94030|94101,94102' ] \
  && ok "V4 apagar con un vuelo a Punta Cana vinculado se rechaza y pide desvincular ($c)" || fallo "V4 $c $(cuerpo) estado=$(ESTADO)"
c="$(pedir DELETE '/armado_vuelos?paquete_id=eq.94301&bloqueo_id=eq.94101' "$T_AD" -)"
es_ok "$c" && [ "$(ESTADO)" = 'true|94020,94030|94102' ] && ok "V5 desvincular explícitamente siempre se permite ($c)" || fallo "V5 $c $(cuerpo) estado=$(ESTADO)"
c="$(pedir POST /rpc/guardar_destinos_aereos_67 "$T_AD" '{"p_paquete_id":94301,"p_destino_id":94010,"p_activo":false,"p_destinos":[]}')"
es_ok "$c" && [ "$(ESTADO)" = 'false||94102' ] && ok "V6 con los vuelos alternativos desvinculados, apagar funciona ($c)" || fallo "V6 $c $(cuerpo) estado=$(ESTADO)"

# ══ F · funciones internas no expuestas ═══════════════════════════════════════════════════════
for f in validar_config_destinos_aereos_67 validar_vinculo_aereo_67 destinos_aereos_efectivos_67 pais_comparable_67; do
  c="$(pedir POST "/rpc/$f" "$T_AD" '{}')"
  es_error "$c" && ok "F $f no es ejecutable por authenticated ($c)" || fallo "F $f respondió $c $(cuerpo)"
done

echo ""
if [ "$FALLOS" = 0 ]; then echo "TEST 220 API: TODO OK ($OKS comprobaciones)"; else echo "TEST 220 API: $FALLOS FALLO(S) de $((OKS + FALLOS))"; exit 1; fi
