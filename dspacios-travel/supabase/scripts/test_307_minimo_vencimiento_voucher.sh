#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# PRUEBAS de la migración 307 (#53): mínimo de confirmación configurable (NETO = PVP), vencimiento que nunca cancela un contrato con pagos
# y criterio único de «pagado completo» para el acceso de aliados a los vouchers.
# Uso:  bash supabase/scripts/test_307_minimo_vencimiento_voucher.sh <contenedor> <base>
#   · <base>: Postgres local DESECHABLE con 281–306 (estado de Producción) YA aplicadas; la 307 se aplica aquí y se comprueba que NO altera datos existentes.
#   · NUNCA contra producción. Datos sintéticos (DTM-93xx).
# ──────────────────────────────────────────────────────────────────
CT="${1:?uso: test_307_minimo_vencimiento_voucher.sh <contenedor> <base>}"; DB="${2:?falta la base}"
export MSYS_NO_PATHCONV=1
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="${MIG_307:-$HERE/../migrations/20260601000307_minimo_confirmacion_vencimiento_voucher.sql}"   # MIG_307: solo para el control negativo (migración mutada)
S() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=0 -d "$DB" "$@" 2>&1; }
SU='aaaaaaaa-1111-1111-1111-111111111111'; VE='eeeeeeee-5555-5555-5555-555555555555'; AD='bbbbbbbb-2222-2222-2222-222222222222'
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FALLO %s  ->  %s\n' "$1" "$2"; }
expect() { if printf '%s' "$2" | grep -Eq "$3"; then ok "$1"; else bad "$1" "esperaba /$3/, obtuve: $(printf '%s' "$2" | tr '\n' ' ' | cut -c1-260)"; fi; }
Q() { S -c "$1"; }
QR() { { echo "select set_config('request.jwt.claims','{\"sub\":\"$1\",\"role\":\"authenticated\"}',false), set_config('request.jwt.claim.sub','$1',false);"; echo "set role authenticated;"; echo "$2;"; echo "reset role;"; } | S | grep -vE '^{"sub"|^SET$|^RESET$|^$|^[0-9a-f-]{36}$'; }
QS() { { echo "set role service_role;"; echo "$1;"; echo "reset role;"; } | S | grep -vE '^SET$|^RESET$|^$'; }
B=$(( $(date +%s) % 800 + 100 ))
# Usuarios sintéticos (superadmin, administración, venta)
Q "insert into auth.users(id,email) values ('$SU','su307@t.l'),('$VE','ve307@t.l'),('$AD','ad307@t.l') on conflict do nothing" >/dev/null
Q "insert into public.usuarios(id,email,nombre,rol,activo,tenant) values ('$SU','su307@t.l','Super 307','superadmin',true,'mayorista'),('$VE','ve307@t.l','Venta 307','venta',true,'mayorista'),('$AD','ad307@t.l','Admin 307','administracion',true,'mayorista') on conflict (id) do update set rol=excluded.rol, activo=true, tenant='mayorista'" >/dev/null
# mk <numero> <precio> [neto 0|1] [plazo_offset_dias] [moneda] [extras "col=val,..."]: pendiente con registro financiero completo
mk() { Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta,moneda,tipo_paquete,financiero_estado,plazo,comision_estado) values ('$1','mayorista','C $1','pendiente','Venta 307',$2,'${5:-COP}','porcion','completo',current_date + (${4:-10}),$( [ "${3:-0}" = 1 ] && echo "'descontada'" || echo null ))" >/dev/null; if [ -n "$6" ]; then Q "update public.ventas set $6 where numero_contrato='$1'" >/dev/null; fi; }
cond() { Q "insert into public.contrato_condiciones(numero_contrato,tipo_componente,orden,valor_componente,condicion_pago_tipo,monto_exigido,restriccion_comercial,moneda,trm) values ('$1','hotel',0,1,'normal',$2,'normal','${3:-COP}',${4:-1})" >/dev/null; }
estado() { Q "select estado from public.ventas where numero_contrato='$1'"; }
regla() { Q "select g->>'regla'||'|'||(g->>'minimo')::numeric::bigint||'|'||(g->>'moneda') from (select p75_priv.estado_minimo('$1') g) q"; }
abono() { QS "select public.registrar_abono('$1','mayorista','$SU'::uuid,$2,${3:-1},'efectivo','r',current_date,false,gen_random_uuid())"; }
abdirecto() { Q "insert into public.abonos(numero_contrato,tenant,cliente,fecha_abono,valor_abono,forma_pago,trm,monto_cop) values ('$1','mayorista','c',current_date-1,$2,'efectivo',${3:-1},${4:-$2})" >/dev/null; }
pagado() { Q "select public.contrato_pagado_completo('$1')"; }

