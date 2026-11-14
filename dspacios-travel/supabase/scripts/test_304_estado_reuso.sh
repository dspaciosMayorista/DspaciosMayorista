#!/bin/sh
# ────────────────────────────────────────────────────────────────────────────
# #94 · migración 304: PRESERVA el estado del reuso (en producción está ENCENDIDO) y las huellas de dtm_reuso_bloqueos.
# Crea una base desechable desde una plantilla (esquema hasta la 302, SIN la 304), ENCIENDE el reuso, y comprueba que aplicar la 304, revertirla y volver a aplicarla:
#   · no cambia dtm_reuso_config.habilitado ni su fila;  · conserva dueño, SECURITY DEFINER, search_path y permisos de dtm_reuso_bloqueos;
#   · no cambia lo que dtm_reuso_bloqueos responde para contratos elegibles y bloqueados;  · la huella md5 pasa 289 → 304 → 289 → 304;
#   · preflight_304 y postcheck_304 no dicen REVISAR;  · rollback_289 se NIEGA mientras la 304 esté aplicada.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_304_estado_reuso.sh <contenedor_pg> <plantilla>      (NUNCA contra una base real)
# ────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
DB="t304e_$(hex 5)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
PSN="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=0"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"; $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
P=0; F=0
ok()  { P=$((P+1)); echo "PASS  $1"; }
bad() { F=$((F+1)); echo "FALLO $1  ->  $2"; }
igual() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "'$2' != '$3'"; fi; }

$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
Q() { $PS -d "$DB" -c "$1"; }

# Contratos: dos elegibles y uno bloqueado (con un abono). Se crean como los de las pruebas de la 289.
SU='aaaaaaaa-1111-1111-1111-111111111111'
$PS -d "$DB" -c "insert into auth.users(id,email) values ('$SU','s@t.l') on conflict do nothing" -c "insert into public.usuarios(id,email,nombre,rol,activo,tenant) values ('$SU','s@t.l','Super','superadmin',true,'mayorista') on conflict (id) do update set rol='superadmin', activo=true" >/dev/null
mk() { Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,cliente_documento,cliente_telefono,cliente_email,canal,tipo_cliente) values ('$1','mayorista','Titular $1','pendiente','Asesor X','123456','3001112233','t@x.co','B2C','persona')" >/dev/null; }
mk DTM-9701; mk DTM-9702; mk DTM-9703
Q "insert into public.abonos(numero_contrato,tenant,cliente,fecha_abono,valor_abono,forma_pago) values ('DTM-9703','mayorista','C',current_date,1,'efectivo')" >/dev/null
Q "update public.dtm_reuso_config set habilitado = true" >/dev/null
$PS -d "$DB" -c "select set_config('request.jwt.claims','{\"sub\":\"$SU\",\"role\":\"authenticated\"}',false)" >/dev/null

foto() {   # huella del estado: config + definición + permisos + respuestas
  $PS -d "$DB" <<SQL
select md5(coalesce((select row_to_json(c)::text from public.dtm_reuso_config c limit 1), 'sin fila'))
 || '|' || (select habilitado::text from public.dtm_reuso_config limit 1)
 || '|' || (select p.prosecdef::text || '/' || coalesce(p.proconfig::text, '-') || '/' || pg_get_userbyid(p.proowner) || '/' || coalesce(p.proacl::text, '-') from pg_proc p where p.oid = 'public.dtm_reuso_bloqueos(text,boolean)'::regprocedure)
 || '|' || array_to_string(public.dtm_reuso_bloqueos('DTM-9701', true), ',') || '|' || array_to_string(public.dtm_reuso_bloqueos('DTM-9702', true), ',') || '|' || array_to_string(public.dtm_reuso_bloqueos('DTM-9703', true), ',')
 || '|' || array_to_string(public.dtm_reuso_bloqueos('DTM-9999', true), ',') || '|' || array_to_string(public.dtm_reuso_bloqueos('MIN-0001', true), ',') || '|' || coalesce(nullif(array_to_string(public.dtm_reuso_bloqueos('DTM-9701', false), ','), ''), '-');
SQL
}
md5fn() { Q "select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.dtm_reuso_bloqueos(text,boolean)'::regprocedure"; }
MD5_289=9335ed80ca236f434802527daaeeb10d; MD5_304=e417b53ecf0de9523e222f9c45debd9a
revisar() { $PS -d "$DB" < "$1" -F '|' | grep -E '\|REVISAR$' || true; }

