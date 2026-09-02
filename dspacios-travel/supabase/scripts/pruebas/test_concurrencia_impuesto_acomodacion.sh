#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Prueba de CONCURRENCIA REAL para guardar_programa_salidas() (migración 163,
# `impuestoPorAcomodacion`). Usa DOS conexiones psql simultáneas de verdad
# (una en segundo plano) contra una base local — no es una simulación ni una
# prueba de wiring por texto. Mismo patrón que
# test_concurrencia_modalidad_mk.sh (migración 161), aplicado al campo nuevo.
#
# Qué demuestra:
#   · La conexión A toma el lock de la fila (SELECT ... FOR UPDATE dentro del
#     RPC) y lo retiene mientras "trabaja" (pg_sleep).
#   · La conexión B, que intenta guardar el MISMO programa mientras A tiene
#     el lock, debe ESPERAR (se mide el tiempo real transcurrido).
#   · Caso 1 (A hace COMMIT con impuestoPorAcomodacion=true): B usa un
#     payload SIN esa clave (cliente viejo) — debe heredar el valor que A
#     dejó al confirmar (true), no una lectura tomada antes de esperar el
#     lock.
#   · Caso 2 (A2 intenta apagarla con impuestoPorAcomodacion=false pero hace
#     ROLLBACK): B2 (mismo payload viejo) debe heredar el valor de ANTES de
#     A2 (true, del caso 1), no el que A2 intentó dejar (false).
#
# Uso:
#   bash supabase/scripts/pruebas/test_concurrencia_impuesto_acomodacion.sh [puerto] [nombre_base]
#
# Requiere PostgreSQL local corriendo (ver local-desde-cero.sh) y `bc`/`date`
# con soporte de nanosegundos (coreutils estándar en Linux).
# ─────────────────────────────────────────────────────────────────────────────
set -u

PUERTO="${1:-5432}"
BASE="${2:-dspacios_concurrencia_impuesto_acom}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ok=0
mal=0
assert() { # $1 = "true"/"false" (ya evaluado), $2 = mensaje
  if [ "$1" = "true" ]; then
    ok=$((ok + 1)); echo "  OK: $2"
  else
    mal=$((mal + 1)); echo "  FALLÓ: $2"
  fi
}

echo "== Construyendo base '$BASE' desde cero (todas las migraciones, incl. 163) =="
if ! bash "$AQUI/local-desde-cero.sh" "$BASE" "$PUERTO" > /tmp/concurrencia_impuesto_acom_build.log 2>&1; then
  echo "No se pudo construir la base — ver /tmp/concurrencia_impuesto_acom_build.log"
  tail -30 /tmp/concurrencia_impuesto_acom_build.log
  exit 1
fi

CONN=(psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1)

echo "== Fixture: usuario operaciones + programa base =="
"${CONN[@]}" -q <<'SQL'
insert into auth.users (id, email) values ('77777777-7777-7777-7777-777777777777', 'conc2@test.com')
  on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo) values
  ('77777777-7777-7777-7777-777777777777', 'conc2@test.com', 'Conc2', 'operaciones', true)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo;
insert into public.programas (id, nombre, moneda, modo_precio) values (9501, 'Programa concurrencia impuesto acom', 'USD', 'salida')
  on conflict (id) do nothing;
SQL
if [ $? -ne 0 ]; then echo "No se pudo preparar el fixture"; exit 1; fi

AUTH_SQL="set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','77777777-7777-7777-7777-777777777777','role','authenticated')::text, true);"

# ─────────────────────────────────────────────────────────────────────────
# CASO 1 — A activa impuestoPorAcomodacion=true y hace COMMIT; B (payload
# viejo, sin la clave) debe esperar y heredar true.
# ─────────────────────────────────────────────────────────────────────────
echo ""
echo "== Caso 1: A retiene el lock 3s y hace COMMIT (impuestoPorAcomodacion=true); B espera y hereda true =="

OUT_A=/tmp/concurrencia_impuesto_acom_a1.txt
OUT_B=/tmp/concurrencia_impuesto_acom_b1.txt
rm -f "$OUT_A" "$OUT_B"

psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 > "$OUT_A" 2>&1 <<SQL &
begin;
$AUTH_SQL
select public.guardar_programa_salidas(
  9501::bigint,
  '{"activa": true, "modo": "impuesto", "valor": 100000, "pctComision": 10, "modalidadMk": "historica", "impuestoPorAcomodacion": true}'::jsonb,
  '[{"orden":0,"etiqueta":"CONEXION_A","tarifa_sencilla":1000000,"impuesto_sencilla":100000}]'::jsonb
);
select pg_sleep(3);
commit;
SQL
PID_A=$!

sleep 1  # margen para que A ya haya tomado el lock antes de que B lo intente

T0=$(date +%s%N)
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 > "$OUT_B" 2>&1 <<SQL
begin;
$AUTH_SQL
select public.guardar_programa_salidas(
  9501::bigint,
  '{"activa": true, "modo": "impuesto", "valor": 50000, "pctComision": 8, "modalidadMk": "historica"}'::jsonb,
  '[{"orden":0,"etiqueta":"CONEXION_B","tarifa_sencilla":2000000,"impuesto_sencilla":60000}]'::jsonb
);
commit;
SQL
RC_B=$?
T1=$(date +%s%N)
wait "$PID_A"
RC_A=$?

ELAPSED_MS=$(( (T1 - T0) / 1000000 ))
echo "  (B tardó ${ELAPSED_MS}ms en completar; A retenía el lock por ~3000ms desde ~1000ms antes de que B empezara)"

[ "$RC_A" -eq 0 ] && v=true || v=false
assert "$v" "conexión A (COMMIT) terminó sin error"
[ "$RC_B" -eq 0 ] && v=true || v=false
assert "$v" "conexión B terminó sin error (nota: B hereda impuestoPorAcomodacion=true de A, así que su propia salida DEBE traer impuesto_sencilla o el RPC la rechazaría — confirma que la herencia se aplica de verdad, no solo se lee)"
[ "$ELAPSED_MS" -ge 1500 ] && v=true || v=false
assert "$v" "B esperó el lock de A (>=1500ms; si hubiera 'colado' su UPDATE/DELETE/INSERT sin esperar, esto sería <100ms)"

OPCION_FINAL=$(psql -p "$PUERTO" -d "$BASE" -tA -c "select regla_comisionable_valor || '|' || regla_comisionable_pct_comision || '|' || regla_comisionable_impuesto_por_acomodacion from public.programas where id=9501;")
[ "$OPCION_FINAL" = "50000.0000|8.0000|true" ] && v=true || v=false
assert "$v" "regla final = SOLO la de B (valor=50000,pctComision=8), con la opción que A dejó (true) — obtenido: '$OPCION_FINAL'"

CANT_SALIDAS=$(psql -p "$PUERTO" -d "$BASE" -tA -c "select count(*) from public.programa_salidas where programa_id=9501;")
ETIQUETAS=$(psql -p "$PUERTO" -d "$BASE" -tA -c "select string_agg(etiqueta, ',') from public.programa_salidas where programa_id=9501;")
[ "$CANT_SALIDAS" = "1" ] && v=true || v=false
assert "$v" "solo queda 1 salida (nunca mezcla A+B) — obtenido: $CANT_SALIDAS"
[ "$ETIQUETAS" = "CONEXION_B" ] && v=true || v=false
assert "$v" "la salida final es la de B (el último commit gana completo) — obtenido: '$ETIQUETAS'"

# ─────────────────────────────────────────────────────────────────────────
# CASO 2 — A2 intenta apagar la opción (impuestoPorAcomodacion=false) pero
# hace ROLLBACK; B2 (payload viejo) debe heredar el valor de ANTES de A2
# (true, del caso 1), nunca el que A2 intentó dejar.
# ─────────────────────────────────────────────────────────────────────────
echo ""
echo "== Caso 2: A2 intenta apagar la opción pero hace ROLLBACK; B2 espera y NO hereda el intento de A2 =="