echo "=== 0) Estado previo: huella de datos existentes (la 307 no debe tocar ninguno)"
mk "DTM-9$B" 1000000 0 -5; abdirecto "DTM-9$B" 100000           # vencido con pago pequeño, ANTES de la migración
mk "DTM-8$B" 1000000 1 -5; abdirecto "DTM-8$B" 400000           # NETO vencido con pago, ANTES de la migración
HUELLA_ANTES=$(Q "select md5(string_agg(numero_contrato||estado||coalesce(precio_venta::text,'')||coalesce(plazo::text,''), ',' order by numero_contrato)) from public.ventas")
ABONOS_ANTES=$(Q "select md5(string_agg(id::text||valor_abono::text, ',' order by id)) from public.abonos")
REUSO_ANTES=$(Q "select habilitado::text from public.dtm_reuso_config limit 1")      # interruptor del reuso ANTES de la 307 (no debe cambiar)
BLOQ_PREVIO=$(Q "select array_to_string(public.dtm_reuso_bloqueos('DTM-9$B', true), ',')")   # motivos de bloqueo de un contrato con pago, con la función de la 304
echo "=== 1) Aplicar la 307 (una sola transacción)"
R=$(docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1 -d "$DB" < "$MIG" 2>&1); expect "la 307 se aplica sin error" "$(printf %s "$R" | grep -c ERROR)" "^0$"
expect "la 307 NO alteró ventas existentes" "$(Q "select md5(string_agg(numero_contrato||estado||coalesce(precio_venta::text,'')||coalesce(plazo::text,''), ',' order by numero_contrato)) from public.ventas")" "^$HUELLA_ANTES\$"
expect "la 307 NO alteró abonos existentes" "$(Q "select md5(string_agg(id::text||valor_abono::text, ',' order by id)) from public.abonos")" "^$ABONOS_ANTES\$"
expect "reaplicar la 307 es idempotente" "$(docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1 -d "$DB" < "$MIG" 2>&1 | grep -c ERROR)" '^0$'

echo "=== 2) Paridad NETO = PVP con la MISMA condición congelada (30 % = 300.000 de 1.000.000)"
P1="DTM-7$B"; N1="DTM-6$B"; mk $P1 1000000; mk $N1 1000000 1; cond $P1 300000; cond $N1 300000
expect "PVP: regla condicion_congelada 300.000" "$(regla $P1)" '^condicion_congelada\|300000\|COP$'
expect "NETO: MISMA regla condicion_congelada 300.000 (no el total)" "$(regla $N1)" '^condicion_congelada\|300000\|COP$'
abono $P1 250000 >/dev/null; abono $N1 250000 >/dev/null
expect "250.000 (< mínimo): PVP y NETO siguen pendientes" "$(estado $P1)|$(estado $N1)" '^pendiente\|pendiente$'
RP=$(abono $P1 50000); RN=$(abono $N1 50000)
expect "en el mínimo (300.000): PVP confirma en el abono" "$(estado $P1)" '^confirmado$'
expect "en el mínimo (300.000): NETO confirma en el abono" "$(estado $N1)" '^confirmado$'
expect "la confirmación se atribuye a la regla condicion_congelada (no a neto_total)" "$RN" '"regla": "condicion_congelada"'
abono $N1 10000 >/dev/null
expect "idempotente: otro abono y reintento no duplican ni cambian el estado" "$(estado $N1)|$(Q "select count(*) from public.aliados_b2b where numero_contrato='$N1'")" '^confirmado\|0$'
expect "reintentar_confirmacion_pago sobre un contrato ya confirmado es un no-op (no duplica ni cambia)" "$(QR $SU "select public.reintentar_confirmacion_pago('$N1')")" 'sin_minimo_o_no_pendiente'
echo "=== 3) Hotel que exige 100 %: la condición congelada exige el total (igual PVP y NETO)"
P2="DTM-5$B"; N2="DTM-4$B"; mk $P2 1000000; mk $N2 1000000 1; cond $P2 1000000; cond $N2 1000000
abono $P2 400000 >/dev/null; abono $N2 400000 >/dev/null
expect "400.000 de un hotel que exige 100 %: ninguno confirma" "$(estado $P2)|$(estado $N2)" '^pendiente\|pendiente$'
abono $P2 600000 >/dev/null; abono $N2 600000 >/dev/null
expect "al completar el 100 %: los dos confirman" "$(estado $P2)|$(estado $N2)" '^confirmado\|confirmado$'
echo "=== 4) Sin condiciones (snapshot ausente): MISMA política legacy 30 % para PVP y NETO"
P3="DTM-3$B"; N3="DTM-2$B"; mk $P3 1000000; mk $N3 1000000 1
expect "PVP sin condiciones: legacy_pct 300.000" "$(regla $P3)" '^legacy_pct\|300000\|COP$'
expect "NETO sin condiciones: legacy_pct 300.000 (igual)" "$(regla $N3)" '^legacy_pct\|300000\|COP$'

