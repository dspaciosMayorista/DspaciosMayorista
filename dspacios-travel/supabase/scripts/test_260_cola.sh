#!/bin/sh
# ────────────────────────────────────────────────────────
# Migración 260 (publicación del tarifario por lotes): prueba de la cola, el trabajador, los reintentos, los huérfanos, la composición (258) y la lectura por rol, MÁS tres
# escenarios con varias sesiones: (1) un trabajador no pisa a otro (SKIP LOCKED → «ocupada»), (2) dos trabajadores en carrera publican UNA sola vez sin duplicar filas,
# (3) pg_cron REAL (1.6, el de la imagen de Supabase) ejecuta el trabajador y termina la publicación sin ningún cliente.
# SOLO Docker local y desechable. Uso (desde dspacios-travel/):
#   MIGRACIONES_PREVIAS="<255> <256> <258>" sh supabase/scripts/test_260_cola.sh <base_nueva> [contenedor_pg] [plantilla]
#     base_nueva    nombre NUEVO ^t260_[a-z0-9_]{1,40}$ que NO exista; se crea desde la plantilla y se borra al final (KEEP=1 la conserva).
#     plantilla     base con las migraciones 001-254 (preparar_esquema_local.sh <contenedor> 254 <plantilla>). Solo se lee.
# Propiedad: la base nueva y, para el escenario 3, un trabajo de pg_cron con prefijo t260_ en la base `postgres` del contenedor (se retira al final).
# ────────────────────────────────────────────────────────
set -eu
DB="${1:-}"; CT="${2:-pg255local}"; PLANTILLA="${3:-plantilla255}"
export MSYS_NO_PATHCONV=1
printf '%s' "$DB" | grep -Eq '^t260_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t260_[a-z0-9_]{1,40}\$." >&2; exit 2; }
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
printf '%s' "$PLANTILLA" | grep -Eq '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$AQUI/../.." && pwd)"
M259="$APP/supabase/migrations/20260601000259_publicador_tarifario_limite_acotado.sql"
M260="$APP/supabase/migrations/20260601000260_publicacion_tarifario_por_lotes.sql"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
FALLAS=0
ok() { echo "  OK   $*"; }
fallo() { echo "  FALLA $*"; FALLAS=$((FALLAS + 1)); }
limpiar() {
  st=$?
  $PS -d postgres -c "select cron.unschedule(jobid) from cron.job where jobname like 't260_%'" >/dev/null 2>&1 || true
  [ "${KEEP:-}" = 1 ] || $PS -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || echo "AVISO: no se pudo borrar $DB" >&2
  exit $st
}
trap limpiar EXIT INT TERM

$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for f in ${MIGRACIONES_PREVIAS:-}; do [ -f "$f" ] || { echo "No existe $f" >&2; exit 2; }; echo "== previa: $(basename "$f")"; $PS -d "$DB" < "$f" >/dev/null 2>&1; done
echo "== 259 + semilla + 260"
$PS -d "$DB" < "$M259" >/dev/null 2>&1
$PS -d "$DB" < "$AQUI/test_259_semilla.sql" >/dev/null 2>&1
$PS -d "$DB" < "$M260" >/dev/null 2>&1 || { echo "La migración 260 falló al aplicarse." >&2; $PS -d "$DB" < "$M260" 2>&1 | tail -5; exit 1; }

echo "== pruebas SQL (cola, trabajador, reintentos, huérfanos, composición, lectura por rol)"
SAL="$(docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -d "$DB" -v ON_ERROR_STOP=1 < "$AQUI/test_260_cola.sql" 2>&1 || true)"
echo "$SAL" | grep -E "^(NOTICE:  +(OK|FALLA)|psql:|ERROR|[0-9]+ comprobaciones|COLA260)" | sed 's/^NOTICE:  //' | cut -c1-260
echo "$SAL" | grep -q "COLA260: todas las pruebas SQL pasaron" || FALLAS=$((FALLAS + 1))

# Sesión «usuario interno» para las llamadas por rol (igual que en las pruebas SQL).
SESION="select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);"

