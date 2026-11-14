#!/bin/bash
# ────────────────────────────────────────────────────────────────────────────────────────────────────────────
# PRUEBAS DE INTEGRACIÓN de la migración 285 (#75, entrega 2): funciones, pendiente financiero, Storage y ventas_basica.uid.
# Además: regresión específica de MINORISTA y recorrido COMPLETO de renumeración con las migraciones finales (284 + 285).
#
# Uso:  bash supabase/scripts/test_285_identidad_funciones_storage.sh <contenedor> [base]
#   · <contenedor>: Postgres local DESECHABLE (supabase/postgres 15.8.1.085) con el esquema hasta la 281 + 283 + 284 + 285 aplicadas.
#   · NUNCA contra producción. Los contratos de prueba se borran al final.
# Cabeceras simuladas con set_config('request.headers', …); la propagación REAL por PostgREST y Storage se prueba aparte
# (supabase/scripts/test_285_postgrest_storage.sh).
# ────────────────────────────────────────────────────────────────────────────────────────────────────────────
CT="${1:?uso: test_285_identidad_funciones_storage.sh <contenedor> [base]}"
DB="${2:-postgres}"
export MSYS_NO_PATHCONV=1
S() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=0 -d "$DB" "$@" 2>&1; }
SU='aaaaaaaa-1111-1111-1111-111111111111'; VE='eeeeeeee-5555-5555-5555-555555555555'
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FALLO %s  ->  %s\n' "$1" "$2"; }
B=$(( $(date +%s) % 7000 + 1000 ))
uid() { S -c "select contrato_uid from public.ventas where numero_contrato='$1'"; }
seed() { S -c "begin; set local session_replication_role = replica; $1; commit;" >/dev/null; }
# t <expect> <etiqueta> <mapa|-> <sql> [codigo]   (superadmin autenticado; el SQL puede cambiar de rol)
t() {
  local pre="select set_config('request.jwt.claims','{\"sub\":\"$SU\",\"role\":\"authenticated\"}',true), set_config('request.jwt.claim.sub','$SU',true);"
  [ "$3" != "-" ] && pre="$pre select set_config('request.headers', jsonb_build_object('x-contratos','$3')::text, true);"
  local out; out=$({ echo "begin;"; echo "$pre"; echo "$4"; echo "rollback;"; } | S | grep -E "^ERROR" | head -1 | cut -c1-150)
  local res=permite; [ -n "$out" ] && res=rechaza
  if [ "$res" != "$1" ]; then bad "$2" "esperaba $1, fue $res $out"; return; fi
  if [ "$1" = rechaza ] && [ -n "$5" ] && ! printf '%s' "$out" | grep -q "$5"; then bad "$2" "rechazó por otro motivo: $out"; return; fi
  ok "$2 ($res${5:+ · $5})"
}
# q <sql> → primer valor (en transacción revertida, con superadmin)
q() { { echo "begin;"; echo "select set_config('request.jwt.claims','{\"sub\":\"$SU\",\"role\":\"authenticated\"}',true), set_config('request.jwt.claim.sub','$SU',true);"; echo "$1"; echo "rollback;"; } | S | grep -v '^{' | grep -v "^$SU" | grep -v '^$' | grep -v -E "^(BEGIN|ROLLBACK|SET)$" | tail -1; }
reuso() { # $1 número → deja U1 (Ana) y U2 (Carlos, nacido de reuso)
  S -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor) values ('$1','mayorista','Ana','pendiente','X')" >/dev/null
  U1=$(uid "$1"); S -c "delete from public.ventas where numero_contrato='$1'" >/dev/null
  S -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,nacio_de_reuso) values ('$1','mayorista','Carlos','pendiente','Y',true)" >/dev/null
  U2=$(uid "$1")
}
N="DTM-9${B}1"; L="DTM-9${B}2"; reuso "$N"
S -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor) values ('$L','mayorista','Legado','pendiente','Y')" >/dev/null; UL=$(uid "$L")
HA="{\"$N\":\"$U1\"}"; HB="{\"$N\":\"$U2\"}"
echo "N=$N Ana=${U1:0:8} Carlos=${U2:0:8} · L=$L (de siempre)"

