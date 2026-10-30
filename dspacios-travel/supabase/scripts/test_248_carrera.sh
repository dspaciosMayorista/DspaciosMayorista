#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# CARRERAS · 248 anulación atómica de un abono (20260601000248_anular_abono_contabilizado.sql)
# DOS SESIONES REALES con COMMIT real. SOLO base LOCAL DESECHABLE en un contenedor Docker propio
# (nunca remoto, nunca Preview/Producción).
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_248_carrera.sh <base_nueva> <contenedor> [plantilla]
#     base_nueva  ^t248_[a-z0-9_]{1,40}$ que NO exista: se crea desde la plantilla (001–247), se le aplica
#                 la 248 y se BORRA al final (KEEP=1 la conserva).
#     plantilla   base con 001–247 (por defecto plantilla247). Solo se lee.
#
#   R1  anular ‖ anular (doble pulsación)        → una 'anulado' y una 'ya_anulado'; UNA huella; 0 asientos huérfanos
#   R2  anular ‖ posteo del asiento del mismo abono → el posteo espera y falla F4405, o gana y la anulación lo retira; 0 huérfanos
#   R3  anular ‖ emitir factura del contrato      → serializados por la venta; el resultado final es coherente:
#                                                    (a) anula primero y la factura nace sin ese anticipo, o
#                                                    (b) factura primero y la anulación se rechaza con F4418
#   R4  registrar ‖ registrar (operaciones distintas, a 100.000 de quedar pagado) → 1 registrado + 1 pide confirmación
#   R5  misma operación ‖ misma operación (doble pulsación) → 1 registrado + 1 ya_registrado; 1 abono
#   R6  dos excedentes CONFIRMADOS (operaciones distintas) → ambos se registran (excedente intencional)
#   R7  «Confirmar» doble (misma operación confirmada) → un solo excedente
#   R8  anular ‖ registrar → sin asientos huérfanos, libro cuadrado
#   R9  misma clave con datos DISTINTOS a la vez → 1 registrado + 1 rechazado (F4466)
#   R10 clave reutilizada tras anular (commit real) → F4468, sin éxito fantasma
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-}"
PLANTILLA="${3:-plantilla247}"
export MSYS_NO_PATHCONV=1
nombre_ok() { printf '%s' "$1" | grep -Eq "$2"; }
nombre_ok "$DB" '^t248_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t248_[a-z0-9_]{1,40}\$." >&2; exit 2; }
nombre_ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Indica el contenedor Docker local." >&2; exit 2; }
nombre_ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PSA="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
PS="$PSA -d $DB -t -A"
TMP="$(mktemp -d)"
FALLOS=0
BASE_PROPIA=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

limpiar() {
  st=$?
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    for i in 1 2 3 4 5; do $PSA -d postgres -c "drop database $DB" >/dev/null 2>&1 && break; sleep 2; done
  fi
  rm -rf "$TMP"
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe: no se toca." >&2; exit 3; }
$PSA -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
BASE_PROPIA=1
$PSA -d "$DB" -1 < "$APP/supabase/migrations/20260601000248_anular_abono_contabilizado.sql" >/dev/null
echo "Base $DB: plantilla + 248 aplicadas."

ADM=00000000-0000-0000-0000-000000246302
$PS -c "insert into auth.users (id, email) values ('$ADM', 'carrera248@t.test') on conflict do nothing;
        insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('$ADM', 'carrera248@t.test', 'Carrera 248', 'administracion', true, 'mayorista')
          on conflict (id) do update set rol = 'administracion', activo = true, tenant = 'mayorista';
        insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado, moneda)
          select n, 'Cliente ' || n, 'mayorista', 1800000, 'activo', 'completo', 'COP' from unnest(array['DTM-248301','DTM-248302','DTM-248303']) n;
        insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, tenant, clasificacion)
          select numero_contrato, 'Hotel 248', 'hotel', 'Alojamiento', 1500000, tenant, 'irt' from public.ventas where numero_contrato like 'DTM-2463%';
        insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago, referencia)
          values ('DTM-248301', 'mayorista', 500000, 500000, 1, current_date, 'Transferencia', 'C-1'),
                 ('DTM-248302', 'mayorista', 400000, 400000, 1, current_date, 'Transferencia', 'C-2'),
                 ('DTM-248303', 'mayorista', 300000, 300000, 1, current_date, 'Transferencia', 'C-3');" >/dev/null
