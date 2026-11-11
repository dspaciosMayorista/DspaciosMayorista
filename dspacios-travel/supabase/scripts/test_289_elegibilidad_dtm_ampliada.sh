#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
# PRUEBAS de la migración 287 (#75): reutilización de consecutivos DTM de contratos pendientes/vacíos.
#
# Uso:  sh supabase/scripts/test_289_elegibilidad_dtm_ampliada.sh <contenedor> [base]
#   · <contenedor>: Postgres local DESECHABLE con el esquema hasta la 281 y la 287 YA aplicada (ver
#     preparar_esquema_local.sh; la imagen local necesita storage.buckets.file_size_limit/allowed_mime_types).
#   · Crea usuarios y contratos de prueba con números DTM-91xx / MIN-91xx. NUNCA contra producción.
# Imprime PASS/FALLO por caso y un resumen; termina con código 1 si algo falla.
# ──────────────────────────────────────────────────────────────────────────────
CT="${1:?uso: test_289_elegibilidad_dtm_ampliada.sh <contenedor> [base]}"
DB="${2:-postgres}"
export MSYS_NO_PATHCONV=1
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo 0 > "$TMP/pass"; echo 0 > "$TMP/fail"

S() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=0 -d "$DB" "$@" 2>&1; }
SU='aaaaaaaa-1111-1111-1111-111111111111'; GE='cccccccc-3333-3333-3333-333333333333'; AG='dddddddd-4444-4444-4444-444444444444'
claims() { echo "select set_config('request.jwt.claims','{\"sub\":\"$1\",\"role\":\"authenticated\"}',false), set_config('request.jwt.claim.sub','$1',false);"; }
# Q <sql>      → ejecuta como el superadmin (función SECURITY DEFINER; sin RLS por ser dueño de la sesión)
Q()  { { claims "$SU"; echo "$1"; } | S | grep -v '^{' | grep -v "^$SU" | grep -v '^$'; }
# QR <uuid> <sql> → ejecuta con RLS real: rol authenticated + claims del usuario
QR() { { claims "$1"; echo "set role authenticated;"; echo "$2;"; echo "reset role;"; } | S | grep -v '^{' | grep -v "^$1" | grep -v '^SET$' | grep -v '^RESET$' | grep -v '^$'; }
ok()   { _c=$(cat "$TMP/pass"); echo $((_c+1)) > "$TMP/pass"; echo "PASS  $1"; }
bad()  { _c=$(cat "$TMP/fail"); echo $((_c+1)) > "$TMP/fail"; echo "FALLO $1  ->  $2"; }
# expect <descripcion> <real> <regex>
expect() { if printf '%s' "$2" | grep -Eq "$3"; then ok "$1"; else bad "$1" "esperaba /$3/, obtuve: $(printf '%s' "$2" | tr '\n' ' ' | cut -c1-220)"; fi; }
expect_not() { if printf '%s' "$2" | grep -Eq "$3"; then bad "$1" "NO debía coincidir /$3/: $(printf '%s' "$2" | tr '\n' ' ' | cut -c1-220)"; else ok "$1"; fi; }
# mk <numero>   → contrato pendiente que solo tiene al titular
mk() { Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,cliente_documento,cliente_telefono,cliente_email,canal,tipo_cliente) values ('$1','mayorista','Titular $1','pendiente','Asesor X','123456','3001112233','t@x.co','B2C','persona');" >/dev/null; }
existe() { Q "select count(*) from public.ventas where numero_contrato='$1'"; }
pool()   { Q "select coalesce(string_agg(numero||'/'||estado, ','), '-') from public.numeros_dtm_liberados"; }
setup() {
  S -c "insert into auth.users(id,email) values ('$SU','s@t.l'),('$GE','g@t.l'),('$AG','a@t.l') on conflict do nothing" \
    -c "insert into public.usuarios(id,email,nombre,rol,activo,tenant) values ('$SU','s@t.l','Super','superadmin',true,'mayorista'),('$GE','g@t.l','Gerente','gerencia',true,'mayorista'),('$AG','a@t.l','Agencia','agencia',true,'mayorista') on conflict (id) do update set rol=excluded.rol,activo=true,tenant='mayorista'" >/dev/null
  S -c "insert into storage.buckets(id,name,public) values ('contratos','contratos',false) on conflict do nothing" >/dev/null
  # Limpieza de corridas anteriores (números de prueba DTM-9xxx / MIN-9xxx): permite repetir el script en la misma base.
  { claims "$SU"; cat <<SQL
set session_replication_role = replica;
delete from public.contrato_soportes_pago where numero_contrato ~ '^(DTM-10000|(DTM|MIN)-9)';
delete from public.avisos where numero_contrato ~ '^(DTM-10000|(DTM|MIN)-9)';
delete from public.persona_capturas where contrato_numero ~ '^(DTM-10000|(DTM|MIN)-9)';
delete from public.sillas where numero_contrato ~ '^(DTM-10000|(DTM|MIN)-9)';
delete from public.abonos_anulados where numero_contrato ~ '^(DTM-10000|(DTM|MIN)-9)';
delete from storage.objects where name ~ '^(DTM-10000|(DTM|MIN)-9)';
delete from public.asientos_contables where descripcion ~ '(DTM-10000|(DTM|MIN)-9)';
set session_replication_role = origin;
select public.eliminar_contrato(numero_contrato, false) from public.ventas where numero_contrato ~ '^(DTM-10000|(DTM|MIN)-9[0-9]{3})\$';
delete from public.numeros_contrato_liberados where numero ~ '^MIN-9';
truncate public.numeros_dtm_liberados;
drop table if exists public.zz_lectura_fallida;
SQL
  } | S >/dev/null
}
setup

