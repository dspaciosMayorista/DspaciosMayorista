#!/bin/sh
# PRUEBAS de la migración 305 (#14-A): registrar_comision_b2b_reserva con recobro del carrito. Base desechable con el esquema hasta la 304 + 305. NUNCA contra producción.
# Uso: sh supabase/scripts/test_305_recobro_reserva.sh <contenedor> <base>
CT="${1:?uso: test_305_recobro_reserva.sh <contenedor> [base]}"
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


echo "=== Fixture: aliado agencia 10 %"
Q "insert into public.aliados (id, nombre, tipo, pct_comision, activo) values (9301, 'Agencia 305', 'agencia', 0.10, true) on conflict (id) do update set pct_comision = 0.10, tipo = 'agencia', activo = true" >/dev/null
expect "aliado de prueba existe" "$(Q "select pct_comision::text from public.aliados where id=9301")" '^0\.10?'

# venta <numero> <modo> <precio_venta> <comision_b2b> <recobro_total> <recobro_aliado> <impuesto>
venta() {
  Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,canal,tipo_asesor,aliado_id,agencia_nombre,modo_compra,precio_venta,comision_b2b,impuesto,recobro_total,recobro_empresa,recobro_aliado,financiero_estado,financiero_actualizado_en,moneda)
     values ('$1','mayorista','Cliente $1','pendiente','Asesor X','B2B','agencia',9301,'Agencia 305','$2',$3,$4,$7,$5,$5-$6,$6,'pendiente',now(),'COP')" >/dev/null
}
rpc() { Q "select public.registrar_comision_b2b_reserva('$1', 9301)" 2>&1; }
plan() { Q "select base_comision::bigint||'|'||comision_ordinaria::bigint||'|'||total_aliado::bigint||'|'||recobro_total::bigint||'|'||recobro_aliado::bigint||'|'||pvp_total::bigint from public.comision_plan where numero_contrato='$1'"; }
fila() { Q "select base_comision::bigint||'|'||precio_venta::bigint||'|'||recobro_total::bigint||'|'||pct_recobro_aliado::numeric(7,4)||'|'||estado||'|'||descontada_en_precio::text||'|'||round(base_comision*pct_comision + recobro_total*pct_recobro_aliado)::bigint from public.aliados_b2b where numero_contrato='$1'"; }

echo "=== 1) SIN recobro: regla vigente (regresión)"
venta DTM-9801 comisionable 2500000 250000 0 0 0
rpc DTM-9801 >/dev/null
expect "PVP sin recobro: plan base 2.500.000, ordinaria 250.000, total 250.000, recobro 0" "$(plan DTM-9801)" '^2500000\|250000\|250000\|0\|0\|2500000$'
venta DTM-9802 neta 2250000 250000 0 0 0
rpc DTM-9802 >/dev/null
expect "NETO sin recobro: fila descontada, base 2.500.000, bruto 2.500.000, recobro 0" "$(fila DTM-9802)" '^2500000\|2500000\|0\|0\.0000\|pagada\|true\|250000$'

echo "=== 2) PVP con recobro 100.000"
venta DTM-9803 comisionable 2600000 250000 100000 50000 0
rpc DTM-9803 >/dev/null
expect "A · aliado directo (participación 50.000): base 2.500.000, ordinaria 250.000, total 300.000, recobro 100.000/50.000, PVP 2.600.000" "$(plan DTM-9803)" '^2500000\|250000\|300000\|100000\|50000\|2600000$'
venta DTM-9804 comisionable 2600000 250000 100000 40000 0
rpc DTM-9804 >/dev/null
expect "B1 · asistida con distribución (40.000): total 290.000" "$(plan DTM-9804)" '^2500000\|250000\|290000\|100000\|40000\|2600000$'
venta DTM-9805 comisionable 2600000 260000 100000 0 0
rpc DTM-9805 >/dev/null
expect "B2 · asistida sin distribución: el recobro queda en la base ⇒ base 2.600.000, ordinaria 260.000, total 260.000" "$(plan DTM-9805)" '^2600000\|260000\|260000\|100000\|0\|2600000$'
venta DTM-9806 comisionable 2600000 230000 100000 40000 200000
rpc DTM-9806 >/dev/null
expect "BNC fuera de la base (impuesto 200.000): base 2.300.000, ordinaria 230.000" "$(plan DTM-9806)" '^2300000\|230000\|270000\|100000\|40000\|2600000$'

