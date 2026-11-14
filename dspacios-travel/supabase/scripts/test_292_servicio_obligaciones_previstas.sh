#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# PRUEBAS de la migración 292 (#75): servicios y líneas protegidos por sus obligaciones PREVISTAS (secuencial y en CARRERA).
# Uso:  bash supabase/scripts/test_292_servicio_obligaciones_previstas.sh <contenedor> <base>
#   · <base>: Postgres local DESECHABLE con la secuencia final (… 288, 286, 289, 290, 291) + 292. auth.uid() lee request.jwt.claims. NUNCA contra producción.
# Cubre: borrar del catálogo un servicio con prevista (enlazada y no enlazada) · borrar/cambiar la línea enlazada · cambios benignos de la línea ·
#        validación de la prevista (otro contrato, servicio inexistente, clave ajena o inexistente, vínculo sin clave) · edición autorizada de un
#        pendiente (quita la prevista y libera la línea en la misma transacción) · confirmación (materializa y la 265 sigue protegiendo) ·
#        eliminar_contrato (289) · CARRERAS borrado↔creación de prevista y borrado↔confirmación, en los dos órdenes.
# ──────────────────────────────────────────────────────────────────
CT="${1:?uso: test_292_servicio_obligaciones_previstas.sh <contenedor> <base>}"; DB="${2:?falta la base}"
export MSYS_NO_PATHCONV=1
S() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=0 -d "$DB" "$@" 2>&1; }
SU='aaaaaaaa-1111-1111-1111-111111111111'
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FALLO %s  ->  %s\n' "$1" "$2"; }
# expect aplana la salida: los errores de psql traen varias líneas
expect() { if printf '%s' "$2" | tr '\n' ' ' | grep -Eq "$3"; then ok "$1"; else bad "$1" "esperaba /$3/, obtuve: $(printf '%s' "$2" | tr '\n' ' ' | cut -c1-260)"; fi; }
Q() { S -c "$1"; }
CL="select set_config('request.jwt.claims','{\"sub\":\"$SU\",\"role\":\"authenticated\"}',false), set_config('request.jwt.claim.sub','$SU',false);"
QR() { { echo "$CL"; echo "set role authenticated;"; echo "$1;"; echo "reset role;"; } | S | grep -vE '^\{"sub"|^SET$|^RESET$|^$|^[0-9a-f-]{36}\|[0-9a-f-]{36}$'; }
QS() { { echo "set role service_role;"; echo "$1;"; echo "reset role;"; } | S | grep -vE '^SET$|^RESET$|^$'; }
B=$(( $(date +%s) % 800 + 100 ))
Q "insert into public.proveedores (id, nombre) values (92900,'Prov 292') on conflict do nothing" >/dev/null

# srv <id>: traslado del catálogo · ctr <numero> <srv> <clave>: contrato PENDIENTE con su línea por alcance (clave) y la CxP de esa línea → prevista (registrar_financiero_contrato real)
srv() { Q "insert into public.servicios_adicionales (id, nombre, proveedor_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion, tipo_receptivo) values ($1,'Traslado 292 $1',92900,0,'tour_traslado','COP','persona','paquete','traslado')" >/dev/null; }
linea() { Q "insert into public.contrato_servicios (numero_contrato, tipo, descripcion, costo, servicio_id, alcance_traslado, clave_enlace) values ('$1','traslado','Traslado · Llegada',100000,$2,'llegada','$3')" >/dev/null; }
venta() { Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta,tipo_paquete,financiero_estado) values ('$1','mayorista','Cliente $1','pendiente','Asesor X',1000000,'porcion','pendiente')" >/dev/null; }
cxp_linea() { printf '[{"tipo_proveedor":"receptivo","proveedor":"Prov 292","servicio":"Traslado · Llegada","servicio_id":%s,"valor_total":100000,"moneda":"COP","observaciones":"Generado automáticamente · enlace:%s"}]' "$1" "$2"; }
cxp_suelta() { printf '[{"tipo_proveedor":"receptivo","proveedor":"Prov 292","servicio":"Tour","servicio_id":%s,"valor_total":80000,"moneda":"COP"}]' "$1"; }
regsql() { echo "select public.registrar_financiero_contrato('$1','mayorista','{\"costo_receptivo\":100000}'::jsonb,'$2'::jsonb)"; }
ctr() { venta "$1"; linea "$1" "$2" "$3"; Q "$(regsql "$1" "$(cxp_linea "$2" "$3")")" >/dev/null; }
uuid() { printf '%08d-0000-4000-8000-%012d' "$1" "$2"; }
nprev() { Q "select count(*) from public.contrato_obligaciones_previstas where numero_contrato='$1' and materializada_en is null"; }
existe_srv() { Q "select count(*) from public.servicios_adicionales where id=$1"; }
linea_de() { Q "select coalesce(servicio_id::text,'null')||'|'||alcance_traslado||'|'||clave_enlace from public.contrato_servicios where numero_contrato='$1'"; }
huella() { Q "select md5(coalesce((select string_agg(payload::text, ';' order by id) from public.contrato_obligaciones_previstas where numero_contrato='$1'),'')||(select count(*) from public.servicios_adicionales where id=$2)::text||coalesce((select string_agg(id||servicio_id::text||alcance_traslado||clave_enlace, ';') from public.contrato_servicios where numero_contrato='$1'),''))"; }

