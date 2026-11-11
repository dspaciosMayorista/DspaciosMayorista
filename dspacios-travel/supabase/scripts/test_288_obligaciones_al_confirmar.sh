#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# PRUEBAS de la migración 288 (#75, parte 1): las obligaciones nacen al CONFIRMAR, una sola vez.
# Uso:  bash supabase/scripts/test_288_obligaciones_al_confirmar.sh <contenedor> <base>
#   · <base>: Postgres local DESECHABLE (supabase/postgres 15.8.1.085) con 281, 283, 284, 285, 287 y 288 aplicadas (y, opcional, la 286 de #97).
#   · auth.uid() debe leer request.jwt.claims (lo prepara el arnés). NUNCA contra producción.
# Cubre: pendiente sin CxP · reintento sin pérdida · confirmación interna materializa · idempotencia · carrera manual/pago · pendiente HISTÓRICO sin duplicar
#        · abono + confirmación + materialización atómicos (éxito, fallo, reintento) · permisos de confirmación sin ampliar · confirmados sin cambios.
# ──────────────────────────────────────────────────────────────────
CT="${1:?uso: test_288_obligaciones_al_confirmar.sh <contenedor> <base>}"; DB="${2:?falta la base}"
export MSYS_NO_PATHCONV=1
S() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=0 -d "$DB" "$@" 2>&1; }
SU='aaaaaaaa-1111-1111-1111-111111111111'; VE='eeeeeeee-5555-5555-5555-555555555555'
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FALLO %s  ->  %s\n' "$1" "$2"; }
expect() { if printf '%s' "$2" | grep -Eq "$3"; then ok "$1"; else bad "$1" "esperaba /$3/, obtuve: $(printf '%s' "$2" | tr '\n' ' ' | cut -c1-230)"; fi; }
Q() { S -c "$1"; }                                         # como dueño de la base (sin RLS)
# QR <uuid> <sql>: sesión con RLS real (rol authenticated + claims)
QR() { { echo "select set_config('request.jwt.claims','{\"sub\":\"$1\",\"role\":\"authenticated\"}',false), set_config('request.jwt.claim.sub','$1',false);"; echo "set role authenticated;"; echo "$2;"; echo "reset role;"; } | S | grep -vE '^{"sub"|^SET$|^RESET$|^$|^[0-9a-f-]{36}$'; }
# QS <sql>: como el SERVIDOR (rol service_role, sin sesión de usuario), que es como la app llama registrar_abono
QS() { { echo "set role service_role;"; echo "$1;"; echo "reset role;"; } | S | grep -vE '^SET$|^RESET$|^$'; }
B=$(( $(date +%s) % 6000 + 1000 ))
CXP='[{"tipo_proveedor":"hotel","proveedor":"Hotel X","servicio":"Hotel","valor_total":500000,"fecha_obligacion":"2027-01-10","aplica_retencion":false,"pct_retencion":0},{"tipo_proveedor":"aereo","proveedor":"Aerolinea Y","servicio":"Tiquetes","valor_total":300000,"fecha_obligacion":"2027-01-10","aplica_retencion":false,"pct_retencion":0}]'
COSTOS='{"costo_hotel":500000,"costo_aereo":300000}'
# mk <numero> [estado] [financiero]: contrato mayorista con precio 1.000.000 (mínimo 30 % = 300.000)
mk() { Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta,tipo_paquete,financiero_estado) values ('$1','mayorista','Cliente $1','${2:-pendiente}','Asesor X',1000000,'porcion','${3:-pendiente}')" >/dev/null; }
reg() { Q "select public.registrar_financiero_contrato('$1','mayorista','$COSTOS'::jsonb,'$CXP'::jsonb)"; }
ncxp()  { Q "select count(*) from public.cuentas_por_pagar where numero_contrato='$1'"; }
nprev() { Q "select count(*) from public.contrato_obligaciones_previstas where numero_contrato='$1' and clase='cxp'"; }
marca() { Q "select (obligaciones_materializadas_en is not null)::text from public.ventas where numero_contrato='$1'"; }
estado() { Q "select estado from public.ventas where numero_contrato='$1'"; }

echo "=== 1) Pendiente: costos previstos sí, CxP NO (quedan como previstas)"
N1="DTM-8$B"; mk "$N1"; R=$(reg "$N1")
expect "la escritura financiera responde con las CxP como previstas" "$R" '"previstas": \[\{'
expect "ninguna CxP exigible en pendiente" "$(ncxp $N1)" '^0$'
expect "2 obligaciones previstas guardadas" "$(nprev $N1)" '^2$'
expect "los costos previstos sí quedan en la venta" "$(Q "select costo_hotel||'|'||costo_aereo from public.ventas where numero_contrato='$N1'")" '^500000.*\|300000'
expect "financiero_estado = completo (costos y previstas registradas)" "$(Q "select financiero_estado from public.ventas where numero_contrato='$N1'")" '^completo$'
expect "sin marcador de materialización" "$(marca $N1)" '^false$'
R2=$(reg "$N1")
expect "reintento sobre un contrato ya completo: ya_completo y NO pierde lo previsto" "$R2|$(nprev $N1)" 'ya_completo.*\|2$'
expect "un contrato ya CONFIRMADO conserva el comportamiento de siempre (CxP al crear)" "$(N=DTM-7$B; mk $N confirmado pendiente; reg $N >/dev/null; ncxp $N)" '^2$'