echo "=== 5) Mínimo configurable (acuerdo): solo superadmin, solo pendiente, sin confirmar solo"
A1="DTM-1$B"; mk $A1 1000000 1; cond $A1 300000
expect "venta NO puede fijar el mínimo" "$(QR $VE "select public.fijar_minimo_confirmacion('$A1','porcentaje',50)")" '42501|Solo superadmin'
expect "administración NO puede fijar el mínimo" "$(QR $AD "select public.fijar_minimo_confirmacion('$A1','porcentaje',50)")" '42501|Solo superadmin'
expect "sin sesión NO puede (anon/sin uid)" "$(Q "select public.fijar_minimo_confirmacion('$A1','porcentaje',50)")" '42501|Solo superadmin'
expect "porcentaje 0 inválido" "$(QR $SU "select public.fijar_minimo_confirmacion('$A1','porcentaje',0)")" 'porcentaje debe estar'
expect "porcentaje 101 inválido" "$(QR $SU "select public.fijar_minimo_confirmacion('$A1','porcentaje',101)")" 'porcentaje debe estar'
expect "importe mayor al total inválido" "$(QR $SU "select public.fijar_minimo_confirmacion('$A1','importe',1500000)")" 'no puede superar'
expect "importe en otra moneda inválido" "$(QR $SU "select public.fijar_minimo_confirmacion('$A1','importe',100,'USD')")" 'moneda de cobro'
expect "tipo inválido" "$(QR $SU "select public.fijar_minimo_confirmacion('$A1','otro',10)")" 'Tipo de mínimo inválido'
R=$(QR $SU "select public.fijar_minimo_confirmacion('$A1','porcentaje',50)")
expect "superadmin fija 50 %: regla acuerdo 500.000 (sobre NETO)" "$R" '"regla": "acuerdo".*"minimo": 500000'
expect "la regla vigente es ahora acuerdo | 500.000" "$(regla $A1)" '^acuerdo\|500000\|COP$'
abono $A1 400000 >/dev/null
expect "400.000 < 500.000 del acuerdo: sigue pendiente (aunque la condición congelada pedía 300.000)" "$(estado $A1)" '^pendiente$'
QR $SU "select public.fijar_minimo_confirmacion('$A1','importe',350000,'COP','acuerdo con el hotel')" >/dev/null
expect "importe 350.000 vigente" "$(regla $A1)" '^acuerdo\|350000\|COP$'
expect "fijar NO confirma por sí misma (ya hay 400.000 ≥ 350.000 y sigue pendiente)" "$(estado $A1)" '^pendiente$'
expect "el estado dice que ya alcanza (para el reintento manual)" "$(Q "select p75_priv.estado_minimo('$A1')->>'alcanza'")" '^true$'
expect "el reintento manual (superadmin) confirma" "$(QR $SU "select public.reintentar_confirmacion_pago('$A1')" >/dev/null; estado $A1)" '^confirmado$'
expect "contrato ya confirmado: no se puede cambiar el mínimo" "$(QR $SU "select public.fijar_minimo_confirmacion('$A1','total')")" 'ya no espera confirmación'
A2="DTM-0$B"; mk $A2 1000000; cond $A2 300000; QR $SU "select public.fijar_minimo_confirmacion('$A2','total')" >/dev/null
expect "acuerdo «total» exige el 100 % aunque la condición pida 30 %" "$(regla $A2)" '^acuerdo\|1000000\|COP$'
abono $A2 300000 >/dev/null; expect "el 30 % ya no basta con acuerdo total" "$(estado $A2)" '^pendiente$'
QR $SU "select public.fijar_minimo_confirmacion('$A2','porcentaje',30)" >/dev/null
expect "el último acuerdo manda (30 %): vuelve a 300.000" "$(regla $A2)" '^acuerdo\|300000\|COP$'
expect "historial append-only: 2 acuerdos, ninguno editable" "$(Q "select count(*) from public.contrato_minimo_acuerdo where numero_contrato='$A2'")" '^2$'
expect "UPDATE de un acuerdo se rechaza" "$(Q "update public.contrato_minimo_acuerdo set porcentaje=0.9 where numero_contrato='$A2'")" 'no se modifica ni se borra'
expect "DELETE directo de un acuerdo se rechaza" "$(Q "delete from public.contrato_minimo_acuerdo where numero_contrato='$A2'")" 'no se modifica ni se borra'
expect "queda registro en auditoría del alta del acuerdo (actor superadmin)" "$(Q "select count(*) from public.auditoria where tabla='contrato_minimo_acuerdo' and accion='INSERT' and registro_id like '%'")" '^[1-9]'
expect "venta no lee los acuerdos (RLS)" "$(QR $VE "select count(*) from public.contrato_minimo_acuerdo")" '^0$'
expect "superadmin sí lee los acuerdos" "$(QR $SU "select count(*) from public.contrato_minimo_acuerdo where numero_contrato='$A2'")" '^2$'
echo "=== 5b) USD: acuerdo en importe USD y tolerancia de 0,01"
U1="DTM-9$((B+1))"; mk $U1 1000 0 10 USD; QR $SU "select public.fijar_minimo_confirmacion('$U1','importe',300,'USD')" >/dev/null
QS "select public.registrar_abono('$U1','mayorista','$SU'::uuid,1199960,4000,'efectivo','r',current_date,false,gen_random_uuid())" >/dev/null
expect "USD: 299,99 de 300,00 (tolerancia 0,01) confirma" "$(estado $U1)" '^confirmado$'
echo "=== 5c) Eliminar un contrato con acuerdo: la cascada sí puede borrar el historial"
A3="DTM-9$((B+2))"; mk $A3 1000000; QR $SU "select public.fijar_minimo_confirmacion('$A3','total')" >/dev/null
Q "delete from public.ventas where numero_contrato='$A3'" >/dev/null
expect "al borrar el contrato desaparecen sus acuerdos (cascada)" "$(Q "select count(*) from public.contrato_minimo_acuerdo where numero_contrato='$A3'")" '^0$'