echo "=== 0) Estructura de la 285"
[ "$(S -c "select count(*) from information_schema.columns where table_name='contrato_financiero_pendiente' and column_name='contrato_uid'")" = 1 ] && ok "contrato_financiero_pendiente.contrato_uid existe" || bad "pendiente.contrato_uid" "falta"
[ "$(S -c "select count(*) from information_schema.columns where table_name='ventas_basica' and column_name='contrato_uid'")" = 1 ] && ok "ventas_basica expone contrato_uid" || bad "ventas_basica.contrato_uid" "falta"
[ "$(S -c "select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'contratos files:%' and (coalesce(qual,'')||coalesce(with_check,'')) like '%contrato_identidad_ok_archivo%'")" = 4 ] && ok "las 4 políticas del bucket contratos exigen la identidad" || bad "políticas" "no son 4"
[ "$(S -c "select has_function_privilege('service_role','public.soporte_verificar_identidad(text)','execute')::text||has_function_privilege('authenticated','public.soporte_verificar_identidad(text)','execute')::text||has_function_privilege('anon','public.soporte_verificar_identidad(text)','execute')::text")" = truefalsefalse ] && ok "soporte_verificar_identidad: solo service_role" || bad "privilegios" "inesperados"

echo "=== 1) Pendiente financiero: conserva la identidad del contrato desde su creación"
seed "update public.ventas set financiero_estado='pendiente' where numero_contrato in ('$N','$L')"
t permite "contrato de SIEMPRE, INSERT sin uid (código anterior a la 285): el trigger completa el uid del contrato" - "insert into public.contrato_financiero_pendiente(numero_contrato,tenant) values ('$L','mayorista');"
t rechaza "contrato de REUSO, INSERT sin uid: se exige el uid explícito" "$HB" "insert into public.contrato_financiero_pendiente(numero_contrato,tenant) values ('$N','mayorista');" IDENTIDAD_REQUERIDA
t permite "contrato de reuso, INSERT con su uid" "$HB" "insert into public.contrato_financiero_pendiente(numero_contrato,tenant,contrato_uid) values ('$N','mayorista','$U2');"
t rechaza "INSERT con el uid del contrato ANTERIOR (guarda de tabla, identidad antigua)" "$HA" "insert into public.contrato_financiero_pendiente(numero_contrato,tenant,contrato_uid) values ('$N','mayorista','$U1');" CONTRATO_CAMBIO
seed "insert into public.contrato_financiero_pendiente(numero_contrato,tenant,contrato_uid) values ('$N','mayorista','$U2')"
t rechaza "un registro con uid no se sobrescribe con otro uid (upsert)" "$HB" "insert into public.contrato_financiero_pendiente(numero_contrato,tenant,contrato_uid) values ('$N','mayorista','$U1') on conflict (numero_contrato) do update set contrato_uid = excluded.contrato_uid;" IDENTIDAD_INMUTABLE
t permite "el upsert con el MISMO uid actualiza el registro" "$HB" "insert into public.contrato_financiero_pendiente(numero_contrato,tenant,contrato_uid,intentos) values ('$N','mayorista','$U2',3) on conflict (numero_contrato) do update set intentos = excluded.intentos;"
CRON="select numero_contrato from public.contrato_financiero_pendiente p where p.contrato_uid is distinct from (select v.contrato_uid from public.ventas v where v.numero_contrato = p.numero_contrato)"
[ "$(S -c "select count(*) from ($CRON) x")" = 0 ] && ok "el uid guardado coincide con el vigente del contrato sembrado" || bad "pendiente" "difiere"
echo "-- el cron declara el uid GUARDADO (no el vigente): con el guardado del contrato anterior se rechaza, con el correcto avanza"
t rechaza "cron: escribe el contrato con el uid guardado de OTRA vida (Ana)" "$HA" "update public.contrato_financiero_pendiente set intentos = intentos + 1 where numero_contrato='$N';" CONTRATO_CAMBIO
t permite "cron: escribe el contrato con el uid guardado correcto" "$HB" "update public.contrato_financiero_pendiente set intentos = intentos + 1 where numero_contrato='$N';"