# Banco de pruebas: HABILITA el reuso para ejercitar la elegibilidad y lo deja apagado al final.
S -c "update public.dtm_reuso_config set habilitado = true" >/dev/null
S -c "insert into public.bloqueos_vuelo(record) values ('ZZ289') on conflict do nothing" >/dev/null
BQ=$(Q "select id from public.bloqueos_vuelo where record='ZZ289'")
sin() { Q "select coalesce(nullif(array_to_string(public.contrato_reuso_preview('$1'),','),''),'SIN_MOTIVOS')"; }
cnt() { Q "select count(*) from public.$1 where $2"; }

echo "=== 1) Contrato PENDIENTE con TODA la preparación: es elegible, se elimina y libera"
N1=DTM-9301
mk $N1
Q "update public.ventas set destino='CARTAGENA', tipo_paquete='porcion', fecha_salida=current_date+30, fecha_regreso=current_date+34, hotel='Hotel X', aerolinea='AV', receptivo='R', asistencia='A',
     precio_venta=3000000, costo_hotel=1000000, costo_aereo=500000, costo_receptivo=100000, costo_asistencia=50000, otros_costos=10000, plan_nombre='Plan', tours_traslados='t', impuesto=1000,
     comision_b2b=100000, comision_estado='descontada', recobro_total=5000, trm_contrato=4000, moneda_cobro='COP', total_cobro=3000000 where numero_contrato='$N1'" >/dev/null
Q "insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$N1','Pasajero');
   insert into public.contrato_hoteles(numero_contrato,nombre) values ('$N1','Hotel X');
   insert into public.contrato_items(numero_contrato,descripcion) values ('$N1','Item');
   insert into public.contrato_servicios(numero_contrato,descripcion) values ('$N1','Traslado');
   insert into public.contrato_vuelos(numero_contrato) values ('$N1');
   insert into public.contrato_vuelo_control(numero_contrato) values ('$N1');
   insert into public.cuotas(numero_contrato,orden,tipo,fecha_limite,monto) values ('$N1',1,'abono',current_date,1000);
   insert into public.rentabilidad(numero_contrato) values ('$N1');
   insert into public.contrato_obligaciones_previstas(numero_contrato,clase,clave,payload) values ('$N1','cxp','hotel:1','{\"valor_total\":1000}'::jsonb);
   insert into public.aliados_b2b(numero_contrato,descontada_en_precio,estado) values ('$N1',true,'pagada');" >/dev/null
