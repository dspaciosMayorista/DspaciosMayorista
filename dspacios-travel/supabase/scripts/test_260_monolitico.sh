#!/bin/sh
# ────────────────────────────────────────────────────────
# ¿La migración 260 encarece el publicador MONOLÍTICO (el camino de siempre mientras TARIFARIO_PUBLICACION_POR_LOTES esté apagada)? La 260 agrega un disparador por fila que sella la
# generación al insertar, y dos tablas con borrado en cascada (neto y filas ocultas) que el DELETE inicial del publicador debe revisar. Se mide publicar_tarifario_resultado con 12.669 filas
# (la forma del paquete 73) en DOS bases idénticas —sin y con la 260—, con la MISMA cuota de CPU y alternando para repartir el ruido. SOLO Docker local y desechable.
# Uso (desde dspacios-travel/):  MIGRACIONES_PREVIAS="<255> <256> <258>" CPU=0.049 REPETICIONES=3 sh supabase/scripts/test_260_monolitico.sh <sufijo> [contenedor] [plantilla]
#   <sufijo> ^[a-z0-9]{1,12}$ → crea t260m_<sufijo>_pre y t260m_<sufijo>_post y las borra al final.
# ────────────────────────────────────────────────────────
set -eu
SUF="${1:-}"; CT="${2:-pg255local}"; PLANTILLA="${3:-plantilla255}"; CPU="${CPU:-0.049}"; N="${REPETICIONES:-3}"
export MSYS_NO_PATHCONV=1
printf '%s' "$SUF" | grep -Eq '^[a-z0-9]{1,12}$' || { echo "Sufijo inválido." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$AQUI/../.." && pwd)"
M259="$APP/supabase/migrations/20260601000259_publicador_tarifario_limite_acotado.sql"
M260="$APP/supabase/migrations/20260601000260_publicacion_tarifario_por_lotes.sql"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
PRE="t260m_${SUF}_pre"; POST="t260m_${SUF}_post"
NANO_PREVIO="$(docker inspect -f '{{.HostConfig.NanoCpus}}' "$CT")"
limpiar() { st=$?; docker update --cpus "$(awk "BEGIN{print ${NANO_PREVIO:-0}/1000000000}")" "$CT" >/dev/null 2>&1 || true; for d in "$PRE" "$POST"; do $PS -d postgres -c "drop database if exists $d with (force)" >/dev/null 2>&1 || true; done; exit $st; }
trap limpiar EXIT INT TERM
for d in "$PRE" "$POST"; do
  $PS -d postgres -c "create database $d template $PLANTILLA" >/dev/null
  for f in ${MIGRACIONES_PREVIAS:-}; do $PS -d "$d" < "$f" >/dev/null 2>&1; done
  $PS -d "$d" < "$M259" >/dev/null 2>&1
  $PS -d "$d" < "$AQUI/test_259_semilla.sql" >/dev/null 2>&1
done
$PS -d "$POST" < "$M260" >/dev/null 2>&1
# Variante opcional para aislar qué componente de la 260 cuesta (p. ej. POST_SQL="alter table public.tarifario_resultado disable trigger tarifario_resultado_sellar")
[ -n "${POST_SQL:-}" ] && $PS -d "$POST" -c "$POST_SQL" >/dev/null
[ "$($PS -d "$PRE" -c "select count(*) from pg_class where relname = 'tarifario_manifiesto'")" = 0 ] && [ "$($PS -d "$POST" -c "select count(*) from pg_class where relname = 'tarifario_manifiesto'")" = 1 ] || { echo "Las bases no quedaron como se esperaba (sin / con la 260)." >&2; exit 2; }

MEDIR="select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
do \$\$ declare g bigint; r bigint; t0 timestamptz; f jsonb; ok boolean;
begin
  select generacion, revision_capturada into g, r from public.iniciar_generacion_tarifario(73);
  f := public.bench_filas(12669, 73);
  t0 := clock_timestamp();
  ok := public.publicar_tarifario_resultado(73, g, r, 'COP', f);
  raise notice 'MS %', round(extract(epoch from clock_timestamp() - t0) * 1000);
end \$\$;"
medir() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -d "$1" -v ON_ERROR_STOP=1 -c "$MEDIR" 2>&1 | sed -n 's/.*MS \([0-9]*\).*/\1/p'; }
docker update --cpus 16 "$CT" >/dev/null
for d in "$PRE" "$POST"; do medir "$d" >/dev/null; done      # calentamiento (la primera publicación no borra nada)
docker update --cpus "$CPU" "$CT" >/dev/null; sleep 2
TP=""; TQ=""
i=1; while [ "$i" -le "$N" ]; do
  a="$(medir "$PRE")"; b="$(medir "$POST")"; TP="$TP $a"; TQ="$TQ $b"; echo "  ronda $i: sin la 260 ${a} ms · con la 260 ${b} ms"; i=$((i + 1))
done
docker update --cpus 16 "$CT" >/dev/null
MP="$(printf '%s\n' $TP | sort -n | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]}')"; MQ="$(printf '%s\n' $TQ | sort -n | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]}')"
echo "  mediana a CPU=$CPU: sin la 260 ${MP} ms · con la 260 ${MQ} ms · variación $(awk "BEGIN{printf \"%+.1f\", (${MQ}-${MP})*100/${MP}}")%"
echo "MONOLITICO_MS_SIN=$MP MONOLITICO_MS_CON=$MQ"
