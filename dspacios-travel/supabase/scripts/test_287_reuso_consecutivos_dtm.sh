#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
# PRUEBAS de la migración 287 (#75): reutilización de consecutivos DTM de contratos pendientes/vacíos.
#
# Uso:  sh supabase/scripts/test_287_reuso_consecutivos_dtm.sh <contenedor> [base]
#   · <contenedor>: Postgres local DESECHABLE con el esquema hasta la 281 y la 287 YA aplicada (ver
#     preparar_esquema_local.sh; la imagen local necesita storage.buckets.file_size_limit/allowed_mime_types).
#   · Crea usuarios y contratos de prueba con números DTM-91xx / MIN-91xx. NUNCA contra producción.
# Imprime PASS/FALLO por caso y un resumen; termina con código 1 si algo falla.
# ──────────────────────────────────────────────────────────────────────────────
CT="${1:?uso: test_287_reuso_consecutivos_dtm.sh <contenedor> [base]}"
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

echo "=== 0) El reuso nace DESHABILITADO (dtm_reuso_config.habilitado = false)"
expect "configuración: habilitado = false por defecto" "$(Q "select habilitado::text from public.dtm_reuso_config")" '^false$'
mk DTM-9100
expect "la vista previa incluye REUSO_DESHABILITADO" "$(Q "select array_to_string(public.contrato_reuso_preview('DTM-9100'),',')")" 'REUSO_DESHABILITADO'
R=$(Q "select public.eliminar_contrato('DTM-9100', true)")
expect "eliminar con reuso se rechaza mientras esté deshabilitado" "$R" 'REUSO_NO_ELEGIBLE.*REUSO_DESHABILITADO'
expect "   · no cambió nada (el contrato sigue y el pool está vacío)" "$(existe DTM-9100)|$(pool)" '^1\|-$'
Q "select public.eliminar_contrato('DTM-9100', false)" >/dev/null
expect "   · eliminar SIN reuso sigue funcionando (comportamiento de la 196)" "$(existe DTM-9100)" '^0$'
# A partir de aquí el banco de pruebas HABILITA el reuso para ejercitar el resto de las garantías; al final lo deja apagado.
S -c "update public.dtm_reuso_config set habilitado = true" >/dev/null

