#!/bin/sh
# ────────────────────────────────────────────────────────
# MIGRACIÓN 259 · casos de configuración previa/ajena contra PostgreSQL local (sin PostgREST, sin carga). SOLO Docker local y desechable.
# Comprueba, con las funciones REALES del esquema: (1) el preflight distingue SIN_LIMITES / APLICADA_259 / AJENA en cada entrada, (2) la 259 ABORTA sin cambiar
# nada ante configuración ajena (se compara cuerpo, configuración, permisos y comentario de las funciones antes/después, incluso si el ejecutor sigue tras el
# error), (3) reaplicar la 259 es un no-op, (4) el rollback solo actúa sobre la configuración EXACTA de la 259 y respeta un cambio posterior.
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_259_configuracion.sh <base_nueva> [contenedor_pg] [plantilla]
#     base_nueva  nombre NUEVO ^t259c_[a-z0-9_]{1,40}$ que NO exista; se crea desde la plantilla y se borra al final (KEEP=1 la conserva).
#     plantilla   base con las migraciones 001-254 (preparar_esquema_local.sh <contenedor> 254 plantilla259). Solo se lee.
# ────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg259}"
PLANTILLA="${3:-plantilla259}"
export MSYS_NO_PATHCONV=1
nombre_ok() { printf '%s' "$1" | grep -Eq "$2"; }
nombre_ok "$DB" '^t259c_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t259c_[a-z0-9_]{1,40}\$." >&2; exit 2; }
nombre_ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
nombre_ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
MIG="$APP/supabase/migrations/20260601000259_publicador_tarifario_limite_acotado.sql"
PRE="$AQUI/preflight_259_publicador_tarifario_limite.sql"
POST="$AQUI/postcheck_259_publicador_tarifario_limite.sql"
ROLL="$AQUI/rollback_259_publicador_tarifario_limite.sql"
for f in "$MIG" "$PRE" "$POST" "$ROLL"; do [ -f "$f" ] || { echo "Falta $f" >&2; exit 2; }; done
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A"
$PS -d postgres -c "select 1" >/dev/null 2>&1 || { echo "Postgres no responde en $CT." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }

BASE_PROPIA=0
limpiar() { st=$?; if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then $PS -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || echo "AVISO: no se pudo borrar $DB" >&2; fi; exit $st; }
trap limpiar EXIT INT TERM
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
BASE_PROPIA=1

W="public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)"
W63="public.publicar_tarifario_resultado_63(bigint,bigint,bigint,text,jsonb,text,numeric)"
SQL() { $PS -d "$DB" -v ON_ERROR_STOP=1 -c "$1" >/dev/null; }
# Huella de las dos entradas: cuerpo, configuración, permisos y comentario. Si no cambia, la función quedó intacta.
HUELLA="select string_agg(proname || '|' || md5(prosrc) || '|' || coalesce(proconfig::text, '') || '|' || coalesce(proacl::text, '') || '|' || coalesce(obj_description(oid, 'pg_proc'), ''), E'\n' order by proname) from pg_proc where proname in ('publicar_tarifario_resultado', 'publicar_tarifario_resultado_63')"
huella() { $PS -d "$DB" -c "$HUELLA"; }
config_de() { $PS -d "$DB" -c "select proconfig::text from pg_proc where oid = to_regprocedure('$1')"; }
# Vuelve al estado previo a la 259 (solo los dos parámetros; el search_path de las funciones no se toca).
limpio() { SQL "alter function $W reset statement_timeout reset lock_timeout"; SQL "alter function $W63 reset statement_timeout reset lock_timeout"; }
# Preflight: fila n → "lectura|estado" (la lectura de la fila 4 contiene «|»: se compara con expresión regular).
pre() { (echo "begin read only;"; cat "$PRE"; echo "rollback;") | $PS -d "$DB" -F '|' | grep "^$1|" | cut -d'|' -f3-; }
# Postcheck: estado de la fila 1 (último campo).
post_ok() { (echo "begin read only;"; cat "$POST"; echo "rollback;") | $PS -d "$DB" -F '|' | grep '^1|' | awk -F'|' '{print $NF}'; }
# Corre un archivo SIN ON_ERROR_STOP (peor caso: el ejecutor sigue después del error) y devuelve toda la salida (incluye NOTICE/WARNING/ERROR).
correr() { $PS -d "$DB" < "$1" 2>&1 || true; }
cuenta() { printf '%s' "$1" | grep -c -E "$2" || true; }

