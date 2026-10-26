#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# #40 E2 · Verificación local, EN ORDEN, de las migraciones 240 y 241 sobre el esquema completo (001-239).
#   preflight 240 → migración 240 → postcheck 240 → preflight 241 → migración 241 → postcheck 241
#   → conversión manual real (CC/CE, mismo número, ACL, reintento) → rollback 241 (rechazo con dato, rechazo sin columna, éxito) → reaplicar 241 → postcheck 241.
# SOLO Docker local y desechable. Crea una base NUEVA desde la plantilla y la borra al final (KEEP=1 la conserva).
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_241_tipo_documento.sh <base_nueva> [contenedor_pg] [plantilla]
#     base_nueva    ^t241_[a-z0-9_]{1,40}$ y que NO exista.
#     plantilla     base con 001-237 (preparar_esquema_local.sh <contenedor> 237 plantilla238); aquí se le aplican 238 y 239.
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg240e2}"
PLANTILLA="${3:-plantilla238}"
export MSYS_NO_PATHCONV=1
ok_nombre() { printf '%s' "$1" | grep -Eq "$2"; }
ok_nombre "$DB" '^t241_[a-z0-9_]{1,40}$' || { echo "Base inválida: ^t241_[a-z0-9_]{1,40}\$." >&2; exit 2; }
ok_nombre "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
ok_nombre "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
MIG="$APP/supabase/migrations"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
MARCA="test_241_tipo_documento $$"

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

aplica() { # archivo de migración
  $PS -d "$DB" -1 < "$1" >/dev/null || { echo "FALLÓ $1" >&2; exit 1; }
}
# Una consulta integral (control · valor · esperado · estado): se imprime y NINGUNA fila puede salir REVISAR.
integral() { # etiqueta archivo
  echo "=== $1 ==="
  salida="$($PS -t -A -F ' | ' -d "$DB" < "$2")" || { echo "FALLÓ $2" >&2; exit 1; }
  echo "$salida"
  if echo "$salida" | grep -q 'REVISAR'; then echo "RESULTADO: $1 tiene filas REVISAR" >&2; exit 1; fi
  echo "RESULTADO: $1 sin REVISAR ($(echo "$salida" | grep -c ' | OK$') OK, $(echo "$salida" | grep -c ' | INFO$') INFO)"
}

aplica "$MIG/20260601000238_cotizacion_asistida_b2b.sql"
aplica "$MIG/20260601000239_titular_reserva_neto.sql"
echo "Esquema 001-239 listo en $DB."

integral "preflight 240"  "$AQUI/preflight_240_cliente_tipo_documento.sql"
aplica "$MIG/20260601000240_cliente_tipo_documento.sql"; echo "migración 240 aplicada"
integral "postcheck 240"  "$AQUI/postcheck_240_cliente_tipo_documento.sql"
integral "preflight 241"  "$AQUI/preflight_241_tipo_documento_conversion.sql"
aplica "$MIG/20260601000241_tipo_documento_conversion.sql"; echo "migración 241 aplicada"
integral "postcheck 241"  "$AQUI/postcheck_241_tipo_documento_conversion.sql"

echo "=== conversión manual real ==="
ESPERADAS=16
{ echo "begin;"; cat "$AQUI/test_216_fixtures.sql" "$AQUI/test_241_conversion.sql"; echo "commit;"; } > "$TMPSQL"
# psql con ON_ERROR_STOP: cualquier error de SQL termina con código ≠ 0 y el script se detiene (set -e en la asignación + comprobación explícita).
if ! SALIDA="$($PS -t -A -d "$DB" < "$TMPSQL" 2>&1)"; then echo "$SALIDA" | cut -c1-300; echo "FALLO: psql terminó con error en la conversión" >&2; exit 1; fi
echo "$SALIDA" | grep -E "^(---|NOTICE:  (OK|FALLO))" | cut -c1-200
N_OK="$(echo "$SALIDA" | grep -c '^NOTICE:  OK  ' || true)"
N_FALLO="$(echo "$SALIDA" | grep -c '^NOTICE:  FALLO' || true)"
N_TABLA="$($PS -t -A -d "$DB" -c "select count(*) || '/' || count(*) filter (where ok) from t216.res")"
echo "RESULTADO conversión: avisos OK=$N_OK FALLO=$N_FALLO · t216.res (total/ok)=$N_TABLA · esperadas=$ESPERADAS"
[ "$N_OK" = "$ESPERADAS" ] && [ "$N_FALLO" = 0 ] && [ "$N_TABLA" = "$ESPERADAS/$ESPERADAS" ] || { echo "FALLO: no se ejecutaron exactamente $ESPERADAS afirmaciones OK" >&2; exit 1; }