echo "=== 1) Contrato vacío (solo titular): liberación atómica, historial técnico conservado, reutilización"
mk DTM-9101
SHARE_A=$(Q "select share_token from public.ventas where numero_contrato='DTM-9101'")
AUD_ANTES=$(Q "select count(*) from public.auditoria where registro_id='DTM-9101'")
INS_ANTES=$(Q "select count(*) from public.auditoria where registro_id='DTM-9101' and tabla='ventas' and accion='INSERT'")
expect "vista previa: contrato vacío sin motivos" "$(Q "select coalesce(nullif(array_to_string(public.contrato_reuso_preview('DTM-9101'),','),''),'SIN_MOTIVOS')")" '^SIN_MOTIVOS$'
R=$(Q "select public.eliminar_contrato('DTM-9101', true)")
expect "eliminar con reuso: la venta ya no existe" "$(existe DTM-9101)" '^0$'
expect "liberación en la misma transacción: el número quedó DISPONIBLE" "$(pool)" 'DTM-9101/disponible'
AUD_DESPUES=$(Q "select count(*) from public.auditoria where registro_id='DTM-9101'")
[ "$AUD_DESPUES" -ge "$AUD_ANTES" ] && ok "auditoría conservada (antes $AUD_ANTES, después $AUD_DESPUES; no se borra ni se altera)" || bad "auditoría conservada" "antes $AUD_ANTES después $AUD_DESPUES"
expect "el evento de creación sigue en la auditoría (sin alterarse)" "$(Q "select count(*) from public.auditoria where registro_id='DTM-9101' and tabla='ventas' and accion='INSERT'")" "^$INS_ANTES$"
RES=$(Q "select numero||' '||coalesce(token::text,'NULL') from public.reservar_numero_contrato('mayorista')")
N=$(printf '%s' "$RES" | cut -d' ' -f1); T=$(printf '%s' "$RES" | cut -d' ' -f2)
expect "reservar devuelve el DTM liberado con ticket" "$RES" '^DTM-9101 [0-9a-f-]{36}$'
expect "estado asignado con ese ticket" "$(pool)" 'DTM-9101/asignado'
R=$(Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$N','$T','mayorista','Cliente B (otro)','pendiente','Asesor Y')")
expect "crear el contrato nuevo con SU ticket funciona" "$(existe DTM-9101)" '^1$'
expect "la reserva se consumió en la misma transacción (pool vacío)" "$(pool)" '^-$'
expect "el ticket no persiste en ventas" "$(Q "select coalesce(reserva_token::text,'NULL') from public.ventas where numero_contrato='DTM-9101'")" '^NULL$'
expect "share_token del contrato nuevo es distinto" "$(Q "select (share_token <> '$SHARE_A'::uuid)::text from public.ventas where numero_contrato='DTM-9101'")" '^true$'

echo "=== 2) Cada motivo de bloqueo: se rechaza SIN cambiar nada"
SEQ=9200
caso() { # caso <CODIGO esperado> <sql de relación con N>
  SEQ=$((SEQ+1)); n="DTM-$SEQ"; mk "$n"
  Q "$(printf '%s' "$2" | sed "s/N/$n/g")" >/dev/null
  r=$(Q "select public.eliminar_contrato('$n', true)")
  expect "bloquea: $1" "$r" "REUSO_NO_ELEGIBLE.*$1"
  expect "   · sigue existiendo y el pool no cambió ($1)" "$(existe $n)|$(pool)" '^1\|-$'
}
caso RELACION_CONTRATO_PASAJEROS "insert into public.contrato_pasajeros(numero_contrato,nombre) values ('N','Pasajero');"
caso RELACION_ABONOS "insert into public.abonos(numero_contrato,tenant,cliente,fecha_abono,valor_abono,forma_pago) values ('N','mayorista','C',current_date,1,'efectivo');"
caso RELACION_ABONOS_ANULADOS "insert into public.abonos_anulados(abono_id,numero_contrato,tenant,abono,motivo,actor_id) values (floor(random()*1e9)::bigint+1000,'N','mayorista','{}'::jsonb,'prueba','$SU');"
caso RELACION_ALIADOS_B2B "insert into public.aliados_b2b(numero_contrato) values ('N');"
caso RELACION_CONTRATO_VUELOS "insert into public.contrato_vuelos(numero_contrato) values ('N');"
caso RELACION_SILLAS "set session_replication_role = replica; insert into public.sillas(bloqueo_id, numero_contrato) values (1,'N'); set session_replication_role = origin;"
caso REFERENCIA_MANUAL_EN_SILLA "set session_replication_role = replica; insert into public.sillas(bloqueo_id, contrato_manual) values (1,'N'); set session_replication_role = origin;"
caso RELACION_CONTRATO_SERVICIOS "insert into public.contrato_servicios(numero_contrato,descripcion) values ('N','Traslado');"
caso RELACION_CONTRATO_HOTELES "insert into public.contrato_hoteles(numero_contrato,nombre) values ('N','Hotel');"
caso RELACION_CONTRATO_ITEMS "insert into public.contrato_items(numero_contrato,descripcion) values ('N','Item');"
caso RELACION_CUENTAS_POR_PAGAR "insert into public.cuentas_por_pagar(numero_contrato,valor_total) values ('N',1000);"
caso RELACION_FACTURACION "insert into public.facturacion(numero_contrato) values ('N');"
caso RELACION_CUOTAS "insert into public.cuotas(numero_contrato,orden,tipo,fecha_limite,monto) values ('N',1,'abono',current_date,1000);"
caso RELACION_VOUCHERS "insert into public.vouchers(numero_contrato,contenido) values ('N','{}'::jsonb);"
caso RELACION_CONTRATO_ADJUNTOS "insert into public.contrato_adjuntos(numero_contrato,path) values ('N','N/x.pdf');"
caso RELACION_CONTRATO_SOPORTES_PAGO "set session_replication_role = replica; insert into public.contrato_soportes_pago(numero_contrato,tenant,path,nombre_original,mime,size_bytes,sha256,subido_por) values ('N','mayorista','N/s.pdf','s.pdf','application/pdf',10,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','$SU'); set session_replication_role = origin;"
caso RELACION_AVISOS "set session_replication_role = replica; insert into public.avisos(usuario_id,tipo,numero_contrato) values ('$SU','soporte_pago_nuevo','N'); set session_replication_role = origin;"
caso RELACION_COTIZACIONES "insert into public.cotizaciones(tenant,numero_contrato) values ('mayorista','N');"
caso RELACION_PERSONA_CAPTURAS "set session_replication_role = replica; insert into public.persona_capturas(id,persona_id,tenant,fuente,nivel,contrato_numero,contrato_pasajero_id) values (gen_random_uuid(),gen_random_uuid(),'mayorista','contrato_pasajero','pasajero_contrato','N',1); set session_replication_role = origin;"
caso ARCHIVOS_EN_STORAGE "insert into storage.objects(bucket_id,name) values ('contratos','N/id.pdf');"
caso ASIENTOS_CONTABLES "insert into public.asientos_contables(numero,descripcion,tenant) values ((select coalesce(max(numero),0)+1 from public.asientos_contables),'Anticipo del contrato N','mayorista');"
caso ESTADO_ACTUAL_CONFIRMADO "select public.confirmar_venta('N');"
caso ESTADO_ACTUAL_CANCELADO "update public.ventas set estado='cancelado' where numero_contrato='N';"
caso ESTADO_DISTINTO_DE_PENDIENTE_EN_HISTORIA "select public.confirmar_venta('N'); update public.ventas set estado='pendiente' where numero_contrato='N';"
caso CAMPO_COMERCIAL_PRECIO_VENTA "update public.ventas set precio_venta=1000000 where numero_contrato='N';"
caso CAMPO_COMERCIAL_HOTEL "update public.ventas set hotel='Hotel X' where numero_contrato='N';"
caso CAMPO_COMERCIAL_B2B_USUARIO_ID "update public.ventas set b2b_usuario_id='$AG' where numero_contrato='N';"
caso FINANCIERO_INCOMPLETO "update public.ventas set financiero_estado='pendiente' where numero_contrato='N';"
# estado actual «activo» y contrato sin evento de creación
SEQ=$((SEQ+1)); n="DTM-$SEQ"; Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor) values ('$n','mayorista','T','activo','X');" >/dev/null
expect "bloquea: ESTADO_ACTUAL_ACTIVO" "$(Q "select public.eliminar_contrato('$n', true)")" 'REUSO_NO_ELEGIBLE.*ESTADO_ACTUAL_ACTIVO'
SEQ=$((SEQ+1)); n="DTM-$SEQ"
S -c "alter table public.ventas disable trigger trg_auditoria" >/dev/null; mk "$n"; S -c "alter table public.ventas enable trigger trg_auditoria" >/dev/null
expect "bloquea: SIN_EVENTO_DE_CREACION_EN_AUDITORIA (evidencia insuficiente)" "$(Q "select public.eliminar_contrato('$n', true)")" 'REUSO_NO_ELEGIBLE.*SIN_EVENTO_DE_CREACION'
echo "-- lectura fallida → bloquear (tabla cuya columna no se puede comparar con el número)"
S -c "create table public.zz_lectura_fallida(numero_contrato uuid)" >/dev/null
SEQ=$((SEQ+1)); n="DTM-$SEQ"; mk "$n"
expect "bloquea: LECTURA_FALLIDA_ZZ_LECTURA_FALLIDA (nunca se asume vacío)" "$(Q "select public.eliminar_contrato('$n', true)")" 'REUSO_NO_ELEGIBLE.*LECTURA_FALLIDA_ZZ_LECTURA_FALLIDA'
expect "   · sigue existiendo" "$(existe $n)" '^1$'
S -c "drop table public.zz_lectura_fallida" >/dev/null
echo "-- sin reuso, el borrado de siempre NO cambia (incluso con relaciones)"
SEQ=$((SEQ+1)); n="DTM-$SEQ"; mk "$n"; Q "insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$n','P');" >/dev/null
Q "select public.eliminar_contrato('$n', false)" >/dev/null
expect "p_reusar=false elimina igual que en la 196 y no toca el pool" "$(existe $n)|$(pool)" '^0\|-$'