echo "=== 2) Confirmación interna materializa UNA vez (y no amplía quién puede confirmar)"
expect "un rol sin permiso sobre la venta NO la confirma (venta ajeno)" "$(QR $VE "select public.confirmar_venta('$N1')")" 'Contrato no encontrado|Sin permiso|ERROR'
expect "…y no se materializó nada" "$(ncxp $N1)|$(estado $N1)" '^0\|pendiente$'
expect "materializar_obligaciones NO se puede invocar directo (sin testigo de confirmación)" "$(QR $SU "select p75_priv.materializar_obligaciones('$N1')")" '42501|Sin permiso'
C=$(QR $SU "select public.confirmar_venta('$N1')")
expect "superadmin confirma: ok y trae las CxP materializadas" "$C" '"ok": true.*"obligaciones"'
expect "ahora hay 2 CxP con su clave prevista" "$(ncxp $N1)|$(Q "select count(*) from public.cuentas_por_pagar where numero_contrato='$N1' and clave_prevista is not null")" '^2\|2$'
expect "marcador puesto y previstas consumidas" "$(marca $N1)|$(Q "select count(*) from public.contrato_obligaciones_previstas where numero_contrato='$N1' and materializada_en is not null")" '^true\|2$'
expect "los importes son los previstos (800.000)" "$(Q "select sum(valor_total)::bigint from public.cuentas_por_pagar where numero_contrato='$N1'")" '^800000$'
QR $SU "select public.confirmar_venta('$N1')" >/dev/null
expect "confirmar de nuevo NO duplica" "$(ncxp $N1)" '^2$'

echo "=== 3) Carrera: dos confirmaciones simultáneas materializan UNA sola vez"
N3="DTM-6$B"; mk "$N3"; reg "$N3" >/dev/null
CL="select set_config('request.jwt.claims','{\"sub\":\"$SU\",\"role\":\"authenticated\"}',false), set_config('request.jwt.claim.sub','$SU',false); set role authenticated;"
( { echo "$CL"; echo "begin; select public.confirmar_venta('$N3'); select pg_sleep(3); commit;"; } | S > /tmp/c288a ) &
sleep 1; { echo "$CL"; echo "select public.confirmar_venta('$N3');"; } | S > /tmp/c288b; wait
expect "la segunda confirmación esperó y vio 'ya confirmado'" "$(cat /tmp/c288b)" 'ya_confirmado.*true'
expect "exactamente 2 CxP (no 4)" "$(ncxp $N3)" '^2$'

echo "=== 4) Pendiente HISTÓRICO (CxP ya creadas por el flujo viejo, sin previstas ni marcador)"
N4="DTM-5$B"; mk "$N4" pendiente completo
Q "insert into public.cuentas_por_pagar(numero_contrato,tenant,proveedor,tipo_proveedor,servicio,valor_total,observaciones) values ('$N4','mayorista','Hotel X','hotel','Hotel',500000,public.marca_cxp_automatica()),('$N4','mayorista','Aerolinea Y','aereo','Tiquetes',300000,public.marca_cxp_automatica())" >/dev/null
expect "preparación: 2 CxP históricas, 0 previstas, sin marcador" "$(ncxp $N4)|$(nprev $N4)|$(marca $N4)" '^2\|0\|false$'
QR $SU "select public.confirmar_venta('$N4')" >/dev/null
expect "al confirmar reconoce lo existente: sigue habiendo 2 CxP (sin duplicar) y las originales intactas" "$(ncxp $N4)|$(Q "select count(*) from public.cuentas_por_pagar where numero_contrato='$N4' and clave_prevista is null")" '^2\|2$'
expect "queda marcado (no vuelve a intentarse)" "$(marca $N4)" '^true$'

