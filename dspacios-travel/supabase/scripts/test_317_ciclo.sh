#!/usr/bin/env bash
# Ciclo de la migración 317 sobre una copia DESECHABLE del esquema real (plantilla con 001-314): preflight -> 317 -> postcheck -> la 317 NO se reaplica (guardas) ->
# batería test_317_neto_manual.sql -> rollback (se niega con un NETO independiente sellado) -> rollback limpio -> preflight vuelve a «falta aplicar» -> 317 de nuevo.
# Uso (desde dspacios-travel/):  bash supabase/scripts/test_317_ciclo.sh <contenedor> <plantilla>     p. ej.  pgb2b plantillab2b
set -u -o pipefail
export MSYS_NO_PATHCONV=1
CT="${1:-pgb2b}"; PL="${2:-plantillab2b}"; DB=t317ciclo
A=(docker exec -e PGPASSWORD=postgres -w /tmp/s317 "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -P pager=off)
FALLOS=0; FASES=0
f() { echo "FALLO: $1"; FALLOS=$((FALLOS+1)); }
ok() { FASES=$((FASES+1)); }
docker exec "$CT" rm -rf /tmp/s317; docker exec "$CT" mkdir -p /tmp/s317
for x in supabase/scripts/test_216_fixtures.sql supabase/scripts/test_211_fixtures.sql supabase/scripts/test_222_fixtures.sql supabase/scripts/test_317_neto_manual.sql \
         supabase/scripts/preflight_317_neto_manual.sql supabase/scripts/postcheck_317_neto_manual.sql supabase/scripts/rollback_317_neto_manual.sql \
         supabase/migrations/20260601000317_neto_cotizacion_manual_independiente.sql; do docker cp "$x" "$CT:/tmp/s317/$(basename "$x")" >/dev/null || { f "no se pudo copiar $x"; }; done
"${A[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB template $PL" >/dev/null 2>&1 || { echo "RESULTADO: FALLO — no se pudo crear la base"; exit 2; }
Q=("${A[@]}" -d "$DB")
M=20260601000317_neto_cotizacion_manual_independiente.sql
control() { # etiqueta archivo patrón_esperado_en_la_columna_observado
  local s; s="$("${Q[@]}" -v ON_ERROR_STOP=1 -f "$2" 2>&1)"; local rc=$?
  printf '%s\n' "$s"
  if [ $rc -ne 0 ]; then f "$1 — error de SQL"; return 1; fi
  if printf '%s\n' "$s" | grep -Eq '\|[[:space:]]*(FALLO|REVISAR)[[:space:]]*$'; then f "$1 — control en FALLO/REVISAR"; return 1; fi
  printf '%s\n' "$s" | grep -Eq '\|[[:space:]]*(OK|INFO)[[:space:]]*$' || { f "$1 — sin filas de control"; return 1; }
  ok
}
echo "== 1 preflight (falta aplicar)"; control preflight preflight_317_neto_manual.sql; "${Q[@]}" -At -f preflight_317_neto_manual.sql | grep -E "falta aplicar" | wc -l | grep -q 2 || f "el preflight no mostró 'falta aplicar' en las dos funciones"
echo "== 2 migración 317"; "${Q[@]}" -v ON_ERROR_STOP=1 -f $M 2>&1 | tail -3; [ ${PIPESTATUS[0]} -eq 0 ] && ok || f "317"
echo "== 3 postcheck"; control postcheck postcheck_317_neto_manual.sql
echo "== 4 la 317 no se reaplica (guardas)"; if "${Q[@]}" -v ON_ERROR_STOP=1 -f $M >/dev/null 2>&1; then f "la 317 se reaplicó sin queja"; else ok; fi
echo "== 5 batería de pruebas"; s="$("${Q[@]}" -v ON_ERROR_STOP=1 -f test_317_neto_manual.sql 2>&1)"; printf '%s\n' "$s" | grep -E "^ +[0-9]+ \||FALLO|ERROR"; printf '%s\n' "$s" | grep -Eq '^ +[0-9]+ \| +0 \|' && ok || f "batería con fallos"
echo "== 6 rollback se niega con un NETO independiente sellado"
# Sembramos la evidencia COMMITEADA con una transacción propia usando las funciones reales.
docker exec -i -e PGPASSWORD=postgres -w /tmp/s317 "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -q -v ON_ERROR_STOP=1 -f - >/tmp/semilla317.log 2>&1 <<'SQL'
\set vect '[]'
\ir test_216_fixtures.sql
\ir test_211_fixtures.sql
\ir test_222_fixtures.sql
select public.crear_cotizacion_manual_neto(t216.u('admin'), 'mayorista', jsonb_set(t216.cab('agencia', 0, 0, 0, 'COP', 5000000), '{payload,recobroAliado}', '0'),
  jsonb_build_array(
   jsonb_build_object('orden',0,'tipo_servicio','aereo','plataforma','D','nombre_servicio','A','proveedor','P','costo_neto',800000,'modo','mk','pct_markup',0.2,'ta',0,'valor',1000000),
   jsonb_build_object('orden',1,'tipo_servicio','hotel','plataforma','B','nombre_servicio','H','proveedor','P','costo_neto',3200000,'modo','mk','pct_markup',0.2,'ta',0,'valor',4000000)), 922201, false, false);
SQL
[ "$("${Q[@]}" -At -c "select count(*) from public.cotizacion_neto where modalidad = 'neto'")" = 1 ] || f "la semilla de evidencia no se creó (ver semilla317.log)"
if "${Q[@]}" -v ON_ERROR_STOP=1 -f rollback_317_neto_manual.sql >/dev/null 2>&1; then f "el rollback NO se negó con un NETO independiente sellado"; else ok; fi
echo "   (la 317 sigue aplicada:)"; "${Q[@]}" -At -c "select to_regprocedure('public.crear_cotizacion_manual_neto(uuid,text,jsonb,jsonb,bigint,boolean,boolean)') is not null" | grep -q t && ok || f "la función desapareció pese al rechazo"
echo "== 7 rollback limpio (base nueva, sin evidencia)"
"${A[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB template $PL" >/dev/null 2>&1
"${Q[@]}" -v ON_ERROR_STOP=1 -f $M >/dev/null 2>&1
"${Q[@]}" -v ON_ERROR_STOP=1 -f rollback_317_neto_manual.sql 2>&1 | tail -1; [ ${PIPESTATUS[0]} -eq 0 ] && ok || f "rollback"
"${Q[@]}" -At -c "select to_regprocedure('public.crear_cotizacion_manual_neto(uuid,text,jsonb,jsonb,bigint,boolean,boolean)') is null" | grep -q t && ok || f "la función nueva sigue existiendo"
control "preflight tras rollback" preflight_317_neto_manual.sql; "${Q[@]}" -At -f preflight_317_neto_manual.sql | grep -c "falta aplicar" | grep -q 2 && ok || f "tras el rollback el preflight no vuelve a 'falta aplicar'"
echo "== 8 317 de nuevo"; "${Q[@]}" -v ON_ERROR_STOP=1 -f $M >/dev/null 2>&1 && ok || f "317 tras rollback"; control "postcheck final" postcheck_317_neto_manual.sql
"${A[@]}" -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
if [ "$FALLOS" -eq 0 ] && [ "$FASES" -ge 13 ]; then echo "RESULTADO: TODO OK ($FASES comprobaciones)"; exit 0; fi
echo "RESULTADO: FALLO — fallos=$FALLOS comprobaciones=$FASES"; exit 1
