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
" >/dev/null
# auth.users ($UID_TEST) se conserva: la segunda carrera (creación) lo
# necesita también — se borra al final del script, no aquí.

echo
echo "== Segunda carrera: CREACIÓN atómica (crear_pasajeros_contrato) — dos"
echo "   contratos NUEVOS, cada uno crea 1 pasajero + pide 1 silla a la vez,"
echo "   sobre un bloqueo con 1 sola disponible (cierra B5 para creación,"
echo "   no solo para la edición ya probada arriba)."
DIGITOS2="$(date +%s%N | tail -c 9)"
CONTRATO_C="DTM-92${DIGITOS2}"
CONTRATO_D="DTM-93${DIGITOS2}"

BLOQUEO2_ID=$(PSQL -v ON_ERROR_STOP=1 -c "
insert into bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, cupos_total)
values ('CONC167B-$RUN_ID', 'Avianca', 'BOG-CTG', '2027-02-01', 1)
returning id;
")
PSQL -v ON_ERROR_STOP=1 -c "insert into sillas (bloqueo_id, numero_silla, estado) values ($BLOQUEO2_ID, 1, 'disponible');" >/dev/null
PSQL -v ON_ERROR_STOP=1 -c "
insert into ventas (numero_contrato, tenant, cliente, fecha_salida, pax, precio_venta, estado, canal, tipo_paquete, bloqueo_ref_id)
values ('$CONTRATO_C', 'mayorista', 'Cliente Conc C', '2027-02-01', 1, 100000, 'pendiente', 'B2C', 'bloqueo', $BLOQUEO2_ID);
" >/dev/null
PSQL -v ON_ERROR_STOP=1 -c "
insert into ventas (numero_contrato, tenant, cliente, fecha_salida, pax, precio_venta, estado, canal, tipo_paquete, bloqueo_ref_id)
values ('$CONTRATO_D', 'mayorista', 'Cliente Conc D', '2027-02-01', 1, 100000, 'pendiente', 'B2C', 'bloqueo', $BLOQUEO2_ID);
" >/dev/null

PAYLOAD_C="jsonb_build_array(jsonb_build_object('nombre','Pasajero C','tipoId','CC','identificacion','${DIGITOS2}01','fechaNacimiento','1990-01-01'))"
PAYLOAD_D="jsonb_build_array(jsonb_build_object('nombre','Pasajero D','tipoId','CC','identificacion','${DIGITOS2}02','fechaNacimiento','1990-01-01'))"
PSQL -c "select * from crear_pasajeros_contrato('$CONTRATO_C', $PAYLOAD_C, 0, '$UID_TEST');" >/tmp/conc167c.out 2>&1 &
PSQL -c "select * from crear_pasajeros_contrato('$CONTRATO_D', $PAYLOAD_D, 0, '$UID_TEST');" >/tmp/conc167d.out 2>&1 &
wait

echo "  conexión C -> $(cat /tmp/conc167c.out)"
echo "  conexión D -> $(cat /tmp/conc167d.out)"

PAX_C=$(PSQL -c "select count(*) from contrato_pasajeros where numero_contrato = '$CONTRATO_C';")
PAX_D=$(PSQL -c "select count(*) from contrato_pasajeros where numero_contrato = '$CONTRATO_D';")
HOLD_C=$(PSQL -c "select count(*) from sillas where numero_contrato = '$CONTRATO_C' and estado in ('en_plazo','confirmada');")
HOLD_D=$(PSQL -c "select count(*) from sillas where numero_contrato = '$CONTRATO_D' and estado in ('en_plazo','confirmada');")

echo "  pax C=$PAX_C pax D=$PAX_D | holders C=$HOLD_C holders D=$HOLD_D"

# El ganador debe tener EXACTAMENTE su pasajero Y su silla (ambos juntos,
# nunca uno sin el otro); el perdedor NO debe tener ni pasajero ni silla
# (la creación completa se revierte junta — el propio hallazgo de B5).
if { [ "$PAX_C" = "1" ] && [ "$HOLD_C" = "1" ] && [ "$PAX_D" = "0" ] && [ "$HOLD_D" = "0" ]; } || \
   { [ "$PAX_D" = "1" ] && [ "$HOLD_D" = "1" ] && [ "$PAX_C" = "0" ] && [ "$HOLD_C" = "0" ]; }; then
  echo "  PASS  exactamente una creación ganó (pasajero + silla juntos); la otra no dejó ni pasajero ni silla"
