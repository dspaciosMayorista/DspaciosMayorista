#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# #40 E3 · Verificación local, EN ORDEN, de la migración 242 sobre el esquema completo (001-241).
#   preflight 242 → migración 242 → postcheck 242 → pruebas de la guarda (22) → rollback 242 → reaplicar 242 dos veces → postcheck 242.
# SOLO Docker local y desechable. Crea una base NUEVA desde la plantilla y la borra al final (KEEP=1 la conserva).
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_242_cotizacion_vencida.sh <base_nueva> [contenedor_pg] [plantilla]
#     base_nueva    ^t242_[a-z0-9_]{1,40}$ y que NO exista.
#     plantilla     base con 001-241 (preparar_esquema_local.sh <contenedor> 241 plantilla241).
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg242e3}"
PLANTILLA="${3:-plantilla241}"
export MSYS_NO_PATHCONV=1
ok_nombre() { printf '%s' "$1" | grep -Eq "$2"; }
ok_nombre "$DB" '^t242_[a-z0-9_]{1,40}$' || { echo "Base inválida: ^t242_[a-z0-9_]{1,40}\$." >&2; exit 2; }
ok_nombre "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
ok_nombre "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
MIG="$APP/supabase/migrations"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
MARCA="test_242_cotizacion_vencida $$"

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

echo "Esquema 001-241 listo en $DB."
integral "preflight 242" "$AQUI/preflight_242_cotizacion_vencida.sql"
aplica "$MIG/20260601000242_cotizacion_vencida_guarda.sql"; echo "migración 242 aplicada"
integral "postcheck 242" "$AQUI/postcheck_242_cotizacion_vencida.sql"

echo "=== pruebas de la guarda ==="
ESPERADAS=22
{ echo "begin;"; cat "$AQUI/test_216_fixtures.sql" "$AQUI/test_242_cotizacion_vencida.sql"; echo "commit;"; } > "$TMPSQL"
if ! SALIDA="$($PS -t -A -d "$DB" < "$TMPSQL" 2>&1)"; then echo "$SALIDA" | cut -c1-300; echo "FALLO: psql terminó con error en las pruebas" >&2; exit 1; fi
echo "$SALIDA" | grep -E "^(---|NOTICE:  (OK|FALLO))" | cut -c1-220
N_OK="$(echo "$SALIDA" | grep -c '^NOTICE:  OK  ' || true)"
N_FALLO="$(echo "$SALIDA" | grep -c '^NOTICE:  FALLO' || true)"
N_TABLA="$($PS -t -A -d "$DB" -c "select count(*) || '/' || count(*) filter (where ok) from t216.res")"
echo "RESULTADO pruebas: avisos OK=$N_OK FALLO=$N_FALLO · t216.res (total/ok)=$N_TABLA · esperadas=$ESPERADAS"
[ "$N_OK" = "$ESPERADAS" ] && [ "$N_FALLO" = 0 ] && [ "$N_TABLA" = "$ESPERADAS/$ESPERADAS" ] || { echo "FALLO: no se ejecutaron exactamente $ESPERADAS afirmaciones OK" >&2; exit 1; }

echo "=== rollback 242 ==="
$PS -d "$DB" -1 < "$AQUI/rollback_242_cotizacion_vencida.sql" >/dev/null || { echo "FALLO: el rollback falló" >&2; exit 1; }
compara "guarda eliminada" "$(consulta "select count(*) from pg_proc where proname = 'p40_exigir_cotizacion_vigente'")" 0
compara "base renombrada eliminada" "$(consulta "select count(*) from pg_proc where proname = 'p40_aceptar_oferta_63_base'")" 0
compara "aceptar_oferta_63 vuelve a ser el cuerpo de la 235 (una firma, sin guarda)" "$(consulta "select count(*) from pg_proc where proname = 'aceptar_oferta_63' and prosrc ~ 'p63_oferta_cerrada' and prosrc !~ 'p40_'")" 1
compara "wrapper manual sin guarda y con la copia del tipo (241)" "$(consulta "select count(*) from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)') and prosrc !~ 'p40_' and prosrc ~ 'cliente_tipo_documento'")" 1
compara "ACL aceptar_oferta_63 (service_role sí, authenticated no, anon no)" "$(consulta "select (has_function_privilege('service_role','public.aceptar_oferta_63(bigint,text,uuid,text,text,numeric,text,numeric)','EXECUTE'))::text || ',' || (has_function_privilege('authenticated','public.aceptar_oferta_63(bigint,text,uuid,text,text,numeric,text,numeric)','EXECUTE'))::text || ',' || (has_function_privilege('anon','public.aceptar_oferta_63(bigint,text,uuid,text,text,numeric,text,numeric)','EXECUTE'))::text")" "true,false,false"
if SAL="$($PS -d "$DB" -1 < "$AQUI/rollback_242_cotizacion_vencida.sql" 2>&1)"; then echo "FALLO: un segundo rollback NO falló" >&2; exit 1; fi
echo "$SAL" | grep -q "la 242 no está aplicada" || { echo "FALLO: el segundo rollback no dio el error esperado: $SAL" >&2; exit 1; }
echo "OK  segundo rollback aborta con claridad"

echo "=== reaplicar 242 ==="
integral "preflight 242 (tras rollback)" "$AQUI/preflight_242_cotizacion_vencida.sql"
aplica "$MIG/20260601000242_cotizacion_vencida_guarda.sql"; echo "migración 242 reaplicada"
aplica "$MIG/20260601000242_cotizacion_vencida_guarda.sql"; echo "migración 242 aplicada una segunda vez seguida (idempotente)"
integral "postcheck 242 (reaplicada)" "$AQUI/postcheck_242_cotizacion_vencida.sql"
echo "TODO OK"