echo "=== 3) Concurrencia"
mk DTM-9301; mk DTM-9302
echo "-- a) dos eliminaciones simultáneas del mismo contrato elegible"
( { claims "$SU"; echo "begin;"; echo "select public.eliminar_contrato('DTM-9301', true);"; echo "select pg_sleep(4);"; echo "commit;"; } | S > "$TMP/e1.txt" ) &
sleep 1.3
Q "select public.eliminar_contrato('DTM-9301', true)" > "$TMP/e2.txt"; wait
expect "la segunda espera la primera y se rechaza (NO_EXISTE)" "$(cat $TMP/e2.txt)" 'REUSO_NO_ELEGIBLE.*NO_EXISTE'
expect "un solo número en el pool" "$(Q "select count(*) from public.numeros_dtm_liberados where numero='DTM-9301'")" '^1$'
Q "select public.eliminar_contrato('DTM-9302', true)" >/dev/null
echo "-- b) dos reservas simultáneas con un solo número en el pool"
Q "delete from public.numeros_dtm_liberados where numero='DTM-9302'" >/dev/null
( { claims "$SU"; echo "begin;"; echo "select numero from public.reservar_numero_contrato('mayorista');"; echo "select pg_sleep(4);"; echo "commit;"; } | S | grep -E '^DTM-' > "$TMP/r1.txt" ) &
sleep 1.3
Q "select numero from public.reservar_numero_contrato('mayorista')" > "$TMP/r2.txt"; wait
expect "A obtiene el liberado" "$(cat $TMP/r1.txt)" '^DTM-9301$'
R2=$(cat "$TMP/r2.txt"); [ "$R2" != "DTM-9301" ] && ok "B NO recibe el mismo número (recibe $R2 de la secuencia)" || bad "B recibió el mismo número" "$R2"
Q "delete from public.numeros_dtm_liberados" >/dev/null
echo "-- c) 8 reservas simultáneas, pool de 3"
for n in DTM-9311 DTM-9312 DTM-9313; do mk $n; Q "select public.eliminar_contrato('$n', true)" >/dev/null; done
for i in 1 2 3 4 5 6 7 8; do ( Q "select numero from public.reservar_numero_contrato('mayorista')" > "$TMP/c$i.txt" ) & done; wait
TODOS=$(cat "$TMP"/c?.txt | sort); DIST=$(printf '%s\n' "$TODOS" | sort -u | wc -l | tr -d ' ')
[ "$DIST" = "8" ] && ok "8 solicitudes → 8 números distintos (sin duplicados)" || bad "duplicados" "$TODOS"
expect "los 3 liberados se entregaron una sola vez" "$(printf '%s\n' "$TODOS" | grep -c -E 'DTM-931[123]')" '^3$'
Q "delete from public.numeros_dtm_liberados" >/dev/null
echo "-- d) dos creaciones simultáneas con el mismo ticket"
mk DTM-9321; Q "select public.eliminar_contrato('DTM-9321', true)" >/dev/null
RES=$(Q "select numero||' '||token from public.reservar_numero_contrato('mayorista')"); N=$(printf '%s' "$RES" | cut -d' ' -f1); T=$(printf '%s' "$RES" | cut -d' ' -f2)
INS="insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$N','$T','mayorista','Cli','pendiente','X')"
( { claims "$SU"; echo "begin;"; echo "$INS;"; echo "select pg_sleep(3);"; echo "commit;"; } | S > "$TMP/i1.txt" ) &
sleep 1.2
Q "$INS" > "$TMP/i2.txt"; wait
expect "exactamente un contrato creado" "$(existe $N)" '^1$'
expect "la segunda creación falla (sin duplicado)" "$(cat $TMP/i2.txt)" 'RESERVA_INEXISTENTE|duplicate key|RESERVA_AJENA'

