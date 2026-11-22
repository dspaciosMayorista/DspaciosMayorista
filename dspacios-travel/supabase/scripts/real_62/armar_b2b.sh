#!/usr/bin/env bash
# Arma escenarios_b2b.mjs = utilidades compartidas de escenarios_48.mjs (hasta `aliadoAuto`) + b2b/g0_setup + `try {` + grupos b2b/g*.mjs (en orden) + b2b/g9_cola.
set -eu
cd "$(dirname "$0")"
LIM=$(grep -n '^const aliadoAuto' escenarios_48.mjs | cut -d: -f1)
{ head -n "$LIM" escenarios_48.mjs; echo; cat b2b/g0_setup.mjs; echo; echo 'try {'; echo '  await sinFallos(); await limpiarRegistro();'; for f in $(ls b2b/g[1-8]_*.mjs | sort); do cat "$f"; echo; done; cat b2b/g9_cola.mjs; } > escenarios_b2b.mjs
node --check escenarios_b2b.mjs && echo "escenarios_b2b.mjs armado ($(wc -l < escenarios_b2b.mjs) líneas)"
