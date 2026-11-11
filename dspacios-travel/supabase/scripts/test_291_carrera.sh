#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# PRUEBAS de la 291 con DOS SESIONES REALES: reemisión NETO contra registro de pago y contra confirmación, en los dos órdenes.
# Uso:  bash supabase/scripts/test_291_carrera.sh <contenedor> <base_desechable_con_291>
#   La base se MODIFICA (datos confirmados): usar una copia desechable. NUNCA contra producción.
# ──────────────────────────────────────────────────────────────────
CT="${1:?uso: test_291_carrera.sh <contenedor> <base>}"; DB="${2:?falta la base}"
export MSYS_NO_PATHCONV=1
S() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=0 -d "$DB" "$@" 2>&1; }
Q() { S -c "$1"; }
PASS=0; FAIL=0
expect() { if printf '%s' "$2" | grep -Eq "$3"; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FALLO $1  ->  esperaba /$3/, obtuve: $(printf '%s' "$2" | tr '\n' ' ' | cut -c1-240)"; fi; }
SU='00000000-0000-0000-0000-000000291201'
como() { printf "select set_config('request.jwt.claims','{\"sub\":\"%s\",\"role\":\"authenticated\"}',false), set_config('request.jwt.claim.sub','%s',false);\nset role authenticated;\n%s\n" "$1" "$1" "$2" | S | grep -v '^{' | grep -v '^SET$'; }
servicio() { printf "set role service_role;\n%s\n" "$1" | S | grep -v '^SET$'; }
B=$(( $(date +%s) % 800 + 100 ))

Q "insert into auth.users (id, email) values ('$SU','c291s@x.test') on conflict do nothing" >/dev/null
Q "insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('$SU','c291s@x.test','C291 Super','superadmin',true,'mayorista')
     on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant" >/dev/null
Q "insert into public.aliados (id, nombre, tipo, pct_comision, nit) values (291201,'C291 Agencia','agencia',0.10,'900291201') on conflict (id) do nothing" >/dev/null
# NETO pendiente del caso obligatorio: PVP 2.000.000, BNC 400.000, 10 % → NETO 1.840.000
mk() { Q "insert into public.ventas (numero_contrato, cliente, tenant, asesor, precio_venta, impuesto, estado, financiero_estado, tipo_asesor, aliado_id, canal, modo_compra, comision_b2b, comision_estado, moneda)
            values ('$1','C','mayorista','C291 Asesor',1840000,400000,'pendiente','completo','agencia',291201,'B2B','neta',160000,'descontada','COP');
          insert into public.aliados_b2b (numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id, precio_venta, base_comision, base_explicita, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado, descontada_en_precio)
            values ('$1','mayorista','C291 Agencia','900291201','agencia',291201,2000000,1600000,true,0.10,0,0,false,0,'pagada',true);
          insert into public.contrato_items (numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden) values ('$1','Paquete',1,0,2000000,0,0);" >/dev/null; }
REEMITIR() { echo "select public.reemitir_neto_pendiente('$1', '[{\"descripcion\":\"Paquete\",\"adultos\":1,\"ninos\":0,\"tarifaAdulto\":2200000,\"tarifaNino\":0}]'::jsonb);"; }
ABONO() { echo "select public.registrar_abono('$1', 'mayorista', '$SU'::uuid, $2, null, 'Efectivo', 'c291', current_date, false, gen_random_uuid());"; }
estado() { Q "select v.estado || '|' || v.precio_venta::numeric(15,0) || '|' || b.base_comision::numeric(15,0) || '|' || (select count(*) from public.abonos a where a.numero_contrato = v.numero_contrato)
              || '|' || (select string_agg(tarifa_adulto::numeric(15,0)::text, ',') from public.contrato_items i where i.numero_contrato = v.numero_contrato)
              from public.ventas v join public.aliados_b2b b using (numero_contrato) where v.numero_contrato = '$1'"; }
expect "S0 la 291 está aplicada" "$(Q "select to_regprocedure('public.reemitir_neto_pendiente(text,jsonb,boolean)') is not null")" "^t$"

# R1 · reemisión primero (retiene el candado 3 s) → el abono espera y entra DESPUÉS, sobre el total nuevo
N1="DTM-291${B}1"; mk "$N1"
( como "$SU" "begin; $(REEMITIR "$N1") select pg_sleep(3); commit;" > /dev/null ) &
sleep 1
T0=$(date +%s); R1=$(servicio "$(ABONO "$N1" 100000)"); T1=$(date +%s)
wait
expect "R1 el abono esperó a la reemisión (≥1 s)" "$((T1 - T0))" "^[1-9]"
expect "R1 total nuevo 2.020.000 + el abono registrado" "$(estado "$N1")" "^pendiente\|2020000\|1800000\|1\|2200000$"

# R2 · abono primero (retiene el candado 3 s, aún sin confirmar) → la reemisión espera, VE el pago y se rechaza sin cambios
N2="DTM-291${B}2"; mk "$N2"
( servicio "begin; $(ABONO "$N2" 100000) select pg_sleep(3); commit;" > /dev/null ) &
sleep 1
R2=$(como "$SU" "$(REEMITIR "$N2")")
wait
expect "R2 la reemisión se rechaza por el pago" "$R2" "NETO_291: el contrato $N2 ya tiene pagos"
expect "R2 nada cambió (1.840.000, ítem 2.000.000)" "$(estado "$N2")" "^pendiente\|1840000\|1600000\|1\|2000000$"

# R3 · reemisión primero → confirmar_venta espera y decide con el total NUEVO
N3="DTM-291${B}3"; mk "$N3"
( como "$SU" "begin; $(REEMITIR "$N3") select pg_sleep(3); commit;" > /dev/null ) &
sleep 1
R3=$(como "$SU" "select public.confirmar_venta('$N3');")
wait
expect "R3 tras la reemisión el mínimo es el total nuevo" "$(Q "select (p75_priv.estado_minimo('$N3')->>'minimo')::numeric::bigint")" "^2020000$"
echo "      R3 confirmar_venta devolvió: $(printf '%s' "$R3" | tr '\n' ' ' | cut -c1-200)"
expect "R3 PVP/base reemitidos se conservan" "$(estado "$N3")" "\|2020000\|1800000\|0\|2200000$"

# R4 · confirmación primero (retiene 3 s) → la reemisión espera y ya no la encuentra pendiente
N4="DTM-291${B}4"; mk "$N4"
Q "update public.ventas set estado = 'pendiente' where numero_contrato = '$N4'" >/dev/null
( como "$SU" "begin; update public.ventas set estado = 'confirmado' where numero_contrato = '$N4'; select pg_sleep(3); commit;" > /dev/null ) &
sleep 1
R4=$(como "$SU" "$(REEMITIR "$N4")")
wait
expect "R4 la reemisión se rechaza: ya no está pendiente" "$R4" "NETO_291: el contrato $N4 no está pendiente"
expect "R4 nada cambió" "$(estado "$N4")" "^confirmado\|1840000\|1600000\|0\|2000000$"

# R5 · un abono insertado SIN la RPC (otro escritor: importador, service-role directo) también serializa: lo hace la FK abonos → ventas
N5="DTM-291${B}5"; mk "$N5"
( servicio "begin; insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago, referencia) values ('$N5','mayorista',100000,100000,1,current_date,'Efectivo','c291-directo'); select pg_sleep(3); commit;" > /dev/null ) &
sleep 1
R5=$(como "$SU" "$(REEMITIR "$N5")")
wait
expect "R5 inserción directa en curso: la reemisión espera y se rechaza" "$R5" "NETO_291: el contrato $N5 ya tiene pagos"
expect "R5 nada cambió" "$(estado "$N5")" "^pendiente\|1840000\|1600000\|1\|2000000$"

echo "────────── 291 carrera: $PASS PASS, $FAIL FALLO"
[ "$FAIL" -eq 0 ]
