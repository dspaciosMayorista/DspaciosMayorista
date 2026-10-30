#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# Pruebas de la MIGRACIÓN 250 en Postgres local desechable (nada habla con Supabase remoto):
#   · preflight sobre las definiciones auditadas        → todo OK
#   · diferencia solo de FORMATO (comentarios, espacios) → sigue OK (se compara por tokens)
#   · hotfix de lógica / de un literal / de madre_anonima → REVISAR, y la 250 ABORTA sin tocar nada
#   · aplicación → postcheck OK → rollback que restaura las definiciones PREVIAS EXACTAS (md5) → segundo rollback aborta → reaplicación
#   · con una variante de formato como estado previo: el rollback devuelve ESA variante exacta, no la de la 211
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_250_migracion.sh <base_nueva> [contenedor_pg] [plantilla]
#   base_nueva    nombre NUEVO ^t250_[a-z0-9_]{1,40}$ (se crea desde la plantilla y se borra al final).
#   plantilla     base con 001-247 aplicadas (por defecto plantilla247). Solo se lee.
# ──────────────────────────────────────────────────────────────────
set -u
DB="${1:-}"
CT="${2:-pg244anular}"
PLANTILLA="${3:-plantilla247}"
export MSYS_NO_PATHCONV=1
printf '%s' "$DB" | grep -Eq '^t250_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t250_[a-z0-9_]{1,40}\$." >&2; exit 2; }
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
printf '%s' "$PLANTILLA" | grep -Eq '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
MIG="$APP/supabase/migrations/20260601000250_comparativa_publica_y_manuales.sql"
PRE="$APP/supabase/scripts/preflight_250_comparativa_publica_y_manuales.sql"
POST="$APP/supabase/scripts/postcheck_250_comparativa_publica_y_manuales.sql"
RB="$APP/supabase/scripts/rollback_250_comparativa_publica_y_manuales.sql"
CH="f211_priv.crear_hija(bigint,text,text,integer,text,uuid,uuid,bigint,text,text,jsonb)"
MA="f211_priv.madre_anonima(public.cotizaciones)"
FALLAS=0
ok()    { echo "  OK    $1"; }
falla() { echo "  FALLA $1"; FALLAS=$((FALLAS + 1)); }

limpiar() { $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; }
$PS -d postgres -c "select 1 from pg_database where datname = '$DB'" | grep -q 1 && { echo "La base $DB ya existe: elige otro nombre." >&2; exit 2; }
for i in 1 2 3 4 5; do $PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>&1 && break; sleep 2; done
trap limpiar EXIT
$PS -d "$DB" -c "select 1" >/dev/null || { echo "No se pudo crear $DB." >&2; exit 1; }

md5_defs() { $PS -d "$DB" -c "select md5(pg_get_functiondef('$CH'::regprocedure) || pg_get_functiondef('$MA'::regprocedure))"; }
revisar() { $PS -d "$DB" < "$PRE" | grep -c '|REVISAR$'; }
revisados() { $PS -d "$DB" < "$PRE" | grep '|REVISAR$' | cut -d'|' -f1 | tr '\n' ' '; }
# Guarda las definiciones originales (exactas) para restaurar entre escenarios.
$PS -d "$DB" -c "select pg_get_functiondef('$CH'::regprocedure) || ';'" > "${TMPDIR:-/tmp}/t250_ch_$DB.sql"
$PS -d "$DB" -c "select pg_get_functiondef('$MA'::regprocedure) || ';'" > "${TMPDIR:-/tmp}/t250_ma_$DB.sql"
restaurar() { $PS -d "$DB" < "${TMPDIR:-/tmp}/t250_ch_$DB.sql" >/dev/null && $PS -d "$DB" < "${TMPDIR:-/tmp}/t250_ma_$DB.sql" >/dev/null; }
# alterar <firma> '<expresión SQL sobre b (el cuerpo) que da el cuerpo nuevo>'
alterar() {
  $PS -d "$DB" >/dev/null <<SQL
do \$x\$
declare d text; b text;
begin
  select pg_get_functiondef(p.oid), p.prosrc into d, b from pg_proc p where p.oid = to_regprocedure('$1');
  execute replace(d, b, $2);
end \$x\$;
SQL
}
ORIG="$(md5_defs)"