FALLAS=0; TOTAL=0
ok() { TOTAL=$((TOTAL+1)); if [ "$2" = "$3" ] || printf '%s' "$2" | grep -Eq -- "$3"; then echo "  OK   $1"; else echo "  FALLA $1"; echo "        esperado: $3"; echo "        obtenido: $2"; FALLAS=$((FALLAS+1)); fi; }
igual() { TOTAL=$((TOTAL+1)); if [ "$2" = "$3" ]; then echo "  OK   $1"; else echo "  FALLA $1 (la huella cambió)"; echo "--- antes"; echo "$2"; echo "--- después"; echo "$3"; FALLAS=$((FALLAS+1)); fi; }

echo "== Caso 0 · estado de fábrica (SIN_LIMITES) y aplicación =="
ok "preflight: publicar_tarifario_resultado" "$(pre 2)" '^SIN_LIMITES .*\|OK'
ok "preflight: publicar_tarifario_resultado_63" "$(pre 3)" '^SIN_LIMITES .*\|OK'
ok "preflight: veredicto" "$(pre 4)" 'OK: ambas SIN_LIMITES; correr la 259'
H0="$(huella)"
SAL="$(correr "$MIG")"
ok "la 259 se aplica sin error ni aborto" "$(cuenta "$SAL" 'ABORTADA|ERROR')" '^0$'
ok "postcheck: las dos entradas en APLICADA_259" "$(post_ok)" '^OK$'
ok "preflight tras aplicar: APLICADA_259 en ambas" "$(pre 4)" 'OK: ambas con la 259 ya aplicada'
ok "los cuerpos no cambiaron al aplicar" "$(huella | cut -d'|' -f2 | tr '\n' ',')" "$(printf '%s' "$H0" | cut -d'|' -f2 | tr '\n' ',')"

echo "== Caso 1 · reaplicación de la 259 =="
H1="$(huella)"
SAL="$(correr "$MIG")"
ok "reaplicar no aborta ni da error" "$(cuenta "$SAL" 'ABORTADA|ERROR')" '^0$'
igual "reaplicar deja las definiciones idénticas" "$H1" "$(huella)"

echo "== Caso 2 · límite previo de BLOQUEO (lock_timeout suelto) en la entrada base =="
limpio; SQL "alter function $W set lock_timeout = '5s'"
H="$(huella)"
ok "preflight: AJENA + REVISAR" "$(pre 2)" '^AJENA · lock_timeout=5s .*\|REVISAR'
ok "preflight: veredicto REVISAR" "$(pre 4)" 'REVISAR: hay configuración ajena'
SAL="$(correr "$MIG")"
ok "la 259 ABORTA con «259 ABORTADA (REVISAR)»" "$SAL" '259 ABORTADA \(REVISAR\).*configuración ajena'
igual "abortada: las dos funciones quedan intactas (cuerpo, config, permisos, comentario)" "$H" "$(huella)"

echo "== Caso 3 · límite previo de EJECUCIÓN distinto (statement_timeout 20s) =="
limpio; SQL "alter function $W set statement_timeout = '20s'"
H="$(huella)"
ok "preflight: AJENA" "$(pre 2)" '^AJENA · statement_timeout=20s'
SAL="$(correr "$MIG")"
ok "la 259 ABORTA" "$SAL" '259 ABORTADA \(REVISAR\)'
igual "abortada: intactas (no se «corrigió» a 30s ni se añadió el lock_timeout)" "$H" "$(huella)"

echo "== Caso 3b · la 259 a medias NO es la 259 (solo statement_timeout=30s, sin lock_timeout) =="
limpio; SQL "alter function $W set statement_timeout = '30s'"
H="$(huella)"
ok "preflight: AJENA" "$(pre 2)" '^AJENA'
SAL="$(correr "$MIG")"
ok "la 259 ABORTA" "$SAL" '259 ABORTADA \(REVISAR\)'
igual "abortada: intacta" "$H" "$(huella)"

echo "== Caso 3c · configuración ajena SOLO en la entrada 63 (la base está limpia) =="
limpio; SQL "alter function $W63 set statement_timeout = '45s'"
H="$(huella)"
ok "preflight base: SIN_LIMITES" "$(pre 2)" '^SIN_LIMITES'
ok "preflight 63: AJENA" "$(pre 3)" '^AJENA · statement_timeout=45s'
SAL="$(correr "$MIG")"
ok "la 259 ABORTA" "$SAL" '259 ABORTADA \(REVISAR\)'
igual "abortada: no quedó a medias (la base NO recibió los límites aunque se validó primero)" "$H" "$(huella)"

echo "== Caso 3d · parámetro ajeno cualquiera (work_mem) =="
limpio; SQL "alter function $W set work_mem = '64MB'"
H="$(huella)"
ok "preflight: AJENA" "$(pre 2)" '^AJENA · work_mem=64MB'
SAL="$(correr "$MIG")"
ok "la 259 ABORTA" "$SAL" '259 ABORTADA \(REVISAR\)'
igual "abortada: intacta" "$H" "$(huella)"
SQL "alter function $W reset work_mem"

