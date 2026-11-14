#!/bin/sh
# PRUEBAS de la migración 304 (#94): resumen de precios congelado en el contrato. Base desechable con el esquema hasta la 302 + 304 aplicada.
# Uso: sh supabase/scripts/test_304_resumen_contrato.sh <contenedor> [base]   (NUNCA contra producción)
CT="${1:?uso: test_304_resumen_contrato.sh <contenedor> [base]}"
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

echo "=== A) Validación estricta del CHECK (27 casos en test_304_validacion.sql)"
VAL="$(S < "$(dirname "$0")/test_304_validacion.sql" 2>&1)"
if printf '%s' "$VAL" | grep -q 'VALIDADOR_RESUMEN 27 casos, 0 fallos'; then ok "validador: 27 casos, 0 fallos"; else bad "validador" "$(printf '%s' "$VAL" | grep -E 'FALLO|VALIDADOR|ERROR' | head -5 | tr '\n' ' ')"; fi

RES_OK='{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":100000000,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":["Tour"],"cupos":["a","b"]}]}]}'
RES_MAL='{"version":1,"modalidad":"pvp","moneda":null,"totalCentavos":100000000,"unidades":[]}'
ins() { echo "insert into public.contrato_resumen_precios(numero_contrato, resumen) values ('$1', '$2'::jsonb);"; }
# Ejecutar como un rol de la base con claims (service_role no pasa por RLS; authenticated/anon sí)
como() { { echo "set role $1;"; echo "$2"; echo "reset role;"; } | S | grep -v '^SET$' | grep -v '^RESET$' | grep -v '^$'; }

echo "=== B) Permisos efectivos"
expect "service_role: select/insert/update/delete concedidos" "$(Q "select bool_and(has_table_privilege('service_role','public.contrato_resumen_precios',p))::text from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p")" '^true$'
expect "authenticated: SOLO select" "$(Q "select string_agg(p, ',' order by p) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege('authenticated','public.contrato_resumen_precios',p)")" '^SELECT$'
expect "anon: ningún privilegio" "$(Q "select count(*) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege('anon','public.contrato_resumen_precios',p)")" '^0$'
expect "RLS activa y UNA sola policy (select por herencia)" "$(Q "select c.relrowsecurity::text||'|'||(select count(*) from pg_policies where tablename='contrato_resumen_precios')||'|'||(select string_agg(cmd,',') from pg_policies where tablename='contrato_resumen_precios') from pg_class c where c.oid='public.contrato_resumen_precios'::regclass")" '^true\|1\|SELECT$'

N1=DTM-9501; mk $N1
expect "service_role INSERTA un resumen válido (sin error)" "ok:$(como service_role "$(ins $N1 "$RES_OK")")" '^ok:$'
expect "…y queda una fila" "$(cnt contrato_resumen_precios "numero_contrato='$N1'")" '^1$'
expect "service_role ACTUALIZA (sin error)" "ok:$(como service_role "update public.contrato_resumen_precios set resumen = resumen where numero_contrato='$N1';")" '^ok:$'
expect "service_role NO puede guardar un resumen inválido (CHECK)" "$(como service_role "$(ins $N1 "$RES_MAL")")" 'violates check constraint|duplicate key'
mk DTM-9502
expect "el CHECK rechaza un resumen con nulos/estructura incompleta" "$(como service_role "$(ins DTM-9502 "$RES_MAL")")" 'contrato_resumen_precios_valido'
expect "…sin dejar fila" "$(cnt contrato_resumen_precios "numero_contrato='DTM-9502'")" '^0$'
expect "authenticated NO inserta" "$(como authenticated "$(ins DTM-9502 "$RES_OK")")" 'permission denied'
expect "authenticated NO actualiza" "$(como authenticated "update public.contrato_resumen_precios set resumen = resumen;")" 'permission denied'
expect "authenticated NO borra" "$(como authenticated "delete from public.contrato_resumen_precios;")" 'permission denied'
expect "anon NO lee" "$(como anon "select count(*) from public.contrato_resumen_precios;")" 'permission denied'
expect "el superadmin (RLS real, puede_ver_contrato) LEE la fila" "$(QR "$SU" "select count(*) from public.contrato_resumen_precios where numero_contrato='$N1'")" '^1$'
expect "un usuario de agencia (sin acceso al contrato) NO la ve" "$(QR "$AG" "select count(*) from public.contrato_resumen_precios where numero_contrato='$N1'")" '^0$'
expect "el contrato exige FK: no se guarda un resumen de un contrato inexistente" "$(como service_role "$(ins DTM-9999 "$RES_OK")")" 'foreign key|violates'