echo "-- e) un abono llega mientras se libera: la liberación espera a la venta y lo ve"
mk DTM-9328
( { claims "$SU"; echo "begin;"; echo "insert into public.abonos(numero_contrato,tenant,cliente,fecha_abono,valor_abono,forma_pago) values ('DTM-9328','mayorista','C',current_date,1,'efectivo');"; echo "select pg_sleep(4);"; echo "commit;"; } | S > "$TMP/a1.txt" ) &
sleep 1.3
R=$(Q "select public.eliminar_contrato('DTM-9328', true)"); wait
expect "la liberación espera al escritor y se rechaza por el abono recién llegado" "$R" "REUSO_NO_ELEGIBLE.*RELACION_ABONOS"
expect "   · el contrato y su abono siguen ahí; el pool no cambió" "$(existe DTM-9328)|$(Q "select count(*) from public.abonos where numero_contrato='DTM-9328'")|$(pool)" "^1\|1\|-$"

echo "=== 4) Fallo de creación después de asignar"
mk DTM-9331; Q "select public.eliminar_contrato('DTM-9331', true)" >/dev/null
RES=$(Q "select numero||' '||token from public.reservar_numero_contrato('mayorista')"); N=$(printf '%s' "$RES" | cut -d' ' -f1); T=$(printf '%s' "$RES" | cut -d' ' -f2)
R=$(Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado) values ('$N','$T','mayorista',null,'pendiente')")
expect "la creación falla (cliente nulo)" "$R" 'null value|violates not-null'
expect "no hay contrato y la reserva sigue asignada con el mismo ticket" "$(existe $N)|$(pool)" '^0\|DTM-9331/asignado$'
OTRO=$(Q "select numero from public.reservar_numero_contrato('mayorista')")
[ "$OTRO" != "$N" ] && ok "mientras la reserva está vigente nadie más recibe ese número (recibe $OTRO)" || bad "reasignado en vigencia" "$OTRO"
R=$(Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$N','$T','mayorista','Cliente reintento','pendiente','X')")
expect "el reintento con el MISMO ticket funciona" "$(existe $N)|$(pool)" '^1\|-$'

echo "=== 5) Reserva vencida: A vencido / B nuevo propietario"
mk DTM-9341; Q "select public.eliminar_contrato('DTM-9341', true)" >/dev/null
RA=$(Q "select numero||' '||token from public.reservar_numero_contrato('mayorista')"); NA=$(printf '%s' "$RA" | cut -d' ' -f1); TA=$(printf '%s' "$RA" | cut -d' ' -f2)
Q "update public.numeros_dtm_liberados set asignado_en = now() - interval '31 minutes' where numero='$NA'" >/dev/null
RB=$(Q "select numero||' '||token from public.reservar_numero_contrato('mayorista')"); NB=$(printf '%s' "$RB" | cut -d' ' -f1); TB=$(printf '%s' "$RB" | cut -d' ' -f2)
expect "B recibe el MISMO número con otro ticket" "$NA|$NB|$([ "$TA" != "$TB" ] && echo distinto)" '^DTM-9341\|DTM-9341\|distinto$'
R=$(Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$NA','$TA','mayorista','Cliente A','pendiente','X')")
expect "A (vencido) es rechazado" "$R" 'RESERVA_AJENA'
R=$(Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$NB','$TB','mayorista','Cliente B','pendiente','X')")
expect "B crea el contrato" "$(Q "select cliente from public.ventas where numero_contrato='$NB'")" '^Cliente B$'
R=$(Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$NA','$TA','mayorista','Cliente A2','pendiente','X')")
expect "A reintenta: ticket sin reserva" "$R" 'RESERVA_INEXISTENTE|duplicate key'
mk DTM-9342; Q "select public.eliminar_contrato('DTM-9342', true)" >/dev/null
RA=$(Q "select numero||' '||token from public.reservar_numero_contrato('mayorista')"); NA=$(printf '%s' "$RA" | cut -d' ' -f1); TA=$(printf '%s' "$RA" | cut -d' ' -f2)
Q "update public.numeros_dtm_liberados set asignado_en = now() - interval '31 minutes' where numero='$NA'" >/dev/null
Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$NA','$TA','mayorista','Cliente A tardío','pendiente','X')" >/dev/null
expect "reserva vencida que nadie tomó: su dueño todavía puede crear" "$(Q "select cliente from public.ventas where numero_contrato='$NA'")" '^Cliente A tardío$'
echo "-- ticket falso o ausente sobre un número del pool"
mk DTM-9343; Q "select public.eliminar_contrato('DTM-9343', true)" >/dev/null
expect "sin ticket" "$(Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor) values ('DTM-9343','mayorista','Intruso','pendiente','X')")" 'RESERVA_AJENA'
expect "ticket inventado" "$(Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('DTM-9343','00000000-0000-0000-0000-000000000000','mayorista','Intruso','pendiente','X')")" 'RESERVA_AJENA'
expect "ticket inventado sobre un número que no está en el pool" "$(Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('DTM-9399','00000000-0000-0000-0000-000000000000','mayorista','X','pendiente','X')")" 'RESERVA_INEXISTENTE'
Q "delete from public.numeros_dtm_liberados" >/dev/null

echo "=== 6) Re-verificación al reutilizar (un escritor sin FK llega entre la liberación y la reserva)"
mk DTM-9351; Q "select public.eliminar_contrato('DTM-9351', true)" >/dev/null
Q "insert into storage.objects(bucket_id,name) values ('contratos','DTM-9351/rezagado.pdf')" >/dev/null
SIG=$(Q "select numero from public.reservar_numero_contrato('mayorista')")
[ "$SIG" != "DTM-9351" ] && ok "reservar NO ofrece el número con un archivo rezagado (recibe $SIG)" || bad "ofreció un número con archivo" "$SIG"
expect "el número queda BLOQUEADO con su motivo (no se borra)" "$(Q "select estado||'|'||motivo_bloqueo from public.numeros_dtm_liberados where numero='DTM-9351'")" '^bloqueado\|ARCHIVOS_EN_STORAGE$'
Q "delete from public.numeros_dtm_liberados" >/dev/null
mk DTM-9352; Q "select public.eliminar_contrato('DTM-9352', true)" >/dev/null
RES=$(Q "select numero||' '||token from public.reservar_numero_contrato('mayorista')"); N=$(printf '%s' "$RES" | cut -d' ' -f1); T=$(printf '%s' "$RES" | cut -d' ' -f2)
Q "insert into storage.objects(bucket_id,name) values ('contratos','$N/despues.pdf')" >/dev/null
R=$(Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$N','$T','mayorista','Cli','pendiente','X')")
expect "al crear, la re-verificación rechaza (archivo llegó después de reservar)" "$R" 'REUSO_NO_ELEGIBLE.*ARCHIVOS_EN_STORAGE'
expect "no se creó el contrato" "$(existe $N)" '^0$'
Q "delete from public.numeros_dtm_liberados" >/dev/null

echo "=== 7) Sin herencia de archivos, soportes ni permisos hacia el contrato nuevo / B2B-B2C sin acceso al historial"
HIST=$(Q "select count(*) from public.auditoria where registro_id='DTM-9101'")
expect "el contrato nuevo (DTM-9101) no tiene archivos, soportes, avisos ni adjuntos" "$(Q "select (select count(*) from storage.objects where starts_with(name,'DTM-9101/'))+(select count(*) from public.contrato_soportes_pago where numero_contrato='DTM-9101')+(select count(*) from public.avisos where numero_contrato='DTM-9101')+(select count(*) from public.contrato_adjuntos where numero_contrato='DTM-9101')")" '^0$'
expect "el historial técnico del número sigue ahí ($HIST filas) y lo lee gerencia" "$(QR $GE "select count(*) from public.auditoria where registro_id='DTM-9101'")" "^$HIST\$"
expect "un usuario B2B (agencia) NO lee la auditoría" "$(QR $AG "select count(*) from public.auditoria")" '^0$'
expect "un usuario B2B NO ve el contrato nuevo (ni el anterior)" "$(QR $AG "select count(*) from public.ventas where numero_contrato='DTM-9101'")" '^0$'
expect "un usuario B2B NO ve el pool" "$(QR $AG "select count(*) from public.numeros_dtm_liberados")" '^0$'
expect "un usuario B2B no puede consultar la elegibilidad" "$(QR $AG "select public.contrato_reuso_preview('DTM-9101')")" 'Solo un superadmin|permission denied'
expect "un usuario B2B no puede reservar números" "$(QR $AG "select * from public.reservar_numero_contrato('mayorista')")" 'permission denied'
expect "un usuario B2B no puede ejecutar la elegibilidad" "$(QR $AG "select public.dtm_reuso_bloqueos('DTM-9101', true)")" 'permission denied'
expect "gerencia no puede eliminar con reuso" "$(QR $GE "select public.eliminar_contrato('DTM-9101', true)")" 'Solo un superadmin'

echo "=== 8) Minorista intacto y compatibilidad"
S -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor) values ('MIN-9101','minorista','Titular min','pendiente','X')" >/dev/null
Q "select public.eliminar_contrato('MIN-9101', true)" >/dev/null
expect "MIN- se libera en numeros_contrato_liberados (mecanismo de siempre)" "$(Q "select count(*) from public.numeros_contrato_liberados where numero='MIN-9101'")|$(pool)" '^1\|-$'
expect "reservar('minorista') devuelve el liberado con ticket nulo" "$(Q "select numero||'|'||coalesce(token::text,'NULL') from public.reservar_numero_contrato('minorista')")" '^MIN-9101\|NULL$'
expect "siguiente_numero_contrato_para_tenant sigue devolviendo secuencia para mayorista" "$(Q "select public.siguiente_numero_contrato_para_tenant('mayorista')")" '^DTM-[0-9]{4,}$'
mk DTM-9361
Q "select public.fn_renumerar_contrato('DTM-9361','DTM-9369')" >/dev/null
expect "la renumeración existente (115/281) sigue funcionando con el trigger y la columna nuevos" "$(existe DTM-9361)|$(existe DTM-9369)" '^0\|1$'
expect "creación sin ticket de un número de secuencia (código viejo) sigue funcionando" "$(Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor) values ('DTM-9370','mayorista','Cli','pendiente','X')"; existe DTM-9370)" '1$'