else
  echo "  FAIL  creación concurrente — se esperaba un ganador completo (1 pax + 1 silla) y un perdedor completo (0 y 0)"
  fail=1
fi

PSQL -v ON_ERROR_STOP=1 -c "
delete from contrato_pasajeros where numero_contrato in ('$CONTRATO_C', '$CONTRATO_D');
delete from sillas where bloqueo_id = $BLOQUEO2_ID;
delete from ventas where numero_contrato in ('$CONTRATO_C', '$CONTRATO_D');
delete from bloqueos_vuelo where id = $BLOQUEO2_ID;
" >/dev/null
# auth.users ($UID_TEST) se conserva: la tercera carrera (multi-bloqueo, B6)
# lo necesita también — se borra al final del script, no aquí.

echo
echo "== Tercera carrera: MULTI-BLOQUEO (crear_pasajeros_contrato_multi, B6"
echo "   ronda 3) — dos contratos NUEVOS, cada uno pide 1 silla en el bloqueo"
echo "   E Y 1 silla en el bloqueo F (ambos con 1 sola disponible), en"
echo "   ÓRDENES CRUZADOS dentro del payload (contrato E-primero pide [E,F];"
echo "   contrato F-primero pide [F,E]) — si el núcleo respetara el orden del"
echo "   payload en vez de ordenar SIEMPRE ascendente por bloqueo_id antes de"
echo "   bloquear, esto sería la receta clásica de un deadlock cruzado."
echo "   Con el orden ascendente forzado, nunca hay deadlock: exactamente UN"
echo "   contrato gana los DOS bloqueos completos; el otro pierde los DOS"
echo "   (nunca un reparto 1 bloqueo cada uno, ni ambos perdiendo)."
DIGITOS3="$(date +%s%N | tail -c 9)"
CONTRATO_G="DTM-94${DIGITOS3}"
CONTRATO_H="DTM-95${DIGITOS3}"

BLOQUEO_E_ID=$(PSQL -v ON_ERROR_STOP=1 -c "
insert into bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, cupos_total)
values ('CONC167E-$RUN_ID', 'Avianca', 'BOG-MDE', '2027-02-01', 1)
returning id;
")
BLOQUEO_F_ID=$(PSQL -v ON_ERROR_STOP=1 -c "
insert into bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, cupos_total)
values ('CONC167F-$RUN_ID', 'Avianca', 'MDE-CTG', '2027-02-01', 1)
returning id;
")
PSQL -v ON_ERROR_STOP=1 -c "insert into sillas (bloqueo_id, numero_silla, estado) values ($BLOQUEO_E_ID, 1, 'disponible'), ($BLOQUEO_F_ID, 1, 'disponible');" >/dev/null
PSQL -v ON_ERROR_STOP=1 -c "
insert into ventas (numero_contrato, tenant, cliente, fecha_salida, pax, precio_venta, estado, canal, tipo_paquete)
values ('$CONTRATO_G', 'mayorista', 'Cliente Conc G', '2027-02-01', 1, 100000, 'pendiente', 'B2C', 'carrito');
" >/dev/null
PSQL -v ON_ERROR_STOP=1 -c "
insert into ventas (numero_contrato, tenant, cliente, fecha_salida, pax, precio_venta, estado, canal, tipo_paquete)
values ('$CONTRATO_H', 'mayorista', 'Cliente Conc H', '2027-02-01', 1, 100000, 'pendiente', 'B2C', 'carrito');
" >/dev/null