echo "=== 1) Catálogo: un servicio con prevista sin materializar NO se elimina"
S1=$((92000+B)); N1="DTM-92$B"; K1=$(uuid $B 1); srv $S1; ctr $N1 $S1 $K1
expect "el contrato está pendiente, sin CxP y con su prevista enlazada a la línea" "$(Q "select estado from ventas where numero_contrato='$N1'")|$(Q "select count(*) from cuentas_por_pagar where numero_contrato='$N1'")|$(nprev $N1)|$(Q "select (payload->>'contrato_servicio_id') is not null from contrato_obligaciones_previstas where numero_contrato='$N1'")" '^pendiente\|0\|1\|t$'
H=$(huella $N1 $S1)
expect "DELETE del servicio con prevista ENLAZADA → 42501 obligaciones previstas" "$(Q "delete from public.servicios_adicionales where id=$S1")" 'obligaciones previstas.*no se puede eliminar'
expect "nada cambió (servicio, línea con su servicio_id y prevista idénticos)" "$(huella $N1 $S1)|$(linea_de $N1)" "^$H\|$S1\|llegada\|$K1$"
S2=$((92000+B+400)); N2="DTM-93$B"; srv $S2; venta $N2; Q "$(regsql $N2 "$(cxp_suelta $S2)")" >/dev/null
expect "prevista SIN línea (tour con servicio_id): también bloquea el borrado" "$(nprev $N2)|$(Q "delete from public.servicios_adicionales where id=$S2")|$(existe_srv $S2)" '^1\|.*obligaciones previstas.*\|1$'
S3=$((92000+B+800)); srv $S3
expect "control: un servicio sin previstas ni CxP se elimina" "$(Q "delete from public.servicios_adicionales where id=$S3")$(existe_srv $S3)" '^0$'

echo "=== 2) Línea: no se borra ni cambia de servicio/alcance/clave con su prevista; los cambios benignos siguen"
expect "DELETE de la línea enlazada a una prevista (contrato vivo) → 23503" "$(Q "delete from public.contrato_servicios where numero_contrato='$N1'")" 'obligación prevista enlazada.*no se puede borrar'
expect "UPDATE del alcance → 42501" "$(Q "update public.contrato_servicios set alcance_traslado='salida' where numero_contrato='$N1'")" 'obligación prevista enlazada no se editan'
expect "UPDATE de la clave → 42501" "$(Q "update public.contrato_servicios set clave_enlace=gen_random_uuid() where numero_contrato='$N1'")" 'obligación prevista enlazada no se editan'
expect "UPDATE del servicio a NULL (lo que haría el ON DELETE SET NULL) → 42501" "$(Q "update public.contrato_servicios set servicio_id=null where numero_contrato='$N1'")" 'obligación prevista enlazada no se editan'
expect "UPDATE benigno (descripción/costo) sí se permite" "$(Q "update public.contrato_servicios set descripcion='Traslado · Llegada (ed)', costo=100000 where numero_contrato='$N1' returning descripcion")" 'Llegada \(ed\)'
expect "la línea sigue intacta" "$(linea_de $N1)" "^$S1\|llegada\|$K1$"

