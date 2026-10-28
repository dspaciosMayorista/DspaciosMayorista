#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# #40/#75 · Verificación local, EN ORDEN, de la migración 253 sobre el esquema completo (001-241 + 242).
#   (aplica la 242) → preflight 253 → migración 253 → postcheck 253 → pruebas (18) → rollback 253 (vuelve a la 242) → reaplicar 253 dos veces → postcheck 253.
# SOLO Docker local y desechable. Crea una base NUEVA desde la plantilla y la borra al final (KEEP=1 la conserva).
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_253_cotizacion_salida_pasada.sh <base_nueva> [contenedor_pg] [plantilla]
#     base_nueva    ^t253_[a-z0-9_]{1,40}$ y que NO exista.
#     plantilla     base con 001-241 (preparar_esquema_local.sh <contenedor> 241 plantilla241).
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg242e3}"
PLANTILLA="${3:-plantilla241}"
export MSYS_NO_PATHCONV=1
ok_nombre() { printf '%s' "$1" | grep -Eq "$2"; }
ok_nombre "$DB" '^t253_[a-z0-9_]{1,40}$' || { echo "Base inválida: ^t253_[a-z0-9_]{1,40}\$." >&2; exit 2; }
ok_nombre "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
ok_nombre "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
MIG="$APP/supabase/migrations"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
MARCA="test_253_cotizacion_salida_pasada $$"

[ "$($PS -t -A -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PS -t -A -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe: no se toca." >&2; exit 3; }

BASE_PROPIA=0
TMPSQL="$(mktemp)"
limpiar() {
  st=$?
  rm -f "$TMPSQL"
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    [ "$($PS -t -A -d postgres -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'" 2>/dev/null)" = "$MARCA" ] \
      && $PS -d postgres -c "drop database $DB" >/dev/null 2>&1 || echo "AVISO: revisa/borra $DB a mano" >&2
  fi
  exit "$st"
}
trap limpiar EXIT

for i in 1 2 3 4 5 6; do
  $PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null 2>&1 || true
  $PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>&1 && { BASE_PROPIA=1; break; }
  sleep 1
done
[ "$BASE_PROPIA" = 1 ] || { echo "No se pudo crear $DB." >&2; exit 3; }
$PS -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null

aplica() { $PS -d "$DB" -1 < "$1" >/dev/null || { echo "FALLÓ $1" >&2; exit 1; }; }
integral() { # etiqueta archivo — ninguna fila puede salir REVISAR
  echo "=== $1 ==="
  salida="$($PS -t -A -F ' | ' -d "$DB" < "$2")" || { echo "FALLÓ $2" >&2; exit 1; }
  echo "$salida"
  if echo "$salida" | grep -q 'REVISAR'; then echo "RESULTADO: $1 tiene filas REVISAR" >&2; exit 1; fi
  echo "RESULTADO: $1 sin REVISAR ($(echo "$salida" | grep -c ' | OK$') OK, $(echo "$salida" | grep -c ' | INFO$') INFO)"
}
consulta() { $PS -t -A -d "$DB" -c "$1"; }
compara() { if [ "$2" = "$3" ]; then echo "OK  $1 = $2"; else echo "FALLO: $1 = $2 (esperado $3)" >&2; exit 1; fi; }

MIG242="$MIG/20260601000242_cotizacion_vencida_guarda.sql"
aplica "$MIG242"; echo "migración 242 aplicada (base previa)"
guarda() { consulta "select prosrc from pg_proc where oid = to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)')"; }
huella() { consulta "select md5(coalesce(string_agg(id || ':' || estado || ':' || coalesce(vigencia_hasta::text,'') || ':' || coalesce(fecha_salida::text,'') || ':' || coalesce(numero_contrato,''), '|' order by id), '')) from public.cotizaciones"; }
H0="$(huella)"
cuerpo() { consulta "select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)')"; }
manipula() { # sed_expr — reescribe la definición vigente de la guarda con un cambio ajeno
  $PS -t -A -d "$DB" -c "select pg_get_functiondef(to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)'))" | sed "$1" | $PS -q -d "$DB" >/dev/null
}
echo "=== protección contra cambios previos en la guarda ==="
M242="$(cuerpo)"
for caso in "literal|s/renueva su vigencia/renueva la vigencia/" "logica|s/v_vigencia < v_hoy/v_vigencia <= v_hoy/"; do
  nombre="${caso%%|*}"; expr="${caso#*|}"
  manipula "$expr"
  MT="$(cuerpo)"
  [ "$MT" != "$M242" ] || { echo "FALLO: la manipulación '$nombre' no cambió la función" >&2; exit 1; }
  sal="$($PS -t -A -F ' | ' -d "$DB" < "$AQUI/preflight_253_cotizacion_salida_pasada.sql")"
  echo "$sal" | grep -q 'cuerpo_de_la_guarda_identico.* | REVISAR$' || { echo "FALLO: el preflight no dio REVISAR con cambio de $nombre" >&2; echo "$sal" >&2; exit 1; }
  echo "OK  preflight REVISAR con cambio de $nombre"
  if SAL="$($PS -d "$DB" -1 < "$MIG/20260601000253_cotizacion_salida_pasada_guarda.sql" 2>&1)"; then echo "FALLO: la 253 NO abortó con cambio de $nombre" >&2; exit 1; fi
  echo "$SAL" | grep -q "253 ABORTADA: el cuerpo vigente" || { echo "FALLO: error inesperado: $SAL" >&2; exit 1; }
  compara "definición intacta tras la 253 abortada ($nombre)" "$(cuerpo)" "$MT"
  aplica "$MIG242"   # restaura la guarda de la 242
  compara "guarda restaurada a la de la 242" "$(cuerpo)" "$M242"
