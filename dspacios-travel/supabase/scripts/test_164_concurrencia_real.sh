#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# CONCURRENCIA (dos conexiones REALES) contra la migración 164 REAL, aplicada
# sobre la cadena completa 1→163 (Commit 7 — cierre operativo).
#
# Complementa —NO reemplaza— a `test_164_concurrencia.sh` (espejo Docker, ya
# aprobado en Commits anteriores): esta variante corre sin Docker, contra un
# PostgreSQL local desechable, usando la MIGRACIÓN 164 REAL como autoridad
# (preferencia explícita del dueño). Es la vía reproducible en entornos sin
# Docker (ej. este sandbox, o CI sin privilegios de contenedor).
#
# Uso:
#   1. Base desechable con 1→163 + la 164 real ya aplicadas (ver
#      supabase/scripts/pruebas/local-desde-cero.sh <db> <puerto> 163 y
#      luego aplicar supabase/migrations/20260601000164_*.sql a mano).
#   2. psql -p <puerto> -d <db> -v ON_ERROR_STOP=1 -f test_164_concurrencia_real.sql
#   3. ./test_164_concurrencia_real.sh <db> <puerto>
#
# T3' (doble-click, misma clave de intento): dos conexiones registran a la
#   vez el MISMO primer pago sobre la cotización 203 con la misma clave de
#   idempotencia → debe quedar UN pago, un asiento y un solo snapshot
#   congelado (la segunda conexión recupera el mismo id vía idempotencia).
# T4' (dos primeros pagos concurrentes, TRM distintas): dos conexiones
#   compiten por ser el PRIMER pago sobre la cotización 202 con TRM 4000 y
#   4500 → debe quedar UN snapshot, UNA TRM congelada (la que ganó el lock
#   `select ... for update` sobre la fila de `cotizaciones`) y ambos pagos
#   contabilizados en esa misma TRM.
# ═══════════════════════════════════════════════════════════════════════════
set -u
BD="${1:-ciclo164}"
PUERTO="${2:-5432}"
PSQL() { psql -p "$PUERTO" -d "$BD" -t -A -q "$@"; }
ACTOR="'cccccccc-0000-0000-0000-000000000001'"
HOY="current_date"
# Las claves de idempotencia son ÚNICAS por diseño (fail-closed, B1): una
# clave ya usada con otra cotización/monto se RECHAZA, nunca se reutiliza en
# silencio. Para que este runner sea re-ejecutable sin chocar contra sus
# propias corridas anteriores, cada corrida usa un sufijo único — dentro de
# una misma corrida, las DOS conexiones de cada carrera comparten la MISMA
# clave a propósito (eso es lo que se está probando).
RUN_ID="$(date +%s%N)-$$"

echo "== Resolviendo ids de las cotizaciones de concurrencia (201/202/203 lógicos) =="
# Cada corrida de test_164_concurrencia_real.sql crea 3 cotizaciones NUEVAS
# (nunca reutiliza ni borra las de corridas previas — una vez congelada, el
# candado de inmutabilidad de la 164 lo impediría). Tomamos siempre las 3 MÁS
# RECIENTES, en orden de creación (201=COP, 202=USD, 203=COP).
IDS=$(PSQL -c "select id from (
  select id from public.cotizaciones where destino='CARTAGENA' and asesor='Asesor CONC'
  order by id desc limit 3
) x order by id;")
ID201=$(echo "$IDS" | sed -n '1p'); ID202=$(echo "$IDS" | sed -n '2p'); ID203=$(echo "$IDS" | sed -n '3p')
if [ -z "$ID201" ] || [ -z "$ID202" ] || [ -z "$ID203" ]; then
  echo "FALTAN cotizaciones de concurrencia — corre primero test_164_concurrencia_real.sql"; exit 2
fi
echo "  201->$ID201  202->$ID202  203->$ID203"

SNAP="jsonb_build_array(jsonb_build_object('orden',0,'tipo_componente','hotel','referencia_externa','Hotel Conc Test','valor_componente',1000000,'condicion_pago_tipo','sin_condicion','monto_exigido',0,'restriccion_comercial','normal'))"

fail=0

echo "== T3': doble-click misma clave (primer pago, cotización $ID203) =="
PSQL -c "set role service_role; select public.registrar_pago_previo($ID203, 900000, 'COP', 1, 'Transferencia', 'DC', $HOY, $ACTOR, 'KC-T3-REAL-$RUN_ID', $SNAP, 1000000, 100);" >/tmp/t3ar.out 2>&1 &
PSQL -c "set role service_role; select public.registrar_pago_previo($ID203, 900000, 'COP', 1, 'Transferencia', 'DC', $HOY, $ACTOR, 'KC-T3-REAL-$RUN_ID', $SNAP, 1000000, 100);" >/tmp/t3br.out 2>&1 &
wait
A3=$(tr -d ' \r\n' </tmp/t3ar.out); B3=$(tr -d ' \r\n' </tmp/t3br.out)
N3_PAY=$(PSQL -c "select count(*) from public.cotizacion_pagos_previos where cotizacion_id=$ID203;")
N3_ASI=$(PSQL -c "select count(*) from public.asientos_contables a join public.cotizacion_pagos_previos p on a.referencia='pago_previo:'||p.id where p.cotizacion_id=$ID203 and a.origen='pago_previo';")
N3_SNAP=$(PSQL -c "select count(*) from public.cotizacion_condiciones where cotizacion_id=$ID203;")
N3_FROZEN=$(PSQL -c "select count(*) from public.cotizaciones where id=$ID203 and condicion_pago_congelada_en is not null;")
echo "  conexión A -> $A3"
echo "  conexión B -> $B3"
echo "  pagos=$N3_PAY asientos_pago_previo=$N3_ASI snapshot=$N3_SNAP congelada=$N3_FROZEN"
if [ "$N3_PAY" = "1" ] && [ "$N3_ASI" = "1" ] && [ "$N3_SNAP" = "1" ] && [ "$N3_FROZEN" = "1" ] && \
   [ "$A3" = "$B3" ] && [ -n "$A3" ] && [[ "$A3" == OK\|* ]]; then
  echo "  PASS  T3' doble-click real: un pago, un asiento, un snapshot, ambas conexiones recuperaron el mismo id"
