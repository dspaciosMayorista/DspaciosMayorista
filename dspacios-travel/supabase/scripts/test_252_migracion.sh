#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# Pruebas de la MIGRACIÓN 252 en Postgres local desechable (nada habla con Supabase remoto). Parte de la plantilla (001-247, que ya trae la 244) y comprueba:
#   · preflight sobre el cuerpo de la 244                  → todo OK
#   · diferencia solo de FORMATO (comentarios, espacios)   → sigue OK (se compara por tokens) y el rollback devuelve ESA variante exacta
#   · hotfix de lógica / de un literal                     → REVISAR, y la 252 ABORTA sin tocar nada ni dejar respaldo
#   · aplicación → postcheck OK → rollback EXACTO (md5) → segundo rollback aborta → reaplicación; respaldo alterado detiene el rollback
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_252_migracion.sh <base_nueva> [contenedor_pg] [plantilla]
#   base_nueva    nombre NUEVO ^t252_[a-z0-9_]{1,40}$ (se crea desde la plantilla y se borra al final).
# ──────────────────────────────────────────────────────────────────
set -u
DB="${1:-}"
CT="${2:-pg244anular}"
PLANTILLA="${3:-plantilla247}"
export MSYS_NO_PATHCONV=1
printf '%s' "$DB" | grep -Eq '^t252_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t252_[a-z0-9_]{1,40}\$." >&2; exit 2; }
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
printf '%s' "$PLANTILLA" | grep -Eq '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
MIG="$APP/supabase/migrations/20260601000252_programa_hoteles_orden.sql"
PRE="$APP/supabase/scripts/preflight_252_programa_hoteles_orden.sql"
POST="$APP/supabase/scripts/postcheck_252_programa_hoteles_orden.sql"
RB="$APP/supabase/scripts/rollback_252_programa_hoteles_orden.sql"
FN="public.guardar_programa_hoteles(bigint,jsonb)"
FALLAS=0
ok()    { echo "  OK    $1"; }
falla() { echo "  FALLA $1"; FALLAS=$((FALLAS + 1)); }

limpiar() { $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; rm -f "${TMPDIR:-/tmp}/t252_fn_$DB.sql"; }
$PS -d postgres -c "select 1 from pg_database where datname = '$DB'" | grep -q 1 && { echo "La base $DB ya existe: elige otro nombre." >&2; exit 2; }
for i in 1 2 3 4 5; do $PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>&1 && break; sleep 2; done
trap limpiar EXIT
$PS -d "$DB" -c "select 1" >/dev/null || { echo "No se pudo crear $DB." >&2; exit 1; }

md5_def() { $PS -d "$DB" -c "select md5(pg_get_functiondef('$FN'::regprocedure))"; }
revisados() { $PS -d "$DB" < "$PRE" | grep '|REVISAR$' | cut -d'|' -f1 | tr '\n' ' '; }
$PS -d "$DB" -c "select pg_get_functiondef('$FN'::regprocedure) || ';'" > "${TMPDIR:-/tmp}/t252_fn_$DB.sql"
restaurar() { $PS -d "$DB" < "${TMPDIR:-/tmp}/t252_fn_$DB.sql" >/dev/null; }
alterar() {
  $PS -d "$DB" >/dev/null <<SQL
do \$x\$
declare d text; b text;
begin
  select pg_get_functiondef(p.oid), p.prosrc into d, b from pg_proc p where p.oid = to_regprocedure('$FN');
  execute replace(d, b, $1);
end \$x\$;
SQL
}
ORIG="$(md5_def)"

echo "== 1. Preflight sobre el cuerpo de la 244"
[ -z "$(revisados)" ] && ok "todo OK (sin REVISAR)" || falla "REVISAR inesperado: $(revisados)"
$PS -d "$DB" < "$PRE"

echo "== 2. Solo FORMATO distinto: se compara por tokens → sigue OK; con esa variante como estado previo el rollback la devuelve EXACTA"
alterar "'-- ajuste cosmético' || E'\n\n' || replace(replace(b, E'\n', E'\n\n    '), 'select ', 'SELECT   ')"
[ "$(md5_def)" != "$ORIG" ] && ok "la definición sí cambió de texto" || falla "la variante de formato no se aplicó"
[ -z "$(revisados)" ] && ok "preflight OK pese al formato" || falla "el formato dio REVISAR: $(revisados)"
FORMATO="$(md5_def)"
$PS -d "$DB" -1 < "$MIG" >/dev/null 2>&1 && ok "252 aplicada" || falla "252 no se aplicó"
[ "$($PS -d "$DB" < "$POST" | grep -c '|REVISAR$')" = 0 ] && ok "postcheck sin REVISAR" || falla "postcheck con REVISAR: $($PS -d "$DB" < "$POST" | grep '|REVISAR$')"
$PS -d "$DB" < "$RB" >/dev/null 2>&1 && ok "rollback ejecutado" || falla "rollback falló"
[ "$(md5_def)" = "$FORMATO" ] && ok "ROLLBACK EXACTO: pg_get_functiondef idéntico (md5) a lo previo" || falla "el rollback no devolvió lo previo"
restaurar
[ "$(md5_def)" = "$ORIG" ] && ok "definición original restaurada para seguir" || falla "no se restauró el original"