echo "=== 9) El pool se recorre por consecutivo NUMÉRICO: DTM-9999 antes que DTM-10000"
Q "delete from public.numeros_dtm_liberados" >/dev/null
mk DTM-10000; mk DTM-9999
Q "select public.eliminar_contrato('DTM-10000', true)" >/dev/null   # se libera PRIMERO el 10000 y después el 9999
Q "select public.eliminar_contrato('DTM-9999', true)" >/dev/null
expect "ambos quedaron en el pool" "$(Q "select count(*) from public.numeros_dtm_liberados where numero in ('DTM-9999','DTM-10000')")" '^2$'
expect "el orden por TEXTO daría DTM-10000 primero (por eso se ordena numéricamente)" "$(Q "select numero from public.numeros_dtm_liberados order by numero limit 1")" '^DTM-10000$'
expect "reservar entrega primero DTM-9999" "$(Q "select numero from public.reservar_numero_contrato('mayorista')")" '^DTM-9999$'
expect "y después DTM-10000" "$(Q "select numero from public.reservar_numero_contrato('mayorista')")" '^DTM-10000$'
Q "delete from public.numeros_dtm_liberados" >/dev/null


echo "=== 10) Entrega 3: ciclo completo con PANTALLAS ANTIGUAS (identidad del contrato, migraciones 284/285)"
Q "delete from public.numeros_dtm_liberados" >/dev/null
mk DTM-9801
UIDA=$(Q "select contrato_uid from public.ventas where numero_contrato='DTM-9801'")
Q "select public.eliminar_contrato('DTM-9801', true)" >/dev/null
RES=$(Q "select numero||' '||coalesce(token::text,'NULL') from public.reservar_numero_contrato('mayorista')")
N10=$(printf '%s' "$RES" | cut -d' ' -f1); T10=$(printf '%s' "$RES" | cut -d' ' -f2)
expect "el pool entrega el MISMO número con ticket" "$RES" '^DTM-9801 [0-9a-f-]{36}$'
Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$N10','$T10','mayorista','Cliente B','pendiente','Asesor Y')" >/dev/null
UIDB=$(Q "select contrato_uid from public.ventas where numero_contrato='DTM-9801'")
expect "el contrato que nace del pool queda marcado nacio_de_reuso" "$(Q "select nacio_de_reuso::text from public.ventas where numero_contrato='DTM-9801'")" '^true$'
expect "y su identidad (uid) es distinta de la del contrato eliminado" "$([ "$UIDA" != "$UIDB" ] && echo distinto)" '^distinto$'
expect "un contrato de la secuencia NO nace marcado" "$(Q "select nacio_de_reuso::text from public.ventas where numero_contrato='DTM-9370'")" '^false$'
# con <uid> <sql>: ejecuta declarando, como la cabecera HTTP, que la pantalla abrió el contrato con ese uid ('-' = pantalla sin identidad)
con() { if [ "$1" = "-" ]; then Q "$2"; else Q "select set_config('request.headers', jsonb_build_object('x-contratos','{\"DTM-9801\":\"$1\"}')::text, false); $2"; fi; }
PAS="insert into public.contrato_pasajeros(numero_contrato,nombre) values ('DTM-9801','intruso')"
expect "pantalla ANTIGUA (uid del contrato eliminado): agregar pasajero rechazado" "$(con "$UIDA" "$PAS")" 'CONTRATO_CAMBIO'
expect "pantalla sin identidad (bundle viejo): agregar pasajero rechazado" "$(con - "$PAS")" 'IDENTIDAD_REQUERIDA'
expect "pantalla ANTIGUA: registrar un abono rechazado" "$(con "$UIDA" "insert into public.abonos(numero_contrato,tenant,cliente,fecha_abono,valor_abono,forma_pago) values ('DTM-9801','mayorista','x',current_date,1,'efectivo')")" 'CONTRATO_CAMBIO'
expect "pantalla ANTIGUA: editar el contrato rechazado" "$(con "$UIDA" "update public.ventas set cliente='Intruso' where numero_contrato='DTM-9801'")" 'CONTRATO_CAMBIO'
expect "pantalla ANTIGUA: eliminar el contrato nuevo rechazado" "$(con "$UIDA" "select public.eliminar_contrato('DTM-9801', false)")" 'CONTRATO_CAMBIO'
expect "ninguna escritura antigua cambió al contrato nuevo" "$(Q "select (select count(*) from public.contrato_pasajeros where numero_contrato='DTM-9801')||'|'||(select count(*) from public.abonos where numero_contrato='DTM-9801')||'|'||(select cliente from public.ventas where numero_contrato='DTM-9801')")" '^0\|0\|Cliente B$'
con "$UIDB" "$PAS" >/dev/null   # pantalla del contrato NUEVO (uid correcto)
expect "pantalla del contrato NUEVO (uid correcto): agregar pasajero permitido y quedó la fila" "$(Q "select count(*) from public.contrato_pasajeros where numero_contrato='DTM-9801'")" '^1$'
con "$UIDB" "delete from public.contrato_pasajeros where numero_contrato='DTM-9801'" >/dev/null   # la guarda exige la identidad también para limpiar