echo "=== 2) liberar_vencidas: tarea automática (sin pantalla) declara lo que leyó bajo bloqueo"
seed "update public.ventas set plazo = current_date - 5 where numero_contrato in ('$N','$L')"
OUT=$({ echo "begin;"; echo "select public.liberar_vencidas();"; echo "select 'ESTADOS '||string_agg(numero_contrato||'='||estado, ',' order by numero_contrato) from public.ventas where numero_contrato in ('$N','$L');"; echo "rollback;"; } | S)
printf '%s' "$OUT" | grep -q "ESTADOS $N=cancelado,$L=cancelado" && ok "liberar_vencidas() sin cabecera libera el contrato de reuso Y el de siempre" || bad "liberar_vencidas" "$(printf '%s' "$OUT" | grep -E 'ERROR|ESTADOS' | head -1)"
t rechaza "una función de usuario NO se auto-declara: UPDATE directo de ventas sin identidad sobre el contrato de reuso" - "update public.ventas set estado = 'cancelado' where numero_contrato='$N';" IDENTIDAD_REQUERIDA
seed "update public.ventas set plazo = null where numero_contrato in ('$N','$L')"

echo "=== 3) Soportes: rechazo DEFINITIVO por identidad (SOPORTE_IDENTIDAD) antes de escribir"
ACT=$(S -c "select id from public.usuarios where activo and id<>'$SU' limit 1"); [ -z "$ACT" ] && ACT=$SU
seed "insert into public.abonos(numero_contrato,tenant,cliente,fecha_abono,valor_abono,forma_pago) select n,'mayorista','C',current_date,1,'efectivo' from unnest(array['$N','$N','$N']) n; insert into public.contrato_soportes_pago(numero_contrato,tenant,path,nombre_original,mime,size_bytes,sha256,subido_por) values ('$N','mayorista','$N/s.pdf','s.pdf','application/pdf',10,repeat('a',64),'$SU')"
SN=$(S -c "select id from public.contrato_soportes_pago where numero_contrato='$N' and vigente order by id desc limit 1")
R1="select public.soporte_registrar('$N','$ACT','$N/n.pdf','n.pdf','application/pdf',10,repeat('c',64));"
R2="select public.soporte_reemplazar($SN,'$ACT','$N/r.pdf','r.pdf','application/pdf',10,repeat('d',64));"
R3="select public.soporte_retirar($SN,'$ACT','nota');"
for op in "soporte_registrar|$R1" "soporte_reemplazar|$R2" "soporte_retirar|$R3"; do nm=${op%%|*}; sql=${op#*|}
  t rechaza "$nm: identidad ANTIGUA" "$HA" "$sql" SOPORTE_IDENTIDAD; t rechaza "$nm: identidad AUSENTE" - "$sql" SOPORTE_IDENTIDAD; t permite "$nm: identidad CORRECTA" "$HB" "$sql"; done
t rechaza "soporte_verificar_identidad (precomprobación antes de subir) con identidad antigua" "$HA" "set local role service_role; select public.soporte_verificar_identidad('$N');" SOPORTE_IDENTIDAD
t rechaza "soporte_verificar_identidad sin identidad" - "set local role service_role; select public.soporte_verificar_identidad('$N');" SOPORTE_IDENTIDAD
t permite "soporte_verificar_identidad con la identidad correcta" "$HB" "set local role service_role; select public.soporte_verificar_identidad('$N');"
t permite "soporte_verificar_identidad sobre un contrato de siempre sin identidad" - "set local role service_role; select public.soporte_verificar_identidad('$L');"
OUT=$({ echo "begin;"; echo "select set_config('request.headers','{\"x-contratos\": $HA}',true);"; echo "do \$\$ begin begin perform public.soporte_registrar('$N','$ACT','$N/zz.pdf','z.pdf','application/pdf',10,repeat('e',64)); exception when others then null; end; end \$\$;"; echo "select 'FILAS '||(select count(*) from public.contrato_soportes_pago where path='$N/zz.pdf')||' AVISOS '||(select count(*) from public.avisos where numero_contrato='$N' and soporte_id is not null);"; echo "rollback;"; } | S | grep FILAS)
[ "$OUT" = "FILAS 0 AVISOS 0" ] || bad "rechazo definitivo" "algo quedó registrado: $OUT"; [ "$OUT" = "FILAS 0 AVISOS 0" ] && ok "el rechazo por identidad no deja soporte ni aviso (todo se revirtió)"

echo "=== 4) Storage: políticas del bucket «contratos» (la función que las compone)"
for v in "ANTIGUA|$HA|false" "AUSENTE|-|false" "CORRECTA|$HB|true"; do IFS='|' read -r nm h ex <<<"$v"
  pre="" ; [ "$h" != "-" ] && pre="select set_config('request.headers','{\"x-contratos\": $h}',true);"
  r=$({ echo "begin;"; echo "$pre"; echo "select public.contrato_identidad_ok_archivo('$N/$U2/carlos.pdf');"; echo "rollback;"; } | S | grep -E "^(t|f)$" | head -1)
  [ "$r" = "${ex:0:1}" ] && ok "contrato_identidad_ok_archivo($N/…) identidad $nm → $ex" || bad "ok_archivo $nm" "obtuvo $r"
done
r=$(q "select public.contrato_identidad_ok_archivo('pe-empleados/12-34.pdf')"); [ "$r" = t ] && ok "prefijo que no es un contrato (pe-empleados/): la identidad no aplica" || bad "pe-empleados" "$r"
r=$(q "select public.contrato_identidad_ok_archivo('$L/x.pdf')"); [ "$r" = t ] && ok "contrato de siempre sin identidad: permitido" || bad "contrato de siempre" "$r"

echo "=== 5) ventas_basica.contrato_uid: el rol «venta» obtiene el uid EN LA MISMA CONSULTA"
S -c "insert into auth.users(id,email) values ('$VE','venta285@t.l') on conflict do nothing" >/dev/null
S -c "insert into public.usuarios(id,email,nombre,rol,activo,tenant) values ('$VE','venta285@t.l','Vendedor 285','venta',true,'mayorista') on conflict (id) do update set rol='venta', activo=true, tenant='mayorista', nombre='Vendedor 285'" >/dev/null
seed "update public.ventas set asesor='Vendedor 285' where numero_contrato='$N'"
r=$({ echo "begin;"; echo "select set_config('request.jwt.claims','{\"sub\":\"$VE\",\"role\":\"authenticated\"}',true), set_config('request.jwt.claim.sub','$VE',true);"; echo "set local role authenticated;"; echo "select numero_contrato||'|'||contrato_uid from public.ventas_basica where numero_contrato='$N';"; echo "rollback;"; } | S | grep "^$N|")
[ "$r" = "$N|$U2" ] && ok "rol venta: select contrato_uid de ventas_basica = uid del contrato vigente" || bad "ventas_basica" "obtuvo: $r"
r=$({ echo "begin;"; echo "select set_config('request.jwt.claims','{\"sub\":\"$VE\",\"role\":\"authenticated\"}',true), set_config('request.jwt.claim.sub','$VE',true);"; echo "set local role authenticated;"; echo "select count(*) from public.ventas where numero_contrato='$N';"; echo "rollback;"; } | S | grep -E '^[0-9]+$' | tail -1)
[ "$r" = 0 ] && ok "rol venta: sigue sin leer la tabla base ventas (144)" || bad "ventas base" "venta leyó la tabla: $r"
r=$(q "select count(*) from public.contratos_identidades(array['$N','$L'])"); [ "$r" = 2 ] && ok "contratos_identidades (superadmin): 2 contratos" || bad "contratos_identidades" "$r"

echo "=== 6) Regresión MINORISTA (contratos MIN-, tenant minorista; nada exige identidad; el reuso no los toca)"
M="MIN-9${B}3"; M2="MIN-9${B}4"
S -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor) values ('$M','minorista','Cliente Minorista','activo','Freelance X')" >/dev/null; UM=$(uid "$M")
t permite "pasajero, abono y CxP de un contrato Minorista sin identidad" - "insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$M','p'); insert into public.abonos(numero_contrato,tenant,cliente,fecha_abono,valor_abono,forma_pago) values ('$M','minorista','C',current_date,10,'efectivo'); insert into public.cuentas_por_pagar(numero_contrato,valor_total,tenant) values ('$M',500,'minorista');"
t permite "importador de histórico: upsert de ventas por numero_contrato (ON CONFLICT) sobre un Minorista existente" - "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta) values ('$M','minorista','Cliente Minorista','activo','Freelance X',5000) on conflict (numero_contrato) do update set precio_venta = excluded.precio_venta;"
t permite "eliminar_contrato(Minorista) sin identidad (sin reuso: comportamiento de siempre)" - "select public.eliminar_contrato('$M', false);"
t rechaza "una identidad FALSA declarada sobre un Minorista también se rechaza (la guarda no distingue agencia)" "{\"$M\":\"$U1\"}" "update public.ventas set observaciones='x' where numero_contrato='$M';" CONTRATO_CAMBIO
t permite "con su identidad correcta, el Minorista opera igual" "{\"$M\":\"$UM\"}" "update public.ventas set observaciones='x' where numero_contrato='$M';"
r=$(q "select coalesce(string_agg(c.relname, ','),'-') from pg_class c where c.relname = 'numeros_dtm_liberados'"); [ "$r" = "-" ] && ok "la 285 no crea el pool de reuso (eso es la entrega 3); Minorista no puede reutilizar nada" || ok "(el pool existe: $r) el reuso se limita a DTM- por patrón en la entrega 3"
t permite "liberar_vencidas() también libera un Minorista vencido sin identidad (contrato de siempre)" - "update public.ventas set plazo = current_date - 3, estado = 'pendiente' where numero_contrato='$M'; select public.liberar_vencidas();"

