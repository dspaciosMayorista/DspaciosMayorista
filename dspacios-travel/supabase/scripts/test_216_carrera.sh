#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# CARRERAS · #39 (migraciones 216 + 217). Sesiones REALES en paralelo sobre una base DESECHABLE
# (CI o local); nunca remota. La base se crea desde la plantilla 001-214, se le aplican 216 y 217 y
# sus datos se COMMITEAN (se descarta la base entera al final).
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_216_carrera.sh <contenedor> [plantilla]
#
# Compuerta: A ejecuta su operación con la transacción ABIERTA y se detiene en un candado consultivo
# que tiene G; B debe quedar en pg_stat_activity esperando un Lock de A (no el consultivo) antes de
# abrir la compuerta. Sin pg_sleep como sincronizador.
#
#   C1   dos ediciones con la MISMA revisión: B espera y recibe EDICION_39_REVISION; un solo historial
#   C2   edición (A) contra primer pago con la revisión vieja (B): PAGO_39_REVISION, sin pago
#   C3   primer pago (A) contra edición (B): EDICION_39_CONGELADA, servicios intactos
#   C4   conversión (A) contra edición (B): la edición se rechaza; un solo contrato
#   C5a  anulación (A) contra conversión (B): no alcanza el mínimo; sin contrato
#   C5b  conversión (A) contra anulación (B): el pago ya está aplicado; un contrato
#   C6   la autorización abierta de A no sirve para la transacción de B (txid distinto)
#   C7   dos conversiones a la vez: un solo contrato y el mismo número
#   C8   titular con datos viejos (B) contra edición de servicios (A): FRONTERA_39, no pisa la edición
#   C10  renovación y edición a la vez, en los dos órdenes (V11): se serializan; la revisión no cambia por renovar
#   C9   ninguna sesión terminó en deadlock
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla216}"
export MSYS_NO_PATHCONV=1
valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_216_carrera.sh <contenedor> [plantilla]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PW="${PGPASSWORD_216:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
DIR_CT=/tmp/s216c
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_216c $SUF"
DB="t216_ca_$SUF"
PSA="docker exec -i -w $DIR_CT -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_ADMIN -X -q -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0
OKS=0
ok()    { echo "OK    $1"; OKS=$((OKS + 1)); }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
limpiar() {
  st=$?
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
$PSA -d "$DB" >/dev/null <<'SQL'
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
SQL
for m in 20260601000216_cotizacion_manual_edicion_frontera.sql 20260601000217_cotizacion_manual_cierre_frontera.sql; do
  docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -v ON_ERROR_STOP=1 \
    < "$APP/supabase/migrations/$m" > "$TMP/m.out" 2>&1 || { echo "No se pudo aplicar $m: $(cut -c1-400 "$TMP/m.out")"; exit 1; }
done
printf 'begin;\n\\ir test_216_fixtures.sql\ncommit;\n' | $PSA -d "$DB" > "$TMP/fx.out" 2>&1 || { echo "Fixtures: $(tail -5 "$TMP/fx.out")"; exit 1; }
ok "C0 base con 216 + 217 y fixtures confirmadas"

uno() { $PSA -d "$DB" -t -A -c "$1"; }
SES() { # $1 = application_name, $2 = archivo de salida ; SQL por stdin
  docker exec -i -e PGPASSWORD="$PW" -e PGAPPNAME="$1" "$CT" psql -h 127.0.0.1 -U "$ROL_ADMIN" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 > "$2" 2>&1
}
cuando() { # $1 = consulta que devuelve 1, $2 = máximo de intentos (1 s)
  i=0
  while [ "$i" -lt "$2" ]; do
    [ "$(uno "$1" 2>/dev/null || echo 0)" = 1 ] && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}
SR='set role service_role;'
auth() { printf "set request.jwt.claims = '{\"sub\":\"%s\",\"role\":\"authenticated\"}'; set request.jwt.claim.sub = '%s'; set role authenticated;" "$1" "$1"; }
ADMIN="$(uno "select t216.u('admin')")"

# carrera nombre llave "prefA" "sqlA" "prefB" "sqlB" : A ejecuta con la transacción abierta y se
# detiene en la compuerta; B debe esperar un Lock de A; luego se abre la compuerta y A confirma.
carrera() {
  n="$1"; k="$2"; ESPERO=0
  printf 'select pg_advisory_lock(%s);\nselect pg_sleep(600);\n' "$k" | SES "${n}_g" "$TMP/$n.g" &
  pg=$!
  cuando "select (count(*) = 1)::int from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.application_name = '${n}_g' and l.locktype = 'advisory' and l.granted" 30 \
    || { fallo "$n: la compuerta no tomó su candado"; kill "$pg" 2>/dev/null || true; return 0; }
  printf '%s\nbegin;\n%s;\nselect pg_advisory_lock(%s);\ncommit;\n' "$3" "$4" "$k" | SES "${n}_a" "$TMP/$n.a" &
  pa=$!
  if ! cuando "select (count(*) = 1)::int from pg_stat_activity where application_name = '${n}_a' and wait_event_type = 'Lock' and wait_event = 'advisory'" 90; then
    fallo "$n: A no llegó a la compuerta ($(tr '\n' ' ' < "$TMP/$n.a" | cut -c1-300))"
    uno "select pg_terminate_backend(pid) from pg_stat_activity where application_name like '${n}_%'" >/dev/null || true
    wait "$pa" || true; wait "$pg" || true; return 0
  fi
  printf '%s\n%s;\n' "$5" "$6" | SES "${n}_b" "$TMP/$n.b" &
  pb=$!
  cuando "select (count(*) = 1)::int from pg_stat_activity where application_name = '${n}_b' and wait_event_type = 'Lock' and wait_event <> 'advisory'" 60 && ESPERO=1
  uno "select pg_terminate_backend(pid) from pg_stat_activity where application_name = '${n}_g'" >/dev/null || true
  wait "$pa" || true; wait "$pb" || true; wait "$pg" || true
}
cot() { uno "select t216.crear('admin')"; }
pagar() { uno "select t216.pagar($1, $2, '$3')"; }
q() { uno "select $1"; }   # genera el SQL de una operación con las funciones de las fixtures
esc() { printf '%s' "$1" | sed "s/'/''/g"; }

# ── C1 ──
C="$(cot)"; SA="$(q "t216.editar_sql($C, 'admin', t216.serv(600000), 'A')")"; SB="$(q "t216.editar_sql($C, 'admin', t216.serv(700000), 'B')")"
carrera C1 216101 "$SR" "$SA" "$SR" "$SB"
if [ "$ESPERO" = 1 ] && grep -q 'EDICION_39_REVISION' "$TMP/C1.b" && grep -Eq '^[0-9]+$' "$TMP/C1.a" \
   && [ "$(uno "select valor::bigint from public.cotizacion_servicios where cotizacion_id = $C and tipo_servicio = 'hotel'")" = 600000 ] \
   && [ "$(uno "select count(*) from public.cotizacion_ediciones where cotizacion_id = $C")" = 1 ]; then
  ok "C1 dos ediciones con la misma revisión: B esperó y recibió EDICION_39_REVISION; gana A, un historial"
else fallo "C1 espero=$ESPERO A=[$(tr '\n' ' ' < "$TMP/C1.a")] B=[$(tr '\n' ' ' < "$TMP/C1.b" | cut -c1-300)]"; fi

# ── C2 ──
C="$(cot)"; SB="$(q "t216.pago_sql($C, 'admin', 100000, 'c2')")"; SA="$(q "t216.editar_sql($C, 'admin', t216.serv(650000))")"
carrera C2 216102 "$SR" "$SA" "$SR" "$SB"
if [ "$ESPERO" = 1 ] && grep -q 'PAGO_39_REVISION' "$TMP/C2.b" && [ "$(uno "select count(*) from public.cotizacion_pagos_previos where cotizacion_id = $C")" = 0 ]; then
  ok "C2 edición primero, pago con la revisión vieja después: el pago esperó y se rechazó; sin pago"
else fallo "C2 espero=$ESPERO B=[$(tr '\n' ' ' < "$TMP/C2.b" | cut -c1-300)]"; fi

# ── C3 ──
C="$(cot)"; SA="$(q "t216.pago_sql($C, 'admin', 100000, 'c3')")"; SB="$(q "t216.editar_sql($C, 'admin', t216.serv(650000))")"
carrera C3 216103 "$SR" "$SA" "$SR" "$SB"
if [ "$ESPERO" = 1 ] && grep -q 'EDICION_39_CONGELADA' "$TMP/C3.b" && grep -q '^OK|' "$TMP/C3.a" \
   && [ "$(uno "select valor::bigint from public.cotizacion_servicios where cotizacion_id = $C and tipo_servicio = 'hotel'")" = 500000 ]; then
  ok "C3 primer pago primero, edición después: la edición esperó y vio la cotización congelada; servicios intactos"
else fallo "C3 espero=$ESPERO A=[$(tr '\n' ' ' < "$TMP/C3.a")] B=[$(tr '\n' ' ' < "$TMP/C3.b" | cut -c1-300)]"; fi

# ── C4 ──
C="$(cot)"; pagar "$C" 450000 c4 >/dev/null; SA="$(q "t216.convertir_sql($C)")"; SB="$(q "t216.editar_sql($C, 'admin', t216.serv(650000))")"
carrera C4 216104 "$SR" "$SA" "$SR" "$SB"
if [ "$ESPERO" = 1 ] && grep -q 'EDICION_39_' "$TMP/C4.b" && [ "$(uno "select count(*) from public.ventas where cotizacion_id = $C")" = 1 ]; then
  ok "C4 conversión contra edición: la edición esperó y se rechazó ($(grep -o 'EDICION_39_[A-Z_]*' "$TMP/C4.b" | head -1)); un contrato"
else fallo "C4 espero=$ESPERO B=[$(tr '\n' ' ' < "$TMP/C4.b" | cut -c1-300)]"; fi

# ── C5a / C5b ──
C="$(cot)"; P="$(pagar "$C" 450000 c5a)"
carrera C5a 216105 "$SR" "select public.anular_pago_previo_controlado($P, '$ADMIN', 'carrera')" "$SR" "$(q "t216.convertir_sql($C)")"
if [ "$ESPERO" = 1 ] && grep -q 'no alcanza el mínimo' "$TMP/C5a.b" && [ "$(uno "select count(*) from public.ventas where cotizacion_id = $C")" = 0 ] \
   && [ "$(uno "select estado from public.cotizacion_pagos_previos where id = $P")" = anulado ]; then
  ok "C5a anulación primero, conversión después: la conversión esperó y no alcanzó el mínimo; sin contrato"
else fallo "C5a espero=$ESPERO B=[$(tr '\n' ' ' < "$TMP/C5a.b" | cut -c1-300)]"; fi
C="$(cot)"; P="$(pagar "$C" 450000 c5b)"
carrera C5b 216106 "$SR" "$(q "t216.convertir_sql($C)")" "$SR" "select public.anular_pago_previo_controlado($P, '$ADMIN', 'carrera')"
if [ "$ESPERO" = 1 ] && grep -q 'ACTIVO' "$TMP/C5b.b" && [ "$(uno "select count(*) from public.ventas where cotizacion_id = $C")" = 1 ] \
   && [ "$(uno "select estado from public.cotizacion_pagos_previos where id = $P")" = aplicado ]; then
  ok "C5b conversión primero, anulación después: la anulación esperó (cotización antes que pago) y vio el pago aplicado"
else fallo "C5b espero=$ESPERO B=[$(tr '\n' ' ' < "$TMP/C5b.b" | cut -c1-300)]"; fi

# ── C6 ── (B no espera: comprueba que la autorización de A no le sirve)
C="$(cot)"
printf 'select pg_advisory_lock(216107);\nselect pg_sleep(600);\n' | SES C6_g "$TMP/C6.g" &
pg=$!
cuando "select (count(*) = 1)::int from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.application_name = 'C6_g' and l.locktype = 'advisory' and l.granted" 30 || fallo "C6 compuerta"
printf "%s\nbegin;\nselect p39_priv.emitir(%s, 'pago', null);\nselect pg_advisory_lock(216107);\nrollback;\n" "$SR" "$C" | SES C6_a "$TMP/C6.a" &
pa=$!
cuando "select (count(*) = 1)::int from pg_stat_activity where application_name = 'C6_a' and wait_event_type = 'Lock' and wait_event = 'advisory'" 90 || fallo "C6 A no llegó"
printf '%s\nupdate public.cotizaciones set monto_exigido_total = 0, monto_exigido_total_cop = 0, condicion_pago_congelada_en = now() where id = %s;\n' "$SR" "$C" | SES C6_b "$TMP/C6.b" || true
uno "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'C6_g'" >/dev/null || true
wait "$pa" || true; wait "$pg" || true
if grep -q 'FRONTERA_39' "$TMP/C6.b" && [ "$(uno "select (condicion_pago_congelada_en is null)::text from public.cotizaciones where id = $C")" = true ]; then
  ok "C6 una autorización abierta en OTRA transacción no habilita el congelado directo (FRONTERA_39)"
else fallo "C6 B=[$(tr '\n' ' ' < "$TMP/C6.b" | cut -c1-300)]"; fi

# ── C7 ──
C="$(cot)"; pagar "$C" 450000 c7 >/dev/null; SA="$(q "t216.convertir_sql($C)")"
carrera C7 216108 "$SR" "$SA" "$SR" "$SA"
NA="$(grep -E '^[A-Z]+-[0-9]+$' "$TMP/C7.a" | head -1 || true)"; NB="$(grep -E '^[A-Z]+-[0-9]+$' "$TMP/C7.b" | head -1 || true)"
if [ "$ESPERO" = 1 ] && [ -n "$NA" ] && [ "$NA" = "$NB" ] && [ "$(uno "select count(*) from public.ventas where cotizacion_id = $C")" = 1 ]; then
  ok "C7 dos conversiones a la vez: B esperó y devolvió el MISMO número ($NA); un contrato"
else fallo "C7 espero=$ESPERO A=[$NA] B=[$(tr '\n' ' ' < "$TMP/C7.b" | cut -c1-300)]"; fi

# ── C8 ──
C="$(cot)"
PAY="$(esc "$(uno "select payload::text from public.cotizaciones where id = $C")")"
DET="$(esc "$(uno "select detalle::text from public.cotizaciones where id = $C")")"
SB="update public.cotizaciones set cliente = 'Titular Nuevo', payload = jsonb_set('$PAY'::jsonb, '{cliente,nombres}', '\"Titular\"'), detalle = jsonb_set('$DET'::jsonb, '{venta,cliente}', '\"Titular Nuevo\"') where id = $C and estado = 'abierta'"
SA="$(q "t216.editar_sql($C, 'admin', t216.serv(660000))")"
carrera C8 216109 "$SR" "$SA" "$(auth "$ADMIN")" "$SB"
if [ "$ESPERO" = 1 ] && grep -q 'FRONTERA_39' "$TMP/C8.b" \
   && [ "$(uno "select cliente || '|' || (select valor::bigint from public.cotizacion_servicios where cotizacion_id = $C and tipo_servicio = 'hotel') from public.cotizaciones where id = $C")" = "Cliente Prueba|660000" ]; then
  ok "C8 titular con datos viejos contra edición: esperó y se rechazó; la edición no se pisó"
else fallo "C8 espero=$ESPERO B=[$(tr '\n' ' ' < "$TMP/C8.b" | cut -c1-300)]"; fi

# ── C10 (V11) ──
C="$(cot)"; R0="$(uno "select t216.rev($C)")"
SA="$(q "t216.editar_sql($C, 'admin', t216.serv(610000))")"
carrera C10a 216110 "$SR" "$SA" "$(auth "$ADMIN")" "update public.cotizaciones set vigencia_hasta = public.fecha_negocio() + 4 where id = $C"
R1="$(uno "select t216.rev($C)")"
if [ "$ESPERO" = 1 ] && ! grep -q 'ERROR' "$TMP/C10a.b" && [ "$(uno "select (vigencia_hasta = public.fecha_negocio() + 4)::text from public.cotizaciones where id = $C")" = true ] \
   && [ "$R1" -gt "$R0" ] && [ "$(uno "select rev_nueva from public.cotizacion_ediciones where cotizacion_id = $C order by id desc limit 1")" = "$R1" ]; then
  ok "C10a edición primero, renovación después: la renovación esperó y pasó sin mover la revisión ($R0 → $R1 solo por la edición)"
else fallo "C10a espero=$ESPERO R0=$R0 R1=$R1 B=[$(tr '\n' ' ' < "$TMP/C10a.b" | cut -c1-300)]"; fi
SB="$(q "t216.editar_sql($C, 'admin', t216.serv(620000))")"
carrera C10b 216111 "$(auth "$ADMIN")" "update public.cotizaciones set vigencia_hasta = public.fecha_negocio() + 5 where id = $C" "$SR" "$SB"
if [ "$ESPERO" = 1 ] && grep -Eq '^[0-9]+$' "$TMP/C10b.b" \
   && [ "$(uno "select (vigencia_hasta = public.fecha_negocio() + 5)::text from public.cotizaciones where id = $C")" = true ]; then
  ok "C10b renovación primero, edición después: la edición esperó y pasó (renovar no cambió la revisión)"
else fallo "C10b espero=$ESPERO B=[$(tr '\n' ' ' < "$TMP/C10b.b" | cut -c1-300)]"; fi

# ── C9 ──
if cat "$TMP"/*.a "$TMP"/*.b 2>/dev/null | grep -qi 'deadlock'; then fallo "C9 alguna sesión terminó en deadlock"; else ok "C9 ninguna sesión terminó en deadlock (orden cotización → pagos)"; fi

echo "------------------------------------------------------------"
echo "Resultado: $OKS OK, $FALLOS FALLO(S)"
if [ "$FALLOS" = 0 ]; then echo "TEST 216 CARRERAS: TODO OK"; else echo "TEST 216 CARRERAS: $FALLOS FALLO(S)"; exit 1; fi
