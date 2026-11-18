#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# SUITES REALES DE BASE DE DATOS del lote integrado (#1, #53, #102, #106, #124?, #125 + O3/U1) ejecutadas contra el esquema COMBINADO (303 → 311),
# cada una con las ACCIONES REALES de la aplicación → PostgREST propio → Postgres, sobre una copia desechable de una plantilla combinada.
# La plantilla combinada la crea el propio script desde `plantilla304` + las migraciones 303…311 y se borra al terminar. NUNCA contra una base real.
# Uso (desde dspacios-travel/):  MSYS_NO_PATHCONV=1 sh supabase/scripts/test_integrado_suites_pg.sh [contenedor_pg=pg304] [plantilla=plantilla304] [filtro-opcional]
# Cada suite imprime su resumen; el script termina con 0 solo si TODAS pasan. `filtro` ejecuta solo las suites cuyo nombre lo contiene.
# ──────────────────────────────────────────────────────────────────
set -u
export MSYS_NO_PATHCONV=1
CT="${1:-pg304}"; PLANTILLA="${2:-plantilla304}"; FILTRO="${3:-}"
TPL="tpl_integrado_$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
limpiar() { st=$?; $PS -d postgres -c "drop database if exists $TPL with (force)" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $TPL template $PLANTILLA" >/dev/null
for n in 303 304 305 306 307 308 309 310 311; do $PS -d "$TPL" < "$(ls supabase/migrations/20260601000${n}_*.sql)" >/dev/null 2>&1 || { echo "No se pudo aplicar la $n a la plantilla combinada"; exit 2; }; done
echo "plantilla combinada $TPL (303 → 311)"
TOTAL=0; MAL=0
# corre <etiqueta> <PREFIJO> <archivo.pg.ts> [PG_REACT=0|1]
suite() {
  [ -n "$FILTRO" ] && ! printf '%s' "$1 $3" | grep -q "$FILTRO" && return 0
  TOTAL=$((TOTAL+1)); LOG="$(mktemp)"
  echo "=== $1"
  PG_REACT="${4:-0}" sh supabase/scripts/test_pg_local.sh "$CT" "$TPL" "$2" "$3" > "$LOG" 2>&1; RC=$?
  grep -E "^ℹ (tests|pass|fail)|✖|FALLÓ|Error:" "$LOG" | head -8 | sed 's/^/    /'
  if [ "$RC" -eq 0 ]; then echo "  -> OK"; else echo "  -> FALLA (exit $RC)"; MAL=$((MAL+1)); tail -15 "$LOG" | sed 's/^/    | /'; fi
  rm -f "$LOG"
}
suite "#53 voucher de aliado (módulo de pago real)"       PG206 pruebas/voucherAcceso307.pg.ts 1
suite "#53 acuerdo de mínimo de confirmación"             PG206 pruebas/minimoAcuerdo307.pg.ts 1
suite "#1 personas de cotización"                         PG901 pruebas/personasCotizaciones1.pg.ts 1
suite "#1 personas de cotización (carrito)"               PG902 pruebas/personasCotizaciones1Carrito.pg.ts 1
suite "#102 ocupación / búsqueda / noche adicional"       PG102 pruebas/ocupacionBusqueda102.pg.ts 0
suite "#102 cotización asistida B2B"                      PG102 pruebas/cotizacionAsistidaB2B102.pg.ts 0
suite "O3/U1 edades del hotel por unidad"                 PG102 pruebas/edadesHotelUnidadU1.pg.ts 0
suite "O4 noche de referencia"                            PG102 pruebas/edadesNocheReferencia.pg.ts 0
echo "=== resumen: $TOTAL suites, $MAL en falla"
[ "$MAL" -eq 0 ]