echo "=== 3) La prevista se valida como la CxP que será (prevista_cxp_aplicar, service_role)"
Q "update public.ventas set financiero_estado='completo' where numero_contrato='$N2'" >/dev/null
fila() { printf '[{"tipo_proveedor":"receptivo","valor_total":1,%s}]' "$1"; }
expect "payload de OTRO contrato → rechazo" "$(QS "select public.prevista_cxp_aplicar('$N2','{}',null,'$(fila "\"numero_contrato\":\"$N1\"")'::jsonb)")" 'payload es de otro contrato'
expect "servicio inexistente → rechazo" "$(QS "select public.prevista_cxp_aplicar('$N2','{}',null,'$(fila '"servicio_id":999999999')'::jsonb)")" 'servicio 999999999 del catálogo no existe'
expect "clave de enlace inexistente → rechazo" "$(QS "select public.prevista_cxp_aplicar('$N2','{}',null,'$(fila "\"servicio_id\":$S2,\"observaciones\":\"x · enlace:$(uuid 9 9)\"")'::jsonb)")" 'no corresponde a ninguna línea'
expect "clave de la línea de OTRO contrato → rechazo" "$(QS "select public.prevista_cxp_aplicar('$N2','{}',null,'$(fila "\"servicio_id\":$S1,\"observaciones\":\"x · enlace:$K1\"")'::jsonb)")" 'pertenece a otro contrato'
expect "vínculo a una línea SIN clave verificable → rechazo" "$(QS "select public.prevista_cxp_aplicar('$N2','{}',null,'$(fila '"contrato_servicio_id":1')'::jsonb)")" 'clave de enlace verificable'
expect "nada se escribió en N2 por los rechazos" "$(nprev $N2)" '^1$'
expect "una prevista válida sin servicio entra (control)" "$(QS "select public.prevista_cxp_aplicar('$N2','{}',null,'$(fila '"servicio":"Otro"')'::jsonb)->>'insertadas'")|$(nprev $N2)" '^1\|2$'

echo "=== 4) Edición AUTORIZADA de un pendiente: quita la prevista enlazada en su transacción y la línea queda libre"
N4="DTM-94$B"; S4=$((92000+B+1200)); K4=$(uuid $B 4); srv $S4; ctr $N4 $S4 $K4
P4=$(Q "select id from contrato_obligaciones_previstas where numero_contrato='$N4'")
R4=$(QS "select public.pendiente_aplicar_servicios('$N4','{}','[]'::jsonb,'{\"costo_receptivo\":0}'::jsonb,array[$P4]::bigint[],'[]'::jsonb,'[]'::jsonb,'{}','[]'::jsonb)")
expect "pendiente_aplicar_servicios quita la prevista (aplicado, 1 eliminada)" "$R4|$(nprev $N4)" '"eliminadas": 1.*\|0$'
expect "sin prevista, el servicio del catálogo ya se puede eliminar (SET NULL en la línea, como antes de la 288)" "$(Q "delete from public.servicios_adicionales where id=$S4")$(existe_srv $S4)|$(linea_de $N4)" "^0\|null\|llegada\|$K4$"
N4b="DTM-95$B"; S4b=$((92000+B+1300)); K4b=$(uuid $B 41); srv $S4b; ctr $N4b $S4b $K4b
P4b=$(Q "select id from contrato_obligaciones_previstas where numero_contrato='$N4b'")
QS "select public.pendiente_aplicar_servicios('$N4b','{}','[]'::jsonb,'{}'::jsonb,'{}','[{\"id\":$P4b,\"valor_total\":120000}]'::jsonb,'[]'::jsonb,'{}','[]'::jsonb)" >/dev/null
expect "actualizar el valor de una prevista enlazada sigue funcionando" "$(Q "select payload->>'valor_total' from contrato_obligaciones_previstas where id=$P4b")" '^120000$'

