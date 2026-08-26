#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# PRUEBA DE CONCURRENCIA REAL — dos conexiones Postgres SEPARADAS pidiendo
# numero_contrato al mismo tiempo, contra
# siguiente_numero_contrato_para_tenant() (migración 159). Mismo motivo que
# test_concurrencia_tramos_contrato.sh: un script de una sola sesión no
# puede ejercitar una carrera real entre dos transacciones.
#
#   supabase/scripts/test_concurrencia_dtm_mayorista.sh [base] [puerto]
#
# QUÉ PRUEBA
#   1) Dos solicitudes MAYORISTA concurrentes producen dos DTM- DIFERENTES y
#      CONSECUTIVOS (como conjunto {DTM-0001, DTM-0002}, sin importar cuál
#      llegó primero) — nunca el mismo número. No hace falta ningún candado
#      manual: nextval() sobre una secuencia de Postgres YA es atómico por
#      diseño del motor (MVCC + operación interna sin bloqueo de fila), es
#      justamente el reemplazo correcto de un `SELECT max()+1` con carrera.
#   2) Una solicitud MAYORISTA concurrente con una MINORISTA no comparte
#      secuencia: el resultado de una no depende del orden de llegada de la
#      otra (se verifica que el mayorista siga en su propio conteo 1,2,3...
#      sin importar cuántas veces se haya pedido un número de minorista).
#   3) Un fallo (ROLLBACK) DESPUÉS de pedir un nextval() dejará un HUECO en
#      la numeración (ese valor se pierde para siempre) pero NUNCA duplica
#      ni reutiliza el número — es el comportamiento NORMAL y DOCUMENTADO de
#      toda secuencia de Postgres (nextval() no es transaccional a
#      propósito, para no bloquearse esperando otras transacciones). Este
#      test lo demuestra y lo deja documentado, no lo "corrige" — corregirlo
#      exigiría volver a un mecanismo con bloqueo, exactamente lo que se
#      quiso evitar al no usar SELECT max()+1.
#
# Requiere PostgreSQL local corriendo (mismo requisito que
# pruebas/local-desde-cero.sh, que este script reutiliza para el andamiaje).
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${1:-dspacios_dtm_concurrencia}"
PUERTO="${2:-5432}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FALLOS=0

ok()   { echo "   OK: $1"; }
fail() { echo "   FALLÓ: $1"; FALLOS=$((FALLOS + 1)); }

echo "== Levantando '$BASE' con TODAS las migraciones (incluida la 159)"
"$AQUI/pruebas/local-desde-cero.sh" "$BASE" "$PUERTO" > /tmp/dtm_conc_setup.log 2>&1 || {
  echo "   FALLÓ el andamiaje — ver /tmp/dtm_conc_setup.log"; cat /tmp/dtm_conc_setup.log; exit 1;
}
echo "   listo"

echo "== Fixture: usuario superadmin autenticado"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users (id, email) values ('e0000001-0000-0000-0000-000000000001', 'sa-dtmconc@test.com')
  on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('e0000001-0000-0000-0000-000000000001', 'sa-dtmconc@test.com', 'Superadmin Concurrencia DTM', 'superadmin', true, 'mayorista')
  on conflict (id) do update set nombre=excluded.nombre, rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant;
SQL

AUTH_SETUP="set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', 'e0000001-0000-0000-0000-000000000001', 'role', 'authenticated')::text, false);"
# Extrae SOLO la línea con el número devuelto (DTM-.../MIN-...) o con
# ROLLBACK, sin importar cuántas líneas de tags de comando (BEGIN/SET/
# COMMIT) o el propio valor de set_config/pg_sleep las rodeen — más robusto
# que contar líneas con tail.
extraer_numero() { grep -E '^(DTM-|MIN-)' | tail -1; }

# ═════════════════════════════════════════════════════════════════════════
# ESCENARIO 1 — dos solicitudes MAYORISTA concurrentes
# ═════════════════════════════════════════════════════════════════════════
echo "== Escenario 1: dos conexiones piden numero_contrato mayorista AL MISMO TIEMPO"

(
  psql -p "$PUERTO" -d "$BASE" -tAc "
    begin; $AUTH_SETUP
    select pg_sleep(0.2 + random() * 0.3);
    select public.siguiente_numero_contrato_para_tenant('mayorista');
    commit;
  " | extraer_numero > /tmp/dtm_conc_A.txt
) &
PID_A=$!

(
  psql -p "$PUERTO" -d "$BASE" -tAc "
    begin; $AUTH_SETUP
    select pg_sleep(0.2 + random() * 0.3);
    select public.siguiente_numero_contrato_para_tenant('mayorista');
    commit;
  " | extraer_numero > /tmp/dtm_conc_B.txt
) &
PID_B=$!

wait "$PID_A" "$PID_B"
RES_A=$(cat /tmp/dtm_conc_A.txt)
RES_B=$(cat /tmp/dtm_conc_B.txt)
echo "   conexión A obtuvo: $RES_A"
echo "   conexión B obtuvo: $RES_B"

if [ "$RES_A" = "$RES_B" ]; then
  fail "las dos conexiones concurrentes obtuvieron EL MISMO número ($RES_A) — nextval() no está siendo atómico"
else
  ok "las dos conexiones obtuvieron números DIFERENTES"
