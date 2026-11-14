#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# PRUEBAS de la migración 288 — PARTE 1b: los escritores que creaban obligaciones al nacer un contrato pendiente.
# Uso:  bash supabase/scripts/test_288b_escritores_pendiente.sh <contenedor> <base>
#   · <base>: Postgres local DESECHABLE con 281, 283, 284, 285, 287 y 288 aplicadas (y, opcional, la 286 de #97). NUNCA contra producción.
# Cubre: conversión de cotización (sin pagos / pago previo inferior, igual, superior al mínimo / varios pagos) · oferta #63 · reintento de confirmación
#        (idempotente, concurrente, desde otro proceso, respuesta perdida) · edición de servicios atómica (items + precio + previstas).
# ──────────────────────────────────────────────────────────────────
CT="${1:?uso: test_288b_escritores_pendiente.sh <contenedor> <base>}"; DB="${2:?falta la base}"
export MSYS_NO_PATHCONV=1
S() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=0 -d "$DB" "$@" 2>&1; }
SU='aaaaaaaa-1111-1111-1111-111111111111'
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FALLO %s  ->  %s\n' "$1" "$2"; }
expect() { if printf '%s' "$2" | grep -Eq "$3"; then ok "$1"; else bad "$1" "esperaba /$3/, obtuve: $(printf '%s' "$2" | tr '\n' ' ' | cut -c1-260)"; fi; }
Q() { S -c "$1"; }
CLAIMS="select set_config('request.jwt.claims','{\"sub\":\"$SU\",\"role\":\"authenticated\"}',false), set_config('request.jwt.claim.sub','$SU',false);"
# QO <sql>: como el dueño de la base CON sesión del superadmin (así llama la conversión: una función DEFINER sin RLS, con auth.uid() del usuario)
QO() { { echo "$CLAIMS"; echo "$1;"; } | S | grep -vE '^\{"sub"|^[0-9a-f-]{36}\|[0-9a-f-]{36}$|^$'; }
# QR <sql>: con RLS real (rol authenticated)
QR() { { echo "$CLAIMS"; echo "set role authenticated;"; echo "$1;"; echo "reset role;"; } | S | grep -vE '^\{"sub"|^SET$|^RESET$|^$|^[0-9a-f-]{36}\|[0-9a-f-]{36}$'; }
QS() { { echo "set role service_role;"; echo "$1;"; echo "reset role;"; } | S | grep -vE '^SET$|^RESET$|^$'; }
B=$(( $(date +%s) % 800 + 100 ))
SNAP='[{"orden":0,"tipo_componente":"hotel","valor_componente":1000000,"condicion_pago_tipo":"sin_condicion","monto_exigido":300000}]'
ncxp()  { Q "select count(*) from public.cuentas_por_pagar where numero_contrato='$1'"; }
nprev() { Q "select count(*) from public.contrato_obligaciones_previstas where numero_contrato='$1' and clase='cxp'"; }
estado() { Q "select estado from public.ventas where numero_contrato='$1'"; }
nabon() { Q "select count(*)||'|'||coalesce(sum(valor_abono),0)::bigint from public.abonos where numero_contrato='$1'"; }
nasiento_cxp() { Q "select count(*) from public.asientos_contables where origen='cxp' and descripcion like '%($1)%'"; }
# cot <id> [pago1 pago2 …]: cotización dinámica de 1.000.000 (hotel 600.000 + aéreo 200.000 de costo) con pagos previos opcionales; devuelve el número del contrato convertido
cot() {
  local id="$1"; shift
  Q "insert into public.cotizaciones (id, codigo, estado, tipo, modo, tenant, payload, precio_venta, moneda, cliente) values ($id,'T1B-$id','abierta','manual','simple','mayorista','{\"cliente\":{\"nombres\":\"Cliente\",\"apellidos\":\"$id\",\"tipoDoc\":\"CC\",\"numeroDoc\":\"123\",\"nacimiento\":\"1990-01-01\",\"telefono\":\"300\"},\"tipoAsesor\":\"interno\",\"destino\":\"CARTAGENA\",\"fechaSalida\":\"2027-03-01\",\"fechaRegreso\":\"2027-03-05\"}'::jsonb,1000000,'COP','Cliente $id')" >/dev/null
  Q "insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, nombre_servicio, proveedor, costo_neto, modo, pct_markup, ta, valor) values ($id,0,'hotel','H','Hotel X',600000,'mk',20,0,750000),($id,1,'aereo','A','Aero Y',200000,'mk',20,0,250000)" >/dev/null
  local k=0; for v in "$@"; do k=$((k+1)); QO "select public.registrar_pago_previo($id,$v,'COP',1,'Efectivo','ref$k',current_date,'$SU'::uuid,'k-$id-$k','$SNAP'::jsonb,300000,null)" >/dev/null; done
  if [ $# -eq 0 ]; then Q "update public.cotizaciones set condicion_pago_congelada_en=now(), moneda_congelada='COP', trm_autoritativa=1, precio_total_congelado=1000000, monto_exigido_total=0, monto_exigido_total_cop=0 where id=$id" >/dev/null; fi
  [ -n "$NOCONV" ] && { echo prep; return; }
  local o n; o=$(QO "select public.convertir_cotizacion_a_contrato($id,'$SU'::uuid)"); n=$(printf "%s" "$o" | grep -E "^DTM-[0-9]+$" | tail -1); if [ -z "$n" ]; then printf "%s
" "$o" | grep -m1 ERROR; return; fi
  # paso final de la conversión controlada (lo hace la app con service_role): evalúa el mínimo con los pagos previos ya aplicados
  [ $# -gt 0 ] && QS "select public.confirmar_tras_conversion('$n', '$SU'::uuid)" >/dev/null
  echo "$n"
}
mk() { Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta,tipo_paquete,financiero_estado) values ('$1','mayorista','Cliente $1','${2:-pendiente}','Asesor X',1000000,'porcion','${3:-pendiente}')" >/dev/null; }
CXP='[{"tipo_proveedor":"hotel","proveedor":"Hotel X","servicio":"Hotel","valor_total":500000,"fecha_obligacion":"2027-01-10","aplica_retencion":false,"pct_retencion":0},{"tipo_proveedor":"aereo","proveedor":"Aerolinea Y","servicio":"Tiquetes","valor_total":300000,"fecha_obligacion":"2027-01-10","aplica_retencion":false,"pct_retencion":0}]'
reg() { Q "select public.registrar_financiero_contrato('$1','mayorista','{\"costo_hotel\":500000,\"costo_aereo\":300000}'::jsonb,'$CXP'::jsonb)" >/dev/null; }

echo "=== 1) Conversión de cotización SIN pagos previos: nace pendiente, con obligaciones solo previstas"
N1=$(cot $((990000+B*10+1)))
expect "se creó el contrato DTM" "$N1" '^DTM-[0-9]+$'
expect "pendiente, sin CxP exigibles, con 2 previstas y sin asientos de CxP" "$(estado $N1)|$(ncxp $N1)|$(nprev $N1)|$(nasiento_cxp $N1)" '^pendiente\|0\|2\|0$'
expect "los costos previstos sí quedaron en la venta" "$(Q "select costo_hotel||'|'||costo_aereo from public.ventas where numero_contrato='$N1'")" '^600000.*\|200000'

echo "=== 2) Pago previo INFERIOR al mínimo congelado (300.000; pago 200.000): NO se puede convertir (mínimo para EMITIR el contrato); la cotización sigue abierta"
ID2=$((990000+B*10+2)); N2=$(cot $ID2 200000)
expect "la conversión se rechaza por no alcanzar el mínimo exigido congelado" "$N2" 'no alcanza el mínimo exigido'
expect "la cotización sigue abierta, sin contrato, y el pago previo sigue activo (no se perdió ni se aplicó)" "$(Q "select (select estado from public.cotizaciones where id=$ID2)||'|'||(select count(*) from public.ventas where cotizacion_id=$ID2)||'|'||(select count(*) from public.cotizacion_pagos_previos where cotizacion_id=$ID2 and estado='activo')")" '^abierta\|0\|1$'

echo "=== 3) Pago previo IGUAL al mínimo (300.000): confirma y materializa UNA vez"
N3=$(cot $((990000+B*10+3)) 300000)
expect "confirmado, 1 abono, 2 CxP materializadas con marcador" "$(estado $N3)|$(nabon $N3)|$(ncxp $N3)|$(Q "select (obligaciones_materializadas_en is not null)::text from public.ventas where numero_contrato='$N3'")" '^confirmado\|1\|300000\|2\|true$'
expect "las CxP materializadas NO traen asiento (lo postea la app y lo repone el reconciliador)" "$(nasiento_cxp $N3)" '^0$'

echo "=== 4) Pago previo SUPERIOR al mínimo (500.000)"
N4=$(cot $((990000+B*10+4)) 500000)
expect "confirmado, 1 abono de 500.000, 2 CxP" "$(estado $N4)|$(nabon $N4)|$(ncxp $N4)" '^confirmado\|1\|500000\|2$'

echo "=== 5) Varios pagos previos que SUMAN el mínimo (150.000 + 150.000)"
N5=$(cot $((990000+B*10+5)) 150000 150000)
expect "confirmado con 2 abonos (300.000) y 2 CxP, sin duplicar" "$(estado $N5)|$(nabon $N5)|$(ncxp $N5)" '^confirmado\|2\|300000\|2$'

echo "=== 6) Reintento de la confirmación (abonos suficientes, confirmación pendiente)"
N6="DTM-6$B"; mk "$N6"; reg "$N6"
Q "insert into public.abonos(numero_contrato,tenant,valor_abono,monto_cop,trm,fecha_abono,forma_pago) values ('$N6','mayorista',400000,400000,1,current_date,'efectivo')" >/dev/null
expect "preparación: pendiente con abonos suficientes, sin CxP" "$(estado $N6)|$(ncxp $N6)" '^pendiente\|0$'
N6b="DTM-5$B"; mk "$N6b"; reg "$N6b"
expect "sin mínimo: no confirma" "$(QR "select public.reintentar_confirmacion_pago('$N6b')")" '"confirmada": false'
( { echo "$CLAIMS"; echo "set role authenticated;"; echo "begin; select public.reintentar_confirmacion_pago('$N6'); select pg_sleep(3); commit;"; } | S > /tmp/c288b1 ) &
sleep 1; R6=$(QR "select public.reintentar_confirmacion_pago('$N6')"); wait
expect "dos reintentos simultáneos: el segundo ESPERA el bloqueo y responde ya_confirmado (no materializa otra vez)" "$R6" '"ya_confirmado": true'
expect "una sola materialización (2 CxP) y confirmado" "$(estado $N6)|$(ncxp $N6)" '^confirmado\|2$'
expect "un tercer reintento (otro proceso) es inocuo" "$(QR "select public.reintentar_confirmacion_pago('$N6')")|$(ncxp $N6)" '"confirmada": false.*\|2$'
expect "sin sesión no se puede reintentar" "$(QS "select public.reintentar_confirmacion_pago('$N6')")" '42501|Sesión requerida|permission'

echo "=== 7) Abono aceptado con confirmación FALLIDA: misma operación, respuesta perdida, otro proceso"
N7="DTM-4$B"; mk "$N7"; reg "$N7"
Q "update public.contrato_obligaciones_previstas set payload = jsonb_set(payload,'{valor_total}','\"x\"') where numero_contrato='$N7' and clave like 'cxp:1:%'" >/dev/null
OP7=$(Q "select gen_random_uuid()")
AB7() { QS "select public.registrar_abono('$N7','mayorista','$SU'::uuid,400000,1,'efectivo','ref',current_date,false,'$OP7'::uuid)"; }
A7=$(AB7)
expect "abono REGISTRADO y confirmación fallida informada" "$A7" '"estado": "registrado".*confirmacion_error'
expect "pendiente, 1 abono, sin CxP" "$(estado $N7)|$(nabon $N7)|$(ncxp $N7)" '^pendiente\|1\|400000\|0$'
expect "respuesta PERDIDA: repetir la misma operación (sigue rota) no duplica el abono y sigue informando el fallo" "$(AB7)|$(nabon $N7)" 'ya_registrado.*confirmacion_error.*\|1\|400000$'
Q "update public.contrato_obligaciones_previstas set payload = jsonb_set(payload,'{valor_total}','500000') where numero_contrato='$N7' and clave like 'cxp:1:%'" >/dev/null
( { echo "set role service_role;"; echo "begin; select public.registrar_abono('$N7','mayorista','$SU'::uuid,400000,1,'efectivo','ref',current_date,false,'$OP7'::uuid); select pg_sleep(3); commit;"; } | S > /tmp/c288b2 ) &
sleep 1; R7=$(QR "select public.reintentar_confirmacion_pago('$N7')"); wait
expect "concurrencia: reintentar la MISMA operación y otro proceso reintentar la confirmación → una sola confirmación" "$(estado $N7)|$(ncxp $N7)|$(nabon $N7)" '^confirmado\|2\|1\|400000$'
expect "(el que llegó segundo solo vio «ya confirmado»)" "$R7" '"ya_confirmado": true'

echo "=== 8) Oferta #63: sus CxP también nacen al confirmar (traslado con bypass transaccional, reinserción con su modo)"
N8="DTM-3$B"; mk "$N8" pendiente completo
S -c "begin; set local session_replication_role = replica; insert into public.p63_aceptacion(id,oferta_id,cotizacion_id,tenant,numero_contrato,fecha_negocio,snapshot,estado) overriding system value values (9$B,1,1,'mayorista','$N8',current_date,'{}'::jsonb,'completa'); commit;" >/dev/null
S -c "begin; set local session_replication_role = replica; update public.ventas set aceptacion_63_id=9$B where numero_contrato='$N8'; commit;" >/dev/null
S -c "begin; select set_config('app.p63_h','on',true); insert into public.cuentas_por_pagar(numero_contrato,tenant,proveedor,tipo_proveedor,servicio,valor_total,moneda,aceptacion_63_id,obligacion_63,valor_cop_63,trm_63,observaciones) values ('$N8','mayorista','Hotel USD','hotel','Hotel',100,'USD',9$B,'hotel:1',400000,4000,'oferta'); commit;" >/dev/null
expect "preparación: 1 CxP #63 en un contrato pendiente" "$(ncxp $N8)" '^1$'
CID=$(Q "select id from public.cuentas_por_pagar where numero_contrato='$N8'")
M8=$(S -c "begin; select p75_priv.mover_cxp_a_prevista($CID,'cxp:63:1'); commit;")
expect "se traslada a prevista SIN que el trigger de protección #63 lo impida" "$(ncxp $N8)|$(nprev $N8)" '0|1$'
CX3=$(Q "select id from public.cuentas_por_pagar where numero_contrato='$N3' limit 1")
expect "(un contrato CONFIRMADO no admite el traslado de sus CxP)" "$(S -c "select p75_priv.mover_cxp_a_prevista($CX3,'x')")" 'solo se trasladan obligaciones de un contrato pendiente'
QR "select public.confirmar_venta('$N8')" >/dev/null
expect "al confirmar reaparece con su marca #63, su equivalente en COP y su TRM intactos" "$(Q "select count(*)||'|'||min(obligacion_63)||'|'||min(valor_cop_63)::bigint||'|'||min(trm_63)::bigint from public.cuentas_por_pagar where numero_contrato='$N8' and aceptacion_63_id is not null")" '^1\|hotel:1\|400000\|4000$'

echo "=== 9) Edición de servicios de un pendiente: items + precio + previstas en UNA transacción (todo o nada)"
N9="DTM-2$B"; mk "$N9"; reg "$N9"
Q "insert into public.contrato_items(numero_contrato,descripcion,adultos,ninos,tarifa_adulto,tarifa_nino,orden) values ('$N9','Servicio · Viejo',1,0,100000,0,100)" >/dev/null
IT=$(Q "select id from public.contrato_items where numero_contrato='$N9'")
PV=$(Q "select id from public.contrato_obligaciones_previstas where numero_contrato='$N9' and clase='cxp' order by id limit 1")
FN="public.pendiente_aplicar_servicios('$N9', array[$IT]::bigint[],"
BAD=$(QS "select $FN '[{\"descripcion\":\"Servicio · Nuevo\",\"tarifa_adulto\":200000}]'::jsonb, '{\"precio_venta\":1100000}'::jsonb, '{}'::bigint[], '[]'::jsonb, '[{\"servicio\":\"sin tipo\",\"valor_total\":10}]'::jsonb, '{}'::bigint[], '[]'::jsonb)")
expect "una obligación inválida RECHAZA toda la edición" "$BAD" 'fila inválida|ERROR'
expect "…y NO queda éxito parcial: items, precio y previstas intactos" "$(Q "select (select count(*) from public.contrato_items where numero_contrato='$N9' and descripcion='Servicio · Viejo')||'|'||(select precio_venta::bigint from public.ventas where numero_contrato='$N9')||'|'||(select count(*) from public.contrato_obligaciones_previstas where numero_contrato='$N9')")" '^1\|1000000\|2$'
OKR=$(QS "select $FN '[{\"descripcion\":\"Servicio · Nuevo\",\"tarifa_adulto\":200000}]'::jsonb, '{\"precio_venta\":1100000,\"costo_receptivo\":150000}'::jsonb, '{}'::bigint[], ('[{\"id\":$PV,\"valor_total\":650000}]')::jsonb, '[{\"tipo_proveedor\":\"receptivo\",\"proveedor\":\"Tour\",\"servicio\":\"Tour\",\"valor_total\":150000}]'::jsonb, '{}'::bigint[], '[]'::jsonb)")
expect "edición válida: se aplica TODO junta" "$OKR" '"aplicado": true'
expect "items, precio y previstas quedaron consistentes" "$(Q "select (select string_agg(descripcion,',') from public.contrato_items where numero_contrato='$N9')||'|'||(select precio_venta::bigint from public.ventas where numero_contrato='$N9')||'|'||(select count(*) from public.contrato_obligaciones_previstas where numero_contrato='$N9')||'|'||(select sum((payload->>'valor_total')::numeric)::bigint from public.contrato_obligaciones_previstas where numero_contrato='$N9')")" '^Servicio · Nuevo\|1100000\|3\|1100000$'
expect "una columna no permitida de ventas se rechaza (no se escribe cualquier cosa)" "$(QS "select $FN '[]'::jsonb, '{\"estado\":\"confirmado\"}'::jsonb, '{}'::bigint[], '[]'::jsonb, '[]'::jsonb, '{}'::bigint[], '[]'::jsonb)")" 'columna no permitida|ERROR'
expect "un usuario autenticado NO puede llamar la edición atómica" "$(QR "select $FN '[]'::jsonb, '{}'::jsonb, '{}'::bigint[], '[]'::jsonb, '[]'::jsonb, '{}'::bigint[], '[]'::jsonb)")" 'permission denied|permiso'