Q "set session_replication_role = replica; insert into public.avisos(usuario_id,tipo,numero_contrato) values ('$SU','soporte_pago_nuevo','$N1'); set session_replication_role = origin;" >/dev/null
Q "set session_replication_role = replica; insert into public.sillas(bloqueo_id, numero_silla, numero_contrato, estado, pasajero_nombres) values ($BQ,1,'$N1','en_plazo','Pasajero'); set session_replication_role = origin;" >/dev/null
Q "insert into public.cotizaciones(tenant,tipo,modo,numero_contrato,estado) values ('mayorista','manual','simple','$N1','convertida')" >/dev/null
COT=$(Q "select id from public.cotizaciones where numero_contrato='$N1'")
UID_VIEJO=$(Q "select contrato_uid from public.ventas where numero_contrato='$N1'")
AUD_ANTES=$(Q "select count(*) from public.auditoria where registro_id='$N1'")
expect "vista previa: la preparación completa NO bloquea" "$(sin $N1)" '^SIN_MOTIVOS$'
Q "select public.eliminar_contrato('$N1', true)" >/dev/null
expect "la venta ya no existe y el número quedó DISPONIBLE (atómico)" "$(existe $N1)|$(pool)" '^0\|DTM-9301/disponible$'
for t in contrato_pasajeros contrato_hoteles contrato_items contrato_servicios contrato_vuelos contrato_vuelo_control cuotas rentabilidad contrato_obligaciones_previstas aliados_b2b avisos; do
  expect "sin residuos en $t" "$(cnt $t "numero_contrato='$N1'")" '^0$'
done
expect "sin residuos en sillas con el contrato" "$(cnt sillas "numero_contrato='$N1'")" '^0$'
expect "silla en plazo LIBERADA: vuelve a disponible, sin contrato ni pasajero" "$(Q "select estado||'|'||coalesce(numero_contrato,'-')||'|'||coalesce(pasajero_nombres,'-') from public.sillas where bloqueo_id=$BQ and numero_silla=1")" '^disponible\|-\|-$'
expect "cotización DESVINCULADA: abierta y sin número (no apunta al contrato borrado)" "$(Q "select estado||'|'||coalesce(numero_contrato,'-') from public.cotizaciones where id=$COT")" '^abierta\|-$'
AUD_DESPUES=$(Q "select count(*) from public.auditoria where registro_id='$N1'")
[ "$AUD_DESPUES" -ge "$AUD_ANTES" ] && ok "auditoría conservada ($AUD_ANTES -> $AUD_DESPUES)" || bad "auditoría conservada" "$AUD_ANTES -> $AUD_DESPUES"

echo "=== 2) El contrato SIGUIENTE (mismo número) no hereda nada"
RES=$(Q "select numero||' '||coalesce(token::text,'NULL') from public.reservar_numero_contrato('mayorista')")
N=$(printf '%s' "$RES" | cut -d' ' -f1); T=$(printf '%s' "$RES" | cut -d' ' -f2)
expect "reservar devuelve el mismo DTM con ticket" "$RES" '^DTM-9301 [0-9a-f-]{36}$'
Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$N','$T','mayorista','Cliente B (otro)','pendiente','Asesor Y')" >/dev/null
expect "el nuevo contrato existe con otra identidad interna (uid distinto)" "$(Q "select (contrato_uid <> '$UID_VIEJO'::uuid)::text from public.ventas where numero_contrato='$N'")" '^true$'
HER=0; for t in contrato_pasajeros contrato_hoteles contrato_items contrato_servicios contrato_vuelos contrato_vuelo_control cuotas rentabilidad contrato_obligaciones_previstas aliados_b2b avisos cuentas_por_pagar abonos facturacion; do HER=$((HER+$(cnt $t "numero_contrato='$N'"))); done
expect "ninguna fila heredada en las tablas hijas" "$HER" '^0$'
expect "la silla liberada NO volvió al contrato nuevo" "$(cnt sillas "numero_contrato='$N'")" '^0$'
expect "la cotización antigua sigue abierta y sin número" "$(Q "select estado||'|'||coalesce(numero_contrato,'-') from public.cotizaciones where id=$COT")" '^abierta\|-$'
expect "los campos comerciales del contrato nuevo están vacíos" "$(Q "select coalesce(precio_venta,0)||'|'||coalesce(hotel,'-')||'|'||coalesce(comision_estado,'-')||'|'||coalesce(destino,'-') from public.ventas where numero_contrato='$N'")" '^0(\.00)?\|-\|-\|-$'
Q "select public.eliminar_contrato('$N', false)" >/dev/null; Q "delete from public.numeros_dtm_liberados" >/dev/null