echo "=== C) Guardas de identidad (284)"
expect "la tabla está clasificada 'estricto' y lleva el disparador" "$(Q "select g.modo||'|'||(select count(*) from pg_trigger t where t.tgrelid='public.contrato_resumen_precios'::regclass and t.tgname='trg_contrato_guarda') from public.contrato_guardas_config g where g.tabla='contrato_resumen_precios'")" '^estricto|1$'
# Un contrato NACIDO DE UN NÚMERO REUTILIZADO (la identidad de la 284 es obligatoria): se crea, se libera con reutilización y se vuelve a reservar.
N2=DTM-9503; mk $N2
Q "select public.eliminar_contrato('$N2', true)" >/dev/null
RES=$(Q "select numero||' '||coalesce(token::text,'NULL') from public.reservar_numero_contrato('mayorista')")
N=$(printf '%s' "$RES" | cut -d' ' -f1); T=$(printf '%s' "$RES" | cut -d' ' -f2)
Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$N','$T','mayorista','Cliente reuso','pendiente','Asesor Z')" >/dev/null
expect "preparación: el contrato nació de un número reutilizado" "$(Q "select nacio_de_reuso::text from public.ventas where numero_contrato='$N2'")" '^true$'
expect "SIN identidad declarada el servidor no puede escribir el resumen (IDENTIDAD_REQUERIDA)" "$(S -c "$(ins $N2 "$RES_OK")" 2>&1)" 'IDENTIDAD_REQUERIDA'
expect "…y no queda fila" "$(cnt contrato_resumen_precios "numero_contrato='$N2'")" '^0$'
expect "CON la identidad vigente del contrato SÍ se guarda" "ok:$({ echo "begin;"; echo "select public.contrato_declarar_identidad('$N2', (select contrato_uid from public.ventas where numero_contrato='$N2'));"; ins $N2 "$RES_OK"; echo "commit;"; } | S | grep -E 'ERROR')" '^ok:$'
expect "…hay fila" "$(cnt contrato_resumen_precios "numero_contrato='$N2'")" '^1$'
expect "CON una identidad AJENA se rechaza (CONTRATO_CAMBIO)" "$({ echo "begin;"; echo "select public.contrato_declarar_identidad('$N2', gen_random_uuid());"; echo "update public.contrato_resumen_precios set resumen = resumen where numero_contrato='$N2';"; echo "commit;"; } | S)" 'CONTRATO_CAMBIO'
expect "…y la fila sigue intacta" "$(cnt contrato_resumen_precios "numero_contrato='$N2'")" '^1$'
{ echo "begin;"; echo "select set_config('request.jwt.claims','{\"sub\":\"$SU\",\"role\":\"authenticated\"}',true), set_config('request.jwt.claim.sub','$SU',true);"; echo "select public.contrato_declarar_identidad('$N2', (select contrato_uid from public.ventas where numero_contrato='$N2'));"; echo "select public.eliminar_contrato('$N2', false);"; echo "commit;"; } | S >/dev/null
Q "delete from public.numeros_dtm_liberados" >/dev/null