echo "=== 5) Confirmar materializa la CxP enlazada; después la 265 protege igual que siempre"
C5=$(QR "select public.confirmar_venta('$N1')")
expect "confirmar_venta OK, CxP enlazada a SU línea, prevista materializada" "$C5|$(Q "select count(*) from cuentas_por_pagar c join contrato_servicios cs on cs.id=c.contrato_servicio_id where c.numero_contrato='$N1' and cs.clave_enlace='$K1' and c.servicio_id=$S1")|$(nprev $N1)" '\|1\|0$'
expect "el servicio sigue sin poder eliminarse (ahora por la CxP enlazada, 265)" "$(Q "delete from public.servicios_adicionales where id=$S1")" 'cuenta por pagar enlazada no se editan'

echo "=== 6) Eliminar el contrato (289) sigue permitido con la prevista; después el servicio queda libre"
N6="DTM-96$B"; S6=$((92000+B+1400)); K6=$(uuid $B 6); srv $S6; ctr $N6 $S6 $K6
expect "eliminar_contrato con línea y prevista enlazadas: elimina todo" "$(Q "select public.eliminar_contrato('$N6', false)" >/dev/null; Q "select (select count(*) from ventas where numero_contrato='$N6')||'|'||(select count(*) from contrato_servicios where numero_contrato='$N6')||'|'||(select count(*) from contrato_obligaciones_previstas where numero_contrato='$N6')")" '^0\|0\|0$'
expect "y el servicio ya se puede eliminar" "$(Q "delete from public.servicios_adicionales where id=$S6")$(existe_srv $S6)" '^0$'

