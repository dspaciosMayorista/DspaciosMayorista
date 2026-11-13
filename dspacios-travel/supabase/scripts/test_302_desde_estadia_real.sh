#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL de la migración 302 (#43/#60 entrega 6). NUNCA contra una base real.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_302_desde_estadia_real.sh <contenedor> <plantilla>
#   Cadena 293 → 301 → preflight 302 → 302 → postcheck (mismas filas y huella) → reaplicar → CHECK (porción sí, otro módulo no, > 30 no)
#   → la vista publicable la expone → rollback protegido (aborta con justificaciones) → limpiar → rollback → sin columna → reaplicar.
#   El insertor monolítico y el de lotes se ejercitan de verdad en cierre_43_precios_antiguos.sh (generación real, con y sin lotes).
# ─────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; DB="t302_$$"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
SQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
trap '$SQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
$SQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$SQL -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for f in supabase/scripts/fixture_293_vigencia_grupos_dias.sql supabase/migrations/20260601000295_grupos_dias_propuesta.sql \
         supabase/scripts/fixture_295_grupos_dias_propuesta.sql supabase/migrations/20260601000297_calculadora_grupos_dias.sql \
         supabase/scripts/fixture_297_calculadora_grupos_dias.sql supabase/migrations/20260601000299_grupos_dias_activacion.sql \
         supabase/scripts/fixture_299_grupos_dias_activacion.sql supabase/migrations/20260601000300_promociones_grupo.sql \
         supabase/migrations/20260601000301_promociones_acumulacion.sql; do
  $SQL -d "$DB" < "$f" >/dev/null 2>&1 || { echo "No se pudo cargar $f"; exit 2; }
done
lectura() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -q -v ON_ERROR_STOP=1 -At -F '|' < "$1"; }
todos_ok() { for c in $2; do e="$(echo "$1" | awk -F'|' -v o="$c" '$1 == o { print $5 }')"; [ "$e" = OK ] || { fallo "$3 control $c = ${e:-∅}"; return; }; done; ok "$3: controles $2 en OK"; }
campo() { echo "$1" | awk -F'|' -v o="$2" '$1 == o { print $3 }'; }
q() { $SQL -d "$DB" -At -c "$1"; }
MIG=supabase/migrations/20260601000302_desde_estadia_real.sql
ROLL=supabase/scripts/rollback_302_desde_estadia_real.sql

q "insert into public.armado_paquetes (id, nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches, moneda_publicacion) values (9399, 'T302', 9301, '2027-06-01', '2027-06-30', 0.2, 'porcion_terrestre', 3, 'COP')" >/dev/null
# Una fila de porción existente para comparar huellas (la 302 no debe tocarla).
q "insert into public.tarifario_resultado (paquete_id, paquete_nombre, paquete_activo, modulo, hotel_id, hotel_nombre, categoria, regimen, acomodacion, noches, fecha_ida, fecha_regreso, base_comisionable, impuesto, precio_pvp, moneda)
   select p.id, 'T302', true, 'porcion_terrestre', h.id, h.nombre, 'Estándar', 'PAM', 'doble', 3, '2027-06-01', '2027-06-30', 0, 0, 123000, 'COP'
     from public.armado_paquetes p, public.hoteles h order by p.id, h.id limit 1" >/dev/null

echo "--- preflight 302"
PRE="$(lectura supabase/scripts/preflight_302_desde_estadia_real.sql)"; echo "$PRE"
todos_ok "$PRE" "1 2 3 4" "preflight"
echo "--- 302"
if ERR="$($SQL -d "$DB" < $MIG 2>&1)"; then ok "302 aplicada"; else echo "$ERR" | tail -5; fallo "302 no se aplicó"; exit 1; fi
POST="$(lectura supabase/scripts/postcheck_302_desde_estadia_real.sql)"; echo "$POST"
todos_ok "$POST" "1 2 3 4 5 6 9" "postcheck"
[ "$(campo "$POST" 7)" = "$(campo "$PRE" 5)" ] && ok "mismas filas" || fallo "cambió el número de filas"
[ "$(campo "$POST" 8)" = "$(campo "$PRE" 7)" ] && ok "misma huella id:precio" || fallo "cambió algún precio"
$SQL -d "$DB" < $MIG >/dev/null 2>&1 && ok "la 302 se reaplica sin error" || fallo "la 302 no es reaplicable"

