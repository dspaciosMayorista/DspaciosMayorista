#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# PR #409 · Verificación local, EN ORDEN, de la migración 247 (incluye la concurrencia real: test_247_concurrencia.sh) (alcance de los blackouts de un programa + guardado atómico) sobre 001-243 + 244 + 245:
#   blackouts "viejos" sembrados ANTES → preflight 247 → 247 → postcheck 247 → los viejos conservan «entrada» y no se tocan
#   → pruebas SQL → inventario de itinerarios → rollback 247 (con su candado de datos) → reaplicar 247 dos veces → postcheck → pruebas.
# SOLO Docker local y desechable. Crea una base NUEVA desde la plantilla y la borra al final (KEEP=1 la conserva).
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_247_programa_blackout_alcance.sh <base_nueva> [contenedor_pg] [plantilla]
#     base_nueva    ^t246_[a-z0-9_]{1,40}$ y que NO exista.
#     plantilla     base con 001-243 (preparar_esquema_local.sh <contenedor> 243 plantilla243).
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg245e88}"
PLANTILLA="${3:-plantilla243}"
export MSYS_NO_PATHCONV=1
ok_nombre() { printf '%s' "$1" | grep -Eq "$2"; }
ok_nombre "$DB" '^t246_[a-z0-9_]{1,40}$' || { echo "Base inválida: ^t246_[a-z0-9_]{1,40}\$." >&2; exit 2; }
ok_nombre "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
ok_nombre "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
MIG244="$APP/supabase/migrations/20260601000244_programa_hotel_vigencia_noches.sql"
MIG245="$APP/supabase/migrations/20260601000245_programa_hotel_asistencia_trm.sql"
MIG246="$APP/supabase/migrations/20260601000246_programa_traslados.sql"
MIG247="$APP/supabase/migrations/20260601000247_programa_blackout_alcance.sql"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
MARCA="test_247_programa_blackout_alcance $$"

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
aplica "$MIG244"; aplica "$MIG245"; echo "migraciones 244 y 245 aplicadas (base de partida)"
# Reproduce uno de los cinco itinerarios históricos antes de reclasificarlo.
$PS -d "$DB" >/dev/null <<'SQL'
insert into public.programas (id, nombre, dias, noches, moneda, modo_precio, tipo_transporte, publicado)
values (7, '__traslado_historico__', 5, 4, 'COP', 'salida', 'terrestre', true);
insert into public.programa_dias (programa_id, dia, titulo) values
  (7,1,'Medellín - Villavicencio'),(7,2,'Tour 1'),(7,3,'Tour 2'),
  (7,4,'Tour 3'),(7,5,'Día libre'),(7,6,'Regreso');
SQL
integral "preflight 246" "$AQUI/preflight_246_programa_traslados.sql"
aplica "$MIG246"; echo "migración 246 aplicada"
integral "postcheck 246" "$AQUI/postcheck_246_programa_traslados.sql"
compara "traslado histórico reclasificado" "$(consulta "select dia::text || '/' || tipo_tramo from public.programa_dias where programa_id=7 and titulo='Medellín - Villavicencio'")" '0/traslado_previo'
compara "cinco días turísticos intactos" "$(consulta "select count(*) from public.programa_dias where programa_id=7 and tipo_tramo='dia' and dia between 1 and 5")" 5
aplica "$MIG246"; echo "migración 246 reaplicada sin cambios"
aplica "$AQUI/rollback_246_programa_traslados.sql"
compara "rollback 246 restaura los seis días originales" "$(consulta "select count(*) from public.programa_dias where programa_id=7 and dia between 1 and 6")" 6
integral "preflight 246 tras rollback" "$AQUI/preflight_246_programa_traslados.sql"
aplica "$MIG246"
integral "postcheck 246 reaplicada" "$AQUI/postcheck_246_programa_traslados.sql"
# La fixture de id 7 no pertenece a la plantilla; retirarla antes de las pruebas
# heredadas, que crean programas con la secuencia desde 1.
$PS -d "$DB" -c "delete from public.programas where id=7 and nombre='__traslado_historico__'" >/dev/null

# Datos «de producción» sembrados ANTES de la 247: dos blackouts válidos y uno con un solo extremo (que la 247 NO debe tocar ni rechazar).
$PS -d "$DB" >/dev/null <<'SQL'
insert into public.programas (id, nombre, dias, noches, moneda, modo_precio, tipo_transporte, publicado) values
  (246001, '__t246_viejo__', 4, 3, 'USD', 'categoria', 'ninguno', true),
  (246002, '__t246_publicado_incompleto__', 4, 3, 'USD', 'categoria', 'ninguno', true),
  (246003, '__t246_publicado_completo__', 3, 2, 'USD', 'categoria', 'ninguno', true),
  (246004, '__t246_borrador_incompleto__', 4, 3, 'USD', 'categoria', 'ninguno', false);
insert into public.programa_blackouts (programa_id, fecha_inicio, fecha_fin, motivo) values
  (246001, '2027-03-10', '2027-03-12', 'viejo 1'),
  (246001, '2027-04-01', '2027-04-01', 'viejo 2'),
  (246001, '2027-05-01', null, 'viejo con un solo extremo');