# Asientos de los abonos de R1 y R3 (R2 se siembra SIN asiento: el posteo compite con la anulación).
for r in C-1 C-3; do

  id="$($PS -c "select id from public.abonos where referencia = '$r'")"
  $PS -c "set role service_role; select public.postear_asiento_abono($id, 'mayorista', '$ADM'::uuid)" >/dev/null
done
ID1="$($PS -c "select id from public.abonos where referencia = 'C-1'")"
ID2="$($PS -c "select id from public.abonos where referencia = 'C-2'")"
ID3="$($PS -c "select id from public.abonos where referencia = 'C-3'")"

sesion() { # sesion <archivo_salida> <sql...>: una sesión service_role con su propia transacción implícita
  out="$1"; shift
  $PS -c "set role service_role; $*" > "$out" 2>&1 || true
}
huerfanos="select count(*) from public.asientos_contables a where a.origen = 'abono' and a.referencia ~ '^abono:[0-9]+\$'
  and not exists (select 1 from public.abonos b where 'abono:' || b.id = a.referencia)
  and not exists (select 1 from public.abonos_anulados z where 'abono:' || z.abono_id = a.referencia)"

# ── R1 · doble pulsación ───────────────────────────────────────────
sesion "$TMP/r1a" "select public.anular_abono($ID1, 'DTM-248301', 'mayorista', '$ADM'::uuid, 'doble clic A')" &
sesion "$TMP/r1b" "select public.anular_abono($ID1, 'DTM-248301', 'mayorista', '$ADM'::uuid, 'doble clic B')" &
wait
A="$(cat "$TMP/r1a" "$TMP/r1b")"
NA="$(printf '%s' "$A" | grep -c '"estado": "anulado"' || true)"
NY="$(printf '%s' "$A" | grep -c '"estado": "ya_anulado"' || true)"
H="$($PS -c "select count(*) from public.abonos_anulados where abono_id = $ID1")"
Q="$($PS -c "select count(*) from public.abonos where id = $ID1")"
O="$($PS -c "$huerfanos")"
[ "$NA" = 1 ] && [ "$NY" = 1 ] && [ "$H" = 1 ] && [ "$Q" = 0 ] && [ "$O" = 0 ] \
  && ok "R1 anular ‖ anular: 1 anulado + 1 ya_anulado, 1 huella, abono fuera, 0 huérfanos" \
  || fallo "R1 anulado=$NA ya_anulado=$NY huellas=$H abono_vivo=$Q huerfanos=$O :: $A"

# ── R2 · anular ‖ posteo del mismo abono (sin asiento todavía) ─────
sesion "$TMP/r2a" "select public.anular_abono($ID2, 'DTM-248302', 'mayorista', '$ADM'::uuid, 'contra posteo')" &
sesion "$TMP/r2b" "select public.postear_asiento_abono($ID2, 'mayorista', '$ADM'::uuid)" &
wait
O="$($PS -c "$huerfanos")"
Q="$($PS -c "select count(*) from public.abonos where id = $ID2")"
H="$($PS -c "select count(*) from public.abonos_anulados where abono_id = $ID2")"
AS="$($PS -c "select count(*) from public.asientos_contables where origen = 'abono' and referencia = 'abono:$ID2'")"
# Dos finales válidos: (a) anula primero y el posteo falla F4405; (b) postea primero y la anulación retira ese asiento.
[ "$O" = 0 ] && [ "$Q" = 0 ] && [ "$H" = 1 ] && [ "$AS" = 0 ] \
  && ok "R2 anular ‖ posteo: abono anulado, 1 huella, sin asiento ni huérfanos ($(cat "$TMP/r2b" | tr -d '\n' | cut -c1-80))" \
  || fallo "R2 huerfanos=$O abono_vivo=$Q huellas=$H asiento=$AS :: $(cat "$TMP/r2a" "$TMP/r2b")"