echo "=== 5) Confirmación por PAGO: abono + confirmación + materialización en UNA transacción"
N5="DTM-4$B"; mk "$N5"; reg "$N5" >/dev/null
OP1=$(Q "select gen_random_uuid()")
AB() { QS "select public.registrar_abono('$N5','mayorista','$SU'::uuid,$1,1,'efectivo','ref',current_date,false,'$2'::uuid)"; }
A1=$(AB 100000 "$OP1")
expect "abono bajo el mínimo: aceptado y NO confirma" "$A1|$(estado $N5)|$(ncxp $N5)" '"estado": "registrado".*\|pendiente\|0$'
OP2=$(Q "select gen_random_uuid()"); A2=$(AB 250000 "$OP2")
expect "el abono que alcanza el mínimo (350.000 ≥ 300.000): aceptado, confirmado y materializado" "$A2|$(estado $N5)|$(ncxp $N5)" '"confirmacion".*\|confirmado\|2$'
expect "reintento de la MISMA operación: ya_registrado y sin duplicar nada" "$(AB 250000 "$OP2")|$(ncxp $N5)|$(Q "select count(*) from public.abonos where numero_contrato='$N5'")" 'ya_registrado.*\|2\|2$'

echo "=== 6) Fallo de la materialización: el abono SE CONSERVA, nada queda a medias, y se repara solo"
N6="DTM-3$B"; mk "$N6"; reg "$N6" >/dev/null
Q "update public.contrato_obligaciones_previstas set payload = jsonb_set(payload,'{valor_total}','\"no-numerico\"') where numero_contrato='$N6' and clave like 'cxp:1:%'" >/dev/null
OP6=$(Q "select gen_random_uuid()")
A6=$(QS "select public.registrar_abono('$N6','mayorista','$SU'::uuid,400000,1,'efectivo','ref',current_date,false,'$OP6'::uuid)")
expect "el abono se registra y la respuesta informa confirmacion_error" "$A6" '"estado": "registrado".*confirmacion_error'
expect "atómico: sigue pendiente, 0 CxP, sin marcador, previstas sin consumir" "$(estado $N6)|$(ncxp $N6)|$(marca $N6)|$(Q "select count(*) from public.contrato_obligaciones_previstas where numero_contrato='$N6' and materializada_en is not null")" '^pendiente\|0\|false\|0$'
expect "el dinero recibido sigue registrado" "$(Q "select count(*) from public.abonos where numero_contrato='$N6'")" '^1$'
Q "update public.contrato_obligaciones_previstas set payload = jsonb_set(payload,'{valor_total}','500000') where numero_contrato='$N6' and clave like 'cxp:1:%'" >/dev/null
A6b=$(QS "select public.registrar_abono('$N6','mayorista','$SU'::uuid,400000,1,'efectivo','ref',current_date,false,'$OP6'::uuid)")
expect "reintentar la misma operación (ya corregido) completa la confirmación y la materialización" "$A6b|$(estado $N6)|$(ncxp $N6)" 'ya_registrado.*confirmacion.*\|confirmado\|2$'

echo "=== 7) Carrera confirmación interna vs. pago"
N7="DTM-2$B"; mk "$N7"; reg "$N7" >/dev/null
( { echo "$CL"; echo "begin; select public.confirmar_venta('$N7'); select pg_sleep(3); commit;"; } | S > /tmp/c288c ) &
sleep 1; OP7=$(Q "select gen_random_uuid()"); { echo "set role service_role;"; echo "select public.registrar_abono('$N7','mayorista','$SU'::uuid,500000,1,'efectivo','ref',current_date,false,'$OP7'::uuid);"; } | S > /tmp/c288d; wait
expect "el abono se registró y no volvió a confirmar" "$(cat /tmp/c288d)" '"estado": "registrado"'
expect "una sola materialización (2 CxP) y confirmado" "$(ncxp $N7)|$(estado $N7)|$(Q "select count(*) from public.abonos where numero_contrato='$N7'")" '^2\|confirmado\|1$'

echo "=== 8) Un pendiente eliminado se lleva sus previstas (nada huérfano)"
N8="DTM-1$B"; mk "$N8"; reg "$N8" >/dev/null
Q "delete from public.ventas where numero_contrato='$N8'" >/dev/null 2>&1
expect "sin previstas huérfanas" "$(nprev $N8)" '^0$'