echo "=== 3) Cada COMPROMISO REAL bloquea, sin cambiar nada"
SEQ=9400
caso() { # caso <CODIGO> <sql con N>
  SEQ=$((SEQ+1)); n="DTM-$SEQ"; mk "$n"
  Q "$(printf '%s' "$2" | sed "s/N/$n/g")" >/dev/null
  r=$(Q "select public.eliminar_contrato('$n', true)")
  expect "bloquea: $1" "$r" "REUSO_NO_ELEGIBLE.*$1"
  expect "   · sigue existiendo y el pool no cambió" "$(existe $n)|$(pool)" '^1\|-$'
}
caso RELACION_ABONOS "insert into public.abonos(numero_contrato,tenant,cliente,fecha_abono,valor_abono,forma_pago) values ('N','mayorista','C',current_date,1,'efectivo');"
caso RELACION_ABONOS_ANULADOS "insert into public.abonos_anulados(abono_id,numero_contrato,tenant,abono,motivo,actor_id) values (floor(random()*1e9)::bigint+1000,'N','mayorista','{}'::jsonb,'prueba','$SU');"
caso RELACION_FACTURACION "insert into public.facturacion(numero_contrato) values ('N');"
caso RELACION_VOUCHERS "insert into public.vouchers(numero_contrato,contenido) values ('N','{}'::jsonb);"
caso RELACION_CONTRATO_ADJUNTOS "insert into public.contrato_adjuntos(numero_contrato,path) values ('N','N/x.pdf');"
caso RELACION_CONTRATO_SOPORTES_PAGO "set session_replication_role = replica; insert into public.contrato_soportes_pago(numero_contrato,tenant,path,nombre_original,mime,size_bytes,sha256,subido_por) values ('N','mayorista','N/s.pdf','s.pdf','application/pdf',10,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','$SU'); set session_replication_role = origin;"
caso ARCHIVOS_EN_STORAGE "insert into storage.objects(bucket_id,name) values ('contratos','N/id.pdf');"
caso ASIENTOS_CONTABLES "insert into public.asientos_contables(numero,descripcion,tenant) values ((select coalesce(max(numero),0)+1 from public.asientos_contables),'Anticipo del contrato N','mayorista');"
caso RELACION_PERSONA_CAPTURAS "set session_replication_role = replica; insert into public.persona_capturas(id,persona_id,tenant,fuente,nivel,contrato_numero,contrato_pasajero_id) values (gen_random_uuid(),gen_random_uuid(),'mayorista','contrato_pasajero','pasajero_contrato','N',1); set session_replication_role = origin;"
caso SILLAS_NO_LIBERABLES "set session_replication_role = replica; insert into public.sillas(bloqueo_id, numero_silla, numero_contrato, estado) values ($BQ,2,'N','confirmada'); set session_replication_role = origin;"
caso VUELO_EMITIDO "insert into public.contrato_vuelo_control(numero_contrato, estado_emision) values ('N','emitido');"
caso FACTURACION_EMITIDA "set session_replication_role = replica; insert into public.contrato_facturacion(numero_contrato, dian_emitida) values ('N', true); set session_replication_role = origin;"
caso COMISION_EXIGIBLE "insert into public.aliados_b2b(numero_contrato) values ('N');"
caso CXP_CON_PAGOS "insert into public.cuentas_por_pagar(numero_contrato,valor_total) values ('N',1000); insert into public.cxp_pagos(cuenta_por_pagar_id,valor) select id,100 from public.cuentas_por_pagar where numero_contrato='N';"
caso ESTADO_ACTUAL_CONFIRMADO "select public.confirmar_venta('N');"
caso ESTADO_DISTINTO_DE_PENDIENTE_EN_HISTORIA "select public.confirmar_venta('N'); update public.ventas set estado='pendiente' where numero_contrato='N';"
caso CAMPO_COMERCIAL_FACTURADO "update public.ventas set facturado=true where numero_contrato='N';"
caso FINANCIERO_INCOMPLETO "update public.ventas set financiero_estado='pendiente' where numero_contrato='N';"
caso REFERENCIA_MANUAL_EN_SILLA "set session_replication_role = replica; insert into public.sillas(bloqueo_id, contrato_manual) values (1,'N'); set session_replication_role = origin;"

