#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# #88 · Verificación local, EN ORDEN, de la migración 244 sobre el esquema completo (001-243).
#   preflight 244 → migración 244 → postcheck 244 → pruebas SQL (roles, RLS, cascade, auditoría)
#   → rollback 244 (con su candado de datos) → reaplicar 244 dos veces → postcheck 244.
# SOLO Docker local y desechable. Crea una base NUEVA desde la plantilla y la borra al final (KEEP=1 la conserva).
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_244_programa_hotel_vigencia_noches.sh <base_nueva> [contenedor_pg] [plantilla]
#     base_nueva    ^t244_[a-z0-9_]{1,40}$ y que NO exista.
#     plantilla     base con 001-243 (preparar_esquema_local.sh <contenedor> 243 plantilla243).
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg244e88}"
PLANTILLA="${3:-plantilla243}"
export MSYS_NO_PATHCONV=1
ok_nombre() { printf '%s' "$1" | grep -Eq "$2"; }
ok_nombre "$DB" '^t244_[a-z0-9_]{1,40}$' || { echo "Base inválida: ^t244_[a-z0-9_]{1,40}\$." >&2; exit 2; }
ok_nombre "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
ok_nombre "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
MIG="$APP/supabase/migrations/20260601000244_programa_hotel_vigencia_noches.sql"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
MARCA="test_244_programa_hotel_vigencia_noches $$"

[ "$($PS -t -A -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PS -t -A -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe: no se toca." >&2; exit 3; }

BASE_PROPIA=0
limpiar() {
  st=$?
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

echo "Esquema 001-243 listo en $DB."
integral "preflight 244" "$AQUI/preflight_244_programa_hotel_vigencia_noches.sql"
aplica "$MIG"; echo "migración 244 aplicada"
integral "postcheck 244" "$AQUI/postcheck_244_programa_hotel_vigencia_noches.sql"

echo "=== pruebas SQL (roles, RLS, cascade, auditoría) ==="
ESPERADAS="$(grep -c '^select pg_temp.ok(' "$AQUI/test_244_programa_hotel_vigencia_noches.sql")"
if ! SALIDA="$($PS -t -A -d "$DB" < "$AQUI/test_244_programa_hotel_vigencia_noches.sql" 2>&1)"; then echo "$SALIDA" | cut -c1-300; echo "FALLO: psql terminó con error en las pruebas" >&2; exit 1; fi
echo "$SALIDA" | grep -E "^(---|NOTICE:  (OK|FALLO))" | cut -c1-220
N_OK="$(echo "$SALIDA" | grep -c '^NOTICE:  OK  ' || true)"
N_FALLO="$(echo "$SALIDA" | grep -c '^NOTICE:  FALLO' || true)"
echo "RESULTADO pruebas: avisos OK=$N_OK FALLO=$N_FALLO · esperadas=$ESPERADAS"
[ "$N_OK" = "$ESPERADAS" ] && [ "$N_FALLO" = 0 ] || { echo "FALLO: no se ejecutaron exactamente $ESPERADAS afirmaciones OK" >&2; exit 1; }
compara "las pruebas terminaron en ROLLBACK (no dejaron hoteles)" "$(consulta "select count(*) from public.programa_hoteles")" 0

echo "=== rollback 244 (candado de datos) ==="
# Con una estancia congelada el rollback ABORTA salvo confirmación expresa.
$PS -d "$DB" <<'SQL' >/dev/null
insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant)
values ('DTM-9244', 'Cliente', date '2027-03-01', 2, 100, 'pendiente', 'mayorista');
insert into public.contrato_programa_estancia (numero_contrato, hotel_nombre, modalidad_servicios, moneda, fecha_entrada, noches_incluidas, noches_adicionales, fecha_regreso, base_vigencia_desde, base_vigencia_hasta, precio_base)
values ('DTM-9244', 'H', 'privado', 'USD', '2027-03-01', 3, 0, '2027-03-04', '2027-03-01', '2027-03-31', 100);
SQL
if SAL="$($PS -d "$DB" -1 < "$AQUI/rollback_244_programa_hotel_vigencia_noches.sql" 2>&1)"; then echo "FALLO: el rollback NO abortó con una estancia congelada" >&2; exit 1; fi
echo "$SAL" | grep -q "hay 1 contrato" || { echo "FALLO: el aborto no dio el mensaje esperado: $SAL" >&2; exit 1; }
echo "OK  el rollback aborta si hay estancias congeladas"
compara "las tablas siguen ahí tras el aborto" "$(consulta "select count(*) from public.contrato_programa_estancia")" 1
{ echo "set app.rollback_244_con_datos = 'si';"; cat "$AQUI/rollback_244_programa_hotel_vigencia_noches.sql"; } | $PS -d "$DB" -1 >/dev/null || { echo "FALLO: el rollback confirmado falló" >&2; exit 1; }
compara "tablas eliminadas" "$(consulta "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('programa_hoteles','programa_hotel_precios','programa_hotel_noches','contrato_programa_estancia','contrato_programa_estancia_costo')")" 0
compara "función eliminada" "$(consulta "select count(*) from pg_proc where proname = 'guardar_programa_hoteles'")" 0
compara "el contrato NO se borró (solo su foto)" "$(consulta "select count(*) from public.ventas where numero_contrato = 'DTM-9244'")" 1
$PS -d "$DB" -c "delete from public.ventas where numero_contrato = 'DTM-9244'" >/dev/null
if SAL="$($PS -d "$DB" -1 < "$AQUI/rollback_244_programa_hotel_vigencia_noches.sql" 2>&1)"; then echo "FALLO: un segundo rollback NO falló" >&2; exit 1; fi
echo "$SAL" | grep -q "la 244 no está aplicada" || { echo "FALLO: el segundo rollback no dio el error esperado: $SAL" >&2; exit 1; }
echo "OK  segundo rollback aborta con claridad"

echo "=== reaplicar 244 ==="
integral "preflight 244 (tras rollback)" "$AQUI/preflight_244_programa_hotel_vigencia_noches.sql"
aplica "$MIG"; echo "migración 244 reaplicada"
aplica "$MIG"; echo "migración 244 aplicada una segunda vez seguida (idempotente)"
integral "postcheck 244 (reaplicada)" "$AQUI/postcheck_244_programa_hotel_vigencia_noches.sql"
echo "TODO OK"