# Nótese: sin bloqueo_ref_id (un contrato de carrito con varios bloqueos no
# estampa uno solo — ver comentario de _ajustar_sillas_nucleo en la
# migración) — crear_pasajeros_contrato_multi recibe cada bloqueo_id
# explícito, nunca lo descubre.
PAYLOAD_G="jsonb_build_array(jsonb_build_object('nombre','Pasajero G','tipoId','CC','identificacion','${DIGITOS3}01','fechaNacimiento','1990-01-01'))"
PAYLOAD_H="jsonb_build_array(jsonb_build_object('nombre','Pasajero H','tipoId','CC','identificacion','${DIGITOS3}02','fechaNacimiento','1990-01-01'))"
RESERVAS_G="jsonb_build_array(jsonb_build_object('bloqueoId',$BLOQUEO_E_ID,'holdersMin',1,'posiciones',jsonb_build_array(1)), jsonb_build_object('bloqueoId',$BLOQUEO_F_ID,'holdersMin',1,'posiciones',jsonb_build_array(1)))"
RESERVAS_H="jsonb_build_array(jsonb_build_object('bloqueoId',$BLOQUEO_F_ID,'holdersMin',1,'posiciones',jsonb_build_array(1)), jsonb_build_object('bloqueoId',$BLOQUEO_E_ID,'holdersMin',1,'posiciones',jsonb_build_array(1)))"
PSQL -c "select * from crear_pasajeros_contrato_multi('$CONTRATO_G', $PAYLOAD_G, $RESERVAS_G, '$UID_TEST');" >/tmp/conc167g.out 2>&1 &
PSQL -c "select * from crear_pasajeros_contrato_multi('$CONTRATO_H', $PAYLOAD_H, $RESERVAS_H, '$UID_TEST');" >/tmp/conc167h.out 2>&1 &
wait

echo "  conexión G ([E,F]) -> $(cat /tmp/conc167g.out)"
echo "  conexión H ([F,E]) -> $(cat /tmp/conc167h.out)"

PAX_G=$(PSQL -c "select count(*) from contrato_pasajeros where numero_contrato = '$CONTRATO_G';")
PAX_H=$(PSQL -c "select count(*) from contrato_pasajeros where numero_contrato = '$CONTRATO_H';")
HOLD_G=$(PSQL -c "select count(*) from sillas where numero_contrato = '$CONTRATO_G' and estado in ('en_plazo','confirmada');")
HOLD_H=$(PSQL -c "select count(*) from sillas where numero_contrato = '$CONTRATO_H' and estado in ('en_plazo','confirmada');")

echo "  pax G=$PAX_G pax H=$PAX_H | holders G=$HOLD_G holders H=$HOLD_H (cada uno pedía 2 sillas, una por bloqueo)"

# El ganador debe quedarse con AMBOS bloqueos (1 pax + 2 sillas); el
# perdedor no debe quedar con NINGUNO de los dos (0 pax + 0 sillas) — nunca
# un reparto 1 silla cada uno (eso sería sobreventa: solo hay 1 por
# bloqueo), y nunca ambos en 0 (sería un deadlock detectado y abortado por
# Postgres en vez de una serialización limpia).
if { [ "$PAX_G" = "1" ] && [ "$HOLD_G" = "2" ] && [ "$PAX_H" = "0" ] && [ "$HOLD_H" = "0" ]; } || \
   { [ "$PAX_H" = "1" ] && [ "$HOLD_H" = "2" ] && [ "$PAX_G" = "0" ] && [ "$HOLD_G" = "0" ]; }; then
  echo "  PASS  exactamente una creación multi-bloqueo ganó los DOS bloqueos completos; la otra no dejó ni pasajero ni silla en ninguno"
else
  echo "  FAIL  multi-bloqueo concurrente — se esperaba un ganador completo (1 pax + 2 sillas) y un perdedor completo (0 y 0); un reparto 1/1 sería sobreventa, y 0/0 en ambos sería un deadlock sin resolver"
  fail=1
fi

PSQL -v ON_ERROR_STOP=1 -c "
delete from contrato_pasajeros where numero_contrato in ('$CONTRATO_G', '$CONTRATO_H');
delete from sillas where bloqueo_id in ($BLOQUEO_E_ID, $BLOQUEO_F_ID);
delete from ventas where numero_contrato in ('$CONTRATO_G', '$CONTRATO_H');
delete from bloqueos_vuelo where id in ($BLOQUEO_E_ID, $BLOQUEO_F_ID);
delete from auth.users where id = '$UID_TEST';
" >/dev/null

if [ "$fail" = "0" ]; then
  echo "== RESULTADO: PASS =="
  exit 0
else
  echo "== RESULTADO: FAIL =="
  exit 1
fi