echo "--- columna y CHECK"
ID="$(q "select id from public.tarifario_resultado where paquete_nombre = 'T302'")"
q "update public.tarifario_resultado set desde_entrada = '2027-06-07' where id = $ID" >/dev/null 2>&1 && ok "porción con justificación: aceptada" || fallo "porción con justificación rechazada"
q "update public.tarifario_resultado set modulo = 'bloqueo' where id = $ID" >/dev/null 2>&1 && fallo "otro módulo con desde_entrada aceptado" || ok "otro módulo con desde_entrada: rechazado"
q "update public.tarifario_resultado set noches = 31 where id = $ID" >/dev/null 2>&1 && fallo "31 noches aceptadas" || ok "más de 30 noches: rechazado"
[ "$(q "select count(*) from information_schema.columns where table_name = 'tarifario_resultado_publicable' and column_name = 'desde_entrada'")" = 1 ] && ok "la vista publicable expone desde_entrada" || fallo "la vista no la expone"
[ "$(q "select desde_entrada_doble::text from public.tarifario_resumen where paquete_id = 9399")" = 2027-06-07 ] && ok "tarifario_resumen expone la entrada del «desde» doble" || fallo "tarifario_resumen sin desde_entrada_doble"
# Equivalencia de los insertores: el cuerpo nuevo, quitando lo añadido, es el original.
for fn in "publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb)" "tarifario_lote_agregar_i(bigint, bigint, integer, text)"; do
  n="$(q "select (length(prosrc) - length(replace(prosrc, 'desde_entrada', ''))) / length('desde_entrada') from pg_proc where oid = 'public.$fn'::regprocedure")"
  [ "$n" -ge 2 ] && ok "$fn escribe desde_entrada (lista y valor)" || fallo "$fn sin desde_entrada"
done

echo "--- rollback protegido"
if R="$($SQL -d "$DB" < $ROLL 2>&1)"; then fallo "el rollback NO abortó con justificaciones"; else echo "$R" | grep -o 'ROLLBACK 302 ABORTADO[^.]*' | head -1; ok "rollback abortado (protegido)"; fi
q "update public.tarifario_resultado set desde_entrada = null" >/dev/null
if $SQL -d "$DB" < $ROLL >/dev/null 2>&1; then ok "rollback aplicado"; else fallo "rollback no se aplicó"; fi
[ "$(q "select count(*) from information_schema.columns where column_name = 'desde_entrada' and table_schema = 'public'")" = 0 ] && ok "rollback: sin la columna (tabla y vista)" || fallo "rollback incompleto"
[ "$(q "select (has_table_privilege('anon', 'public.tarifario_resultado_publicable', 'select') and has_table_privilege('authenticated', 'public.tarifario_resumen', 'select'))::text")" = true ] \
  && ok "rollback: la vista y sus dependientes (tarifario_resumen) recreadas con sus permisos" || fallo "vista o dependientes rotos tras el rollback"
[ "$(q "select count(*) from public.tarifario_resumen where false")" = 0 ] && ok "rollback: tarifario_resumen legible" || fallo "tarifario_resumen rota"
[ "$(q "select position('desde_entrada' in prosrc) from pg_proc where oid = 'public.tarifario_lote_agregar_i(bigint, bigint, integer, text)'::regprocedure")" = 0 ] && ok "rollback: insertores originales" || fallo "rollback: insertores sin restaurar"
$SQL -d "$DB" < $MIG >/dev/null 2>&1 && ok "reaplicar tras el rollback" || fallo "no se reaplica tras el rollback"
POST2="$(lectura supabase/scripts/postcheck_302_desde_estadia_real.sql)"
todos_ok "$POST2" "1 2 3 4 5 6 9" "postcheck tras reaplicar"

echo "=== $FALLOS fallo(s)"
[ "$FALLOS" -eq 0 ]