else
  echo "  FAIL  T3'"; cat /tmp/t3ar.out /tmp/t3br.out; fail=1
fi

echo "== T4': dos primeros pagos concurrentes con TRM distintas (cotización $ID202, USD) =="
PSQL -c "set role service_role; select public.registrar_pago_previo($ID202, 300, 'USD', 4000, 'Transferencia', 'A', $HOY, $ACTOR, 'KC-A4-REAL-$RUN_ID', $SNAP, 1000, 100);" >/tmp/t4ar.out 2>&1 &
PSQL -c "set role service_role; select public.registrar_pago_previo($ID202, 500, 'USD', 4500, 'Transferencia', 'B', $HOY, $ACTOR, 'KC-B4-REAL-$RUN_ID', $SNAP, 1000, 100);" >/tmp/t4br.out 2>&1 &
wait
A4=$(tr -d ' \r\n' </tmp/t4ar.out); B4=$(tr -d ' \r\n' </tmp/t4br.out)
N4_PAY=$(PSQL -c "select count(*) from public.cotizacion_pagos_previos where cotizacion_id=$ID202;")
N4_SNAP=$(PSQL -c "select count(*) from public.cotizacion_condiciones where cotizacion_id=$ID202;")
TRM4=$(PSQL -c "select trm_autoritativa from public.cotizaciones where id=$ID202;")
DISTINCT_TRM4=$(PSQL -c "select count(distinct trm) from public.cotizacion_pagos_previos where cotizacion_id=$ID202;")
echo "  conexión A -> $A4"
echo "  conexión B -> $B4"
echo "  pagos=$N4_PAY snapshot=$N4_SNAP trm_autoritativa=$TRM4 trms_distintas=$DISTINCT_TRM4"
if [ "$N4_PAY" = "2" ] && [ "$N4_SNAP" = "1" ] && [ "$DISTINCT_TRM4" = "1" ]; then
  OK4=$(PSQL -c "select count(*) from public.cotizacion_pagos_previos where cotizacion_id=$ID202 and trm=$TRM4;")
  if [ "$OK4" = "2" ]; then
    echo "  PASS  T4' concurrencia real: 2 pagos en UNA sola TRM congelada ($TRM4), snapshot único, sin mezcla"
  else
    echo "  FAIL  T4': los pagos no quedaron todos en la TRM congelada"; fail=1
  fi
else
  echo "  FAIL  T4': esperaba 2 pagos/1 snapshot/una sola trm (pagos=$N4_PAY snap=$N4_SNAP trms=$DISTINCT_TRM4)"; fail=1
fi

echo ""
echo "== Idempotencia: replay exacto de una clave YA usada devuelve el MISMO id (sin duplicar) =="
FIRST=$(PSQL -c "set role service_role; select public.registrar_pago_previo($ID201, 700000, 'COP', 1, 'Transferencia', 'IDEM', $HOY, $ACTOR, 'KC-IDEM-REAL-$RUN_ID', $SNAP, 1000000, 100);" | tr -d ' \r\n')
REPLAY=$(PSQL -c "set role service_role; select public.registrar_pago_previo($ID201, 700000, 'COP', 1, 'Transferencia', 'IDEM', $HOY, $ACTOR, 'KC-IDEM-REAL-$RUN_ID', $SNAP, 1000000, 100);" | tr -d ' \r\n')
N_REPLAY_PAY=$(PSQL -c "select count(*) from public.cotizacion_pagos_previos where cotizacion_id=$ID201;")
if [ "$FIRST" = "$REPLAY" ] && [ -n "$FIRST" ] && [ "$N_REPLAY_PAY" = "1" ]; then
  echo "  PASS  idempotencia: mismo id devuelto, un solo pago en la BD ($FIRST)"
else
  echo "  FAIL  idempotencia: first=$FIRST replay=$REPLAY pagos=$N_REPLAY_PAY"; fail=1
fi

echo ""
echo "== Idempotencia fail-closed: misma clave con datos DISTINTOS se RECHAZA (no reusa) =="
DIVERGE=$(PSQL -c "set role service_role; select public.registrar_pago_previo($ID201, 999999, 'COP', 1, 'Transferencia', 'IDEM', $HOY, $ACTOR, 'KC-IDEM-REAL-$RUN_ID', $SNAP, 1000000, 100);" 2>&1)
if echo "$DIVERGE" | grep -q "ya se usó para un pago con datos distintos"; then
  echo "  PASS  fail-closed: la clave reutilizada con otro valor fue rechazada"
else
  echo "  FAIL  fail-closed: se esperaba el rechazo de la clave divergente"; echo "$DIVERGE"; fail=1
fi

echo ""
if [ "$fail" = "0" ]; then
  echo "CONCURRENCIA REAL (164 real, cadena 1→163+164): TODO PASS"
else
  echo "CONCURRENCIA REAL: HAY FALLOS"; exit 1
fi