echo "=== 4) CxP sin pagos: obligación no ejecutada (se borra); tablas sin clasificar siguen bloqueando"
SEQ=$((SEQ+1)); n="DTM-$SEQ"; mk "$n"; Q "insert into public.cuentas_por_pagar(numero_contrato,valor_total) values ('$n',1000)" >/dev/null
expect "CxP sin pagos ni retenciones no bloquea" "$(sin $n)" '^SIN_MOTIVOS$'
Q "select public.eliminar_contrato('$n', true)" >/dev/null
expect "y se eliminó con el contrato" "$(existe $n)|$(cnt cuentas_por_pagar "numero_contrato='$n'")" '^0\|0$'
Q "delete from public.numeros_dtm_liberados" >/dev/null
S -c "create table public.zz_tabla_nueva(numero_contrato text)" >/dev/null
SEQ=$((SEQ+1)); n="DTM-$SEQ"; mk "$n"; Q "insert into public.zz_tabla_nueva values ('$n')" >/dev/null
expect "una tabla FUTURA sin clasificar con filas del contrato BLOQUEA (falla cerrado)" "$(sin $n)" 'RELACION_ZZ_TABLA_NUEVA'
S -c "drop table public.zz_tabla_nueva" >/dev/null
S -c "create table public.zz_lectura_fallida(numero_contrato uuid)" >/dev/null
SEQ=$((SEQ+1)); n="DTM-$SEQ"; mk "$n"
expect "lectura fallida de una tabla sin clasificar BLOQUEA" "$(sin $n)" 'LECTURA_FALLIDA_ZZ_LECTURA_FALLIDA'
S -c "drop table public.zz_lectura_fallida" >/dev/null

echo "=== 5) Atomicidad: si la liberación falla, NO se elimina ni se libera nada"
SEQ=$((SEQ+1)); n="DTM-$SEQ"; mk "$n"
Q "insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$n','P'); set session_replication_role = replica; insert into public.sillas(bloqueo_id, numero_silla, numero_contrato, estado) values ($BQ,3,'$n','en_plazo'); set session_replication_role = origin;" >/dev/null
S -c "insert into public.numeros_dtm_liberados(numero) values ('$n')" >/dev/null
R=$(Q "select public.eliminar_contrato('$n', true)")
expect "falla (clave duplicada en el pool)" "$R" 'duplicate key|ERROR'
expect "el contrato, el pasajero y la silla siguen intactos (rollback completo)" "$(existe $n)|$(cnt contrato_pasajeros "numero_contrato='$n'")|$(cnt sillas "numero_contrato='$n' and estado='en_plazo'")" '^1\|1\|1$'
Q "delete from public.numeros_dtm_liberados" >/dev/null

