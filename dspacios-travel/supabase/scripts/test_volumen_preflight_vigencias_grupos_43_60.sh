#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────
# PRUEBA DE VOLUMEN y de EQUIVALENCIA del diagnóstico preflight_vigencias_grupos_43_60_lectura.sql
# SOLO en un contenedor Postgres LOCAL DESECHABLE (se crea y se elimina aquí; nunca una base real).
# Requiere Docker y la imagen postgres:17 ya descargada. Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_volumen_preflight_vigencias_grupos_43_60.sh [tamaños] [tope_segundos] [sin_equivalencia]
#   p. ej.  sh supabase/scripts/test_volumen_preflight_vigencias_grupos_43_60.sh "50 150 300" 60
#
# 1) EQUIVALENCIA: con 8 hoteles sintéticos (tamaño en el que la versión 2 todavía termina) compara la versión final con la
#    versión 2 de referencia: mismos controles, observado, esperado, estado, hoteles_incompletos y TODAS las filas de detalle
#    (la columna «ejemplo» de los controles principales se excluye: la versión 2 desempataba al azar).
# 2) VOLUMEN: para cada tamaño carga datos sintéticos (fixture_volumen_...), ejecuta la versión final con JIT activado y desactivado,
#    mide la duración y comprueba que (a) no falla, (b) devuelve el mismo número de filas, (c) cumple el tope de segundos.
# Los datos son SINTÉTICOS y reproducibles (semilla fija); no representan necesariamente el volumen real.
# ─────────────────────────────────────────────────────────────────────────
set -eu
TAMANOS="${1:-50 150 300}"
TOPE="${2:-60}"
VOL_EXTRA="${VOL_EXTRA:-}"   # p. ej. VOL_EXTRA="-v vigs=60 -v cats=8 -v regs=5" para hoteles más anchos
SIN_EQ="${3:-}"   # "sin_equivalencia" omite la comparación con la versión 2 (que tarda ~5 min con 8 hoteles)
CT="pg_vol_preflight_43_60_$$"
export MSYS_NO_PATHCONV=1
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
trap 'docker rm -f "$CT" >/dev/null 2>&1 || true' EXIT
TMP="$(mktemp -d)"; trap 'docker rm -f "$CT" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

docker run -d --name "$CT" -e POSTGRES_PASSWORD=x postgres:17 >/dev/null
n=0; until docker exec "$CT" psql -U postgres -qc "select 1" >/dev/null 2>&1; do
  n=$((n + 1)); [ $n -ge 30 ] && { echo "El contenedor no arrancó"; exit 2; }; sleep 1
done
docker cp supabase/scripts/fixture_volumen_preflight_vigencias_grupos_43_60.sql "$CT":/tmp/vol.sql >/dev/null
docker cp supabase/scripts/preflight_vigencias_grupos_43_60_lectura.sql "$CT":/tmp/final.sql >/dev/null
docker cp supabase/scripts/referencia/preflight_vigencias_grupos_43_60_lectura_v2_LENTA_solo_referencia.sql "$CT":/tmp/ref.sql >/dev/null
seg() { awk "BEGIN{printf \"%.1f\", $2 - $1}"; }
nuevo_db() { docker exec "$CT" psql -U postgres -X -q -c "create database $1" >/dev/null; docker exec "$CT" psql -U postgres -d "$1" -X -q -v ON_ERROR_STOP=1 -v hoteles="$2" $VOL_EXTRA -f /tmp/vol.sql >/dev/null; }
corre() { # db archivo jit salida -> imprime segundos
  s=$(date +%s.%N)
  docker exec "$CT" psql -U postgres -d "$1" -X -q -v ON_ERROR_STOP=1 -c "set jit=$3" -At -F '|' -f "/tmp/$2.sql" > "$4" 2>"$4.err"
  e=$(date +%s.%N); seg "$s" "$e"
}
normaliza() { awk -F'|' '{ if (index($1, ".")) print $0; else print $1 "|" $2 "|" $3 "|" $4 "|" $5 "|" $6 }' "$1"; }

if [ "$SIN_EQ" != "sin_equivalencia" ]; then
echo "--- 1) equivalencia con la versión 2 (8 hoteles sintéticos)"
nuevo_db eq 8
t_ref=$(corre eq ref off "$TMP/ref.out"); t_fin=$(corre eq final off "$TMP/fin.out")
[ ! -s "$TMP/ref.out.err" ] && [ ! -s "$TMP/fin.out.err" ] && ok "ambas ejecutan sin errores (versión 2: ${t_ref}s · final: ${t_fin}s, JIT desactivado)" || fallo "alguna de las dos devolvió errores"
normaliza "$TMP/ref.out" > "$TMP/a.txt"; normaliza "$TMP/fin.out" > "$TMP/b.txt"
[ "$(wc -l < "$TMP/a.txt")" -gt 100 ] || fallo "salida de referencia demasiado corta"
diff "$TMP/a.txt" "$TMP/b.txt" >/dev/null && ok "equivalentes: $(wc -l < "$TMP/a.txt") filas (controles, estados, hoteles incompletos y todo el detalle)" || { fallo "DIFERENCIAS entre la versión 2 y la final"; diff "$TMP/a.txt" "$TMP/b.txt" | head -6 | cut -c1-200; }

fi
echo "--- 2) volumen (versión final)"
printf "%-9s %-11s %-9s %-14s %-14s\n" hoteles vigencias tarifas "jit=on (s)" "jit=off (s)"
FILAS_REF=""
for N in $TAMANOS; do
  nuevo_db "v$N" "$N"
  vg=$(docker exec "$CT" psql -U postgres -d "v$N" -X -At -c "select count(*) from hotel_temporadas"); tf=$(docker exec "$CT" psql -U postgres -d "v$N" -X -At -c "select count(*) from tarifa_hotel")
  t_on=$(corre "v$N" final on "$TMP/on_$N.out"); t_off=$(corre "v$N" final off "$TMP/off_$N.out")
  printf "%-9s %-11s %-9s %-14s %-14s\n" "$N" "$vg" "$tf" "$t_on" "$t_off"
  [ ! -s "$TMP/on_$N.out.err" ] && [ ! -s "$TMP/off_$N.out.err" ] || fallo "$N hoteles: errores de ejecución"
  f_on=$(wc -l < "$TMP/on_$N.out"); f_off=$(wc -l < "$TMP/off_$N.out")
  [ "$f_on" = "$f_off" ] && [ "$f_on" -gt 15 ] || fallo "$N hoteles: filas distintas entre JIT activado y desactivado ($f_on/$f_off)"
  [ "$(awk "BEGIN{print ($t_on <= $TOPE && $t_off <= $TOPE)}")" = 1 ] && ok "$N hoteles dentro de ${TOPE}s" || fallo "$N hoteles supera ${TOPE}s"
  docker exec "$CT" psql -U postgres -X -q -c "drop database v$N" >/dev/null
done
[ "$FALLOS" = 0 ] && echo "TODO OK" || { echo "$FALLOS FALLO(S)"; exit 1; }