echo "=== 1) Estado inicial: 289 con el reuso ENCENDIDO"
ANTES="$(foto)"; echo "  huella: $ANTES" | cut -c1-200
igual "huella md5 de dtm_reuso_bloqueos = la de la 289" "$(md5fn)" "$MD5_289"
case "$ANTES" in *'|true|'*) ok "reuso encendido";; *) bad "reuso encendido" "$ANTES";; esac
case "$ANTES" in *'SIN_MOTIVOS'*|*'|DTM-'*) :;; esac
R="$(revisar supabase/scripts/preflight_304_contrato_resumen_precios.sql)"; [ -z "$R" ] && ok "preflight_304: ningún REVISAR" || bad "preflight_304" "$R"

echo "=== 2) Aplicar la 304 (dos veces: idempotente)"
$PS -d "$DB" < supabase/migrations/20260601000304_contrato_resumen_precios.sql >/dev/null 2>"$TMP/e1" && ok "304 aplicada" || { cat "$TMP/e1"; bad "304 aplicada" "ver error"; }
$PS -d "$DB" < supabase/migrations/20260601000304_contrato_resumen_precios.sql >/dev/null 2>"$TMP/e2" && ok "304 reaplicada sin error" || { cat "$TMP/e2"; bad "304 reaplicada" "ver error"; }
igual "huella md5 = la de la 304" "$(md5fn)" "$MD5_304"
igual "el reuso, los permisos y las respuestas NO cambian (misma huella de estado)" "$(foto)" "$ANTES"
R="$(revisar supabase/scripts/postcheck_304_contrato_resumen_precios.sql)"; [ -z "$R" ] && ok "postcheck_304: ningún REVISAR" || bad "postcheck_304" "$R"

echo "=== 3) rollback_289 se NIEGA con la 304 aplicada"
ERR="$($PSN -d "$DB" < supabase/scripts/rollback_289_elegibilidad_dtm_ampliada.sql 2>&1 || true)"
case "$ERR" in *'ROLLBACK_289: la 304 está aplicada'*) ok "rollback_289 rechazado con mensaje claro";; *) bad "rollback_289 debía rechazarse" "$(printf '%s' "$ERR" | tail -2 | tr '\n' ' ')";; esac
igual "…y no cambió nada" "$(md5fn)" "$MD5_304"

echo "=== 4) Rollback de la 304: vuelve EXACTAMENTE a la 289 y conserva el reuso"
$PS -d "$DB" < supabase/scripts/rollback_304_contrato_resumen_precios.sql >/dev/null 2>"$TMP/e3" && ok "rollback_304 aplicado" || { cat "$TMP/e3"; bad "rollback_304" "ver error"; }
igual "huella md5 restaurada = la de la 289" "$(md5fn)" "$MD5_289"
igual "reuso, permisos y respuestas idénticos a los de ANTES de la 304" "$(foto)" "$ANTES"
igual "la tabla ya no existe" "$(Q "select coalesce(to_regclass('public.contrato_resumen_precios')::text, 'no')")" "no"
R="$(revisar supabase/scripts/preflight_304_contrato_resumen_precios.sql)"; [ -z "$R" ] && ok "preflight_304 vuelve a no decir REVISAR" || bad "preflight_304 tras rollback" "$R"

echo "=== 5) Reaplicar tras el rollback"
$PS -d "$DB" < supabase/migrations/20260601000304_contrato_resumen_precios.sql >/dev/null 2>"$TMP/e4" && ok "304 reaplicada tras el rollback" || { cat "$TMP/e4"; bad "reaplicar" "ver error"; }
igual "huella md5 = la de la 304" "$(md5fn)" "$MD5_304"
igual "estado del reuso intacto" "$(foto)" "$ANTES"

echo
echo "RESUMEN: $P PASS, $F FALLO"
[ "$F" = "0" ]