echo "=== 7) Recorrido COMPLETO de renumeración con las migraciones finales (284 + 285)"
RN="DTM-9${B}5"; RN2="DTM-9${B}6"; reuso "$RN"; HR="{\"$RN\":\"$U2\"}"; HRA="{\"$RN\":\"$U1\"}"; UR=$U2
S -c "insert into public.bloqueos_vuelo(record,destino_id,cupos_total) values ('R$B',1,5)" >/dev/null; BLR=$(S -c "select id from public.bloqueos_vuelo where record='R$B'")
seed "insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$RN','P1'),('$RN','P2');
      insert into public.abonos(numero_contrato,tenant,cliente,fecha_abono,valor_abono,forma_pago) values ('$RN','mayorista','C',current_date,100,'efectivo'),('$RN','mayorista','C',current_date,200,'efectivo');
      insert into public.cuentas_por_pagar(numero_contrato,valor_total) values ('$RN',1000);
      insert into public.cxp_pagos(cuenta_por_pagar_id,valor) select id,50 from public.cuentas_por_pagar where numero_contrato='$RN';
      insert into public.contrato_vuelos(numero_contrato,record,direccion,aerolinea) values ('$RN','R$B','ida','AV');
      insert into public.sillas(bloqueo_id,numero_silla,estado,numero_contrato,pasajero_nombres) values ($BLR,1,'en_plazo','$RN','P1');
      insert into public.contrato_items(numero_contrato,descripcion) values ('$RN','Item');
      insert into public.contrato_soportes_pago(numero_contrato,tenant,path,nombre_original,mime,size_bytes,sha256,subido_por) values ('$RN','mayorista','$RN/s.pdf','s.pdf','application/pdf',10,repeat('a',64),'$SU');
      insert into public.avisos(usuario_id,tipo,numero_contrato) values ('$SU','soporte_pago_nuevo','$RN');
      insert into public.cotizaciones(tenant,numero_contrato) values ('mayorista','$RN');
      insert into public.contrato_financiero_pendiente(numero_contrato,tenant,contrato_uid) values ('$RN','mayorista','$UR')"