echo "=== D) Eliminación y reutilización (#75): el siguiente contrato NO hereda el resumen"
N3=DTM-9504; mk $N3
Q "update public.ventas set destino='CARTAGENA', tipo_paquete='porcion', fecha_salida=current_date+30, fecha_regreso=current_date+34, hotel='Hotel X', precio_venta=1000000 where numero_contrato='$N3'" >/dev/null
Q "insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$N3','Pasajero'); insert into public.contrato_hoteles(numero_contrato,nombre) values ('$N3','Hotel X'); insert into public.contrato_items(numero_contrato,descripcion) values ('$N3','Item');" >/dev/null
S -c "$(ins $N3 "$RES_OK")" >/dev/null
expect "el contrato con resumen guardado tiene la fila" "$(cnt contrato_resumen_precios "numero_contrato='$N3'")" '^1$'
expect "vista previa: el resumen es PREPARACIÓN (no bloquea, sin RELACION_CONTRATO_RESUMEN_PRECIOS)" "$(sin $N3)" '^SIN_MOTIVOS$'
UID_VIEJO=$(Q "select contrato_uid from public.ventas where numero_contrato='$N3'")
Q "select public.eliminar_contrato('$N3', true)" >/dev/null
expect "eliminado con reutilización: venta y resumen fuera; número DISPONIBLE" "$(existe $N3)|$(cnt contrato_resumen_precios "numero_contrato='$N3'")|$(Q "select estado from public.numeros_dtm_liberados where numero='$N3'")" '^0\|0\|disponible$'
RES=$(Q "select numero||' '||coalesce(token::text,'NULL') from public.reservar_numero_contrato('mayorista')")
N=$(printf '%s' "$RES" | cut -d' ' -f1); T=$(printf '%s' "$RES" | cut -d' ' -f2)
expect "reservar devuelve el mismo número" "$N" "^$N3$"
Q "insert into public.ventas(numero_contrato,reserva_token,tenant,cliente,estado,asesor) values ('$N','$T','mayorista','Cliente B (otro)','pendiente','Asesor Y')" >/dev/null
expect "el contrato nuevo (mismo número) NO hereda el resumen" "$(cnt contrato_resumen_precios "numero_contrato='$N'")" '^0$'
expect "…y es otra identidad" "$(Q "select (contrato_uid <> '$UID_VIEJO'::uuid)::text from public.ventas where numero_contrato='$N'")" '^true$'
Q "select public.eliminar_contrato('$N', false)" >/dev/null; Q "delete from public.numeros_dtm_liberados" >/dev/null

echo "=== E) Eliminar SIN reutilizar y reversión de un contrato incompleto también limpian"
N4=DTM-9505; mk $N4; S -c "$(ins $N4 "$RES_OK")" >/dev/null
Q "select public.eliminar_contrato('$N4', false)" >/dev/null
expect "eliminar sin reutilizar: sin resumen huérfano" "$(existe $N4)|$(cnt contrato_resumen_precios "numero_contrato='$N4'")" '^0\|0$'
N5=DTM-9506; mk $N5; Q "update public.ventas set financiero_estado='pendiente' where numero_contrato='$N5'" >/dev/null; S -c "$(ins $N5 "$RES_OK")" >/dev/null
S -c "select public.revertir_contrato_incompleto('$N5','mayorista')" >/dev/null 2>&1
expect "revertir_contrato_incompleto: sin resumen huérfano" "$(cnt contrato_resumen_precios "numero_contrato='$N5'")" '^0$'
Q "select public.eliminar_contrato(numero_contrato, false) from public.ventas where numero_contrato in ('DTM-9501','DTM-9502','DTM-9503')" >/dev/null 2>&1

S -c "update public.dtm_reuso_config set habilitado = false" >/dev/null
echo
P=$(cat "$TMP/pass"); F=$(cat "$TMP/fail")
echo "RESUMEN: $P PASS, $F FALLO"
[ "$F" = "0" ]