echo "=== 6) Plan de comisión de #97 con la 286 REAL (versión LIBERACION_PLAN_V2): por contrato_uid, no materializado, cotización conservada"
if [ "$(Q "select (to_regclass('public.comision_plan') is not null)::text")" = "true" ]; then
  Q "insert into public.aliados(nombre) select 'Aliado 289' where not exists (select 1 from public.aliados)" >/dev/null; ALI=$(Q "select id from public.aliados order by id limit 1")
  PL() { # PL <cotizacion|NULL> <'numero'|NULL> <'uid'|NULL> <version>
    Q "insert into public.comision_plan(aliado_id,tipo_asesor,cotizacion_id,numero_contrato,contrato_uid,version,tenant,economico_rev,moneda,pvp_total,bnc,recobro_total,recobro_aliado,base_comision,pct_comision,pct_origen,comision_ordinaria,total_aliado)
       values ($ALI,'freelance',$1,$2,$3,$4,'mayorista',1,'COP',1,0,0,0,1,0,'defecto',0,0)"; }
  VER=$(Q "select coalesce(obj_description('p97_priv.tg_solo_insercion()'::regprocedure,'pg_proc'),'-')")
  expect "la 286 aplicada trae la versión esperada del trigger (LIBERACION_PLAN_V2)" "$VER" '^LIBERACION_PLAN_V2:'

  echo "-- 6a) pendiente con plan (cotización + copia del contrato + evidencia de OTRA vida del mismo número)"
  SEQ=$((SEQ+1)); n="DTM-$SEQ"; mk "$n"
  U1=$(Q "select contrato_uid from public.ventas where numero_contrato='$n'"); U0=$(Q "select gen_random_uuid()")
  Q "insert into public.cotizaciones(tenant,tipo,modo,numero_contrato,estado) values ('mayorista','manual','simple','$n','convertida')" >/dev/null
  CP=$(Q "select id from public.cotizaciones where numero_contrato='$n'")
  PL $CP NULL NULL 1 >/dev/null                        # acuerdo de la COTIZACIÓN (sin contrato_uid)
  PL $CP "'$n'" "'$U1'" 2 >/dev/null                   # copia ligada al contrato por conversión
  PL NULL "'$n'" "'$U0'" 1 >/dev/null                  # evidencia de OTRA identidad con el mismo número
  expect "elegible: plan no materializado de un pendiente con la versión esperada" "$(sin $n)" '^SIN_MOTIVOS$'
  Q "select public.eliminar_contrato('$n', true)" >/dev/null
  expect "el contrato se eliminó y el número quedó disponible" "$(existe $n)|$(pool)" "^0\\|$n/disponible\$"
  expect "la copia del contrato (U1) se borró POR IDENTIDAD" "$(cnt comision_plan "contrato_uid='$U1'")" '^0$'
  expect "el acuerdo de la COTIZACIÓN se conserva (reabrible y convertible)" "$(cnt comision_plan "cotizacion_id=$CP and contrato_uid is null")" '^1$'
  expect "la evidencia de OTRO uid con el mismo número está INTACTA" "$(cnt comision_plan "contrato_uid='$U0'")" '^1$'
  expect "la cotización quedó abierta y sin número" "$(Q "select estado||'|'||coalesce(numero_contrato,'-') from public.cotizaciones where id=$CP")" '^abierta\|-$'

  echo "-- 6b) contrato siguiente (mismo número): sin herencia; la cotización puede convertirse de nuevo"
  RES=$(Q "select numero||' '||coalesce(token::text,'NULL') from public.reservar_numero_contrato('mayorista')"); N=$(printf '%s' "$RES" | cut -d' ' -f1); T=$(printf '%s' "$RES" | cut -d' ' -f2)
  expect "reservar devuelve el mismo número con ticket" "$RES" "^$n [0-9a-f-]{36}\$"
  Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$N','$T','mayorista','Cliente B','pendiente','Y')" >/dev/null
  U2=$(Q "select contrato_uid from public.ventas where numero_contrato='$N'")
  expect "identidad nueva distinta de la anterior y de la evidencia" "$( [ "$U2" != "$U1" ] && [ "$U2" != "$U0" ] && echo ok)" '^ok$'
  expect "ningún plan pertenece al contrato nuevo (por identidad)" "$(cnt comision_plan "contrato_uid='$U2'")" '^0$'
  # Reconversión: la misma operación que hace p97_priv.aplicar (copia versión+1 de la cadena de la cotización) ya NO choca con la cadena única
  RC=$(Q "insert into public.comision_plan(aliado_id,tipo_asesor,cotizacion_id,numero_contrato,contrato_uid,version,tenant,economico_rev,moneda,pvp_total,bnc,recobro_total,recobro_aliado,base_comision,pct_comision,pct_origen,comision_ordinaria,total_aliado)
       select aliado_id,tipo_asesor,cotizacion_id,'$N','$U2',version+1,tenant,economico_rev,moneda,pvp_total,bnc,recobro_total,recobro_aliado,base_comision,pct_comision,pct_origen,comision_ordinaria,total_aliado from public.comision_plan where cotizacion_id=$CP and contrato_uid is null")
  expect "reconvertir la cotización reabierta crea la copia nueva sin choque de versión" "$(cnt comision_plan "cotizacion_id=$CP and contrato_uid='$U2'")|$RC" '^1|$'
  Q "select public.eliminar_contrato('$N', true)" >/dev/null; Q "delete from public.numeros_dtm_liberados" >/dev/null

  echo "-- 6c) límites de la excepción del trigger (llamada directa, fuera de eliminar_contrato)"
  SEQ=$((SEQ+1)); m="DTM-$SEQ"; mk "$m"; UM=$(Q "select contrato_uid from public.ventas where numero_contrato='$m'"); PL NULL "'$m'" "'$UM'" 1 >/dev/null
  expect "marca por NÚMERO (la forma antigua) NO autoriza el borrado" "$(Q "select set_config('app.p75_eliminando','$m',false); delete from public.comision_plan where contrato_uid='$UM'")" 'ACUERDO_97'
  expect "marca con la identidad de OTRO contrato NO autoriza" "$(Q "select set_config('app.p75_eliminando_uid','$U0',false); delete from public.comision_plan where contrato_uid='$UM'")" 'ACUERDO_97'
  expect "ni siquiera la marca correcta borra planes de la COTIZACIÓN (sin contrato_uid)" "$(Q "select set_config('app.p75_eliminando_uid','$UM',false); delete from public.comision_plan where cotizacion_id=$CP and contrato_uid is null")" 'ACUERDO_97'
  expect "UPDATE sigue prohibido incluso con la marca correcta" "$(Q "select set_config('app.p75_eliminando_uid','$UM',false); update public.comision_plan set pct_origen='general' where contrato_uid='$UM'")" 'ACUERDO_97'
  Q "select set_config('app.p75_eliminando_uid','',false)" >/dev/null
  Q "update public.ventas set estado='confirmado' where numero_contrato='$m'" >/dev/null
  expect "contrato ya CONFIRMADO: la marca correcta tampoco borra el plan" "$(Q "select set_config('app.p75_eliminando_uid','$UM',false); delete from public.comision_plan where contrato_uid='$UM'")" 'ACUERDO_97'
  Q "select set_config('app.p75_eliminando_uid','',false)" >/dev/null

  echo "-- 6d) plan materializado (comisión exigible) bloquea; NETO descontada no; versión antigua de la 286 bloquea"
  SEQ=$((SEQ+1)); p="DTM-$SEQ"; mk "$p"; UP=$(Q "select contrato_uid from public.ventas where numero_contrato='$p'"); PL NULL "'$p'" "'$UP'" 1 >/dev/null
  PID=$(Q "select id from public.comision_plan where contrato_uid='$UP'")
  Q "insert into public.aliados_b2b(numero_contrato,plan_id) values ('$p',$PID)" >/dev/null
  r=$(Q "select public.eliminar_contrato('$p', true)")
  expect "plan MATERIALIZADO en comisión exigible: bloquea" "$r" 'REUSO_NO_ELEGIBLE.*PLAN_COMISION_MATERIALIZADO'
  expect "   · y el trigger tampoco lo borra con la marca correcta" "$(Q "select set_config('app.p75_eliminando_uid','$UP',false); delete from public.comision_plan where id=$PID")" 'ACUERDO_97'
  Q "select set_config('app.p75_eliminando_uid','',false)" >/dev/null
  Q "delete from public.aliados_b2b where numero_contrato='$p'; insert into public.aliados_b2b(numero_contrato,plan_id,descontada_en_precio) values ('$p',$PID,true)" >/dev/null
  expect "NETO descontada con plan: elegible" "$(sin $p)" '^SIN_MOTIVOS$'
  Q "select public.eliminar_contrato('$p', true)" >/dev/null
  expect "NETO: contrato, comisión descontada y plan eliminados" "$(existe $p)|$(cnt aliados_b2b "numero_contrato='$p'")|$(cnt comision_plan "contrato_uid='$UP'")" '^0\|0\|0$'
  Q "delete from public.numeros_dtm_liberados" >/dev/null
  SEQ=$((SEQ+1)); o="DTM-$SEQ"; mk "$o"; UO=$(Q "select contrato_uid from public.ventas where numero_contrato='$o'"); PL NULL "'$o'" "'$UO'" 1 >/dev/null
  Q "comment on function p97_priv.tg_solo_insercion() is 'solo inserción (versión antigua)'" >/dev/null
  expect "286 SIN la versión esperada: el plan bloquea (no basta que exista el texto en el cuerpo)" "$(sin $o)" 'PLAN_COMISION_SIN_LIBERACION_97'
  Q "comment on function p97_priv.tg_solo_insercion() is '$VER'" >/dev/null
  expect "restaurada la versión: vuelve a ser elegible" "$(sin $o)" '^SIN_MOTIVOS$'

  echo "-- 6e) eliminar SIN reutilizar no cambia respecto a la 287 (no toca planes ni avisos)"
  Q "select public.eliminar_contrato('$o', false)" >/dev/null
  expect "contrato eliminado y su plan histórico conservado" "$(existe $o)|$(cnt comision_plan "contrato_uid='$UO'")" '^0\|1$'

  echo "-- 6f) fallo intermedio (después de borrar plan, comisión y avisos): rollback COMPLETO"
  SEQ=$((SEQ+1)); q="DTM-$SEQ"; mk "$q"; UQ=$(Q "select contrato_uid from public.ventas where numero_contrato='$q'"); PL NULL "'$q'" "'$UQ'" 1 >/dev/null
  Q "insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$q','P'); insert into public.aliados_b2b(numero_contrato,descontada_en_precio) values ('$q',true); insert into public.cuentas_por_pagar(numero_contrato,valor_total) values ('$q',1000);
     set session_replication_role = replica; insert into public.avisos(usuario_id,tipo,numero_contrato) values ('$SU','soporte_pago_nuevo','$q'); insert into public.sillas(bloqueo_id, numero_silla, numero_contrato, estado, pasajero_nombres) values ($BQ,5,'$q','en_plazo','P'); set session_replication_role = origin;" >/dev/null
  Q "insert into public.cotizaciones(tenant,tipo,modo,numero_contrato,estado) values ('mayorista','manual','simple','$q','convertida')" >/dev/null
  CQ=$(Q "select id from public.cotizaciones where numero_contrato='$q'")
  S -c "create or replace function public.zz_falla_289() returns trigger language plpgsql as \$f\$ begin if old.numero_contrato = '$q' then raise exception 'FALLO_INTERMEDIO_289'; end if; return old; end \$f\$" -c "create trigger zz_falla_289 before delete on public.ventas for each row execute function public.zz_falla_289()" >/dev/null
  r=$(Q "select public.eliminar_contrato('$q', true)")
  expect "falla DESPUÉS de haber borrado plan, comisión, avisos y CxP" "$r" 'FALLO_INTERMEDIO_289'
  S -c "drop trigger zz_falla_289 on public.ventas" -c "drop function public.zz_falla_289()" >/dev/null
  expect "rollback completo: contrato, pasajero, plan, comisión NETO, CxP, aviso y silla intactos" "$(existe $q)|$(cnt contrato_pasajeros "numero_contrato='$q'")|$(cnt comision_plan "contrato_uid='$UQ'")|$(cnt aliados_b2b "numero_contrato='$q'")|$(cnt cuentas_por_pagar "numero_contrato='$q'")|$(cnt avisos "numero_contrato='$q'")|$(cnt sillas "numero_contrato='$q' and estado='en_plazo'")" '^1\|1\|1\|1\|1\|1\|1$'
  expect "…la cotización sigue vinculada (no quedó a medias) y el pool vacío" "$(Q "select estado||'|'||coalesce(numero_contrato,'-') from public.cotizaciones where id=$CQ")|$(pool)" "^convertida\\|$q\\|-\$"
  Q "select public.eliminar_contrato('$q', false)" >/dev/null
else
  echo "(286 no aplicada en esta base: se omite la sección)"
fi

echo "=== 7) Reuso APAGADO: nada se libera aunque el contrato sea elegible"
S -c "update public.dtm_reuso_config set habilitado = false" >/dev/null
SEQ=$((SEQ+1)); n="DTM-$SEQ"; mk "$n"
expect "apagado: el borrado con reuso se rechaza (REUSO_DESHABILITADO)" "$(Q "select public.eliminar_contrato('$n', true)")" 'REUSO_NO_ELEGIBLE.*REUSO_DESHABILITADO'
expect "   · nada cambió (el contrato sigue y el pool está vacío)" "$(existe $n)|$(pool)" '^1\|-$'
Q "select public.eliminar_contrato('$n', false)" >/dev/null
echo
P=$(cat "$TMP/pass"); F=$(cat "$TMP/fail")
echo "RESUMEN: $P PASS, $F FALLO"
[ "$F" = "0" ]