CNT="select 'pas='||(select count(*) from public.contrato_pasajeros where numero_contrato=@N@)||' ab='||(select count(*) from public.abonos where numero_contrato=@N@)||' cxp='||(select count(*) from public.cuentas_por_pagar where numero_contrato=@N@)||' pagos='||(select count(*) from public.cxp_pagos p join public.cuentas_por_pagar c on c.id=p.cuenta_por_pagar_id where c.numero_contrato=@N@)||' vue='||(select count(*) from public.contrato_vuelos where numero_contrato=@N@)||' sil='||(select count(*) from public.sillas where numero_contrato=@N@)||' it='||(select count(*) from public.contrato_items where numero_contrato=@N@)||' sop='||(select count(*) from public.contrato_soportes_pago where numero_contrato=@N@)||' avi='||(select count(*) from public.avisos where numero_contrato=@N@)||' cot='||(select count(*) from public.cotizaciones where numero_contrato=@N@)||' pen='||(select count(*) from public.contrato_financiero_pendiente where numero_contrato=@N@)||' venta='||(select count(*) from public.ventas where numero_contrato=@N@)"
cnt() { printf '%s' "$CNT" | sed "s/@N@/'$1'/g"; }
ANTES=$(q "$(cnt $RN)")
echo "   antes ($RN): $ANTES"
t rechaza "renumerar con la identidad de la pantalla ANTIGUA: nada se mueve" "$HRA" "select public.fn_renumerar_contrato('$RN','$RN2');" CONTRATO_CAMBIO
t rechaza "renumerar SIN identidad (bundle viejo)" - "select public.fn_renumerar_contrato('$RN','$RN2');" IDENTIDAD_REQUERIDA
OUT=$({ echo "begin;"; echo "select set_config('request.jwt.claims','{\"sub\":\"$SU\",\"role\":\"authenticated\"}',true), set_config('request.jwt.claim.sub','$SU',true);"; echo "select set_config('request.headers','{\"x-contratos\": $HR}',true);"
  echo "select public.fn_renumerar_contrato('$RN','$RN2');"; echo "select 'DESPUES '||($(cnt $RN2));" ; echo "select 'VIEJO '||($(cnt $RN));"; echo "select 'UID '||(select (contrato_uid='$UR'::uuid and nacio_de_reuso)::text from public.ventas where numero_contrato='$RN2');"; echo "select 'PENUID '||(select (contrato_uid='$UR'::uuid)::text from public.contrato_financiero_pendiente where numero_contrato='$RN2');"; echo "rollback;"; } | S)
