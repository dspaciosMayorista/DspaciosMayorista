#!/bin/sh
# REL-2 · corre suites REALES del árbol VIEJO (C:/tmp/old312 = 312608a59) contra la plantilla FINAL (001–326). Una base desechable por suite (la crea test_pg_local.sh y la borra).
# Uso: sh rel2_suites.sh <plantilla> <etiqueta=PREFIJO=archivo=react[=extra.sql]>...
set -u
export MSYS_NO_PATHCONV=1
cd "${OLD_EXPORT:-C:/tmp/old312}/dspacios-travel" || exit 2
PLANTILLA="$1"; shift
OUT="${TMPDIR:-/tmp}/rel2_suites_out"; mkdir -p "$OUT"
MAL=0; TOTAL=0
for spec in "$@"; do
  etiqueta="${spec%%=*}"; r="${spec#*=}"; pre="${r%%=*}"; r="${r#*=}"; arch="${r%%=*}"; r="${r#*=}"; react="${r%%=*}"; extra=""; [ "$r" != "$react" ] && extra="${r#*=}"
  TOTAL=$((TOTAL+1)); LOG="$OUT/$pre-$(basename "$arch").log"
  echo "=== $etiqueta ($arch)"
  PG_REACT="$react" REPORTER=spec sh supabase/scripts/test_pg_local.sh pgb2b "$PLANTILLA" "$pre" "$arch" $extra > "$LOG" 2>&1; RC=$?
  grep -E "^ℹ (tests|pass|fail|cancelled|skipped)" "$LOG" | sed 's/^/    /'
  if [ "$RC" -eq 0 ]; then echo "  -> OK"; else echo "  -> FALLA (exit $RC)"; MAL=$((MAL+1)); grep -E "✖|not ok|Error" "$LOG" | head -12 | sed 's/^/    | /'; fi
done
echo "=== resumen: $TOTAL suites, $MAL en falla"
[ "$MAL" -eq 0 ]
