#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Prueba de CONCURRENCIA REAL para guardar_programa_salidas() (migración 161,
# revisión PR #277 ronda 2, punto 1). Usa DOS conexiones psql simultáneas de
# verdad (una en segundo plano) contra una base local — no es una simulación
# ni una prueba de wiring por texto.
#
# Qué demuestra:
#   · La conexión A toma el lock de la fila (SELECT ... FOR UPDATE dentro del
#     RPC) y lo retiene mientras "trabaja" (pg_sleep).
#   · La conexión B, que intenta guardar el MISMO programa mientras A tiene
#     el lock, debe ESPERAR (se mide el tiempo real transcurrido — si no
#     esperó, algo volvió a romper el aislamiento).
#   · Al terminar, el programa queda EXACTAMENTE como lo dejó el último
#     guardado que hizo commit — nunca una mezcla de la regla de uno con las
#     salidas del otro.
#   · Caso 1 (A hace COMMIT): B usa un payload SIN la clave `modalidadMk`
#     (cliente viejo) — debe heredar la modalidad que A dejó al confirmar,
#     no una lectura tomada antes de esperar el lock.
#   · Caso 2 (A hace ROLLBACK): B (con el mismo payload viejo) debe heredar
#     la modalidad de ANTES de A (porque A nunca confirmó), no la que A
#     intentó dejar.
#
# Uso:
#   bash supabase/scripts/pruebas/test_concurrencia_modalidad_mk.sh [puerto] [nombre_base]
#
# Requiere PostgreSQL local corriendo (ver local-desde-cero.sh) y `bc`/`date`
# con soporte de nanosegundos (coreutils estándar en Linux).
# ─────────────────────────────────────────────────────────────────────────────
set -u

PUERTO="${1:-5432}"
BASE="${2:-dspacios_concurrencia_mk}"
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

echo "== Construyendo base '$BASE' desde cero (todas las migraciones, incl. 161) =="
if ! bash "$AQUI/local-desde-cero.sh" "$BASE" "$PUERTO" > /tmp/concurrencia_build.log 2>&1; then
  echo "No se pudo construir la base — ver /tmp/concurrencia_build.log"
  tail -30 /tmp/concurrencia_build.log
  exit 1
fi

CONN=(psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1)

echo "== Fixture: usuario operaciones + programa base =="
"${CONN[@]}" -q <<'SQL'
insert into auth.users (id, email) values ('66666666-6666-6666-6666-666666666666', 'conc@test.com')
  on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo) values
  ('66666666-6666-6666-6666-666666666666', 'conc@test.com', 'Conc', 'operaciones', true)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo;
insert into public.programas (id, nombre, moneda, modo_precio) values (9401, 'Programa concurrencia', 'USD', 'salida')
  on conflict (id) do nothing;
SQL
if [ $? -ne 0 ]; then echo "No se pudo preparar el fixture"; exit 1; fi

AUTH_SQL="set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','66666666-6666-6666-6666-666666666666','role','authenticated')::text, true);"

# ─────────────────────────────────────────────────────────────────────────
# CASO 1 — A toma el lock y hace COMMIT; B (payload viejo, sin modalidadMk)
# debe esperar y heredar la modalidad que A dejó.
# ─────────────────────────────────────────────────────────────────────────
echo ""
echo "== Caso 1: A retiene el lock 3s y hace COMMIT; B espera y hereda la modalidad de A =="

OUT_A=/tmp/concurrencia_a1.txt
OUT_B=/tmp/concurrencia_b1.txt
rm -f "$OUT_A" "$OUT_B"

psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 > "$OUT_A" 2>&1 <<SQL &
begin;
$AUTH_SQL
select public.guardar_programa_salidas(
  9401::bigint,
  '{"activa": true, "modo": "pct", "valor": 3, "pctComision": 10, "modalidadMk": "base_neta_impuestos_al_final"}'::jsonb,
  '[{"orden":0,"etiqueta":"CONEXION_A","tarifa_sencilla":100,"neto_sencilla":91}]'::jsonb
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
  9401::bigint,
  '{"activa": true, "modo": "pct", "valor": 5, "pctComision": 8}'::jsonb,
  '[{"orden":0,"etiqueta":"CONEXION_B","tarifa_sencilla":200,"neto_sencilla":190}]'::jsonb
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
assert "$v" "conexión B terminó sin error"
[ "$ELAPSED_MS" -ge 1500 ] && v=true || v=false
assert "$v" "B esperó el lock de A (>=1500ms; si hubiera 'colado' su UPDATE/DELETE/INSERT sin esperar, esto sería <100ms)"

REGLA_FINAL=$(psql -p "$PUERTO" -d "$BASE" -tA -c "select regla_comisionable_modo || '|' || regla_comisionable_valor || '|' || regla_comisionable_pct_comision || '|' || regla_comisionable_modalidad_mk from public.programas where id=9401;")
[ "$REGLA_FINAL" = "pct|5.0000|8.0000|base_neta_impuestos_al_final" ] && v=true || v=false
assert "$v" "regla final = SOLO la de B (modo=pct,valor=5,pctComision=8), con la modalidad que A dejó (base_neta_impuestos_al_final) — obtenido: '$REGLA_FINAL'"

CANT_SALIDAS=$(psql -p "$PUERTO" -d "$BASE" -tA -c "select count(*) from public.programa_salidas where programa_id=9401;")
ETIQUETAS=$(psql -p "$PUERTO" -d "$BASE" -tA -c "select string_agg(etiqueta, ',') from public.programa_salidas where programa_id=9401;")
[ "$CANT_SALIDAS" = "1" ] && v=true || v=false
assert "$v" "solo queda 1 salida (nunca mezcla A+B) — obtenido: $CANT_SALIDAS"
[ "$ETIQUETAS" = "CONEXION_B" ] && v=true || v=false
assert "$v" "la salida final es la de B (el último commit gana completo) — obtenido: '$ETIQUETAS'"

# ─────────────────────────────────────────────────────────────────────────
# CASO 2 — A2 toma el lock y hace ROLLBACK; B2 (payload viejo) debe heredar
# la modalidad de ANTES de A2 (que A2 nunca llegó a confirmar), no la que
# A2 intentó dejar. Parte del estado dejado por el caso 1
# (modo=pct,valor=5,pctComision=8,modalidad=base_neta_impuestos_al_final).
# ─────────────────────────────────────────────────────────────────────────
echo ""
echo "== Caso 2: A2 intenta cambiar la modalidad a 'historica' pero hace ROLLBACK; B2 espera y NO hereda el intento de A2 =="

OUT_A2=/tmp/concurrencia_a2.txt
OUT_B2=/tmp/concurrencia_b2.txt
rm -f "$OUT_A2" "$OUT_B2"

psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 > "$OUT_A2" 2>&1 <<SQL &
begin;
$AUTH_SQL
select public.guardar_programa_salidas(
  9401::bigint,
  '{"activa": true, "modo": "impuesto", "valor": 999, "pctComision": 20, "modalidadMk": "historica"}'::jsonb,
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
  9401::bigint,
  '{"activa": true, "modo": "ninguno", "valor": null, "pctComision": 15}'::jsonb,
  '[{"orden":0,"etiqueta":"CONEXION_B2","tarifa_sencilla":250,"neto_sencilla":212.5}]'::jsonb
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

REGLA_FINAL2=$(psql -p "$PUERTO" -d "$BASE" -tA -c "select coalesce(regla_comisionable_modo,'') || '|' || coalesce(regla_comisionable_valor::text,'') || '|' || regla_comisionable_pct_comision || '|' || regla_comisionable_modalidad_mk from public.programas where id=9401;")
[ "$REGLA_FINAL2" = "ninguno||15.0000|base_neta_impuestos_al_final" ] && v=true || v=false
assert "$v" "regla final = SOLO la de B2 (modo=ninguno,valor=null,pctComision=15), con la modalidad de ANTES de A2 (base_neta_impuestos_al_final, del caso 1 — NUNCA 'historica', que A2 intentó pero revirtió) — obtenido: '$REGLA_FINAL2'"

CANT_SALIDAS2=$(psql -p "$PUERTO" -d "$BASE" -tA -c "select count(*) from public.programa_salidas where programa_id=9401;")
ETIQUETAS2=$(psql -p "$PUERTO" -d "$BASE" -tA -c "select string_agg(etiqueta, ',') from public.programa_salidas where programa_id=9401;")
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
