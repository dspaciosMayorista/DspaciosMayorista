#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# #88 · Verificación local, EN ORDEN, de las migraciones 244 y 245 sobre el esquema completo (001-243).
#   preflight 244 → 244 → postcheck 244 → pruebas SQL de la 244
#   → preflight 245 → 245 → postcheck 245 → pruebas SQL de la 245
#   → rollback 245 (con su candado de datos) → reaplicar 245 dos veces → postcheck 245.
# SOLO Docker local y desechable. Crea una base NUEVA desde la plantilla y la borra al final (KEEP=1 la conserva).
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_245_programa_hotel_asistencia_trm.sh <base_nueva> [contenedor_pg] [plantilla]
#     base_nueva    ^t245_[a-z0-9_]{1,40}$ y que NO exista.
#     plantilla     base con 001-243 (preparar_esquema_local.sh <contenedor> 243 plantilla243).
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg245e88}"
PLANTILLA="${3:-plantilla243}"
export MSYS_NO_PATHCONV=1
ok_nombre() { printf '%s' "$1" | grep -Eq "$2"; }
ok_nombre "$DB" '^t245_[a-z0-9_]{1,40}$' || { echo "Base inválida: ^t245_[a-z0-9_]{1,40}\$." >&2; exit 2; }
ok_nombre "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
ok_nombre "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
MIG244="$APP/supabase/migrations/20260601000244_programa_hotel_vigencia_noches.sql"
MIG245="$APP/supabase/migrations/20260601000245_programa_hotel_asistencia_trm.sql"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
MARCA="test_245_programa_hotel_asistencia_trm $$"

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
pruebas() { # etiqueta archivo
  echo "=== pruebas SQL $1 ==="
  ESPERADAS="$(grep -c '^select pg_temp.ok(' "$2")"
  if ! SALIDA="$($PS -t -A -d "$DB" < "$2" 2>&1)"; then echo "$SALIDA" | cut -c1-300; echo "FALLO: psql terminó con error en las pruebas $1" >&2; exit 1; fi
  echo "$SALIDA" | grep -E "^(---|NOTICE:  (OK|FALLO))" | cut -c1-220
  N_OK="$(echo "$SALIDA" | grep -c '^NOTICE:  OK  ' || true)"
  N_FALLO="$(echo "$SALIDA" | grep -c '^NOTICE:  FALLO' || true)"
  echo "RESULTADO pruebas $1: avisos OK=$N_OK FALLO=$N_FALLO · esperadas=$ESPERADAS"
  [ "$N_OK" = "$ESPERADAS" ] && [ "$N_FALLO" = 0 ] || { echo "FALLO: $1 no ejecutó exactamente $ESPERADAS afirmaciones OK" >&2; exit 1; }
}

echo "Esquema 001-243 listo en $DB."
integral "preflight 244" "$AQUI/preflight_244_programa_hotel_vigencia_noches.sql"
aplica "$MIG244"; echo "migración 244 aplicada"
integral "postcheck 244" "$AQUI/postcheck_244_programa_hotel_vigencia_noches.sql"
pruebas "244" "$AQUI/test_244_programa_hotel_vigencia_noches.sql"

integral "preflight 245" "$AQUI/preflight_245_programa_hotel_asistencia_trm.sql"
aplica "$MIG245"; echo "migración 245 aplicada"
integral "postcheck 245" "$AQUI/postcheck_245_programa_hotel_asistencia_trm.sql"
pruebas "245" "$AQUI/test_245_programa_hotel_asistencia_trm.sql"
compara "las pruebas terminaron en ROLLBACK (no dejaron programas de prueba)" "$(consulta "select count(*) from public.programas where nombre like '__t24%'")" 0

echo "=== rollback 245 (candado de datos) ==="
$PS -d "$DB" <<'SQL' >/dev/null
insert into public.proveedores (nombre) values ('PROV R245 ROLLBACK');
insert into public.ventas (numero_contrato, cliente, fecha_salida, pax, precio_venta, estado, tenant)
values ('DTM-9245', 'Cliente', date '2027-03-01', 2, 100, 'pendiente', 'mayorista');
insert into public.contrato_programa_estancia_costo (numero_contrato, moneda, neto_base, neto_noches, asistencia_noches, asistencia_total, trm_costo, detalle_noches)
values ('DTM-9245', 'USD', 100, 0, 0, 24, 4000, '[]'::jsonb);
SQL
if SAL="$($PS -d "$DB" -1 < "$AQUI/rollback_245_programa_hotel_asistencia_trm.sql" 2>&1)"; then echo "FALLO: el rollback NO abortó con TRM/asistencia congeladas" >&2; exit 1; fi
echo "$SAL" | grep -q "ABORTADO: hay 1 fila" || { echo "FALLO: el aborto no dio el mensaje esperado: $SAL" >&2; exit 1; }
echo "OK  el rollback aborta si hay asistencia/TRM congeladas"
compara "las columnas siguen ahí tras el aborto" "$(consulta "select count(*) from information_schema.columns where table_schema='public' and table_name='contrato_programa_estancia_costo' and column_name='trm_costo'")" 1
{ echo "set app.rollback_245_con_datos = 'si';"; cat "$AQUI/rollback_245_programa_hotel_asistencia_trm.sql"; } | $PS -d "$DB" >/dev/null || { echo "FALLO: el rollback confirmado falló" >&2; exit 1; }
compara "columnas de la 245 retiradas" "$(consulta "select count(*) from information_schema.columns where table_schema='public' and ((table_name='programas' and column_name='proveedor_asistencia_id') or (table_name='contrato_programa_estancia_costo' and column_name in ('asistencia_total','proveedor_asistencia_id','trm_costo')))")" 0
compara "vínculos a CxP de la 244 restituidos" "$(consulta "select count(*) from information_schema.columns where table_schema='public' and table_name='contrato_programa_estancia_costo' and column_name in ('cxp_programa_id','cxp_noches_id')")" 2
compara "restricciones de la 245 retiradas" "$(consulta "select count(*) from pg_constraint where conname in ('contrato_programa_estancia_costo_asistencia_check','contrato_programa_estancia_costo_trm_check','programas_modo_hotel_terrestre_chk')")" 0
compara "el registro de costo NO se borró (solo sus columnas)" "$(consulta "select count(*) from public.contrato_programa_estancia_costo where numero_contrato = 'DTM-9245'")" 1
$PS -d "$DB" -c "delete from public.ventas where numero_contrato = 'DTM-9245'" >/dev/null
if SAL="$($PS -d "$DB" < "$AQUI/rollback_245_programa_hotel_asistencia_trm.sql" 2>&1)"; then echo "FALLO: un segundo rollback NO falló" >&2; exit 1; fi
echo "$SAL" | grep -q "la 245 no está aplicada" || { echo "FALLO: el segundo rollback no dio el error esperado: $SAL" >&2; exit 1; }
echo "OK  segundo rollback aborta con claridad"

echo "=== reaplicar 245 ==="
integral "preflight 245 (tras rollback)" "$AQUI/preflight_245_programa_hotel_asistencia_trm.sql"
aplica "$MIG245"; echo "migración 245 reaplicada"
aplica "$MIG245"; echo "migración 245 aplicada una segunda vez seguida (idempotente)"
integral "postcheck 245 (reaplicada)" "$AQUI/postcheck_245_programa_hotel_asistencia_trm.sql"
pruebas "245 (reaplicada)" "$AQUI/test_245_programa_hotel_asistencia_trm.sql"
echo "TODO OK"