echo "=== 3) NETO con recobro"
venta DTM-9807 neta 2310000 290000 100000 40000 0
rpc DTM-9807 >/dev/null
expect "C · NETO con participación 40.000: bruto 2.600.000, base 2.500.000, recobro 100.000, 40 %, comisión descontada 290.000 = ordinaria 250.000 + 40.000" "$(fila DTM-9807)" '^2500000\|2600000\|100000\|0\.4000\|pagada\|true\|290000$'
venta DTM-9808 neta 2340000 260000 100000 0 0
rpc DTM-9808 >/dev/null
expect "NETO sin distribución: base 2.600.000 (incluye el recobro), descontada 260.000" "$(fila DTM-9808)" '^2600000\|2600000\|100000\|0\.0000\|pagada\|true\|260000$'
expect "el plan PVP NO se crea para una venta NETO" "$(Q "select count(*) from public.comision_plan where numero_contrato in ('DTM-9807','DTM-9808')")" '^0$'

echo "=== 4) Manipulaciones: la base recalcula y rechaza"
venta DTM-9809 comisionable 2600000 250000 100000 0 0
expect "B2 con comisión de la regla equivocada (250.000 en vez de 260.000): rechazada" "$(rpc DTM-9809)" 'no coincide con la calculada'
venta DTM-9810 comisionable 2600000 260000 100000 40000 0
expect "participación 40.000 con la ordinaria del caso sin distribución (260.000): rechazada" "$(rpc DTM-9810)" 'no coincide con la calculada'
venta DTM-9811 neta 2310000 250000 100000 40000 0
expect "NETO sin sumar la participación a la comisión descontada (250.000 en vez de 290.000): rechazado" "$(rpc DTM-9811)" 'no coincide con la calculada'
venta DTM-9812 comisionable 2600000 250000 100000 150000 0
expect "participación mayor que el recobro (150.000 > 100.000): inconsistente, rechazada" "$(rpc DTM-9812)" 'inconsistente'
expect "…sin dejar plan ni fila" "$(Q "select count(*) from public.comision_plan where numero_contrato in ('DTM-9809','DTM-9810','DTM-9812')")|$(Q "select count(*) from public.aliados_b2b where numero_contrato in ('DTM-9809','DTM-9810','DTM-9811','DTM-9812')")" '^0\|0$'

echo "=== 5) Reintento sin duplicar"
expect "un segundo registro del mismo contrato se rechaza (23505)" "$(rpc DTM-9803)" 'ya tiene comisión B2B'
expect "…y hay UN solo plan" "$(Q "select count(*) from public.comision_plan where numero_contrato='DTM-9803'")" '^1$'

echo "=== 6) Permisos: un aliado solo registra su propia comisión; roles ajenos no"
AL="eeeeeeee-5555-5555-5555-555555555555"
Q "insert into public.aliados (id, nombre, tipo, pct_comision, activo) values (9302, 'Otra agencia 305', 'agencia', 0.12, true) on conflict (id) do nothing" >/dev/null
Q "insert into auth.users(id,email) values ('$AL','al305@t.l') on conflict do nothing" >/dev/null
Q "insert into public.usuarios(id,email,nombre,rol,activo,tenant) values ('$AL','al305@t.l','Aliado 305','agencia',true,'mayorista') on conflict (id) do nothing" >/dev/null
Q "update public.usuarios set rol='agencia', activo=true, tenant='mayorista', aliado_id=9302 where id='$AL'" >/dev/null
venta DTM-9813 comisionable 2600000 250000 100000 50000 0
expect "una agencia NO registra la comisión de otro aliado (su usuarios.aliado_id ≠ 9301)" "$(QR "$AL" "select public.registrar_comision_b2b_reserva('DTM-9813', 9301)" 2>&1)" 'solo registra su propia comisión|No autorizado'
Q "update public.usuarios set aliado_id = 9301 where id = '$AL'" >/dev/null
expect "la agencia dueña del aliado SÍ registra la suya, con recobro" "$(QR "$AL" "select public.registrar_comision_b2b_reserva('DTM-9813', 9301)" 2>&1 | grep -c ERROR)" '^0$'
expect "…y quedó el plan con recobro" "$(plan DTM-9813)" '^2500000\|250000\|300000\|100000\|50000\|2600000$'

Q "select public.eliminar_contrato(numero_contrato, false) from public.ventas where numero_contrato ~ '^DTM-98[0-9]{2}$'" >/dev/null 2>&1
echo
P=$(cat "$TMP/pass"); F=$(cat "$TMP/fail")
echo "RESUMEN: $P PASS, $F FALLO"
[ "$F" = "0" ]