echo "== 1. Preflight sobre las definiciones auditadas"
[ "$(revisar)" = 0 ] && ok "todo OK (sin REVISAR)" || falla "REVISAR inesperado: $(revisados)"
$PS -d "$DB" < "$PRE"

echo "== 2. Solo FORMATO distinto (comentario, saltos de línea, mayúsculas de palabras clave): se compara por tokens → sigue OK"
alterar "$CH" "'-- ajuste cosmético' || E'\n\n' || replace(replace(b, E'\n', E'\n\n    '), 'select ', 'SELECT   ')"
alterar "$MA" "'-- ajuste cosmético' || E'\n' || replace(b, E'\n', E'\r\n')"
[ "$(md5_defs)" != "$ORIG" ] && ok "las definiciones sí cambiaron de texto" || falla "la variante de formato no se aplicó"
[ "$(revisar)" = 0 ] && ok "preflight OK pese al formato" || falla "el formato dio REVISAR: $(revisados)"
FORMATO="$(md5_defs)"

echo "== 3. Con la variante de formato como estado PREVIO: aplicar 250 → postcheck → rollback devuelve ESA variante exacta"
$PS -d "$DB" -1 < "$MIG" >/dev/null 2>&1 && ok "250 aplicada" || falla "250 no se aplicó"
[ "$($PS -d "$DB" < "$POST" | grep -c '|REVISAR$')" = 0 ] && ok "postcheck sin REVISAR" || falla "postcheck con REVISAR: $($PS -d "$DB" < "$POST" | grep '|REVISAR$')"
[ "$(md5_defs)" != "$FORMATO" ] && ok "las funciones cambiaron" || falla "las funciones no cambiaron"
$PS -d "$DB" < "$RB" >/dev/null 2>&1 && ok "rollback ejecutado" || falla "rollback falló"
[ "$(md5_defs)" = "$FORMATO" ] && ok "ROLLBACK EXACTO: pg_get_functiondef idéntico (md5) a lo previo" || falla "el rollback no devolvió lo previo"
$PS -d "$DB" < "$RB" 2>&1 | grep -q 'ABORTADO' && ok "segundo rollback aborta" || falla "el segundo rollback no abortó"
restaurar
[ "$(md5_defs)" = "$ORIG" ] && ok "definiciones originales restauradas para seguir" || falla "no se restauró el original"

echo "== 4. Hotfix de LÓGICA / LITERAL / madre_anonima: REVISAR y la 250 ABORTA sin tocar nada"
casos() {
  nombre="$1"; firma="$2"; expr="$3"; control="$4"
  alterar "$firma" "$expr"
  r="$(revisados)"
  echo "$r" | grep -q "$control" && ok "$nombre → REVISAR ($control)" || falla "$nombre no dio REVISAR en $control (dio: $r)"
  antes="$(md5_defs)"
  $PS -d "$DB" -1 < "$MIG" >/dev/null 2>&1 && falla "$nombre: la 250 SE APLICÓ sobre una función alterada" || ok "$nombre: la 250 abortó"
  [ "$(md5_defs)" = "$antes" ] && ok "$nombre: las funciones no cambiaron" || falla "$nombre: las funciones cambiaron"
  [ "$($PS -d "$DB" -c "select to_regclass('f211_priv.respaldo_250') is null")" = t ] && ok "$nombre: no quedó respaldo a medias" || falla "$nombre: quedó respaldo"
  restaurar
}
casos "crear_hija: tolerancia 0.5 → 5 (lógica)" "$CH" "replace(b, '> 0.5', '> 5')" "crear_hija_cuerpo"
casos "crear_hija: texto de un mensaje (literal)" "$CH" "replace(b, 'la opción no tiene servicios', 'la opcion no tiene servicios')" "crear_hija_cuerpo"
casos "crear_hija: condición agregada (hotfix)" "$CH" "replace(b, 'if not found or c.modo <> ''comparativa''', 'if not found or c.modo <> ''comparativa'' or false')" "crear_hija_cuerpo"
casos "madre_anonima: abierta a todos" "$MA" "replace(b, 'c.aliado_id is null', 'true')" "madre_anonima_cuerpo"
[ "$(md5_defs)" = "$ORIG" ] && ok "tras los escenarios las funciones son las originales" || falla "estado distinto del original"