echo "=== 11) APAGADO (habilitado=false): no entrega ni consume el pool, no borra nada; los contratos ya reutilizados siguen protegidos"
CFG_OFF="update public.dtm_reuso_config set habilitado = false"; CFG_ON="update public.dtm_reuso_config set habilitado = true"
Q "$CFG_ON" >/dev/null; Q "delete from public.numeros_dtm_liberados" >/dev/null
mk DTM-9811; Q "select public.eliminar_contrato('DTM-9811', true)" >/dev/null
expect "preparación: el pool tiene DTM-9811 disponible" "$(pool)" '^DTM-9811/disponible$'
# 1) pool disponible + apagado → secuencia, el pool intacto
Q "$CFG_OFF" >/dev/null
R1=$(Q "select numero||' '||coalesce(token::text,'NULL') from public.reservar_numero_contrato('mayorista')")
expect "1 · apagado + pool disponible: se usa la SECUENCIA (otro número, ticket nulo)" "$R1" '^DTM-[0-9]{4,} NULL$'
expect_not "1 · …y no es el del pool" "$R1" 'DTM-9811'
expect "1 · el pool NO cambió (número conservado, sigue disponible)" "$(pool)" '^DTM-9811/disponible$'
# 2) ticket emitido ANTES de apagar + apagado → no se crea el contrato reutilizado
Q "$CFG_ON" >/dev/null
RT=$(Q "select numero||' '||token from public.reservar_numero_contrato('mayorista')"); NT=$(printf '%s' "$RT" | cut -d' ' -f1); TT=$(printf '%s' "$RT" | cut -d' ' -f2)
expect "2 · (encendido) se emite el ticket del pool" "$RT" '^DTM-9811 [0-9a-f-]{36}$'
Q "$CFG_OFF" >/dev/null
E2=$(Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$NT','$TT','mayorista','Tardío','pendiente','Z')")
expect "2 · apagado + ticket emitido antes: rechazo claro REUSO_APAGADO" "$E2" 'REUSO_APAGADO'
expect "2 · …no se creó ningún contrato" "$(existe DTM-9811)" '^0$'
expect "2 · …la reserva y el número se CONSERVAN con el mismo ticket" "$(Q "select estado||'|'||(asignado_token='$TT')::text from public.numeros_dtm_liberados where numero='DTM-9811'")" '^asignado\|true$'
E2b=$(Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor) values ('DTM-9811','mayorista','Sin ticket','pendiente','Z')")
expect "2 · …tampoco se puede crear ese número sin ticket" "$E2b" 'RESERVA_AJENA'
# 3) contrato reutilizado ya creado (DTM-9801, sección 10): sigue protegido con el reuso APAGADO
expect "3 · (apagado) UID antiguo sigue rechazado" "$(con "$UIDA" "$PAS")" 'CONTRATO_CAMBIO'
expect "3 · (apagado) sin identidad sigue rechazado" "$(con - "$PAS")" 'IDENTIDAD_REQUERIDA'
con "$UIDB" "$PAS" >/dev/null
expect "3 · (apagado) con la identidad correcta sigue funcionando" "$(Q "select count(*) from public.contrato_pasajeros where numero_contrato='DTM-9801'")" '^1$'
expect "3 · (apagado) conserva nacio_de_reuso y su uid" "$(Q "select nacio_de_reuso::text||'|'||(contrato_uid='$UIDB')::text from public.ventas where numero_contrato='DTM-9801'")" '^true\|true$'
con "$UIDB" "delete from public.contrato_pasajeros where numero_contrato='DTM-9801'" >/dev/null   # la guarda exige la identidad también para limpiar
# 4) carrera: apagar vs consumir la reserva / reservar, en sesiones reales simultáneas (orden transaccional)
Q "$CFG_ON" >/dev/null
Q "update public.numeros_dtm_liberados set estado='disponible', asignado_token=null, asignado_en=null where numero='DTM-9811'" >/dev/null
RC=$(Q "select numero||' '||token from public.reservar_numero_contrato('mayorista')"); NC=$(printf '%s' "$RC" | cut -d' ' -f1); TC=$(printf '%s' "$RC" | cut -d' ' -f2)
# 4a) la CREACIÓN llega primero (retiene la transacción 3 s); el APAGADO espera y se aplica después → el contrato queda creado
( { claims "$SU"; echo "begin; insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$NC','$TC','mayorista','Carrera A','pendiente','Z'); select pg_sleep(3); commit;"; } | S > "$TMP/c4a1" ) &
sleep 1; ( echo "$CFG_OFF;" | S > "$TMP/c4a2" ); wait
expect "4a · creación primero, apagado después: el contrato se creó (orden transaccional)" "$(existe DTM-9811)|$(Q "select habilitado::text from public.dtm_reuso_config")" '^1\|false$'
expect "4a · …y nació marcado de reuso, con el pool consumido" "$(Q "select nacio_de_reuso::text from public.ventas where numero_contrato='DTM-9811'")|$(pool)" '^true\|-$'
# 4b) el APAGADO llega primero (retiene 3 s); la creación con ticket espera y ve el interruptor apagado → rechazada, nada se pierde
Q "delete from public.ventas where numero_contrato='DTM-9811'" >/dev/null 2>&1; Q "delete from public.numeros_dtm_liberados" >/dev/null
mk DTM-9821; Q "$CFG_ON" >/dev/null; Q "select public.eliminar_contrato('DTM-9821', true)" >/dev/null
RD=$(Q "select numero||' '||token from public.reservar_numero_contrato('mayorista')"); ND=$(printf '%s' "$RD" | cut -d' ' -f1); TD=$(printf '%s' "$RD" | cut -d' ' -f2)
( echo "begin; $CFG_OFF; select pg_sleep(3); commit;" | S > "$TMP/c4b1" ) &
sleep 1; Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$ND','$TD','mayorista','Carrera B','pendiente','Z')" > "$TMP/c4b2"; wait
expect "4b · apagado primero, creación después: rechazada con REUSO_APAGADO" "$(cat "$TMP/c4b2")" 'REUSO_APAGADO'
expect "4b · …sin contrato y con la reserva intacta" "$(existe DTM-9821)|$(Q "select estado from public.numeros_dtm_liberados where numero='DTM-9821'")" '^0\|asignado$'
# 4c) apagado vs RESERVAR: reservar espera al apagado y ya lo ve apagado → secuencia, el pool intacto
Q "$CFG_ON" >/dev/null; Q "update public.numeros_dtm_liberados set estado='disponible', asignado_token=null, asignado_en=null where numero='DTM-9821'" >/dev/null
( echo "begin; $CFG_OFF; select pg_sleep(3); commit;" | S > "$TMP/c4c1" ) &
sleep 1; R4=$(Q "select numero||' '||coalesce(token::text,'NULL') from public.reservar_numero_contrato('mayorista')"); wait
expect "4c · reservar concurrente con el apagado: espera y usa la SECUENCIA (no entrega el pool)" "$R4" '^DTM-[0-9]{4,} NULL$'
expect_not "4c · …y no es el del pool" "$R4" 'DTM-9821'
expect "4c · el pool conserva el número" "$(pool)" '^DTM-9821/disponible$'
Q "delete from public.numeros_dtm_liberados" >/dev/null
S -c "update public.dtm_reuso_config set habilitado = false" >/dev/null   # el banco deja el reuso APAGADO
echo
P=$(cat "$TMP/pass"); F=$(cat "$TMP/fail")
echo "RESUMEN: $P PASS, $F FALLO"
[ "$F" = "0" ]
