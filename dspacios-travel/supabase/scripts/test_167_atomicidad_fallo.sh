#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# ATOMICIDAD DE LA MIGRACIÓN 167 ante un fallo a mitad de camino — revisión
# de Opus, ronda 9 (HIGH). La migración 167 se envolvió en `begin;`/`commit;`
# (igual que 153-164): esta prueba INYECTA un error deliberado cerca del
# final del archivo (una referencia a una tabla que no existe a propósito) y
# confirma que, tras el error, NINGUNO de los objetos que crea la migración
# quedó a medio aplicar — columna, índice, tabla de exenciones, trigger,
# tipo compuesto ni las 14 funciones (12 + las 2 de fecha de referencia, B22).
#
# Sin el `begin;`/`commit;` (autocommit, comportamiento ANTES de esta ronda),
# esta misma prueba habría dejado la mayoría de los objetos ya creados
# (todo lo que corrió ANTES del punto de fallo) y solo el resto ausente —
# un esquema HÍBRIDO. Con la transacción explícita, Postgres revierte TODO.
#
# Uso:
#   bash supabase/scripts/pruebas/local-desde-cero.sh <db> <puerto> 166
#   bash supabase/scripts/test_167_atomicidad_fallo.sh <db> <puerto>
# ═══════════════════════════════════════════════════════════════════════════
set -u
BD="${1:-dspacios_local}"
PUERTO="${2:-5432}"
PSQL() { psql -p "$PUERTO" -d "$BD" -t -A -q "$@"; }
MIGRACION="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/migrations/20260601000167_contrato_pasajero_responsable_infante.sql"
ROTO="$(mktemp)"
trap 'rm -f "$ROTO"' EXIT

if [ ! -f "$MIGRACION" ]; then
  echo "FALLA: no se encontró $MIGRACION"
  exit 1
fi

# Copia la migración completa SALVO el "commit;" final, y en su lugar
# inserta una referencia deliberadamente inválida (una tabla que nunca
# existe) seguida del propio "commit;" — si la transacción NO protegiera el
# archivo, todo lo anterior al error ya habría quedado aplicado igual.
sed '$ d' "$MIGRACION" > "$ROTO"  # quita la última línea (se espera "commit;")
ultima="$(tail -1 "$MIGRACION")"
if [ "$ultima" != "commit;" ]; then
  echo "FALLA: la migración 167 no termina en 'commit;' — ¿se re-envolvió el archivo? (última línea: '$ultima')"
  exit 1
fi
{
  echo "select * from public.tabla_que_no_existe_a_proposito_167;"
  echo "commit;"
} >> "$ROTO"

echo "== Aplicando la migración 167 con un error inyectado (se espera que FALLE) =="
SALIDA="$(psql -p "$PUERTO" -d "$BD" -v ON_ERROR_STOP=1 -q -f "$ROTO" 2>&1)"
if [ $? -eq 0 ]; then
  echo "FALLA: la migración con el error inyectado no falló — la prueba no es válida (revisar el punto de inyección)."
  exit 1
fi
if ! echo "$SALIDA" | grep -qi "tabla_que_no_existe_a_proposito_167"; then
  echo "FALLA: el error no es el esperado (no menciona la tabla inyectada). Salida:"
  echo "$SALIDA"
  exit 1
fi
echo "  (falló como se esperaba, por la tabla inyectada)"

echo "== Verificando que NINGÚN objeto de la 167 quedó parcialmente aplicado =="
fail=0
check_ausente() {
  local desc="$1" query="$2"
  local val
  val="$(PSQL -c "$query")"
  if [ "$val" = "f" ]; then
    echo "  OK   ausente: $desc"
  else
    echo "  FALLA presente (no debía existir tras el rollback): $desc"
    fail=1
  fi
}

check_ausente "función edad_anios" "select exists(select 1 from pg_proc where proname='edad_anios' and pronamespace='public'::regnamespace)"
check_ausente "función es_infante_por_edad" "select exists(select 1 from pg_proc where proname='es_infante_por_edad' and pronamespace='public'::regnamespace)"
check_ausente "función _fecha_referencia_efectiva" "select exists(select 1 from pg_proc where proname='_fecha_referencia_efectiva' and pronamespace='public'::regnamespace)"
check_ausente "función _fecha_referencia_guc" "select exists(select 1 from pg_proc where proname='_fecha_referencia_guc' and pronamespace='public'::regnamespace)"
check_ausente "columna contrato_pasajeros.responsable_id" "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='contrato_pasajeros' and column_name='responsable_id')"
check_ausente "índice idx_contrato_pasajeros_responsable" "select exists(select 1 from pg_indexes where schemaname='public' and indexname='idx_contrato_pasajeros_responsable')"
check_ausente "tabla _pasajeros_exentos_167" "select exists(select 1 from pg_tables where schemaname='public' and tablename='_pasajeros_exentos_167')"
check_ausente "función fn_validar_responsable_infante" "select exists(select 1 from pg_proc where proname='fn_validar_responsable_infante' and pronamespace='public'::regnamespace)"
check_ausente "trigger trg_validar_responsable_infante" "select exists(select 1 from pg_trigger where tgname='trg_validar_responsable_infante')"
check_ausente "función _ajustar_sillas_nucleo" "select exists(select 1 from pg_proc where proname='_ajustar_sillas_nucleo' and pronamespace='public'::regnamespace)"
check_ausente "función _ajustar_sillas_bloqueo_nucleo" "select exists(select 1 from pg_proc where proname='_ajustar_sillas_bloqueo_nucleo' and pronamespace='public'::regnamespace)"
check_ausente "función ajustar_sillas_por_pasajeros" "select exists(select 1 from pg_proc where proname='ajustar_sillas_por_pasajeros' and pronamespace='public'::regnamespace)"
check_ausente "tipo _fila_pasajero_167" "select exists(select 1 from pg_type where typname='_fila_pasajero_167' and typnamespace='public'::regnamespace)"
check_ausente "función _autorizado_escribir_pasajeros" "select exists(select 1 from pg_proc where proname='_autorizado_escribir_pasajeros' and pronamespace='public'::regnamespace)"
check_ausente "función _reemplazar_pasajeros_nucleo" "select exists(select 1 from pg_proc where proname='_reemplazar_pasajeros_nucleo' and pronamespace='public'::regnamespace)"
check_ausente "función _guardar_pasajeros_nucleo" "select exists(select 1 from pg_proc where proname='_guardar_pasajeros_nucleo' and pronamespace='public'::regnamespace)"
check_ausente "función guardar_pasajeros_contrato" "select exists(select 1 from pg_proc where proname='guardar_pasajeros_contrato' and pronamespace='public'::regnamespace)"
check_ausente "función crear_pasajeros_contrato" "select exists(select 1 from pg_proc where proname='crear_pasajeros_contrato' and pronamespace='public'::regnamespace)"
check_ausente "función crear_pasajeros_contrato_multi" "select exists(select 1 from pg_proc where proname='crear_pasajeros_contrato_multi' and pronamespace='public'::regnamespace)"

echo
if [ "$fail" -eq 0 ]; then
  echo "== RESULTADO: PASS (la transacción explícita revirtió TODO ante el fallo inyectado) =="
  exit 0
else
  echo "== RESULTADO: FAIL (quedaron objetos parcialmente aplicados — revisar el begin/commit de la migración 167) =="
  exit 1
fi