fi

# Como conjunto (sin importar el orden real de llegada), deben ser
# EXACTAMENTE DTM-0001 y DTM-0002 — consecutivos, sin huecos, sin repetir.
CONJUNTO=$(printf '%s\n%s\n' "$RES_A" "$RES_B" | sort | tr '\n' ',' )
ESPERADO="DTM-0001,DTM-0002,"
if [ "$CONJUNTO" = "$ESPERADO" ]; then
  ok "el conjunto de números es exactamente {DTM-0001, DTM-0002} — consecutivos, sin duplicar ni saltar"
else
  fail "el conjunto de números fue '$CONJUNTO', se esperaba '$ESPERADO'"
fi

# ═════════════════════════════════════════════════════════════════════════
# ESCENARIO 2 — una solicitud MAYORISTA concurrente con una MINORISTA:
# no deben compartir secuencia ni interferirse.
# ═════════════════════════════════════════════════════════════════════════
echo "== Escenario 2: mayorista y minorista concurrentes — secuencias independientes"

(
  psql -p "$PUERTO" -d "$BASE" -tAc "
    begin; $AUTH_SETUP
    select pg_sleep(0.2 + random() * 0.3);
    select public.siguiente_numero_contrato_para_tenant('mayorista');
    commit;
  " | extraer_numero > /tmp/dtm_conc_C_mayorista.txt
) &
PID_C=$!

(
  psql -p "$PUERTO" -d "$BASE" -tAc "
    begin; $AUTH_SETUP
    select pg_sleep(0.2 + random() * 0.3);
    select public.siguiente_numero_contrato_para_tenant('minorista');
    commit;
  " | extraer_numero > /tmp/dtm_conc_D_minorista.txt
) &
PID_D=$!

wait "$PID_C" "$PID_D"
RES_MAY=$(cat /tmp/dtm_conc_C_mayorista.txt)
RES_MIN=$(cat /tmp/dtm_conc_D_minorista.txt)
echo "   mayorista concurrente obtuvo: $RES_MAY (se esperaba DTM-0003, siguiente tras el escenario 1)"
echo "   minorista concurrente obtuvo: $RES_MIN (formato MIN-00-NNNN, secuencia propia sin tocar)"

[ "$RES_MAY" = "DTM-0003" ] && ok "mayorista continuó su PROPIO conteo (0001, 0002 del escenario 1, ahora 0003) sin que minorista lo alterara" \
  || fail "mayorista obtuvo '$RES_MAY', se esperaba DTM-0003 — indicaría que algo interfirió con su secuencia"
if [[ "$RES_MIN" =~ ^MIN-00-[0-9]{4}$ ]]; then
  ok "minorista devolvió '$RES_MIN' — formato de siempre, sin relación con la numeración de mayorista"
else
  fail "minorista devolvió '$RES_MIN', formato inesperado"
fi

# ═════════════════════════════════════════════════════════════════════════
# ESCENARIO 3 — un ROLLBACK posterior a nextval() deja un HUECO, nunca
# duplica ni reutiliza. Comportamiento NORMAL de una secuencia de Postgres,
# documentado aquí explícitamente (no es un bug de esta función).
# ═════════════════════════════════════════════════════════════════════════
echo "== Escenario 3: un ROLLBACK después de pedir el número deja un hueco (esperado, no es un bug)"
ANTES=$(psql -p "$PUERTO" -d "$BASE" -tAc "select last_value from public.contrato_seq_mayorista;")
psql -p "$PUERTO" -d "$BASE" -tAc "
  begin; $AUTH_SETUP
  select public.siguiente_numero_contrato_para_tenant('mayorista');
  rollback;
" > /tmp/dtm_conc_rollback.txt
NUM_DESCARTADO=$(extraer_numero < /tmp/dtm_conc_rollback.txt)
echo "   número generado y luego descartado (ROLLBACK): $NUM_DESCARTADO"

SIGUIENTE=$(psql -p "$PUERTO" -d "$BASE" -tAc "
  begin; $AUTH_SETUP
  select public.siguiente_numero_contrato_para_tenant('mayorista');
  commit;
" | extraer_numero)
echo "   siguiente número real tras el rollback: $SIGUIENTE"

if [ "$SIGUIENTE" = "$NUM_DESCARTADO" ]; then
  fail "el número descartado por el ROLLBACK se reutilizó — NO debería pasar nunca (perdería la garantía de unicidad)"
elif [ "$SIGUIENTE" = "DTM-0005" ] && [ "$NUM_DESCARTADO" = "DTM-0004" ]; then
  ok "el ROLLBACK dejó exactamente el hueco esperado: DTM-0004 se pierde para siempre, el siguiente real es DTM-0005 — nextval() nunca es transaccional, por diseño, para no bloquearse esperando otras conexiones. Este hueco es NORMAL y esperado, no un defecto a corregir."
else
  fail "secuencia inesperada tras el rollback: descartado=$NUM_DESCARTADO, siguiente=$SIGUIENTE"
fi

echo "═══════════════════════════════════════════════════════════════"
if [ "$FALLOS" -eq 0 ]; then
  echo "TODAS LAS PRUEBAS DE CONCURRENCIA PASARON."
else
  echo "$FALLOS PRUEBA(S) FALLARON — ver detalle arriba."
  exit 1
fi
