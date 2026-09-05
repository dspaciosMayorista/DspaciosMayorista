#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# CONCURRENCIA (dos conexiones REALES) contra `ajustar_sillas_por_pasajeros`
# (migración 167). Un bloqueo con UNA sola silla disponible; dos contratos
# DISTINTOS piden, a la vez, 1 pasajero con silla cada uno. Debe ganar
# exactamente UNO — el candado `for update` sobre el pool de sillas del
# bloqueo serializa a la segunda conexión, que debe fallar limpio por falta
# de cupo (nunca las dos tomando la misma silla).
#
# Uso:
#   bash supabase/scripts/pruebas/local-desde-cero.sh <db> <puerto>
#   bash supabase/scripts/test_167_concurrencia.sh <db> <puerto>
# ═══════════════════════════════════════════════════════════════════════════
set -u
BD="${1:-dspacios_local}"
PUERTO="${2:-5432}"
PSQL() { psql -p "$PUERTO" -d "$BD" -t -A -q "$@"; }
RUN_ID="$(date +%s%N)-$$"
# `ventas.numero_contrato` exige el formato ^DTM-[0-9]{4,}$ para tenant
# mayorista (migración 160) — solo dígitos tras el prefijo, máx. 30
# caracteres en total.
DIGITOS="$(date +%s%N | tail -c 9)"
CONTRATO_A="DTM-90${DIGITOS}"
CONTRATO_B="DTM-91${DIGITOS}"
UID_TEST="22222222-2222-2222-2222-222222222222"
CLAIMS="select set_config('request.jwt.claims', json_build_object('sub','$UID_TEST')::text, false);"

fail=0

echo "== Fixtures =="
PSQL -v ON_ERROR_STOP=1 -c "
insert into auth.users (id, email, raw_user_meta_data)
values ('$UID_TEST', 'conc167-$RUN_ID@test.local', jsonb_build_object('rol','superadmin','nombre','Conc167'))
on conflict (id) do nothing;
" >/dev/null

BLOQUEO_ID=$(PSQL -v ON_ERROR_STOP=1 -c "
insert into bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, cupos_total)
values ('CONC167-$RUN_ID', 'Avianca', 'BOG-SMR', '2027-02-01', 1)
returning id;
")
PSQL -v ON_ERROR_STOP=1 -c "insert into sillas (bloqueo_id, numero_silla, estado) values ($BLOQUEO_ID, 1, 'disponible');" >/dev/null

PSQL -v ON_ERROR_STOP=1 -c "
insert into ventas (numero_contrato, tenant, cliente, fecha_salida, pax, precio_venta, estado, canal, tipo_paquete, bloqueo_ref_id)
values ('$CONTRATO_A', 'mayorista', 'Cliente Conc A', '2027-02-01', 1, 100000, 'activo', 'B2C', 'bloqueo', $BLOQUEO_ID);
" >/dev/null
PSQL -v ON_ERROR_STOP=1 -c "
insert into ventas (numero_contrato, tenant, cliente, fecha_salida, pax, precio_venta, estado, canal, tipo_paquete, bloqueo_ref_id)
values ('$CONTRATO_B', 'mayorista', 'Cliente Conc B', '2027-02-01', 1, 100000, 'activo', 'B2C', 'bloqueo', $BLOQUEO_ID);
" >/dev/null

echo "== Dos conexiones piden, a la vez, 1 silla cada una sobre un bloqueo con 1 sola disponible =="
PSQL -c "$CLAIMS select * from ajustar_sillas_por_pasajeros('$CONTRATO_A', 1);" >/tmp/conc167a.out 2>&1 &
PSQL -c "$CLAIMS select * from ajustar_sillas_por_pasajeros('$CONTRATO_B', 1);" >/tmp/conc167b.out 2>&1 &
wait

A=$(cat /tmp/conc167a.out)
B=$(cat /tmp/conc167b.out)
echo "  conexión A -> $A"
echo "  conexión B -> $B"

HOLD_A=$(PSQL -c "select count(*) from sillas where numero_contrato = '$CONTRATO_A' and estado in ('en_plazo','confirmada');")
HOLD_B=$(PSQL -c "select count(*) from sillas where numero_contrato = '$CONTRATO_B' and estado in ('en_plazo','confirmada');")
TOTAL_ASIGNADAS=$(PSQL -c "select count(*) from sillas where bloqueo_id = $BLOQUEO_ID and estado in ('en_plazo','confirmada');")

echo "  holders A=$HOLD_A holders B=$HOLD_B total_asignadas_al_bloqueo=$TOTAL_ASIGNADAS"

# Exactamente UNA de las dos debe haber ganado la silla (holders 1+0 o 0+1),
# nunca las dos (1+1, imposible con 1 sola silla) ni ninguna (0+0, ambas
# fallando sería un bug del candado, no del cupo real).
if [ "$TOTAL_ASIGNADAS" = "1" ] && { { [ "$HOLD_A" = "1" ] && [ "$HOLD_B" = "0" ]; } || { [ "$HOLD_A" = "0" ] && [ "$HOLD_B" = "1" ]; }; }; then
  echo "  PASS  exactamente un contrato se quedó con la única silla; el otro no toco inventario"
else
  echo "  FAIL  concurrencia — se esperaba exactamente 1 silla asignada, repartida 1/0 entre los dos contratos"
  fail=1
fi

# Limpieza (no deja fixtures de concurrencia acumulándose entre corridas).
PSQL -v ON_ERROR_STOP=1 -c "
delete from sillas where bloqueo_id = $BLOQUEO_ID;
delete from ventas where numero_contrato in ('$CONTRATO_A', '$CONTRATO_B');
delete from bloqueos_vuelo where id = $BLOQUEO_ID;
delete from auth.users where id = '$UID_TEST';
" >/dev/null

if [ "$fail" = "0" ]; then
  echo "== RESULTADO: PASS =="
  exit 0
else
  echo "== RESULTADO: FAIL =="
  exit 1
fi