echo "=== 6) Vencimiento: nunca cancela con pagos; sin pagos, como siempre"
V0="DTM-9$((B+3))"; V1="DTM-9$((B+4))"; V2="DTM-9$((B+5))"; V3="DTM-9$((B+6))"; V4="DTM-9$((B+7))"; V5="DTM-9$((B+8))"
mk $V0 1000000 0 -5; cond $V0 300000                                 # sin pago, vencido → se cancela
mk $V1 1000000 0 -5; cond $V1 300000; abdirecto $V1 1000             # pago pequeño, vencido → se conserva
mk $V2 1000000 1 -5; cond $V2 300000; abdirecto $V2 300000          # NETO en el mínimo, no confirmado, vencido → se conserva
mk $V3 1000000 0 3; cond $V3 300000                                   # vigente sin pago → intacto
mk $V4 1000000 0 -5; cond $V4 300000; abdirecto $V4 0.0 1 100000    # monto_cop > 0 aunque valor 0 → se conserva
mk $V5 1000000 0 -5; cond $V5 300000; abdirecto $V5 0               # abono en cero NO cuenta como pago → se cancela
R=$(Q "select public.liberar_vencidas()")
expect "sin pagos: cancelado" "$(estado $V0)" '^cancelado$'
expect "pago pequeño (1.000): se conserva pendiente" "$(estado $V1)" '^pendiente$'
expect "NETO en el mínimo sin confirmar: se conserva pendiente" "$(estado $V2)" '^pendiente$'
expect "vigente sin pago: intacto" "$(estado $V3)" '^pendiente$'
expect "pago solo en monto_cop: se conserva" "$(estado $V4)" '^pendiente$'
expect "abono en cero no cuenta como pago: se cancela" "$(estado $V5)" '^cancelado$'
expect "la respuesta informa las conservadas por pago" "$R" '"conservadas_con_pago": 5'
expect "los contratos vencidos con pago de ANTES de la migración también se conservan" "$(estado "DTM-9$B")|$(estado "DTM-8$B")" '^pendiente\|pendiente$'
expect "ninguna fila de abonos se tocó" "$(Q "select count(*) from public.abonos where numero_contrato in ('$V1','$V2','$V4')")" '^3$'
R2=$(Q "select public.liberar_vencidas()"); expect "segunda corrida: idempotente (nada nuevo que cancelar)" "$R2" '"liberadas": 0'
expect "p_hoy explícito: corte estricto (plazo = hoy no se libera)" "$(Q "select public.liberar_vencidas(current_date - 100)")" '"liberadas": 0'
expect "los contratos confirmados no se tocan" "$(estado $P1)|$(estado $N1)" '^confirmado\|confirmado$'
echo "=== 7) Pagado completo (criterio único para el acceso de aliados a vouchers)"
W0="DTM-9$((B+10))"; W1="DTM-9$((B+11))"; W2="DTM-9$((B+12))"; W3="DTM-9$((B+13))"; W4="DTM-9$((B+14))"; W5="DTM-9$((B+15))"; W6="DTM-9$((B+16))"; W7="DTM-9$((B+17))"
mk $W0 1000000 0 10 COP "estado='confirmado'"; abdirecto $W0 600000
expect "60 % pagado: NO está completo" "$(pagado $W0)" '^f$'
abdirecto $W0 399999.60
expect "saldo 0,40 COP (dentro de la tolerancia 0,5): completo" "$(pagado $W0)" '^t$'
mk $W1 1000000 0 10 COP "estado='confirmado'"; abdirecto $W1 999999
expect "saldo 1 COP (fuera de tolerancia): NO completo" "$(pagado $W1)" '^f$'
mk $W2 1000 0 10 USD "estado='confirmado'"; abdirecto $W2 999.99 4000 3999960
expect "USD saldo 0,01 (tolerancia USD): completo" "$(pagado $W2)" '^t$'
mk $W3 1000 0 10 USD "estado='confirmado'"; abdirecto $W3 999.98 4000 3999920
expect "USD saldo 0,02: NO completo" "$(pagado $W3)" '^f$'
Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta,moneda,tipo_paquete,financiero_estado,plazo,moneda_cobro,total_cobro,trm_cobro) values ('$W4','mayorista','C W4','pendiente','Venta 307',1000,'USD','porcion','completo',current_date+10,'COP',4000000,4000)" >/dev/null; Q "update public.ventas set estado='confirmado' where numero_contrato='$W4'" >/dev/null; abdirecto $W4 3999999
expect "USD cobrado en COP: compara contra el total en COP (saldo 1 COP: NO completo)" "$(pagado $W4)" '^f$'
abdirecto $W4 1
expect "USD cobrado en COP, pagado el total en COP: completo" "$(pagado $W4)" '^t$'
mk $W5 1000000 0 10 COP "estado='cancelado'"; abdirecto $W5 1000000
expect "contrato cancelado: nunca completo (falla cerrado)" "$(pagado $W5)" '^f$'
mk $W6 1000000 0 10 COP "estado='confirmado'"
expect "sin pagos: no completo" "$(pagado $W6)" '^f$'
mk $W7 0 0 10 COP "estado='confirmado'"; abdirecto $W7 0
expect "total 0: no completo (no se libera por un contrato vacío)" "$(pagado $W7)" '^f$'
expect "contrato inexistente: no completo" "$(pagado DTM-0000-NO)" '^f$'
expect "versión por lote devuelve solo los completos" "$(Q "select string_agg(x,',' order by x) from public.contratos_pagados_completos(array['$W0','$W1','$W2','$W3','$W4','$W5']) x")" "^$W0,$W2,$W4\$"
echo "=== 7b) Reversión de pago y aumento del saldo bloquean de nuevo, sin borrar nada"
Q "insert into public.vouchers(numero_contrato,tipo,proveedor,contenido) values ('$W0','hotel','H','{\"x\":1}'::jsonb)" >/dev/null
ID=$(Q "select id from public.abonos where numero_contrato='$W0' order by id limit 1")
QS "select public.anular_abono($ID,'$W0','mayorista','$SU'::uuid,'prueba 307')" >/dev/null
expect "tras anular un abono el contrato deja de estar completo" "$(pagado $W0)" '^f$'
expect "el voucher NO se borra" "$(Q "select count(*) from public.vouchers where numero_contrato='$W0'")" '^1$'
mk "DTM-9$((B+18))" 1000000 0 10 COP "estado='confirmado'"; abdirecto "DTM-9$((B+18))" 1000000
expect "pagado completo" "$(pagado DTM-9$((B+18)))" '^t$'
Q "update public.ventas set precio_venta = 1200000 where numero_contrato='DTM-9$((B+18))'" >/dev/null
expect "un aumento posterior del precio vuelve a bloquear" "$(pagado DTM-9$((B+18)))" '^f$'
expect "ninguna función de pago-completo es invocable por anon/authenticated" "$(Q "select has_function_privilege('anon','public.contratos_pagados_completos(text[])','execute')::text||has_function_privilege('authenticated','public.contrato_pagado_completo(text)','execute')::text||has_function_privilege('service_role','public.contrato_pagado_completo(text)','execute')::text")" '^falsefalsetrue$'
echo "=== 8) Contratos confirmados/cancelados y la contabilidad existente no se reescriben"
expect "ningún contrato pasó de cancelado a otro estado" "$(Q "select count(*) from public.ventas where numero_contrato in ('$V0','$V5') and estado <> 'cancelado'")" '^0$'
expect "asientos contables sin cambios por la 307 (cero asientos de origen 307)" "$(Q "select count(*) from public.asientos_contables where descripcion ilike '%307%'")" '^0$'