compara() { # etiqueta obtenido esperado
  if [ "$2" = "$3" ]; then echo "OK  $1 = $2"; else echo "FALLO: $1 = $2 (esperado $3)" >&2; exit 1; fi
}
# El rollback debe FALLAR (psql ≠ 0) con el mensaje indicado.
rollback_falla() { # etiqueta mensaje
  if SAL="$($PS -d "$DB" -1 < "$AQUI/rollback_241_tipo_documento_conversion.sql" 2>&1)"; then echo "FALLO: $1: el rollback NO falló" >&2; exit 1; fi
  echo "$SAL" | grep -q "$2" || { echo "FALLO: $1: el error no es el esperado: $SAL" >&2; exit 1; }
  echo "OK  $1"
}
consulta() { $PS -t -A -d "$DB" -c "$1"; }
COL_TIT="select count(*) from information_schema.columns where table_name='ventas' and column_name='titular_tipo_documento'"

echo "=== rollback 241 ==="
# (1) Se NIEGA con un tipo de titular guardado.
$PS -d "$DB" -c "update public.ventas set titular_tipo_documento = 'CE' where numero_contrato = (select min(numero_contrato) from public.ventas where cliente_tipo_documento is not null)" >/dev/null
rollback_falla "rollback rechazado con titular_tipo_documento guardado" "ROLLBACK 241 ABORTADO: hay 1 "
compara "columna titular_tipo_documento tras el rechazo" "$(consulta "$COL_TIT")" 1
# (2) Sin datos del titular: se aplica.
$PS -d "$DB" -c "update public.ventas set titular_tipo_documento = null" >/dev/null
$PS -d "$DB" -1 < "$AQUI/rollback_241_tipo_documento_conversion.sql" >/dev/null || { echo "FALLO: el rollback limpio falló" >&2; exit 1; }
compara "columna titular_tipo_documento tras rollback" "$(consulta "$COL_TIT")" 0
compara "columna cliente_tipo_documento (240) intacta" "$(consulta "select count(*) from information_schema.columns where table_name='ventas' and column_name='cliente_tipo_documento'")" 1
compara "ventas con cliente_tipo_documento conservado" "$(consulta "select count(*) from public.ventas where cliente_tipo_documento is not null")" 3
compara "tipos conservados (CC,CE,PAS)" "$(consulta "select string_agg(cliente_tipo_documento, ',' order by cliente_tipo_documento) from public.ventas")" "CC,CE,PAS"
compara "wrapper restaurado a la 222 (no copia el tipo)" "$(consulta "select count(*) from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)') and prosrc !~ 'cliente_tipo_documento'")" 1
compara "ACL del wrapper (service_role sí, authenticated no, anon no)" "$(consulta "select (has_function_privilege('service_role','public.convertir_cotizacion_manual_controlada(bigint,uuid)','EXECUTE'))::text || ',' || (has_function_privilege('authenticated','public.convertir_cotizacion_manual_controlada(bigint,uuid)','EXECUTE'))::text || ',' || (has_function_privilege('anon','public.convertir_cotizacion_manual_controlada(bigint,uuid)','EXECUTE'))::text")" "true,false,false"
# (3) Sin la columna, un segundo rollback aborta con claridad.
rollback_falla "segundo rollback aborta (la 241 ya no está)" "la 241 no está aplicada"

echo "=== reaplicar 241 (reintento tras rollback) ==="
integral "preflight 241 (tras rollback)" "$AQUI/preflight_241_tipo_documento_conversion.sql"
aplica "$MIG/20260601000241_tipo_documento_conversion.sql"; echo "migración 241 reaplicada"
aplica "$MIG/20260601000241_tipo_documento_conversion.sql"; echo "migración 241 aplicada una segunda vez seguida (idempotente)"
integral "postcheck 241 (reaplicada)" "$AQUI/postcheck_241_tipo_documento_conversion.sql"
echo "TODO OK"