echo "=== 9) Comisión B2B con la 286 de #97 (única responsable de diferirla y de crear la fila exigible; #75 solo llama su función al confirmar)"
if [ "$(Q "select (to_regprocedure('public.materializar_comision_b2b(text)') is not null)::text")" = true ]; then
  # #97: el ciclo de comisión (plan + materialización al confirmar) tiene interruptor propio, apagado por defecto; en la base desechable se enciende para esta sección.
  CICLO_ANTES=$(Q "select coalesce((select activo::text from p97_priv.ciclo limit 1),'false')")
  Q "update p97_priv.ciclo set activo = true" >/dev/null
  Q "insert into public.aliados(id,nombre,tipo,pct_comision,nit) values (988001,'T288 Agencia','agencia',0.10,'900988001') on conflict (id) do nothing" >/dev/null
  mkb() { Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta,impuesto,tipo_paquete,financiero_estado,tipo_asesor,aliado_id,canal,modo_compra,comision_b2b,comision_estado) values ('$1','mayorista','C','pendiente','T288',$2,200000,'porcion','pendiente','agencia',988001,'B2B','$3',80000,'$4')" >/dev/null; }
  N9="DTM-9$B"; mkb "$N9" 1000000 comisionable pendiente
  RC=$(QR $SU "select public.registrar_comision_b2b_reserva('$N9',988001)")
  expect "PVP pendiente: la reserva registra el PLAN y NO crea comisión exigible" "$RC|$(Q "select count(*) from public.aliados_b2b where numero_contrato='$N9'")" '\|0$'
  reg "$N9" >/dev/null
  QR $SU "select public.confirmar_venta('$N9')" >/dev/null
  expect "al confirmar nace UNA comisión pendiente (la materializa #97 dentro de la confirmación)" "$(Q "select count(*)||'|'||min(estado)||'|'||(min(plan_id) is not null)::text from public.aliados_b2b where numero_contrato='$N9'")" '^1\|pendiente\|true$'
  QR $SU "select public.confirmar_venta('$N9')" >/dev/null
  expect "confirmar otra vez no duplica la comisión ni las CxP" "$(Q "select count(*) from public.aliados_b2b where numero_contrato='$N9'")|$(ncxp $N9)" '^1\|2$'
  N10="DTM-8$B$B"; mkb "$N10" 920000 neta descontada
  QR $SU "select public.registrar_comision_b2b_reserva('$N10',988001)" >/dev/null
  expect "NETO pendiente: una sola fila DESCONTADA (registro del descuento), no exigible" "$(Q "select count(*)||'|'||min(estado)||'|'||bool_and(descontada_en_precio)::text from public.aliados_b2b where numero_contrato='$N10'")" '^1\|pagada\|true$'
  reg "$N10" >/dev/null
  QR $SU "select public.confirmar_venta('$N10')" >/dev/null
  expect "NETO confirmado: NO nace otra comisión por pagar (sigue 1 fila, ninguna pendiente)" "$(Q "select count(*)||'|'||count(*) filter (where estado='pendiente')::text from public.aliados_b2b where numero_contrato='$N10'")|$(ncxp $N10)" '^1\|0\|2$'
  Q "update p97_priv.ciclo set activo = $CICLO_ANTES" >/dev/null
else
  echo "(omitida: la 286 de #97 no está aplicada en esta base)"
fi

echo "=== 10) Escritores de la app sobre CxP de un PENDIENTE (edición de servicios, programa) escriben previstas; sobre un confirmado no aplican"
N11="DTM-9$B$B"; mk "$N11"; reg "$N11" >/dev/null
IDP=$(Q "select id from public.contrato_obligaciones_previstas where numero_contrato='$N11' and clase='cxp' order by id limit 1")
IDQ=$(Q "select id from public.contrato_obligaciones_previstas where numero_contrato='$N11' and clase='cxp' order by id desc limit 1")
RP=$(QS "select public.prevista_cxp_aplicar('$N11', array[$IDQ]::bigint[], '[{\"id\":$IDP,\"valor_total\":650000}]'::jsonb, '[{\"tipo_proveedor\":\"receptivo\",\"proveedor\":\"Tour Z\",\"servicio\":\"Tour\",\"valor_total\":120000,\"observaciones\":\"edición\",\"fecha_obligacion\":\"2027-01-10\"}]'::jsonb)")
expect "pendiente: elimina, actualiza e inserta PREVISTAS y no toca cuentas_por_pagar" "$RP|$(ncxp $N11)" '"aplicado": true.*"insertadas": 1.*\|0$'
expect "las previstas quedaron: 650.000 + 120.000" "$(Q "select sum((payload->>'valor_total')::numeric)::bigint from public.contrato_obligaciones_previstas where numero_contrato='$N11' and clase='cxp'")" '^770000$'
QR $SU "select public.confirmar_venta('$N11')" >/dev/null
expect "al confirmar nacen las CxP editadas (2) por 770.000" "$(ncxp $N11)|$(Q "select sum(valor_total)::bigint from public.cuentas_por_pagar where numero_contrato='$N11'")" '^2\|770000$'
expect "sobre un contrato CONFIRMADO no aplica (la app sigue su camino de siempre)" "$(QS "select public.prevista_cxp_aplicar('$N11', '{}'::bigint[], '[]'::jsonb, '[]'::jsonb)")" '"aplicado": false'
expect "un usuario autenticado NO puede llamar prevista_cxp_aplicar" "$(QR $SU "select public.prevista_cxp_aplicar('$N11', '{}'::bigint[], '[]'::jsonb, '[]'::jsonb)")" 'permission denied|permiso'
echo
echo "RESUMEN: $PASS PASS, $FAIL FALLO"
[ "$FAIL" = "0" ]