echo "=== 10) REINTENTO de una conversión terminada (respuesta perdida / repetida / concurrente): mismo contrato, autorización vigente, sin repetir nada"
# Actores: autorizado (administracion Mayorista), inactivo, venta, y administración de OTRA agencia (Minorista). Superadmin SU ya existe.
AD='eeeeeeee-5555-5555-5555-555555555555'; IN='ffffffff-6666-6666-6666-666666666666'; VE='99999999-7777-7777-7777-777777777777'; OT='88888888-8888-8888-8888-888888888888'
S -c "insert into auth.users(id,email) values ('$AD','ad10@t.l'),('$IN','in10@t.l'),('$VE','ve10@t.l'),('$OT','ot10@t.l') on conflict do nothing" \
  -c "insert into public.usuarios(id,email,nombre,rol,activo,tenant) values ('$AD','ad10@t.l','Admin','administracion',true,'mayorista'),('$IN','in10@t.l','Inactivo','administracion',false,'mayorista'),('$VE','ve10@t.l','Venta','venta',true,'mayorista'),('$OT','ot10@t.l','OtraAgencia','administracion',true,'minorista') on conflict (id) do update set rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant" >/dev/null
huella() { Q "select (select count(*) from public.ventas where cotizacion_id=$1)||'|'||(select count(*) from public.cuentas_por_pagar c join public.ventas v on v.numero_contrato=c.numero_contrato where v.cotizacion_id=$1)||'|'||(select count(*) from public.contrato_obligaciones_previstas p join public.ventas v on v.numero_contrato=p.numero_contrato where v.cotizacion_id=$1)||'|'||(select count(*) from public.abonos a join public.ventas v on v.numero_contrato=a.numero_contrato where v.cotizacion_id=$1)||'|'||(select count(*) from public.contrato_items i join public.ventas v on v.numero_contrato=i.numero_contrato where v.cotizacion_id=$1)||'|'||(select count(*) from public.asientos_contables where descripcion like '%('||(select numero_contrato from public.ventas where cotizacion_id=$1)||')%')||'|'||(select estado||coalesce(obligaciones_materializadas_en::text,'-') from public.ventas where cotizacion_id=$1)"; }
conv() { QO "select public.convertir_cotizacion_a_contrato($1,'$2'::uuid)" | grep -E "^DTM-[0-9]+$|ERROR" | head -1; }
ID_PEND=$((990000+B*10+1)); ID_CONF=$((990000+B*10+5))     # N1 (pendiente, sin pago) y N5 (confirmada por pago previo)