echo "== 3. Hotfix de LÓGICA / LITERAL: REVISAR y la 252 ABORTA sin tocar nada"
casos() {
  nombre="$1"; expr="$2"
  alterar "$expr"
  r="$(revisados)"
  echo "$r" | grep -q "cuerpo_igual_al_de_la_244" && ok "$nombre → REVISAR" || falla "$nombre no dio REVISAR (dio: $r)"
  antes="$(md5_def)"
  $PS -d "$DB" -1 < "$MIG" >/dev/null 2>&1 && falla "$nombre: la 252 SE APLICÓ sobre una función alterada" || ok "$nombre: la 252 abortó"
  [ "$(md5_def)" = "$antes" ] && ok "$nombre: la función no cambió" || falla "$nombre: la función cambió"
  [ "$($PS -d "$DB" -c "select to_regclass('public.respaldo_252') is null")" = t ] && ok "$nombre: no quedó respaldo a medias" || falla "$nombre: quedó respaldo"
  restaurar
}
casos "orden +1 → +2 (lógica)" "replace(b, 'v_orden := v_orden + 1', 'v_orden := v_orden + 2')"
casos "texto de un mensaje (literal)" "replace(b, 'La lista de hoteles debe ser un arreglo', 'La lista de hoteles debe ser un array')"
casos "condición agregada (hotfix)" "replace(b, 'if not found then', 'if not found or false then')"
[ "$(md5_def)" = "$ORIG" ] && ok "tras los escenarios la función es la original" || falla "estado distinto del original"

echo "== 4. Ciclo limpio: preflight → 252 → postcheck → rollback exacto → segundo rollback aborta → reaplicar"
PRE_HUELLA="$($PS -d "$DB" < "$PRE" | grep '^huella_exacta' | cut -d'|' -f2)"
$PS -d "$DB" -1 < "$MIG" >/dev/null 2>&1 && ok "252 aplicada" || falla "252 no se aplicó"
$PS -d "$DB" < "$POST"
[ "$($PS -d "$DB" < "$POST" | grep -c '|REVISAR$')" = 0 ] && ok "postcheck sin REVISAR" || falla "postcheck con REVISAR"
RESP_HUELLA="$($PS -d "$DB" < "$POST" | grep '^huella_exacta' | cut -d'|' -f2)"
[ -n "$PRE_HUELLA" ] && [ "$PRE_HUELLA" = "$RESP_HUELLA" ] && ok "el respaldo guarda exactamente lo que había" || falla "huellas distintas: $PRE_HUELLA vs $RESP_HUELLA"
$PS -d "$DB" -1 < "$MIG" >/dev/null 2>&1 && falla "reaplicar sin rollback debería abortar" || ok "reaplicar encima aborta"
$PS -d "$DB" < "$RB" >/dev/null 2>&1 && ok "rollback ejecutado" || falla "rollback falló"
[ "$(md5_def)" = "$ORIG" ] && ok "ROLLBACK EXACTO a la 244" || falla "el rollback no devolvió la 244"
$PS -d "$DB" < "$RB" 2>&1 | grep -q 'ABORTADO' && ok "segundo rollback aborta" || falla "segundo rollback no abortó"
$PS -d "$DB" -1 < "$MIG" >/dev/null 2>&1 && ok "reaplicada" || falla "no se pudo reaplicar"

echo "== 5. El respaldo alterado detiene el rollback sin cambiar nada"
$PS -d "$DB" -c "set session_replication_role = replica; update public.respaldo_252 set definicion = definicion || ' ' where nombre = 'guardar_programa_hoteles'" >/dev/null
antes="$(md5_def)"
$PS -d "$DB" < "$RB" 2>&1 | grep -q 'ABORTADO' && ok "rollback aborta con respaldo alterado" || falla "el rollback no detectó el respaldo alterado"
[ "$(md5_def)" = "$antes" ] && ok "la función quedó como estaba" || falla "cambió la función"

echo
[ "$FALLAS" = 0 ] && echo "TEST 252: TODO OK" || { echo "TEST 252: $FALLAS FALLAS"; exit 1; }
