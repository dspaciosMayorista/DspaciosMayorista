#!/usr/bin/env bash
# Aplica a una base DESECHABLE las migraciones 312–324 (#126, #127 y bloque B2B) en orden numérico, con su preflight ANTES y su postcheck DESPUÉS.
# Se detiene ante la primera fila REVISAR/FALLO o ante cualquier error de SQL. SOLO bases locales desechables (rev_verif_*, m_*, tpg_*).
# Uso (desde dspacios-travel/):  bash supabase/scripts/localreview_integrado/aplicar_migraciones.sh <contenedor_pg> <base> [migraciones...]   (por defecto: 312 313 314 315 316 317 318 319 322 323 324)
set -u -o pipefail
export MSYS_NO_PATHCONV=1
PG="${1:?contenedor}"; DB="${2:?base}"; shift 2
case "$DB" in rev_verif_*|m_*|tpg_*) ;; *) echo "RECHAZADO: «$DB» no es una base desechable (rev_verif_*, m_*, tpg_*)."; exit 2;; esac
LISTA="${*:-312 313 314 315 316 317 318 319 322 323 324}"
SCR="$(cd "$(dirname "$0")/.." && pwd)"; MIG="$(cd "$SCR/../migrations" && pwd)"
PS=(docker exec -e PGPASSWORD=postgres "$PG" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -F'|' -v ON_ERROR_STOP=1 -d "$DB")
docker exec "$PG" sh -c "rm -rf /tmp/mi_scr /tmp/mi_mig && mkdir -p /tmp/mi_scr /tmp/mi_mig" || exit 2
docker cp "$(cygpath -m "$SCR")/." "$PG:/tmp/mi_scr" >/dev/null || exit 2
docker cp "$(cygpath -m "$MIG")/." "$PG:/tmp/mi_mig" >/dev/null || exit 2
mal=0
revisa() { # etiqueta archivo
  local out; out="$("${PS[@]}" -f "$2" 2>&1)"; local rc=$?
  if [ $rc -ne 0 ]; then echo "FALLO $1: error de SQL"; echo "$out" | head -6 | sed 's/^/    | /'; return 1; fi
  local n bad; n=$(grep -cE '\|(OK|INFO|REVISAR|FALLO)$' <<<"$out"); bad=$(grep -E '\|(REVISAR|FALLO)$' <<<"$out")
  if [ -n "$bad" ]; then echo "FALLO $1: $n controles, con REVISAR/FALLO:"; echo "$bad" | cut -c1-220 | sed 's/^/    | /'; return 1; fi
  echo "OK    $1: $n controles OK/INFO"
}
for n in $LISTA; do
  pre="$(ls "$SCR" | grep -E "^preflight_${n}_" | head -1)"; post="$(ls "$SCR" | grep -E "^postcheck_${n}_" | head -1)"; mg="$(ls "$MIG" | grep -E "^2026060100$(printf %04d "$n")_" | head -1)"
  [ -n "$pre" ] && [ -n "$post" ] && [ -n "$mg" ] || { echo "FALLO $n: faltan archivos"; exit 1; }
  revisa "$n preflight" "/tmp/mi_scr/$pre" || exit 1
  if ! "${PS[@]}" -1 -f "/tmp/mi_mig/$mg" >/tmp/mi_apl.$$ 2>&1; then echo "FALLO $n migración:"; head -8 /tmp/mi_apl.$$ | sed 's/^/    | /'; exit 1; fi
  echo "OK    $n migración aplicada ($mg)"
  revisa "$n postcheck" "/tmp/mi_scr/$post" || exit 1
done
rm -f /tmp/mi_apl.$$; echo "CADENA APLICADA: $LISTA"