# ════════════════════════════════════════════════════════════════════════════════════════════════
# Correcciones de la revisión de Codex (F1 identidad · F2 clasificación/reuso/renumeración). F3–F5 son de la capa de aplicación (pruebas/minimoAcordado307.test.ts y minimoAcuerdo307.pg.ts).
# ════════════════════════════════════════════════════════════════════════════════════════════════
# QH <uid> <sql> <expresión SQL de request.headers>: sesión con RLS real Y cabeceras HTTP (como las manda la Server Action: x-contratos = {"<numero>":"<uid>"})
QH() { { echo "select set_config('request.jwt.claims','{\"sub\":\"$1\",\"role\":\"authenticated\"}',false), set_config('request.jwt.claim.sub','$1',false), set_config('request.headers', $3, false);"; echo "set role authenticated;"; echo "$2;"; echo "reset role;"; } | S | grep -vE '^{"sub"|^SET$|^RESET$|^$|^[0-9a-f-]{36}$|^\{.*x-contratos'; }
HDR() { echo "jsonb_build_object('x-contratos', jsonb_build_object('$1','$2')::text)::text"; }   # cabecera con el par número→uid
uidde() { Q "select contrato_uid from public.ventas where numero_contrato='$1'"; }
nacuerdos() { Q "select count(*) from public.contrato_minimo_acuerdo where numero_contrato='$1'"; }

