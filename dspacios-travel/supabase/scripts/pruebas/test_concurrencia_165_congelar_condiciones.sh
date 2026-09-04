#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Prueba de CONCURRENCIA REAL para congelar_condiciones_contrato() (migración
# 165). Gap identificado en la revisión estricta de PR #282 (finding F2): el
# test funcional local (test_165_congelar_condiciones.sql) solo prueba la
# no-duplicación de forma SECUENCIAL (dos llamadas dentro de la MISMA
# sesión/transacción) — nunca demuestra que el `select ... for update` sobre
# `ventas` realmente serializa dos conexiones DISTINTAS que compiten por el
# MISMO numero_contrato. Este script sí usa DOS conexiones psql simultáneas
# de verdad (mismo patrón que test_concurrencia_modalidad_mk.sh) contra una
# base local — no es una simulación ni una prueba de wiring por texto.
#
# Qué demuestra:
#   · La conexión A toma el lock de la fila de `ventas` (con un
#     `SELECT ... FOR UPDATE` propio, ANTES de llamar al RPC) y lo retiene
#     mientras "trabaja" (pg_sleep) — luego, dentro de esa MISMA transacción
#     (el lock ya es suyo, no hay auto-bloqueo), llama al RPC y congela SU
#     propio snapshot.
#   · La conexión B llama al RPC DIRECTO (sin lock previo) para el MISMO
#     numero_contrato mientras A todavía tiene el lock — debe ESPERAR (se
#     mide el tiempo real transcurrido) hasta que A haga commit.
#   · Al terminar, `contrato_condiciones` tiene EXACTAMENTE 1 fila para ese
#     contrato (la de A, que se congeló primero dentro de su transacción) —
#     B, al encontrar que ya existe, hace no-op — nunca 2 filas.
#
# Uso:
#   bash supabase/scripts/pruebas/test_concurrencia_165_congelar_condiciones.sh [puerto] [nombre_base]
#
# Requiere PostgreSQL local corriendo (ver local-desde-cero.sh).
# ─────────────────────────────────────────────────────────────────────────────
set -u

PUERTO="${1:-5432}"
BASE="${2:-dspacios_concurrencia_165}"
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

echo "== Construyendo base '$BASE' desde cero (todas las migraciones, incl. 165/166) =="
if ! bash "$AQUI/local-desde-cero.sh" "$BASE" "$PUERTO" > /tmp/concurrencia_165_build.log 2>&1; then
  echo "No se pudo construir la base — ver /tmp/concurrencia_165_build.log"
  tail -30 /tmp/concurrencia_165_build.log
  exit 1
fi

echo "== Fixture: usuario venta + contrato vacío (sin condiciones congeladas) =="
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users (id, email) values ('77777777-7777-7777-7777-777777777777', 'conc165@test.com')
  on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('77777777-7777-7777-7777-777777777777', 'conc165@test.com', 'Conc 165', 'venta', true, 'mayorista')
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
insert into public.ventas (numero_contrato, tenant, cliente, estado) values ('DTM-9500', 'mayorista', 'Cliente Concurrencia 165', 'pendiente')
  on conflict (numero_contrato) do nothing;
SQL
if [ $? -ne 0 ]; then echo "No se pudo preparar el fixture"; exit 1; fi

OUT_A=/tmp/concurrencia_165_a.txt
OUT_B=/tmp/concurrencia_165_b.txt
rm -f "$OUT_A" "$OUT_B"

echo ""
echo "== A toma el lock de ventas (FOR UPDATE propio) 3s, luego congela DENTRO de esa misma transacción; B llama al RPC directo mientras tanto =="

psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 > "$OUT_A" 2>&1 <<'SQL' &
begin;
select tenant from public.ventas where numero_contrato = 'DTM-9500' for update;
select pg_sleep(3);
select public.congelar_condiciones_contrato(
  'DTM-9500',
  '[{"orden":0,"tipo_componente":"hotel","referencia_externa":"CONEXION_A","valor_componente":1000000,"condicion_pago_tipo":"pago_total","monto_exigido":1000000,"restriccion_comercial":"no_reembolsable_no_endosable"}]'::jsonb,
  'COP', 1, '77777777-7777-7777-7777-777777777777'
);
commit;
SQL
PID_A=$!

sleep 1  # margen para que A ya haya tomado el lock antes de que B lo intente

T0=$(date +%s%N)
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 > "$OUT_B" 2>&1 <<'SQL'
select public.congelar_condiciones_contrato(
  'DTM-9500',
  '[{"orden":0,"tipo_componente":"servicio","referencia_externa":"CONEXION_B","valor_componente":2,"monto_exigido":2}]'::jsonb,
  'COP', 1, '77777777-7777-7777-7777-777777777777'
);
SQL
RC_B=$?
T1=$(date +%s%N)
wait "$PID_A"
RC_A=$?

ELAPSED_MS=$(( (T1 - T0) / 1000000 ))
echo "  (B tardó ${ELAPSED_MS}ms en completar; A retenía el lock por ~3000ms desde ~1000ms antes de que B empezara)"

[ "$RC_A" -eq 0 ] && v=true || v=false
assert "$v" "conexión A (lock + congelado + COMMIT) terminó sin error"
[ "$RC_B" -eq 0 ] && v=true || v=false
assert "$v" "conexión B (RPC directo, sin lock previo) terminó sin error"
[ "$ELAPSED_MS" -ge 1500 ] && v=true || v=false
assert "$v" "B esperó el lock de A sobre la fila de ventas (>=1500ms; si el FOR UPDATE del RPC no bloqueara de verdad, esto sería <100ms)"

CANT_FILAS=$(psql -p "$PUERTO" -d "$BASE" -tA -c "select count(*) from public.contrato_condiciones where numero_contrato='DTM-9500';")
[ "$CANT_FILAS" = "1" ] && v=true || v=false
assert "$v" "exactamente 1 fila congelada en contrato_condiciones (nunca 2 — el no-op de B bajo carrera real funcionó) — obtenido: $CANT_FILAS"

REFERENCIA=$(psql -p "$PUERTO" -d "$BASE" -tA -c "select referencia_externa from public.contrato_condiciones where numero_contrato='DTM-9500';")
[ "$REFERENCIA" = "CONEXION_A" ] && v=true || v=false
assert "$v" "la fila que quedó es la de A (congeló primero, dentro de su propia transacción) — obtenido: '$REFERENCIA'"

echo ""
echo "== Limpieza =="
psql -p "$PUERTO" -d postgres -c "drop database if exists $BASE;" > /dev/null 2>&1

echo ""
echo "== Resumen: $ok OK, $mal FALLÓ =="
if [ "$mal" -gt 0 ]; then
  echo "PRUEBA DE CONCURRENCIA FALLÓ"
  exit 1
fi
echo "TODAS LAS PRUEBAS DE CONCURRENCIA (165) PASARON"
exit 0