# ── R3 · anular ‖ emitir factura ───────────────────────────────────
sesion "$TMP/r3a" "select public.anular_abono($ID3, 'DTM-248303', 'mayorista', '$ADM'::uuid, 'contra factura')" &
sesion "$TMP/r3b" "select public.facturar_factura('DTM-248303', '$ADM'::uuid, 'mayorista', 1800000, 1500000, 0, null, null, null, null)" &
wait
Q="$($PS -c "select count(*) from public.abonos where id = $ID3")"
H="$($PS -c "select count(*) from public.abonos_anulados where abono_id = $ID3")"
F="$($PS -c "select count(*) from public.asientos_contables where referencia = 'facturacion:DTM-248303' and origen = 'facturacion'")"
D="$($PS -c "select count(*) from (select asiento_id from public.asiento_lineas group by asiento_id having sum(debe) <> sum(haber)) x")"
ANT="$($PS -c "select coalesce(sum(l.haber - l.debe), 0)::numeric(15,0) from public.asiento_lineas l join public.puc_cuentas p on p.id = l.cuenta_id where l.tercero = 'DTM-248303' and p.codigo = '280505'")"
O="$($PS -c "$huerfanos")"
# (a) anulado y facturado sin anticipo: abono 0, huella 1, anticipo 0.  (b) facturado con el anticipo aplicado y anulación rechazada: abono 1, huella 0, anticipo neto 0 por aplicación.
if [ "$D" = 0 ] && [ "$O" = 0 ] && [ "$F" -ge 0 ]; then
  if { [ "$Q" = 0 ] && [ "$H" = 1 ] && [ "$ANT" = 0 ]; } || { [ "$Q" = 1 ] && [ "$H" = 0 ] && grep -q FIN_ANTICIPO_APLICADO "$TMP/r3a"; }; then
    ok "R3 anular ‖ facturar: final coherente (abono=$Q huella=$H factura=$F anticipo=$ANT; anular: $(tr -d '\n' < "$TMP/r3a" | cut -c1-70))"
  else
    fallo "R3 final incoherente abono=$Q huella=$H factura=$F anticipo=$ANT :: $(cat "$TMP/r3a" "$TMP/r3b")"
  fi
else
  fallo "R3 libro descuadrado=$D huérfanos=$O"
fi

# ═══ Carreras del REGISTRO de abonos (registrar_abono) ═══════════════════════
$PS -c "insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado, moneda)
          select n, 'Cliente ' || n, 'mayorista', 1000000, 'activo', 'completo', 'COP' from unnest(array['DTM-248304','DTM-248305','DTM-248306','DTM-248307']) n;
        insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago, referencia)
          values ('DTM-248304', 'mayorista', 900000, 900000, 1, current_date, 'Transferencia', 'P-304'),
                 ('DTM-248306', 'mayorista', 1000000, 1000000, 1, current_date, 'Transferencia', 'P-306'),
                 ('DTM-248307', 'mayorista', 1000000, 1000000, 1, current_date, 'Transferencia', 'P-307');" >/dev/null
reg() { # reg <contrato> <monto> <confirmar> <operacion>
  echo "select public.registrar_abono('$1', 'mayorista', '$ADM'::uuid, $2, null, 'Transferencia', 'R', null, $3, '$4'::uuid)"
}
cuenta() { $PS -c "select count(*) from public.abonos where numero_contrato = '$1'"; }
suma() { $PS -c "select coalesce(sum(valor_abono), 0)::numeric(15,0) from public.abonos where numero_contrato = '$1'"; }
ops() { $PS -c "select count(*) from public.abono_operaciones where numero_contrato = '$1'"; }
descuadre() { $PS -c "select count(*) from (select asiento_id from public.asiento_lineas group by asiento_id having sum(debe) <> sum(haber)) x"; }

# ── R4 · dos solicitudes DISTINTAS sobre un contrato a 100.000 de quedar pagado, sin confirmar ──
# Si cada una decidiera con la foto previa, las dos pasarían sin confirmación (cada 100.000 «cabe»). Con la venta
# bloqueada la segunda ve el contrato ya cubierto: debe pedir confirmación y NO escribir.
sesion "$TMP/r4a" "$(reg DTM-248304 100000 false 00000000-0000-4000-8000-000000046041)" &
sesion "$TMP/r4b" "$(reg DTM-248304 100000 false 00000000-0000-4000-8000-000000046042)" &
wait
R="$(cat "$TMP/r4a" "$TMP/r4b")"
NR="$(printf '%s' "$R" | grep -c '"estado": "registrado"' || true)"
NC="$(printf '%s' "$R" | grep -c '"estado": "requiere_confirmacion"' || true)"
N="$(cuenta DTM-248304)"; S="$(suma DTM-248304)"
[ "$NR" = 1 ] && [ "$NC" = 1 ] && [ "$N" = 2 ] && [ "$S" = 1000000 ] \
  && ok "R4 dos registros distintos ‖: 1 registrado + 1 pide confirmación; 2 abonos, total 1.000.000 (sin sobrepago)" \
  || fallo "R4 registrado=$NR confirmacion=$NC abonos=$N suma=$S :: $R"