insert into public.programa_dias (programa_id, dia, titulo) values
  (246002, 1, 'Día 1'), (246002, 2, 'Día 2'), (246002, 4, 'Día 4'),
  (246003, 1, 'Día 1'), (246003, 2, 'Día 2'), (246003, 3, 'Día 3'),
  (246004, 1, 'Día 1');
SQL

integral "preflight 247" "$AQUI/preflight_247_programa_blackout_alcance.sql"
aplica "$MIG247"; echo "migración 247 aplicada"
integral "postcheck 247" "$AQUI/postcheck_247_programa_blackout_alcance.sql"
compara "los 3 blackouts viejos siguen ahí" "$(consulta "select count(*) from public.programa_blackouts where programa_id = 246001")" 3
compara "todos conservan el alcance «entrada»" "$(consulta "select count(*) from public.programa_blackouts where programa_id = 246001 and alcance = 'entrada'")" 3
compara "el blackout viejo con un solo extremo NO se tocó" "$(consulta "select count(*) from public.programa_blackouts where programa_id = 246001 and fecha_fin is null")" 1
pruebas "246" "$AQUI/test_247_programa_blackout_alcance.sql"
compara "las pruebas terminaron en ROLLBACK (no dejaron programas de prueba)" "$(consulta "select count(*) from public.programas where nombre = '__t246_programa__'")" 0
echo "=== concurrencia real ==="
sh "$AQUI/test_247_concurrencia.sh" "$CT" "$DB"

echo "=== inventario de itinerarios incompletos (solo lectura) ==="
INV="$($PS -t -A -F ' | ' -d "$DB" < "$AQUI/inventario_programas_itinerario_247.sql")"
echo "$INV"
compara "el inventario marca el publicado incompleto (falta el día 3)" "$(echo "$INV" | grep -c '^246002 | .* | 3 |.* | INCOMPLETO$')" 1
compara "el inventario marca el publicado sin días cargados" "$(echo "$INV" | grep -c '^246001 | .* | INCOMPLETO$')" 1
compara "el inventario da OK al publicado completo" "$(echo "$INV" | grep -c '^246003 | .* | OK$')" 1
compara "el inventario ignora el borrador" "$(echo "$INV" | grep -c '^246004 |')" 0

echo "=== rollback 246 (candado de datos) ==="
$PS -d "$DB" -c "insert into public.programa_blackouts (programa_id, fecha_inicio, fecha_fin, motivo, alcance) values (246001, '2027-06-01', '2027-06-05', 'nuevo viaje', 'viaje')" >/dev/null
if SAL="$($PS -d "$DB" -1 < "$AQUI/rollback_247_programa_blackout_alcance.sql" 2>&1)"; then echo "FALLO: el rollback NO abortó con un blackout de alcance «viaje»" >&2; exit 1; fi
echo "$SAL" | grep -q "ABORTADO: hay 1 blackout" || { echo "FALLO: el aborto no dio el mensaje esperado: $SAL" >&2; exit 1; }
echo "OK  el rollback aborta si hay blackouts de alcance «viaje»"
compara "la columna sigue ahí tras el aborto" "$(consulta "select count(*) from information_schema.columns where table_schema='public' and table_name='programa_blackouts' and column_name='alcance'")" 1
{ echo "set app.rollback_247_con_datos = 'si';"; cat "$AQUI/rollback_247_programa_blackout_alcance.sql"; } | $PS -d "$DB" >/dev/null || { echo "FALLO: el rollback confirmado falló" >&2; exit 1; }
compara "columna, restricciones y función retiradas" "$(consulta "select (select count(*) from information_schema.columns where table_schema='public' and table_name='programa_blackouts' and column_name='alcance') + (select count(*) from pg_constraint where conname in ('programa_blackouts_alcance_chk','programa_blackouts_extremos_chk')) + (select count(*) from pg_proc where proname = 'guardar_programa_blackouts')")" 0
compara "los blackouts NO se borraron (solo la columna)" "$(consulta "select count(*) from public.programa_blackouts where programa_id = 246001")" 4
if SAL="$($PS -d "$DB" < "$AQUI/rollback_247_programa_blackout_alcance.sql" 2>&1)"; then echo "FALLO: un segundo rollback NO falló" >&2; exit 1; fi
echo "$SAL" | grep -q "la 247 no está aplicada" || { echo "FALLO: el segundo rollback no dio el error esperado: $SAL" >&2; exit 1; }
echo "OK  segundo rollback aborta con claridad"

echo "=== reaplicar 246 ==="
integral "preflight 246 (tras rollback)" "$AQUI/preflight_247_programa_blackout_alcance.sql"
aplica "$MIG247"; echo "migración 247 reaplicada"
aplica "$MIG247"; echo "migración 247 aplicada una segunda vez seguida (idempotente)"
integral "postcheck 246 (reaplicada)" "$AQUI/postcheck_247_programa_blackout_alcance.sql"
compara "tras reaplicar, todos los blackouts quedan en «entrada»" "$(consulta "select count(*) from public.programa_blackouts where programa_id = 246001 and alcance = 'entrada'")" 4
pruebas "246 (reaplicada)" "$AQUI/test_247_programa_blackout_alcance.sql"
echo "=== concurrencia real (reaplicada) ==="
sh "$AQUI/test_247_concurrencia.sh" "$CT" "$DB"

echo "TODO OK"