echo "-- 10a) secuencial: actor autorizado recibe el MISMO contrato y no cambia nada"
for par in "$ID_PEND:$N1" "$ID_CONF:$N5"; do
  id=${par%%:*}; esperado=${par##*:}
  H0=$(huella $id)
  expect "superadmin: reintento devuelve $esperado" "$(conv $id $SU)" "^$esperado\$"
  expect "administración Mayorista: reintento devuelve $esperado" "$(conv $id $AD)" "^$esperado\$"
  expect "…huella idéntica (venta, CxP, previstas, abonos, ítems, asientos, estado/marcador)" "$(huella $id)" "^$(printf '%s' "$H0" | sed 's/[][\.*^$|+]/\\&/g')\$"
done
echo "-- 10b) secuencial: actor sin autorización vigente NO recibe el contrato ni cambia nada"
H0=$(huella $ID_CONF)
expect "usuario INACTIVO rechazado" "$(conv $ID_CONF $IN)" 'desactivado'
expect "rol venta rechazado" "$(conv $ID_CONF $VE)" 'no autorizado'
expect "administración de OTRA agencia rechazada (sin acceso a la cotización)" "$(conv $ID_CONF $OT)" 'No tienes acceso a la agencia'
expect "usuario inexistente rechazado" "$(conv $ID_CONF 'abababab-1212-1212-1212-121212121212')" 'no existe'
expect "sin usuario rechazado" "$(QO "select public.convertir_cotizacion_a_contrato($ID_CONF,null)" | grep -m1 ERROR)" 'usuario interno autorizado'
expect "ninguno de los rechazos cambió algo" "$(huella $ID_CONF)" "^$(printf '%s' "$H0" | sed 's/[][\.*^$|+]/\\&/g')\$"
echo "-- 10c) la autorización es la VIGENTE: se desactiva al actor autorizado y el siguiente reintento se rechaza"
S -c "update public.usuarios set activo=false where id='$AD'" >/dev/null
expect "el mismo actor, ya desactivado, es rechazado" "$(conv $ID_PEND $AD)" 'desactivado'
S -c "update public.usuarios set activo=true where id='$AD'" >/dev/null
expect "reactivado, vuelve a recibir el mismo contrato" "$(conv $ID_PEND $AD)" "^$N1\$"
echo "-- 10d) concurrente (conversión nueva): dos llamadas simultáneas, ambas correctas, UN contrato"
IDC=$((990000+B*10+7))
NOCONV=1 cot $IDC 300000 >/dev/null
( echo "$CLAIMS"; echo "select public.convertir_cotizacion_a_contrato($IDC,'$SU'::uuid);" ) | S > /tmp/c10_a.$$ &
( echo "$CLAIMS"; echo "select public.convertir_cotizacion_a_contrato($IDC,'$AD'::uuid);" ) | S > /tmp/c10_b.$$ &
wait
RA=$(grep -E "^DTM-[0-9]+$|ERROR" /tmp/c10_a.$$ | head -1); RB=$(grep -E "^DTM-[0-9]+$|ERROR" /tmp/c10_b.$$ | head -1); rm -f /tmp/c10_a.$$ /tmp/c10_b.$$
expect "ambas llamadas correctas y con el MISMO número" "$RA|$RB" '^(DTM-[0-9]+)\|\1$'
NC=$(printf '%s' "$RA")
expect "un solo contrato, y sus obligaciones previstas/CxP una sola vez (2)" "$(Q "select count(*) from public.ventas where cotizacion_id=$IDC")|$(nprev $NC)$(ncxp $NC)" '^1\|[0-2]{2}$'
QS "select public.confirmar_tras_conversion('$NC', '$SU'::uuid)" >/dev/null
HC=$(huella $IDC)
echo "-- 10e) concurrente (reintento ya terminado): autorizado, inactivo y sin acceso a la vez"
for who in "$SU" "$AD" "$IN" "$VE" "$OT"; do ( echo "$CLAIMS"; echo "select public.convertir_cotizacion_a_contrato($IDC,'$who'::uuid);" ) | S > /tmp/c10_$who.$$ & done
wait
OKS=0; NOS=0
for who in "$SU" "$AD" "$IN" "$VE" "$OT"; do r=$(grep -E "^DTM-[0-9]+$|ERROR" /tmp/c10_$who.$$ | head -1); rm -f /tmp/c10_$who.$$; case "$who" in $SU|$AD) [ "$r" = "$NC" ] && OKS=$((OKS+1));; *) printf '%s' "$r" | grep -q ERROR && NOS=$((NOS+1));; esac; done
expect "los 2 autorizados reciben el mismo contrato y los 3 sin autorización vigente son rechazados" "$OKS|$NOS" '^2\|3$'
expect "huella idéntica tras la concurrencia (nada repetido)" "$(huella $IDC)" "^$(printf '%s' "$HC" | sed 's/[][\.*^$|+]/\\&/g')\$"

echo
echo "RESUMEN: $PASS PASS, $FAIL FALLO"
[ "$FAIL" = "0" ]
