#!/usr/bin/env bash
# Pruebas de CONCURRENCIA (dos conexiones) de la corrección A1/A2 (migración 164).
# Precondiciones:
#   1. Docker con el contenedor `pago164test` (postgres:16) corriendo.
#   2. test_164_schema.sql aplicado.
#   3. test_164_concurrencia.sql aplicado (prepara las cotizaciones 201/202/203).
#
# T3 (doble-click, misma clave de intento): dos conexiones registran a la vez el
#   MISMO primer pago sobre la 203 con la misma clave → debe quedar UN pago, un
#   asiento y un solo congelado/snapshot (la segunda conexión recupera el id).
# T4 (dos primeros pagos concurrentes, TRM distintas): dos conexiones compiten
#   por ser el PRIMER pago sobre la 202 con TRM 4000 y 4500 → debe quedar UN
#   snapshot, UNA TRM congelada (la que ganó el lock) y ambos pagos en esa TRM.

PSQL() { MSYS_NO_PATHCONV=1 docker exec pago164test psql -U postgres -d test -t -A -q "$@"; }
DB="pago164test"
CALL_USR="'00000000-0000-0000-0000-000000000001'"
TODAY="current_date"

fail=0

echo "== T3: doble-click misma clave (primer pago, cot 203) =="
# Conexión A y B con la MISMA clave KC-T3 y el MISMO snapshot. El resultado se
# captura a archivo temporal (la sustitución de comando NO se puede backgroundear).
PSQL -c "select public.registrar_pago_previo(203, 900000, 'COP', 1, 'Transferencia', 'DC', $TODAY, $CALL_USR, 'KC-T3', public._snap(), 1066000, 35.53);" >/tmp/t3a.out 2>&1 &
PSQL -c "select public.registrar_pago_previo(203, 900000, 'COP', 1, 'Transferencia', 'DC', $TODAY, $CALL_USR, 'KC-T3', public._snap(), 1066000, 35.53);" >/tmp/t3b.out 2>&1 &
wait
A3=$(tr -d ' \r\n' </tmp/t3a.out); B3=$(tr -d ' \r\n' </tmp/t3b.out)
N3_PAY=$(PSQL -c "select count(*) from cotizacion_pagos_previos where cotizacion_id=203;")
N3_ASI=$(PSQL -c "select count(*) from asientos_contables a join cotizacion_pagos_previos p on a.referencia='pago_previo:'||p.id where p.cotizacion_id=203 and a.origen='pago_previo';")
N3_SNAP=$(PSQL -c "select count(*) from cotizacion_condiciones where cotizacion_id=203;")
N3_FROZEN=$(PSQL -c "select count(*) from cotizaciones where id=203 and condicion_pago_congelada_en is not null;")
echo "  conexión A -> $A3 | conexión B -> $B3"
echo "  pagos=$N3_PAY asientos_pago_previo=$N3_ASI snapshot=$N3_SNAP congelada=$N3_FROZEN"
if [ "$N3_PAY" = "1" ] && [ "$N3_ASI" = "1" ] && [ "$N3_SNAP" = "2" ] && [ "$N3_FROZEN" = "1" ] && [ "$A3" = "$B3" ] && [ "$A3" != "" ]; then
  echo "  PASS  T3 doble-click: un pago, un asiento, un snapshot, ambos recuperaron el mismo id"
else
  echo "  FAIL  T3" ; fail=1
fi

echo "== T4: dos primeros pagos concurrentes con TRM distintas (cot 202) =="
PSQL -c "select public.registrar_pago_previo(202, 300, 'USD', 4000, 'Transferencia', 'A', $TODAY, $CALL_USR, 'KC-A4', public._snap(), 700, 35.0);" >/tmp/t4a.out 2>&1 &
PSQL -c "select public.registrar_pago_previo(202, 500, 'USD', 4500, 'Transferencia', 'B', $TODAY, $CALL_USR, 'KC-B4', public._snap(), 700, 35.0);" >/tmp/t4b.out 2>&1 &
wait
A4=$(tr -d ' \r\n' </tmp/t4a.out); B4=$(tr -d ' \r\n' </tmp/t4b.out)
N4_PAY=$(PSQL -c "select count(*) from cotizacion_pagos_previos where cotizacion_id=202;")
N4_SNAP=$(PSQL -c "select count(*) from cotizacion_condiciones where cotizacion_id=202;")
TRM4=$(PSQL -c "select trm_autoritativa from cotizaciones where id=202;")
DISTINCT_TRM4=$(PSQL -c "select count(distinct trm) from cotizacion_pagos_previos where cotizacion_id=202;")
SUM4_COP=$(PSQL -c "select round(sum(monto_cop),2) from cotizacion_pagos_previos where cotizacion_id=202 and estado='activo';")
echo "  conexión A -> $A4 | conexión B -> $B4"
echo "  pagos=$N4_PAY snapshot=$N4_SNAP trm_autoritativa=$TRM4 trms_distintas=$DISTINCT_TRM4 sumaCOP=$SUM4_COP"
# 202 USD precio 2000. Si TRM ganadora = 4000: pagos 300+500=800 USD => 3.200.000 COP.
# Si = 4500: 800*4500 = 3.600.000. Cualquiera coherente: pagos=2, snapshot=2, UNA sola trm.
if [ "$N4_PAY" = "2" ] && [ "$N4_SNAP" = "2" ] && [ "$DISTINCT_TRM4" = "1" ]; then
  # ambos pagos en la TRM congelada, sin mezcla
  OK4=$(PSQL -c "select count(*) from cotizacion_pagos_previos where cotizacion_id=202 and trm=$TRM4;")
  if [ "$OK4" = "2" ]; then
    echo "  PASS  T4 concurrencia: 2 pagos en UNA sola TRM ($TRM4), snapshot único, sin mezcla"
  else
    echo "  FAIL  T4: los pagos no quedaron todos en la TRM congelada" ; fail=1
  fi
else
  echo "  FAIL  T4: esperaba 2 pagos/2 snapshot/una sola trm (pagos=$N4_PAY snap=$N4_SNAP trms=$DISTINCT_TRM4)" ; fail=1
fi

echo ""
if [ "$fail" = "0" ]; then echo "CONCURRENCIA: TODO PASS"; else echo "CONCURRENCIA: HAY FALLOS"; exit 1; fi