# ── R5 · doble pulsación: la MISMA operación a la vez ──
sesion "$TMP/r5a" "$(reg DTM-248305 400000 false 00000000-0000-4000-8000-000000046051)" &
sesion "$TMP/r5b" "$(reg DTM-248305 400000 false 00000000-0000-4000-8000-000000046051)" &
wait
R="$(cat "$TMP/r5a" "$TMP/r5b")"
NR="$(printf '%s' "$R" | grep -c '"estado": "registrado"' || true)"
NY="$(printf '%s' "$R" | grep -c '"estado": "ya_registrado"' || true)"
N="$(cuenta DTM-248305)"; O="$(ops DTM-248305)"; D="$(descuadre)"
[ "$NR" = 1 ] && [ "$NY" = 1 ] && [ "$N" = 1 ] && [ "$O" = 1 ] && [ "$D" = 0 ] \
  && ok "R5 misma operación ‖ misma operación: 1 registrado + 1 ya_registrado; 1 abono, 1 operación, libro cuadrado" \
  || fallo "R5 registrado=$NR ya=$NY abonos=$N operaciones=$O descuadre=$D :: $R"

# ── R6 · excedente CONFIRMADO a propósito, dos operaciones distintas a la vez ──
sesion "$TMP/r6a" "$(reg DTM-248306 50000 true 00000000-0000-4000-8000-000000046061)" &
sesion "$TMP/r6b" "$(reg DTM-248306 70000 true 00000000-0000-4000-8000-000000046062)" &
wait
R="$(cat "$TMP/r6a" "$TMP/r6b")"
NR="$(printf '%s' "$R" | grep -c '"estado": "registrado"' || true)"
N="$(cuenta DTM-248306)"; S="$(suma DTM-248306)"
[ "$NR" = 2 ] && [ "$N" = 3 ] && [ "$S" = 1120000 ] \
  && ok "R6 dos excedentes confirmados ‖: ambos se registran (intencional); 3 abonos, total 1.120.000" \
  || fallo "R6 registrado=$NR abonos=$N suma=$S :: $R"

# ── R7 · confirmación pulsada dos veces (misma operación, confirmada) ──
sesion "$TMP/r7a" "$(reg DTM-248307 100000 true 00000000-0000-4000-8000-000000046071)" &
sesion "$TMP/r7b" "$(reg DTM-248307 100000 true 00000000-0000-4000-8000-000000046071)" &
wait
R="$(cat "$TMP/r7a" "$TMP/r7b")"
NR="$(printf '%s' "$R" | grep -c '"estado": "registrado"' || true)"
NY="$(printf '%s' "$R" | grep -c '"estado": "ya_registrado"' || true)"
N="$(cuenta DTM-248307)"
[ "$NR" = 1 ] && [ "$NY" = 1 ] && [ "$N" = 2 ] \
  && ok "R7 «Confirmar» doble: 1 registrado + 1 ya_registrado; solo UN excedente (2 abonos)" \
  || fallo "R7 registrado=$NR ya=$NY abonos=$N :: $R"

# ── R8 · registrar ‖ anular el mismo contrato: ninguno deja asientos huérfanos ──
ID304="$($PS -c "select min(id) from public.abonos where numero_contrato = 'DTM-248304'")"
sesion "$TMP/r8a" "select public.anular_abono($ID304, 'DTM-248304', 'mayorista', '$ADM'::uuid, 'contra registro')" &
sesion "$TMP/r8b" "$(reg DTM-248304 10000 true 00000000-0000-4000-8000-000000046081)" &
wait
O="$($PS -c "$huerfanos")"; D="$(descuadre)"
grep -q '"estado": "anulado"' "$TMP/r8a" && grep -q '"estado": "registrado"' "$TMP/r8b" && [ "$O" = 0 ] && [ "$D" = 0 ] \
  && ok "R8 anular ‖ registrar: ambos terminan, 0 asientos huérfanos, libro cuadrado" \
  || fallo "R8 huérfanos=$O descuadre=$D :: $(cat "$TMP/r8a" "$TMP/r8b")"

# ── R9 · MISMA clave con datos DISTINTOS a la vez: solo uno gana, el otro se rechaza ──
$PS -c "insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado, moneda)
          values ('DTM-248308', 'Cliente R9', 'mayorista', 1000000, 'activo', 'completo', 'COP')" >/dev/null
sesion "$TMP/r9a" "$(reg DTM-248308 100000 false 00000000-0000-4000-8000-000000046091)" &
sesion "$TMP/r9b" "$(reg DTM-248308 100001 false 00000000-0000-4000-8000-000000046091)" &
wait
R="$(cat "$TMP/r9a" "$TMP/r9b")"
NR="$(printf '%s' "$R" | grep -c '"estado": "registrado"' || true)"
NE="$(printf '%s' "$R" | grep -c 'FIN_OPERACION_DISTINTA' || true)"
N="$(cuenta DTM-248308)"; O="$(ops DTM-248308)"
[ "$NR" = 1 ] && [ "$NE" = 1 ] && [ "$N" = 1 ] && [ "$O" = 1 ] \
  && ok "R9 misma clave con datos distintos ‖: 1 registrado + 1 rechazado (F4466); 1 abono, 1 operación" \
  || fallo "R9 registrado=$NR rechazado=$NE abonos=$N operaciones=$O :: $R"