echo "=== 7) CARRERAS (dos sesiones reales; la primera retiene sus bloqueos 3 s)"
# 7a creación de la prevista PRIMERO, borrado del servicio después: el borrado espera y ve la prevista
N7="DTM-97$B"; S7=$((92000+B+1500)); K7=$(uuid $B 7); srv $S7; venta $N7; linea $N7 $S7 $K7
( { echo "begin;"; regsql $N7 "$(cxp_linea $S7 $K7)"; echo "; select pg_sleep(3); commit;"; } | S > /tmp/t292_7a1 ) &
sleep 1; T0=$(date +%s); R7=$(Q "delete from public.servicios_adicionales where id=$S7"); T1=$(date +%s); wait
expect "7a: el borrado esperó a la prevista en curso (≥1 s) y la rechazó" "$((T1-T0))|$R7" '^[1-9][0-9]*\|.*obligaciones previstas'
expect "7a: estado final coherente (servicio, línea y prevista enlazada)" "$(existe_srv $S7)|$(linea_de $N7)|$(nprev $N7)" "^1\|$S7\|llegada\|$K7\|1$"
# 7b borrado del servicio PRIMERO, creación de la prevista después: la creación falla y no queda nada huérfano
N7b="DTM-98$B"; S7b=$((92000+B+1600)); K7b=$(uuid $B 72); srv $S7b; venta $N7b
( { echo "begin; delete from public.servicios_adicionales where id=$S7b; select pg_sleep(3); commit;"; } | S > /tmp/t292_7b1 ) &
sleep 1; R7b=$(Q "$(regsql $N7b "$(cxp_suelta $S7b)")"); wait
expect "7b: la prevista sobre el servicio que se está borrando falla (FK/servicio inexistente) y no queda prevista" "$R7b|$(existe_srv $S7b)|$(nprev $N7b)" 'ERROR.*\|0\|0$'
# 7c creación de la prevista enlazada PRIMERO, borrado de la LÍNEA después
N7c="DTM-99$B"; S7c=$((92000+B+1700)); K7c=$(uuid $B 73); srv $S7c; venta $N7c; linea $N7c $S7c $K7c
( { echo "begin;"; regsql $N7c "$(cxp_linea $S7c $K7c)"; echo "; select pg_sleep(3); commit;"; } | S > /tmp/t292_7c1 ) &
sleep 1; R7c=$(Q "delete from public.contrato_servicios where numero_contrato='$N7c'"); wait
expect "7c: el borrado de la línea esperó y la rechazó; línea y prevista quedan" "$R7c|$(linea_de $N7c)|$(nprev $N7c)" "obligación prevista enlazada.*\|$S7c\|llegada\|$K7c\|1$"
# 7d borrado de la LÍNEA primero, creación de la prevista enlazada después
N7d="DTM-90$B"; S7d=$((92000+B+1800)); K7d=$(uuid $B 74); srv $S7d; venta $N7d; linea $N7d $S7d $K7d
( { echo "begin; delete from public.contrato_servicios where numero_contrato='$N7d'; select pg_sleep(3); commit;"; } | S > /tmp/t292_7d1 ) &
sleep 1; R7d=$(Q "$(regsql $N7d "$(cxp_linea $S7d $K7d)")"); wait
expect "7d: la creación falla (la clave ya no tiene línea) y no queda prevista ni CxP" "$R7d|$(nprev $N7d)|$(Q "select count(*) from cuentas_por_pagar where numero_contrato='$N7d'")" 'no corresponde a ninguna línea.*\|0\|0$'
# 7e CONFIRMACIÓN primero (materializa con la prevista), borrado del servicio después
( { echo "$CL"; echo "set role authenticated; begin; select public.confirmar_venta('$N7'); select pg_sleep(3); commit;"; } | S > /tmp/t292_7e1 ) &
sleep 1; R7e=$(Q "delete from public.servicios_adicionales where id=$S7"); wait
expect "7e: el borrado concurrente con la confirmación se rechaza (prevista viva o CxP enlazada) y la CxP queda" "$R7e|$(existe_srv $S7)|$(Q "select count(*) from cuentas_por_pagar where numero_contrato='$N7' and servicio_id=$S7 and contrato_servicio_id is not null")|$(nprev $N7)" '(obligaciones previstas|cuenta por pagar enlazada).*\|1\|1\|0$'
# 7f CONFIRMACIÓN y borrado de la LÍNEA en carrera
N7f="DTM-91$B"; S7f=$((92000+B+1900)); K7f=$(uuid $B 76); srv $S7f; ctr $N7f $S7f $K7f
( { echo "$CL"; echo "set role authenticated; begin; select public.confirmar_venta('$N7f'); select pg_sleep(3); commit;"; } | S > /tmp/t292_7f1 ) &
sleep 1; R7f=$(Q "delete from public.contrato_servicios where numero_contrato='$N7f'"); wait
expect "7f: la línea no se borra durante ni después de la confirmación; CxP enlazada" "$R7f|$(linea_de $N7f)|$(Q "select count(*) from cuentas_por_pagar where numero_contrato='$N7f' and contrato_servicio_id is not null")" "(obligación prevista enlazada|cuenta por pagar enlazada).*\|$S7f\|llegada\|$K7f\|1$"
# 7g borrado del servicio intentado PRIMERO (se rechaza al instante) y confirmación justo después: confirma bien
N7g="DTM-89$B"; S7g=$((92000+B+2000)); K7g=$(uuid $B 77); srv $S7g; ctr $N7g $S7g $K7g
( { echo "begin; delete from public.servicios_adicionales where id=$S7g; select pg_sleep(3); commit;"; } | S > /tmp/t292_7g1 ) &
sleep 1; R7g=$(QR "select public.confirmar_venta('$N7g')"); wait
expect "7g: el borrado se rechazó y la confirmación materializó sin error" "$(cat /tmp/t292_7g1 | tr '\n' ' ')|$(Q "select count(*) from cuentas_por_pagar where numero_contrato='$N7g' and contrato_servicio_id is not null")|$(Q "select estado from ventas where numero_contrato='$N7g'")" 'obligaciones previstas.*\|1\|confirmado$'
rm -f /tmp/t292_7*

echo "=== 8) Permisos: las funciones nuevas no son ejecutables por la API"
expect "anon/authenticated sin EXECUTE en tg_servicio_con_previstas, tg_prevista_valida, tg_linea_enlazada_protegida, clave_enlace_de, prevista_enlaza_linea" "$(Q "select count(*) from pg_proc p where p.oid in ('public.tg_servicio_con_previstas()'::regprocedure,'public.tg_prevista_valida()'::regprocedure,'public.tg_linea_enlazada_protegida()'::regprocedure,'p75_priv.clave_enlace_de(text)'::regprocedure,'p75_priv.prevista_enlaza_linea(text,bigint,uuid)'::regprocedure) and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))")" '^0$'

echo; echo "RESULTADO 292: $PASS pasan, $FAIL fallan"
[ "$FAIL" -eq 0 ]
