#!/bin/sh
# Genera supabase/scripts/aplicar_288_292_atomico.sql: las migraciones 288 y 292 en UNA sola transacción (un único BEGIN … COMMIT).
# Por qué: cada archivo trae su propio BEGIN/COMMIT; aplicarlos uno tras otro deja un intervalo en el que la 288 ya está confirmada (los pendientes
# nacen con obligaciones PREVISTAS) y la 292 todavía no protege su servicio ni su línea. En una sola transacción ese intervalo no existe: nadie ve
# la 288 sin la 292 (o ve las dos, o ninguna), y si algo falla no se aplica ninguna.
# Los cuerpos se copian TAL CUAL; solo se quita la línea «begin;» y la línea «commit;» propias de cada archivo (se exige que haya exactamente una de cada).
# Uso (desde dspacios-travel/):  sh supabase/scripts/generar_aplicar_288_292_atomico.sh [salida]   (por defecto escribe el .sql junto a este script)
set -eu
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIGS="$AQUI/../migrations"
M288="$MIGS/20260601000288_obligaciones_al_confirmar.sql"; M292="$MIGS/20260601000292_servicio_obligaciones_previstas.sql"
SALIDA="${1:-$AQUI/aplicar_288_292_atomico.sql}"
cuerpo() {
  n_b=$(tr -d '\r' < "$1" | grep -ciE '^[[:space:]]*begin;[[:space:]]*$' || true); n_c=$(tr -d '\r' < "$1" | grep -ciE '^[[:space:]]*commit;[[:space:]]*$' || true)
  [ "$n_b" = 1 ] && [ "$n_c" = 1 ] || { echo "$(basename "$1"): se esperaba exactamente un «begin;» y un «commit;» (hay $n_b y $n_c)" >&2; exit 1; }
  tr -d '\r' < "$1" | grep -viE '^[[:space:]]*(begin|commit);[[:space:]]*$'
}
md5() { tr -d '\r' < "$1" | md5sum | cut -c1-32; }
{
  echo "-- ═══════════════════════════════════════════════════════════════════════════════════════════════"
  echo "-- APLICACIÓN ATÓMICA 288 + 292 (#75) — GENERADO por generar_aplicar_288_292_atomico.sh. NO EDITAR A MANO."
  echo "-- Fuentes (md5 sin CR): 288 = $(md5 "$M288") · 292 = $(md5 "$M292")"
  echo "-- Una sola transacción: la 288 nunca queda visible sin la 292. Si cualquier paso falla, no se aplica NADA (repetir tras corregir)."
  echo "-- Antes: preflight_288 (OK) en una consulta aparte. Después: postcheck_288 y postcheck_292. Luego la 286 (#97) y el resto de la secuencia."
  echo "-- lock_timeout: si una sesión de la app retiene ventas/cuentas_por_pagar, falla en 10 s en vez de dejar en cola a toda la app detrás del ALTER."
  echo "-- ═══════════════════════════════════════════════════════════════════════════════════════════════"
  echo "begin;"
  echo "set local lock_timeout = '10s';"
  echo "-- ─── 288 (cuerpo íntegro) ───"
  cuerpo "$M288"
  echo "-- ─── 292 (cuerpo íntegro) ───"
  cuerpo "$M292"
  [ -n "${PAUSA_PRUEBA:-}" ] && echo "select pg_sleep(${PAUSA_PRUEBA}); -- SOLO PRUEBA LOCAL: mantiene la transacción abierta para probar sesiones concurrentes"
  echo "commit;"
} > "$SALIDA"
echo "generado: $SALIDA"