echo "== escenario 1 · un trabajador NO pisa a otro (SKIP LOCKED)"
G=$($PS -d "$DB" -c "$SESION select public.t_preparar260('s1', 3000, 1000); select public.t_publicar260('s1');" | tail -1)
( $PS -d "$DB" -c "begin; select 1 from public.tarifario_publicacion_cola where paquete_id = 73 for update; select pg_sleep(5); commit;" >/dev/null 2>&1 ) &
sleep 1.5
R=$($PS -d "$DB" -c "$SESION select public.tarifario_publicacion_avanzar(73, $G)" | tail -1)
[ "$R" = "ocupada" ] && ok "con la cola bloqueada por otro trabajador la llamada responde «ocupada» sin esperar" || fallo "esperaba «ocupada», recibió «$R»"
W=$($PS -d "$DB" -c "select public.tarifario_cola_correr(3000)" | tail -1)
echo "$W" | grep -q '"pasos": 0' && ok "el trabajador, con la publicación tomada por otro, sale sin hacer pasos: $W" || fallo "el trabajador no debía avanzar una publicación ocupada: $W"
wait
echo "== escenario 2 · dos trabajadores en carrera publican UNA vez, sin duplicar filas"
( $PS -d "$DB" -c "select public.tarifario_cola_correr(60000)" > /tmp/t260_w1.out 2>&1 ) &
( $PS -d "$DB" -c "select public.tarifario_cola_correr(60000)" > /tmp/t260_w2.out 2>&1 ) &
wait
FILAS=$($PS -d "$DB" -c "select count(*) from public.tarifario_resultado where paquete_id = 73 and paquete_nombre = 's1'")
DUP=$($PS -d "$DB" -c "select count(*) - count(distinct precio_pvp) from public.tarifario_resultado where paquete_id = 73 and generacion = $G")
GENS=$($PS -d "$DB" -c "select count(distinct r.generacion) from public.tarifario_resultado r where r.paquete_id = 73 and exists (select 1 from public.tarifario_resultado_publicable v where v.id = r.id)")
COLA=$($PS -d "$DB" -c "select count(*) from public.tarifario_publicacion_cola")
[ "$FILAS" = 3000 ] && [ "$DUP" = 0 ] && [ "$GENS" = 1 ] && [ "$COLA" = 0 ] && ok "3.000 filas exactas, 0 duplicadas, una sola generación visible y la cola vacía (w1: $(tr -d '\n' < /tmp/t260_w1.out | cut -c1-60) · w2: $(tr -d '\n' < /tmp/t260_w2.out | cut -c1-60))" \
  || fallo "carrera: filas=$FILAS duplicadas=$DUP generaciones=$GENS cola=$COLA"

echo "== escenario 3 · pg_cron REAL ejecuta el trabajador sin ningún cliente"
$PS -d postgres -c "create extension if not exists pg_cron" >/dev/null 2>&1 || true
if [ "$($PS -d postgres -c "select count(*) from pg_extension where extname = 'pg_cron'")" = 1 ]; then
  G3=$($PS -d "$DB" -c "$SESION select public.t_preparar260('s3', 4000, 1000); select public.t_publicar260('s3');" | tail -1)
  echo "  publicación $G3 encolada (4 lotes en espera); nadie llama a avanzar"
  # Mismos comandos que la migración, apuntando a la base de prueba. 'N seconds' (pg_cron >= 1.5) y la sintaxis de cron.schedule se comprueban con el motor real.
  $PS -d postgres -c "select cron.schedule_in_database('t260_cola', '3 seconds', 'select public.tarifario_cola_correr()', '$DB')" >/dev/null
  VISTO=0
  for i in $(seq 1 40); do
    N=$($PS -d "$DB" -c "select count(*) from public.tarifario_resultado_publicable where paquete_id = 73 and paquete_nombre = 's3'")
    [ "$N" = 4000 ] && { VISTO=1; break; }
    sleep 2
  done
  [ "$VISTO" = 1 ] && ok "pg_cron publicó las 4.000 filas por su cuenta (≈ $((i * 2)) s) sin ninguna petición" || fallo "pg_cron no terminó la publicación en 80 s"
  EST=$($PS -d postgres -c "select count(*) filter (where status = 'succeeded'), count(*) filter (where status = 'failed') from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 't260_cola'")
  echo "  ejecuciones de pg_cron (ok|fallidas): $EST"
  case "$EST" in *"|0") ok "ninguna ejecución del trabajo falló";; *) fallo "hubo ejecuciones fallidas de pg_cron: $EST";; esac
  # La rutina de purga de la migración se acepta tal cual
  $PS -d postgres -c "select cron.schedule('t260_purga', '17 3 * * *', \$c\$delete from cron.job_run_details where end_time < now() - interval '1 day' and jobid in (select jobid from cron.job where jobname = 'tarifario_cola_correr')\$c\$)" >/dev/null && ok "el trabajo de purga diaria de la migración es aceptado por pg_cron"
  $PS -d postgres -c "select cron.unschedule(jobid) from cron.job where jobname like 't260_%'" >/dev/null
else
  echo "  AVISO: pg_cron no está disponible en este contenedor: escenario 3 NO verificado"; FALLAS=$((FALLAS + 1))
fi

echo
[ "$FALLAS" = 0 ] && echo "TEST 260 COLA: todo pasó" || echo "TEST 260 COLA: $FALLAS FALLA(S)"
[ "$FALLAS" = 0 ]