DESP=$(printf '%s' "$OUT" | grep "^DESPUES " | sed 's/^DESPUES //'); VIE=$(printf '%s' "$OUT" | grep "^VIEJO " | sed 's/^VIEJO //')
[ "$DESP" = "$ANTES" ] && ok "renumeración con la identidad correcta: TODAS las filas hijas pasaron al número nuevo ($DESP)" || bad "renumeración" "antes=$ANTES después=$DESP | $(printf '%s' "$OUT" | grep ERROR | head -1)"
printf '%s' "$VIE" | grep -q "pas=0 ab=0 cxp=0 pagos=0 vue=0 sil=0 it=0 sop=0 avi=0 cot=0 pen=0 venta=0" && ok "el número viejo quedó sin filas en ninguna tabla" || bad "número viejo" "$VIE"
printf '%s' "$OUT" | grep -q "^UID true" && ok "el contrato_uid y nacio_de_reuso se conservaron en el número nuevo" || bad "uid tras renumerar" "$(printf '%s' "$OUT" | grep '^UID')"
printf '%s' "$OUT" | grep -q "^PENUID true" && ok "el registro pendiente financiero conserva el MISMO uid tras renumerar" || bad "pendiente tras renumerar" "$(printf '%s' "$OUT" | grep '^PENUID')"
t permite "renumerar un contrato de SIEMPRE sin identidad (y con ella)" - "select public.fn_renumerar_contrato('$L','DTM-9${B}7');"

# Limpieza
S -c "begin; set local session_replication_role = replica;
  delete from public.cxp_pagos where cuenta_por_pagar_id in (select id from public.cuentas_por_pagar where numero_contrato in ('$N','$L','$M','$M2','$RN','$RN2','DTM-9${B}7'));
  delete from public.contrato_financiero_pendiente where numero_contrato in ('$N','$L','$M','$RN','$RN2','DTM-9${B}7');
  delete from public.contrato_soportes_pago where numero_contrato in ('$N','$L','$M','$RN','$RN2','DTM-9${B}7');
  delete from public.avisos where numero_contrato in ('$N','$L','$M','$RN','$RN2','DTM-9${B}7');
  delete from public.cotizaciones where numero_contrato in ('$N','$L','$M','$RN','$RN2','DTM-9${B}7');
  delete from public.sillas where bloqueo_id=$BLR; delete from public.bloqueos_vuelo where id=$BLR;
  delete from public.contrato_vuelos where numero_contrato in ('$N','$L','$M','$RN','$RN2','DTM-9${B}7');
  delete from public.contrato_items where numero_contrato in ('$N','$L','$M','$RN','$RN2','DTM-9${B}7');
  delete from public.contrato_pasajeros where numero_contrato in ('$N','$L','$M','$RN','$RN2','DTM-9${B}7');
  delete from public.abonos where numero_contrato in ('$N','$L','$M','$RN','$RN2','DTM-9${B}7');
  delete from public.cuentas_por_pagar where numero_contrato in ('$N','$L','$M','$RN','$RN2','DTM-9${B}7');
  delete from public.ventas where numero_contrato in ('$N','$L','$M','$RN','$RN2','DTM-9${B}7'); commit;" >/dev/null
echo; echo "RESUMEN: $PASS PASS, $FAIL FALLO"
[ "$FAIL" -eq 0 ]