echo "=== 9) F1 · identidad del contrato al fijar el mínimo (UUID viejo, identidad ausente en un número reutilizado, UUID correcto)"
# El número NACIÓ de un reuso: la bandera es inmutable, así que se inserta ya con ella (como lo haría el reuso real).
R1="DTM-8$((B+30))"; Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta,moneda,tipo_paquete,financiero_estado,plazo,nacio_de_reuso) values ('$R1','mayorista','C reuso','pendiente','Venta 307',1000000,'COP','porcion','completo',current_date+10,true)" >/dev/null
expect "fixture: el contrato de prueba nació de un reuso" "$(Q "select nacio_de_reuso::text from public.ventas where numero_contrato='$R1'")" '^true$'
U1=$(uidde $R1); VIEJO='11111111-1111-4111-8111-111111111111'
expect "número REUTILIZADO + UUID viejo declarado: se rechaza (CONTRATO_CAMBIO / F4601)" "$(QH $SU "select public.fijar_minimo_confirmacion('$R1','porcentaje',20)" "$(HDR $R1 $VIEJO)")" 'CONTRATO_CAMBIO'
expect "…y no quedó ningún acuerdo" "$(nacuerdos $R1)" '^0$'
expect "número REUTILIZADO sin identidad declarada: se rechaza (IDENTIDAD_REQUERIDA / F4602)" "$(QH $SU "select public.fijar_minimo_confirmacion('$R1','porcentaje',25)" "'{}'")" 'IDENTIDAD_REQUERIDA'
expect "…y tampoco quedó acuerdo" "$(nacuerdos $R1)" '^0$'
expect "número REUTILIZADO con el UUID vigente declarado por la pantalla: se acepta" "$(QH $SU "select public.fijar_minimo_confirmacion('$R1','porcentaje',20)" "$(HDR $R1 $U1)")" '"ok": true.*"minimo": 200000'
expect "…y quedó UN acuerdo, ligado a ESA vida del contrato" "$(nacuerdos $R1)|$(Q "select count(*) from public.contrato_minimo_acuerdo where numero_contrato='$R1' and contrato_uid='$U1'")" '^1\|1$'
R2="DTM-7$((B+31))"; mk $R2 1000000; U2=$(uidde $R2)
expect "contrato de SIEMPRE sin identidad declarada: sigue funcionando (compatibilidad)" "$(QH $SU "select public.fijar_minimo_confirmacion('$R2','porcentaje',30)" "'{}'")" '"ok": true'
expect "contrato de SIEMPRE con UUID viejo declarado: se rechaza igual" "$(QH $SU "select public.fijar_minimo_confirmacion('$R2','porcentaje',40)" "$(HDR $R2 $VIEJO)")" 'CONTRATO_CAMBIO'
expect "contrato de SIEMPRE con su UUID: se acepta" "$(QH $SU "select public.fijar_minimo_confirmacion('$R2','porcentaje',40)" "$(HDR $R2 $U2)")" '"ok": true'
expect "contrato que ya NO existe pero la pantalla lo declaraba: se rechaza por identidad (no «no existe» a secas)" "$(QH $SU "select public.fijar_minimo_confirmacion('DTM-0001','porcentaje',40)" "$(HDR DTM-0001 $VIEJO)")" 'CONTRATO_CAMBIO'
echo "--- la guarda de la TABLA hija también exige identidad (INSERT directo con UUID viejo en un reuso)"
expect "INSERT directo en contrato_minimo_acuerdo con UUID viejo se rechaza por la guarda estricta" "$(QH $SU "insert into public.contrato_minimo_acuerdo(numero_contrato,contrato_uid,tenant,tipo) values ('$R1','$U1','mayorista','total')" "$(HDR $R1 $VIEJO)")" 'CONTRATO_CAMBIO|permission denied|violates row-level'

