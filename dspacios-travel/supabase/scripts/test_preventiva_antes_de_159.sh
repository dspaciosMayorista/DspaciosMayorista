#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# PRUEBAS de supabase/scripts/preventiva_antes_de_159.sql — específicamente
# de los chequeos 4 (secuencia) y 5 (función), que la revisión posterior al
# PR #274 (ronda 3) exigió resolver por OBJETO EXACTO
# (`to_regclass`/`to_regprocedure`, esquema+nombre+firma) en vez de
# `relname`/`proname` sueltos, para no dar un falso BLOQUEADO ante un
# homónimo en otro esquema o una sobrecarga con otra firma.
#
#   supabase/scripts/test_preventiva_antes_de_159.sh [base] [puerto]
#
# QUÉ PRUEBA (los 4 controles pedidos, dos negativos + dos positivos):
#   N1) Objeto homónimo en OTRO esquema (una secuencia `contrato_seq_
#       mayorista` en un esquema que no es `public`) NO bloquea — el
#       chequeo 4 debe seguir dando n=0/ok=true.
#   N2) Función homónima con OTRA firma (`siguiente_numero_contrato_
#       para_tenant(integer)`, no `(text)`) NO bloquea — el chequeo 5 debe
#       seguir dando n=0/ok=true.
#   P1) La secuencia EXACTA (`public.contrato_seq_mayorista`) SÍ bloquea —
#       el chequeo 4 pasa a n=1/ok=false y el veredicto general queda
#       BLOQUEADO.
#   P2) La función EXACTA (`public.siguiente_numero_contrato_para_
#       tenant(text)`) SÍ bloquea — el chequeo 5 pasa a n=1/ok=false y el
#       veredicto general queda BLOQUEADO.
#
# Corre contra una base SIN la migración 159 aplicada todavía (hasta la
# 158) — es justamente el escenario real en el que se usa este preflight.
# Reutiliza pruebas/local-desde-cero.sh para el andamiaje. Solo lectura de
# parte del script bajo prueba: los objetos de prueba (secuencias/funciones
# fantasma) los crea y destruye ESTE script, no `preventiva_antes_de_159.sql`.
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${1:-dspacios_preventiva}"
PUERTO="${2:-5432}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FALLOS=0

ok()   { echo "   OK: $1"; }
fail() { echo "   FALLÓ: $1"; FALLOS=$((FALLOS + 1)); }

echo "== Base hasta la migración 158 (SIN la 159 — el escenario real del preflight)"
"$AQUI/pruebas/local-desde-cero.sh" "$BASE" "$PUERTO" 158 > /tmp/preventiva_setup.log 2>&1 || {
  echo "   FALLÓ el andamiaje — ver /tmp/preventiva_setup.log"; cat /tmp/preventiva_setup.log; exit 1;
}
echo "   listo"

# Corre la consulta REAL del archivo (no una reimplementación) y devuelve,
# para el `chequeo` pedido, el valor de la columna `ok` ('t'/'f').
ok_de_chequeo() {
  local chequeo="$1"
  psql -p "$PUERTO" -d "$BASE" -F'|' -A -t -f "$AQUI/preventiva_antes_de_159.sql" \
    | awk -F'|' -v c="$chequeo" '$2 == c { print $4 }'
}
veredicto() {
  psql -p "$PUERTO" -d "$BASE" -F'|' -A -t -f "$AQUI/preventiva_antes_de_159.sql" \
    | awk -F'|' '$2 == "── VEREDICTO ──" { print $4 }'
}

echo "== Línea base: sin ningún objeto todavía, ambos chequeos deben dar OK"
[ "$(ok_de_chequeo contrato_seq_mayorista_no_existe_todavia)" = "t" ] && ok "chequeo 4 (secuencia) = OK antes de crear nada" \
  || fail "chequeo 4 debía ser OK en la línea base"
[ "$(ok_de_chequeo funcion_siguiente_numero_contrato_para_tenant_no_existe_todavia)" = "t" ] && ok "chequeo 5 (función) = OK antes de crear nada" \
  || fail "chequeo 5 debía ser OK en la línea base"
[ "$(veredicto)" = "t" ] && ok "veredicto general = OK en la línea base" || fail "veredicto debía ser OK en la línea base"

