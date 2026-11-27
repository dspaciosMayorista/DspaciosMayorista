#!/bin/sh
# Revisión consolidada, ronda de correcciones (2026-11-26): aplica ADITIVAMENTE las migraciones 344→349 (con su preflight y postcheck, una consulta integral cada uno) y las semillas sintéticas `semillas/rev2/*.sql` a UNA base ya existente.
# NUNCA crea ni borra bases ni toca filas existentes: las migraciones son aditivas y las semillas son idempotentes. Antes de usarlo sobre la base del dueño: `revision.mjs respaldar` y el inventario de integridad (inventario_integridad.sql).
# Uso (desde dspacios-travel/):  sh supabase/scripts/revision_consolidada/aplicar_rev2.sh <contenedor_pg> <base> [--sin-semillas]
set -u
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; DB="${2:?base}"; SEM="${3:-}"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -v ON_ERROR_STOP=1"
M=supabase/migrations; S=supabase/scripts
verificar() { # $1 = archivo, $2 = etiqueta; devuelve 0 si todo OK (sin filas malas)
  [ -f "$1" ] || { echo "  (sin $2)"; return 0; }
  v_sal="$($PS -q -t -A -F '|' -d "$DB" < "$1" 2>&1)"; v_rc=$?
  v_mal="$(printf '%s\n' "$v_sal" | awk -F'|' 'NF>=3 && $NF != "OK" && $NF != "INFO" && $NF != "APLICABLE" && $NF != "CORRECTA" && $NF != "LISTA PARA APLICAR" && $NF != "" {print}')"
  v_n="$(printf '%s\n' "$v_sal" | awk -F'|' 'NF>=3 {n++} END {print n+0}')"
  if [ $v_rc -ne 0 ] || [ -n "$v_mal" ] || [ "$v_n" -eq 0 ]; then
    [ "${3:-}" = "silencioso" ] && return 1
    echo "  FALLO $2 (filas $v_n, rc $v_rc):"; printf '%s\n' "$v_sal" | cut -c1-230 | head -20; return 1
  fi
  echo "  $2: $v_n controles, todos OK"; return 0
}
for N in 344 345 346 347 348 349; do
  pre="$(ls $S/preflight_${N}_*.sql | head -1)"; post="$(ls $S/postcheck_${N}_*.sql | head -1)"; mig="$(ls $M/20260601000${N}_*.sql | head -1)"
  if verificar "$post" "postcheck $N (¿ya aplicada?)" silencioso >/dev/null 2>&1; then echo "== $N ya aplicada y correcta: se omite"; continue; fi
  verificar "$pre" "preflight $N" || exit 1
  echo "== aplicar $N · $(basename "$mig")"; $PS -q -d "$DB" < "$mig" >/dev/null || { echo "  FALLO al aplicar $N"; exit 1; }
  verificar "$post" "postcheck $N" || exit 1
done
if [ "$SEM" != "--sin-semillas" ]; then
  for f in supabase/scripts/revision_consolidada/semillas/rev2/*.sql; do
    echo "== semilla $(basename "$f")"; $PS -q -d "$DB" < "$f" >/dev/null || { echo "  FALLO semilla $f"; exit 1; }
  done
fi
$PS -q -d "$DB" -c "notify pgrst, 'reload schema'" >/dev/null
echo "== rev2 aplicado en $DB"