done
integral "preflight 253" "$AQUI/preflight_253_cotizacion_salida_pasada.sql"
aplica "$MIG/20260601000253_cotizacion_salida_pasada_guarda.sql"; echo "migración 253 aplicada"
integral "postcheck 253" "$AQUI/postcheck_253_cotizacion_salida_pasada.sql"
compara "la 253 no tocó datos (huella de cotizaciones)" "$(huella)" "$H0"

echo "=== pruebas de la guarda ==="
ESPERADAS=18
{ echo "begin;"; cat "$AQUI/test_216_fixtures.sql" "$AQUI/test_253_cotizacion_salida_pasada.sql"; echo "commit;"; } > "$TMPSQL"
if ! SALIDA="$($PS -t -A -d "$DB" < "$TMPSQL" 2>&1)"; then echo "$SALIDA" | cut -c1-300; echo "FALLO: psql terminó con error en las pruebas" >&2; exit 1; fi
echo "$SALIDA" | grep -E "^(---|NOTICE:  (OK|FALLO))" | cut -c1-220
N_OK="$(echo "$SALIDA" | grep -c '^NOTICE:  OK  ' || true)"
N_FALLO="$(echo "$SALIDA" | grep -c '^NOTICE:  FALLO' || true)"
N_TABLA="$($PS -t -A -d "$DB" -c "select count(*) || '/' || count(*) filter (where ok) from t216.res")"
echo "RESULTADO pruebas: avisos OK=$N_OK FALLO=$N_FALLO · t216.res (total/ok)=$N_TABLA · esperadas=$ESPERADAS"
[ "$N_OK" = "$ESPERADAS" ] && [ "$N_FALLO" = 0 ] && [ "$N_TABLA" = "$ESPERADAS/$ESPERADAS" ] || { echo "FALLO: no se ejecutaron exactamente $ESPERADAS afirmaciones OK" >&2; exit 1; }

H1="$(huella)"
echo "=== rollback 253 ==="
$PS -d "$DB" -1 < "$AQUI/rollback_253_cotizacion_salida_pasada.sql" >/dev/null || { echo "FALLO: el rollback falló" >&2; exit 1; }
compara "guarda vuelve a la 242 (sin SALIDA_PASADA, con COTIZACION_VENCIDA)" "$(consulta "select count(*) from pg_proc where oid = to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)') and prosrc !~ 'SALIDA_PASADA' and prosrc ~ 'COTIZACION_VENCIDA'")" 1
compara "ACL de la guarda tras el rollback (service_role sí, authenticated no, anon no)" "$(consulta "select has_function_privilege('service_role','public.p40_exigir_cotizacion_vigente(bigint)','EXECUTE')::text || ',' || has_function_privilege('authenticated','public.p40_exigir_cotizacion_vigente(bigint)','EXECUTE')::text || ',' || has_function_privilege('anon','public.p40_exigir_cotizacion_vigente(bigint)','EXECUTE')::text")" "true,false,false"
compara "el rollback no tocó datos (huella tras las pruebas)" "$(huella)" "$H1"
if SAL="$($PS -d "$DB" -1 < "$AQUI/rollback_253_cotizacion_salida_pasada.sql" 2>&1)"; then echo "FALLO: un segundo rollback NO falló" >&2; exit 1; fi
echo "$SAL" | grep -q "la 253 no está aplicada" || { echo "FALLO: el segundo rollback no dio el error esperado: $SAL" >&2; exit 1; }
echo "OK  segundo rollback aborta con claridad"

compara "guarda tras el rollback = cuerpo de la 242 auditada" "$(cuerpo)" "$M242"
echo "=== reaplicar 253 ==="
integral "preflight 253 (tras rollback)" "$AQUI/preflight_253_cotizacion_salida_pasada.sql"
aplica "$MIG/20260601000253_cotizacion_salida_pasada_guarda.sql"; echo "migración 253 reaplicada"
aplica "$MIG/20260601000253_cotizacion_salida_pasada_guarda.sql"; echo "migración 253 aplicada una segunda vez seguida (idempotente)"
integral "postcheck 253 (reaplicada)" "$AQUI/postcheck_253_cotizacion_salida_pasada.sql"
echo "=== el rollback no pisa un cambio posterior a la 253 ==="
M253="$(cuerpo)"
manipula "s/genera una cotización nueva/genera una nueva cotización/"
MT="$(cuerpo)"
[ "$MT" != "$M253" ] || { echo "FALLO: la manipulación posterior no cambió la función" >&2; exit 1; }
if SAL="$($PS -d "$DB" -1 < "$AQUI/rollback_253_cotizacion_salida_pasada.sql" 2>&1)"; then echo "FALLO: el rollback pisó un cambio posterior" >&2; exit 1; fi
echo "$SAL" | grep -q "modificada después de la 253" || { echo "FALLO: error inesperado del rollback: $SAL" >&2; exit 1; }
compara "definición posterior intacta tras el rollback abortado" "$(cuerpo)" "$MT"
echo "TODO OK"