# ═════════════════════════════════════════════════════════════════════════
# N1 — homónimo en OTRO esquema no bloquea
# ═════════════════════════════════════════════════════════════════════════
echo "== N1: secuencia 'contrato_seq_mayorista' en OTRO esquema (no public) NO debe bloquear"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "
  create schema if not exists otro_esquema;
  create sequence otro_esquema.contrato_seq_mayorista start 1;
"
[ "$(ok_de_chequeo contrato_seq_mayorista_no_existe_todavia)" = "t" ] && ok "el homónimo en otro_esquema NO disparó el chequeo (sigue OK)" \
  || fail "un homónimo en otro esquema disparó un falso BLOQUEADO"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "drop schema otro_esquema cascade;"

# ═════════════════════════════════════════════════════════════════════════
# N2 — función homónima con OTRA firma no bloquea
# ═════════════════════════════════════════════════════════════════════════
echo "== N2: función 'siguiente_numero_contrato_para_tenant' con OTRA firma (integer, no text) NO debe bloquear"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "
  create function public.siguiente_numero_contrato_para_tenant(p_tenant_id integer)
  returns text language sql as \$\$ select 'fantasma'::text; \$\$;
"
[ "$(ok_de_chequeo funcion_siguiente_numero_contrato_para_tenant_no_existe_todavia)" = "t" ] && ok "la sobrecarga con otra firma (integer) NO disparó el chequeo (sigue OK)" \
  || fail "una sobrecarga con otra firma disparó un falso BLOQUEADO"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "drop function public.siguiente_numero_contrato_para_tenant(integer);"

# ═════════════════════════════════════════════════════════════════════════
# P1 — la secuencia EXACTA sí bloquea
# ═════════════════════════════════════════════════════════════════════════
echo "== P1: la secuencia EXACTA public.contrato_seq_mayorista SÍ debe bloquear"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "create sequence public.contrato_seq_mayorista start 1;"
[ "$(ok_de_chequeo contrato_seq_mayorista_no_existe_todavia)" = "f" ] && ok "la secuencia exacta SÍ disparó el chequeo (BLOQUEADO, como debe ser)" \
  || fail "la secuencia exacta no disparó el chequeo — debía bloquear"
[ "$(veredicto)" = "f" ] && ok "el veredicto general pasó a BLOQUEADO" || fail "el veredicto general debía quedar BLOQUEADO"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "drop sequence public.contrato_seq_mayorista;"

echo "== Confirmando que P1 no dejó rastro (chequeo 4 vuelve a OK tras limpiar)"
[ "$(ok_de_chequeo contrato_seq_mayorista_no_existe_todavia)" = "t" ] && ok "chequeo 4 = OK de nuevo tras limpiar" || fail "chequeo 4 no volvió a OK tras limpiar"

# ═════════════════════════════════════════════════════════════════════════
# P2 — la función EXACTA sí bloquea
# ═════════════════════════════════════════════════════════════════════════
echo "== P2: la función EXACTA public.siguiente_numero_contrato_para_tenant(text) SÍ debe bloquear"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "
  create function public.siguiente_numero_contrato_para_tenant(p_tenant text)
  returns text language sql as \$\$ select 'fantasma'::text; \$\$;
"
[ "$(ok_de_chequeo funcion_siguiente_numero_contrato_para_tenant_no_existe_todavia)" = "f" ] && ok "la función exacta SÍ disparó el chequeo (BLOQUEADO, como debe ser)" \
  || fail "la función exacta no disparó el chequeo — debía bloquear"
[ "$(veredicto)" = "f" ] && ok "el veredicto general quedó BLOQUEADO" || fail "el veredicto general debía quedar BLOQUEADO"
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -c "drop function public.siguiente_numero_contrato_para_tenant(text);"

echo "== Confirmando que el script vuelve a OK tras limpiar todo (deja la base como la encontró)"
[ "$(veredicto)" = "t" ] && ok "veredicto general = OK, la base quedó exactamente como al empezar" || fail "quedó algún objeto de prueba sin limpiar"

echo "═══════════════════════════════════════════════════════════════"
if [ "$FALLOS" -eq 0 ]; then
  echo "TODAS LAS PRUEBAS DEL PREFLIGHT PASARON."
else
  echo "$FALLOS PRUEBA(S) FALLARON — ver detalle arriba."
  exit 1
fi