OUT_A2=/tmp/concurrencia_impuesto_acom_a2.txt
OUT_B2=/tmp/concurrencia_impuesto_acom_b2.txt
rm -f "$OUT_A2" "$OUT_B2"

psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 > "$OUT_A2" 2>&1 <<SQL &
begin;
$AUTH_SQL
select public.guardar_programa_salidas(
  9501::bigint,
  '{"activa": true, "modo": "impuesto", "valor": 999, "pctComision": 20, "modalidadMk": "historica", "impuestoPorAcomodacion": false}'::jsonb,
  '[{"orden":0,"etiqueta":"CONEXION_A2","tarifa_sencilla":300}]'::jsonb
);
select pg_sleep(3);
rollback;
SQL
PID_A2=$!

sleep 1

T2=$(date +%s%N)
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 > "$OUT_B2" 2>&1 <<SQL
begin;
$AUTH_SQL
select public.guardar_programa_salidas(
  9501::bigint,
  '{"activa": true, "modo": "impuesto", "valor": 15000, "pctComision": 15, "modalidadMk": "historica"}'::jsonb,
  '[{"orden":0,"etiqueta":"CONEXION_B2","tarifa_sencilla":250000,"impuesto_sencilla":9000}]'::jsonb
);
commit;
SQL
RC_B2=$?
T3=$(date +%s%N)
wait "$PID_A2"
RC_A2=$?

ELAPSED_MS2=$(( (T3 - T2) / 1000000 ))
echo "  (B2 tardó ${ELAPSED_MS2}ms en completar; A2 retenía el lock por ~3000ms antes de hacer ROLLBACK)"

[ "$RC_A2" -eq 0 ] && v=true || v=false
assert "$v" "conexión A2 (ROLLBACK explícito, sin error de psql) terminó su script sin error"
[ "$RC_B2" -eq 0 ] && v=true || v=false
assert "$v" "conexión B2 terminó sin error"
[ "$ELAPSED_MS2" -ge 1500 ] && v=true || v=false
assert "$v" "B2 esperó el lock de A2 (>=1500ms)"

OPCION_FINAL2=$(psql -p "$PUERTO" -d "$BASE" -tA -c "select regla_comisionable_valor || '|' || regla_comisionable_pct_comision || '|' || regla_comisionable_impuesto_por_acomodacion from public.programas where id=9501;")
[ "$OPCION_FINAL2" = "15000.0000|15.0000|true" ] && v=true || v=false
assert "$v" "regla final = SOLO la de B2 (valor=15000,pctComision=15), con la opción de ANTES de A2 (true, del caso 1 — NUNCA false, que A2 intentó pero revirtió) — obtenido: '$OPCION_FINAL2'"

CANT_SALIDAS2=$(psql -p "$PUERTO" -d "$BASE" -tA -c "select count(*) from public.programa_salidas where programa_id=9501;")
ETIQUETAS2=$(psql -p "$PUERTO" -d "$BASE" -tA -c "select string_agg(etiqueta, ',') from public.programa_salidas where programa_id=9501;")
[ "$CANT_SALIDAS2" = "1" ] && v=true || v=false
assert "$v" "solo queda 1 salida tras el caso 2 (nunca mezcla A2+B2, ni sobrevive nada de A2) — obtenido: $CANT_SALIDAS2"
[ "$ETIQUETAS2" = "CONEXION_B2" ] && v=true || v=false
assert "$v" "la salida final es la de B2 — obtenido: '$ETIQUETAS2'"

# ─────────────────────────────────────────────────────────────────────────
echo ""
echo "== Limpieza =="
psql -p "$PUERTO" -d postgres -c "drop database if exists $BASE;" > /dev/null 2>&1

echo ""
echo "== Resumen: $ok OK, $mal FALLÓ =="
if [ "$mal" -gt 0 ]; then
  echo "PRUEBA DE CONCURRENCIA FALLÓ"
  exit 1
fi
echo "TODAS LAS PRUEBAS DE CONCURRENCIA PASARON"
exit 0