echo "== Caso 3e · search_path distinto =="
SQL "alter function $W set search_path = public"
H="$(huella)"
ok "preflight: AJENA" "$(pre 2)" '^AJENA .*search_path=public\|REVISAR'
SAL="$(correr "$MIG")"
ok "la 259 ABORTA por el search_path" "$SAL" '259 ABORTADA \(REVISAR\).*search_path'
igual "abortada: intacta" "$H" "$(huella)"
SQL "alter function $W set search_path = public, pg_temp"

echo "== Caso 4 · cambio POSTERIOR antes del rollback =="
limpio; correr "$MIG" >/dev/null
ok "259 aplicada en ambas" "$(post_ok)" '^OK$'
SQL "alter function $W set statement_timeout = '45s'"      # alguien más cambia la base DESPUÉS de la 259
CFG_BASE="$(config_de "$W")"
ok "preflight: la base ahora es AJENA (45s + lock 8s)" "$(pre 2)" '^AJENA'
SAL="$(correr "$ROLL")"
ok "el rollback avisa de la configuración que no es la de la 259" "$SAL" 'NO es la de la 259'
igual "el rollback NO borró el cambio posterior (la base conserva statement_timeout=45s y lock_timeout=8s)" "$CFG_BASE" "$(config_de "$W")"
ok "el rollback SÍ revirtió la 63 (exactamente la de la 259)" "$(pre 3)" '^SIN_LIMITES'
ok "el resultado se presenta como INCOMPLETO, no como completo" "$(cuenta "$SAL" 'ROLLBACK 259 INCOMPLETO')/$(cuenta "$SAL" 'ROLLBACK 259 COMPLETO')" '^1/0$'

echo "== Caso 4b · 259 aplicada → cambia el search_path → rollback =="
limpio; correr "$MIG" >/dev/null
ok "259 aplicada en ambas" "$(post_ok)" '^OK$'
SQL "alter function $W set search_path = public, extensions, pg_temp"   # alguien cambia SOLO el search_path de la base DESPUÉS de la 259
CFG_BASE="$(config_de "$W")"
H4B="$(huella | grep '^publicar_tarifario_resultado|')"
SAL="$(correr "$ROLL")"
ok "el rollback avisa que no toca la función con el search_path cambiado" "$SAL" 'WARNING:.*tiene un search_path que NO es el de la 259'
igual "la función alterada queda intacta (conserva el search_path nuevo y los límites de la 259)" "$CFG_BASE" "$(config_de "$W")"
igual "huella de la función alterada idéntica (cuerpo, config, permisos, comentario)" "$H4B" "$(huella | grep '^publicar_tarifario_resultado|')"
ok "la otra entrada (63) sí se revirtió: seguía exactamente en 259 → SIN_LIMITES" "$(pre 3)" '^SIN_LIMITES'
ok "el resultado se presenta como INCOMPLETO (1 función sin tocar), no como completo" "$(cuenta "$SAL" 'ROLLBACK 259 INCOMPLETO')/$(cuenta "$SAL" 'ROLLBACK 259 COMPLETO')" '^1/0$'
SQL "alter function $W set search_path = public, pg_temp"

echo "== Caso 5 · rollback exacto e idempotente =="
limpio; correr "$MIG" >/dev/null
SAL="$(correr "$ROLL")"
ok "rollback sin avisos de configuración ajena" "$(cuenta "$SAL" 'NO se toca')" '^0$'
ok "el resultado se presenta como COMPLETO" "$(cuenta "$SAL" 'ROLLBACK 259 COMPLETO')/$(cuenta "$SAL" 'ROLLBACK 259 INCOMPLETO')" '^1/0$'
ok "ambas vuelven a SIN_LIMITES" "$(pre 4)" 'OK: ambas SIN_LIMITES'
ok "el search_path de las dos entradas sigue (no se usó RESET ALL)" "$($PS -d "$DB" -c "select count(*) from pg_proc where proname in ('publicar_tarifario_resultado','publicar_tarifario_resultado_63') and 'search_path=public, pg_temp' = any(proconfig)")" '^2$'
H5="$(huella)"
SAL="$(correr "$ROLL")"
igual "el segundo rollback es un no-op" "$H5" "$(huella)"
ok "los cuerpos no cambiaron en toda la prueba" "$(huella | cut -d'|' -f2 | tr '\n' ',')" "$(printf '%s' "$H0" | cut -d'|' -f2 | tr '\n' ',')"

echo
echo "$((TOTAL-FALLAS)) de $TOTAL comprobaciones pasaron."
if [ "$FALLAS" = 0 ]; then echo "TODAS LAS COMPROBACIONES PASARON"; else echo "FALLARON $FALLAS"; exit 1; fi