# ── R10 · clave reutilizada DESPUÉS de anular (commit real): no hay éxito fantasma ──
ID308="$($PS -c "select id from public.abonos where numero_contrato = 'DTM-248308'")"
sesion "$TMP/r10a" "select public.anular_abono($ID308, 'DTM-248308', 'mayorista', '$ADM'::uuid, 'prueba R10')"
if printf '%s %s' "$(cat "$TMP/r9a")" "$(cat "$TMP/r9b")" | grep -q '"estado": "registrado"'; then
  # reintenta con los datos que ganaron en R9 (100000 o 100001)
  MONTO="$($PS -c "select (abono ->> 'monto_cop')::numeric(15,0) from public.abonos_anulados where abono_id = $ID308")"
  sesion "$TMP/r10b" "$(reg DTM-248308 "$MONTO" false 00000000-0000-4000-8000-000000046091)"
  N="$(cuenta DTM-248308)"
  grep -q 'FIN_OPERACION_ANULADA' "$TMP/r10b" && [ "$N" = 0 ] \
    && ok "R10 clave reutilizada tras anular: rechazada (F4468), 0 abonos; no apunta a una fila inexistente" \
    || fallo "R10 abonos=$N :: $(cat "$TMP/r10a" "$TMP/r10b")"
else
  fallo "R10 no hubo abono ganador en R9"
fi

# ── R11 · el asiento falló en el primer registro; dos REINTENTOS idénticos a la vez recuperan el asiento sin duplicar ──
$PS -c "insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado, moneda)
          values ('DTM-248309', 'Cliente R11', 'mayorista', 1000000, 'activo', 'completo', 'COP');
        create function public.t248_r11_falla() returns trigger language plpgsql as \$f\$ begin
          if new.origen = 'abono' and new.descripcion like 'Abono DTM-248309%' then raise exception 'R11 asiento no disponible'; end if; return new; end \$f\$;
        create trigger t248_r11_falla before insert on public.asientos_contables for each row execute function public.t248_r11_falla();" >/dev/null
OP11=00000000-0000-4000-8000-000000046111
sesion "$TMP/r11a" "$(reg DTM-248309 250000 false $OP11)"
$PS -c "drop trigger t248_r11_falla on public.asientos_contables; drop function public.t248_r11_falla();" >/dev/null
SA="$($PS -c "select count(*) from public.asientos_contables where referencia = 'abono:' || (select id from public.abonos where numero_contrato = 'DTM-248309')")"
sesion "$TMP/r11b" "$(reg DTM-248309 250000 false $OP11)" &
sesion "$TMP/r11c" "$(reg DTM-248309 250000 false $OP11)" &
wait
R="$(cat "$TMP/r11b" "$TMP/r11c")"
NY="$(printf '%s' "$R" | grep -c '"estado": "ya_registrado"' || true)"
NE="$(printf '%s' "$R" | grep -c 'asiento_error' || true)"
N="$(cuenta DTM-248309)"; O="$(ops DTM-248309)"; D="$(descuadre)"
AS="$($PS -c "select count(*) from public.asientos_contables where referencia = 'abono:' || (select id from public.abonos where numero_contrato = 'DTM-248309')")"
grep -q 'asiento_error' "$TMP/r11a" && [ "$SA" = 0 ] && [ "$NY" = 2 ] && [ "$NE" = 0 ] && [ "$N" = 1 ] && [ "$O" = 1 ] && [ "$AS" = 1 ] && [ "$D" = 0 ]   && ok "R11 asiento fallido + 2 reintentos idénticos ‖: 2 ya_registrado sin asiento_error; 1 abono, 1 operación, 1 asiento, libro cuadrado"   || fallo "R11 primero_con_error=$(grep -c asiento_error "$TMP/r11a") asientos_antes=$SA ya=$NY con_error=$NE abonos=$N operaciones=$O asientos=$AS descuadre=$D :: $R"

echo
[ "$FALLOS" = 0 ] && echo "TODAS LAS CARRERAS 248 OK" || { echo "$FALLOS CARRERA(S) CON FALLO"; exit 1; }