echo "== 5. Ciclo limpio: preflight → 250 → postcheck → rollback exacto → segundo rollback aborta → reaplicar"
[ "$(revisar)" = 0 ] && ok "preflight OK" || falla "preflight con REVISAR"
PRE_HUELLA="$($PS -d "$DB" < "$PRE" | grep '^huella_exacta' | cut -d'|' -f2)"
$PS -d "$DB" -1 < "$MIG" >/dev/null 2>&1 && ok "250 aplicada" || falla "250 no se aplicó"
$PS -d "$DB" < "$POST"
[ "$($PS -d "$DB" < "$POST" | grep -c '|REVISAR$')" = 0 ] && ok "postcheck sin REVISAR" || falla "postcheck con REVISAR"
RESP_HUELLA="$($PS -d "$DB" < "$POST" | grep '^huella_exacta' | cut -d'|' -f2)"
[ -n "$PRE_HUELLA" ] && [ "$PRE_HUELLA" = "$RESP_HUELLA" ] && ok "el respaldo guarda exactamente lo que había (huella del preflight = huella del respaldo)" || falla "huellas distintas: $PRE_HUELLA vs $RESP_HUELLA"
$PS -d "$DB" -1 < "$MIG" >/dev/null 2>&1 && falla "reaplicar sin rollback debería abortar" || ok "reaplicar encima aborta"
$PS -d "$DB" < "$RB" >/dev/null 2>&1 && ok "rollback ejecutado" || falla "rollback falló"
[ "$(md5_defs)" = "$ORIG" ] && ok "ROLLBACK EXACTO a la 211" || falla "el rollback no devolvió la 211"
$PS -d "$DB" < "$RB" 2>&1 | grep -q 'ABORTADO' && ok "segundo rollback aborta" || falla "segundo rollback no abortó"
$PS -d "$DB" -1 < "$MIG" >/dev/null 2>&1 && ok "reaplicada" || falla "no se pudo reaplicar"
[ "$($PS -d "$DB" < "$POST" | grep -c '|REVISAR$')" = 0 ] && ok "postcheck final sin REVISAR" || falla "postcheck final con REVISAR"

echo "== 6. El respaldo alterado detiene el rollback sin cambiar nada"
$PS -d "$DB" -c "set session_replication_role = replica; update f211_priv.respaldo_250 set definicion = definicion || ' ' where nombre = 'crear_hija'" >/dev/null
antes="$(md5_defs)"
$PS -d "$DB" < "$RB" 2>&1 | grep -q 'ABORTADO' && ok "rollback aborta con respaldo alterado" || falla "el rollback no detectó el respaldo alterado"
[ "$(md5_defs)" = "$antes" ] && ok "las funciones quedaron como estaban" || falla "cambiaron las funciones"

rm -f "${TMPDIR:-/tmp}/t250_ch_$DB.sql" "${TMPDIR:-/tmp}/t250_ma_$DB.sql"
echo
[ "$FALLAS" = 0 ] && echo "TEST 250: TODO OK" || { echo "TEST 250: $FALLAS FALLAS"; exit 1; }