echo "=== 10) F2 · clasificación de la tabla nueva: guardas de identidad y reuso de consecutivos"
expect "la tabla está CLASIFICADA como estricta en contrato_guardas_config" "$(Q "select modo from public.contrato_guardas_config where tabla='contrato_minimo_acuerdo'")" '^estricto$'
expect "la guarda de identidad está INSTALADA en la tabla" "$(Q "select count(*) from pg_trigger where tgrelid='public.contrato_minimo_acuerdo'::regclass and tgname='trg_contrato_guarda' and not tgisinternal")" '^1$'
expect "contrato_instalar_guardas() corre sin GUARDA_SIN_CLASIFICAR (idempotente)" "$(Q "select public.contrato_instalar_guardas()")" 'guardas instaladas'
expect "ninguna tabla de contrato queda sin clasificar" "$(Q "select count(*) from pg_class c join pg_namespace s on s.oid=c.relnamespace and s.nspname='public' where c.relkind in ('r','p') and (exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.attname in ('numero_contrato','contrato_numero')) or exists (select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='f' and k.confrelid='public.ventas'::regclass)) and not exists (select 1 from public.contrato_guardas_config g where g.tabla=c.relname::text)")" '^0$'
expect "el interruptor del reuso NO cambió por la 307 (mismo valor que antes de aplicarla)" "$(Q "select habilitado::text from public.dtm_reuso_config limit 1")" "^$REUSO_ANTES\$"
expect "dtm_reuso_bloqueos conserva dueño, SECURITY DEFINER y permisos (no ejecutable por anon/authenticated)" "$(Q "select p.prosecdef::text||'/'||(not has_function_privilege('anon',p.oid,'execute'))::text||'/'||(not has_function_privilege('authenticated',p.oid,'execute'))::text from pg_proc p where p.oid='public.dtm_reuso_bloqueos(text,boolean)'::regprocedure")" '^true/true/true$'
expect "contratos bloqueados desde ANTES de la 307 devuelven los MISMOS motivos que antes (reuso en su estado original)" "$(Q "select array_to_string(public.dtm_reuso_bloqueos('DTM-9$B', true), ',')")" "^$BLOQ_PREVIO$"
Q "update public.dtm_reuso_config set habilitado = true" >/dev/null     # SOLO en esta base desechable, para ejercitar la elegibilidad
E1="DTM-6$((B+32))"; mk $E1 1000000
expect "contrato elegible SIN acuerdo: sin bloqueos (referencia)" "$(Q "select coalesce(nullif(array_to_string(public.dtm_reuso_bloqueos('$E1', true), ','), ''), 'ELEGIBLE')")" '^ELEGIBLE$'
QR $SU "select public.fijar_minimo_confirmacion('$E1','porcentaje',50)" >/dev/null
QR $SU "select public.fijar_minimo_confirmacion('$E1','importe',400000)" >/dev/null
expect "el MISMO contrato con 2 acuerdos (historial) sigue ELEGIBLE: el acuerdo no es un bloqueo nuevo (sin RELACION_CONTRATO_MINIMO_ACUERDO)" "$(Q "select coalesce(nullif(array_to_string(public.dtm_reuso_bloqueos('$E1', true), ','), ''), 'ELEGIBLE')")" '^ELEGIBLE$'
expect "contrato_reuso_preview también lo ve elegible" "$(QR $SU "select coalesce(nullif(array_to_string(public.contrato_reuso_preview('$E1'), ','), ''), 'ELEGIBLE')")" 'ELEGIBLE'
abdirecto $E1 1000
expect "un PAGO real lo sigue bloqueando como antes (RELACION_ABONOS), con o sin acuerdo" "$(Q "select array_to_string(public.dtm_reuso_bloqueos('$E1', true), ',')")" 'RELACION_ABONOS'
echo "--- liberar y reutilizar: eliminar_contrato(…, reusar) con acuerdo; auditoría y cascada"
E2="DTM-5$((B+33))"; mk $E2 1000000; QR $SU "select public.fijar_minimo_confirmacion('$E2','porcentaje',50)" >/dev/null
QR $SU "select public.eliminar_contrato('$E2', true)" >/dev/null
expect "el contrato elegible con acuerdo SE ELIMINÓ para reuso (ya no existe)" "$(Q "select count(*) from public.ventas where numero_contrato='$E2'")" '^0$'
expect "su acuerdo se fue en cascada con el contrato" "$(nacuerdos $E2)" '^0$'
expect "el número quedó disponible en el pool de reuso" "$(Q "select count(*) from public.numeros_dtm_liberados where numero='$E2'")" '^[1-9]'
expect "la auditoría CONSERVA el historial del acuerdo (INSERT) y registra su borrado en cascada (DELETE)" "$(Q "select string_agg(distinct accion, ',' order by accion) from public.auditoria where tabla='contrato_minimo_acuerdo' and (antes->>'numero_contrato'='$E2' or despues->>'numero_contrato'='$E2')")" 'DELETE.*INSERT'
echo "--- renumeración (fn_renumerar_contrato) con acuerdos"
N0="DTM-4$((B+34))"; N1="DTM-3$((B+35))"; mk $N0 1000000; QR $SU "select public.fijar_minimo_confirmacion('$N0','porcentaje',30)" >/dev/null; QR $SU "select public.fijar_minimo_confirmacion('$N0','porcentaje',40)" >/dev/null
UID0=$(uidde $N0)
QR $SU "select public.fn_renumerar_contrato('$N0','$N1')" >/dev/null
expect "renumerar: los 2 acuerdos pasan al número nuevo, con la MISMA vida del contrato" "$(nacuerdos $N1)|$(nacuerdos $N0)|$(Q "select count(*) from public.contrato_minimo_acuerdo where numero_contrato='$N1' and contrato_uid='$UID0'")" '^2\|0\|2$'
expect "…y el mínimo vigente sigue siendo el último (40 %)" "$(regla $N1)" '^acuerdo\|400000\|COP$'
expect "un UPDATE que cambie OTRA cosa sigue prohibido (solo se traslada el número)" "$(Q "update public.contrato_minimo_acuerdo set porcentaje = 0.9 where numero_contrato='$N1'")" 'no se modifica ni se borra'
expect "un UPDATE de número hacia un contrato AJENO (otra vida) se rechaza" "$(Q "update public.contrato_minimo_acuerdo set numero_contrato='$R2' where numero_contrato='$N1'")" 'no se modifica ni se borra'
Q "update public.dtm_reuso_config set habilitado = $REUSO_ANTES" >/dev/null
expect "el interruptor del reuso quedó como estaba (restituido en la base desechable)" "$(Q "select habilitado::text from public.dtm_reuso_config limit 1")" "^$REUSO_ANTES\$"

echo "=== 11) Postcheck, rollback (ida y vuelta) y preflight sobre copias desechables"
SCR="$HERE"
PGA() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -F '|' -v ON_ERROR_STOP=0 "$@" 2>&1; }
copia() { PGA -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='$DB' and pid <> pg_backend_pid()" >/dev/null; PGA -d postgres -c "drop database if exists $1" >/dev/null; PGA -d postgres -c "create database $1 template $DB" >/dev/null; }
revisar() { PGA -d "$1" < "$2" | grep -E '\|REVISAR$' | grep -v 'la 307 no escribió datos' || true; }
expect "postcheck_307 sobre la base con la 307 y datos de prueba: ningún REVISAR (salvo «no escribió datos», que aquí no aplica porque la prueba creó acuerdos)" "$(revisar "$DB" "$SCR/postcheck_307_minimo_vencimiento_voucher.sql")|x" '^\|x$'
RB="${DB}_rb"; copia "$RB"
RES=$(PGA -v ON_ERROR_STOP=1 -d "$RB" < "$SCR/rollback_307_minimo_vencimiento_voucher.sql" | grep -c 'ERROR')
expect "rollback_307 corre sin error (con acuerdos existentes)" "$RES" '^0$'
expect "rollback: dtm_reuso_bloqueos vuelve EXACTAMENTE a la 304 (md5)" "$(PGA -d "$RB" -c "select md5(replace(prosrc, chr(13), '')) from pg_proc where oid='public.dtm_reuso_bloqueos(text,boolean)'::regprocedure")" '^e417b53ecf0de9523e222f9c45debd9a$'
expect "rollback: con acuerdos la tabla SE CONSERVA, clasificada y con su guarda (no se pierde historial)" "$(PGA -d "$RB" -c "select (select count(*) from public.contrato_minimo_acuerdo) > 0, (select count(*) from public.contrato_guardas_config where tabla='contrato_minimo_acuerdo'), (select count(*) from pg_trigger where tgrelid='public.contrato_minimo_acuerdo'::regclass and tgname='trg_contrato_guarda')")" '^t\|1\|1$'
expect "rollback: contrato_instalar_guardas() sigue sin abortar" "$(PGA -d "$RB" -c "select public.contrato_instalar_guardas()")" 'guardas instaladas'
expect "rollback: regla NETO y vencimiento vuelven al texto aplicado (288 / 285) y las funciones nuevas desaparecen" "$(PGA -d "$RB" -c "select (position('neto_total' in pg_get_functiondef('p75_priv.regla_confirmacion(text)'::regprocedure)) > 0), (position('conservadas' in pg_get_functiondef('public.liberar_vencidas(date)'::regprocedure)) = 0), to_regprocedure('public.contratos_pagados_completos(text[])') is null, to_regprocedure('public.fijar_minimo_confirmacion(text,text,numeric,text,text)') is null")" '^t\|t\|t\|t$'
expect "rollback: el interruptor del reuso no cambió" "$(PGA -d "$RB" -c "select habilitado::text from public.dtm_reuso_config limit 1")" "^$REUSO_ANTES\$"
PGA -v ON_ERROR_STOP=1 -d "$RB" < "$MIG" >/dev/null 2>&1; expect "reaplicar la 307 tras el rollback funciona" "$(PGA -d "$RB" -c "select to_regprocedure('public.fijar_minimo_confirmacion(text,text,numeric,text,text)') is not null")" '^t$'
expect "…y el postcheck vuelve a estar limpio" "$(revisar "$RB" "$SCR/postcheck_307_minimo_vencimiento_voucher.sql")|x" '^\|x$'
RB2="${DB}_rb2"; copia "$RB2"; PGA -d "$RB2" -c "truncate public.contrato_minimo_acuerdo" >/dev/null
PGA -v ON_ERROR_STOP=1 -d "$RB2" < "$SCR/rollback_307_minimo_vencimiento_voucher.sql" >/dev/null 2>&1
expect "rollback con la tabla VACÍA: la tabla y su clasificación desaparecen" "$(PGA -d "$RB2" -c "select to_regclass('public.contrato_minimo_acuerdo') is null, (select count(*) from public.contrato_guardas_config where tabla='contrato_minimo_acuerdo')")" '^t\|0$'
expect "…y el preflight sobre esa base (esquema previo a la 307) no dice REVISAR" "$(revisar "$RB2" "$SCR/preflight_307_minimo_vencimiento_voucher.sql" | grep -v 'la 307 NO está aplicada' | grep -v 'regla_confirmacion existe')|x" '^\|x$'
PGA -d postgres -c "drop database if exists $RB" -c "drop database if exists $RB2" >/dev/null

echo; echo "RESULTADO: $PASS pasaron, $FAIL fallaron"; [ "$FAIL" = 0 ]
