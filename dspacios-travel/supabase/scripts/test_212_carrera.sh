#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# CARRERAS · 212 reemplazo atómico de programa_ciudades (RPC reemplazar_ruta_programa)
# DOS SESIONES REALES con COMMIT real + observador. SOLO base LOCAL DESECHABLE en un
# contenedor Docker propio (nunca remota, nunca Preview/Producción).
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_212_carrera.sh <base_nueva> <contenedor> [plantilla]
#     base_nueva  ^t212_[a-z0-9_]{1,40}$ que NO exista: se crea desde la plantilla (esquema
#                 vigente 001–210, SIN la 211), se le aplica la 212 y se BORRA al final
#                 (KEEP=1 la conserva).
#     contenedor  postgres local (obligatorio).
#     plantilla   base con el esquema vigente (por defecto postgres). Solo se lee y no debe
#                 tener otras conexiones abiertas (requisito de CREATE DATABASE ... TEMPLATE).
#
#   R1  A (explícito, sostiene el lock) ‖ B (reimportación, sin alojamientos)
#         → B espera; el resultado final es el de B con los alojamientos que dejó A (nunca los previos)
#   R2  observador durante A → ve la ruta ANTERIOR completa (jamás vacía ni a medias)
#   R3  A (ok, sostiene) ‖ B (INSERT inválido) → B falla 23514; queda exactamente lo de A
#   R4  A (ROLLBACK tras sostener) ‖ B → B espera y parte del estado original (nada de A se filtra)
#   R5  seis pares simultáneos sin retraso, cada uno con su propio conjunto → siempre un conjunto ENTERO
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-}"
PLANTILLA="${3:-postgres}"
export MSYS_NO_PATHCONV=1
nombre_ok() { printf '%s' "$1" | grep -Eq "$2"; }
nombre_ok "$DB" '^t212_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t212_[a-z0-9_]{1,40}\$." >&2; exit 2; }
nombre_ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
nombre_ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PGPW="${PGPASSWORD_212:-postgres}"
PSA="docker exec -i -e PGPASSWORD=$PGPW $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
PS="$PSA -d $DB -t -A"
SES="docker exec -i -e PGPASSWORD=$PGPW $CT psql -h 127.0.0.1 -U supabase_admin -d $DB -X -q -t -A -v VERBOSITY=verbose"
TMP="$(mktemp -d)"
MARCA="test_212_carrera $(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
FALLOS=0
BASE_PROPIA=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

limpiar() {
  st=$?
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    m="$($PSA -d postgres -t -A -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'" 2>/dev/null || true)"
    if [ "$m" = "$MARCA" ]; then
      for i in 1 2 3 4 5; do $PSA -d postgres -c "drop database $DB" >/dev/null 2>&1 && break; sleep 2; done
    else echo "AVISO: $DB no lleva la marca de esta corrida; no se borra." >&2; fi
  fi
  rm -rf "$TMP"
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe: no se toca." >&2; exit 3; }
# La 211 NO debe estar: la prueba demuestra que la 212 no la necesita.
[ "$($PSA -d "$PLANTILLA" -t -A -c "select count(*) from pg_class where relname = 'cotizacion_grupos' or relname like 'cotizaciones_comparativ%'")" = 0 ] || echo "AVISO: parece haber objetos de la 211 en la plantilla." >&2
$PSA -d postgres -c "create database $DB template $PLANTILLA" >/dev/null || { echo "No se pudo crear $DB." >&2; exit 3; }
BASE_PROPIA=1
$PSA -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null
if [ "${SIN_LOCK:-}" = 1 ]; then
  # Modo de CONTROL: la RPC sin el lock por programa. Las carreras deben salir en ROJO (demuestra que detectan la falta de serialización).
  sed '/pg_advisory_xact_lock/d' "$APP/supabase/migrations/20260601000212_programa_ruta_alojamiento.sql" | $PSA -d "$DB" >/dev/null || { echo "La 212 falló." >&2; exit 1; }
  echo "MODO CONTROL: RPC SIN lock (se esperan FALLOS)."
else
  $PSA -d "$DB" < "$APP/supabase/migrations/20260601000212_programa_ruta_alojamiento.sql" >/dev/null || { echo "La 212 falló." >&2; exit 1; }
fi
echo "Base $DB: esquema vigente + 212 aplicada."

$PS >/dev/null <<'SQL'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000021a2', 't212_carrera@x.test');
insert into public.usuarios (id, email, nombre, rol) values ('00000000-0000-0000-0000-0000000021a2', 't212_carrera@x.test', 'Op', 'operaciones')
  on conflict (id) do update set rol = 'operaciones', activo = true;
insert into public.programas (id, nombre) select 9000 + i, '__t212_carrera_' || i from generate_series(1, 30) i;
SQL

# Estado inicial de un programa: LIMA(Hotel L) · CUSCO(Hotel C1) · CUSCO(Hotel C2)
reset_prog() {
  $PS >/dev/null <<SQL
delete from public.programa_ciudades where programa_id = $1;
insert into public.programa_ciudades (programa_id, orden, nombre, noches, alojamiento_previsto) values
  ($1, 0, 'LIMA', 1, 'Hotel L'), ($1, 1, 'CUSCO', 1, 'Hotel C1'), ($1, 2, 'CUSCO', 1, 'Hotel C2');
SQL
}
ses() { echo "select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-0000000021a2\",\"role\":\"authenticated\"}', false), set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000021a2', false); set role authenticated;"; }
rpc() { echo "select public.reemplazar_ruta_programa($1, '$2'::jsonb);"; }
foto() { $PS -c "select coalesce(string_agg(nombre || '=' || coalesce(alojamiento_previsto, '~'), ',' order by orden), '(vacía)') from public.programa_ciudades where programa_id = $1"; }
t0() { date +%s%N | cut -c1-13; }
ms() { echo $(( $(t0) - $1 )); }
carrera() { # $1=nombre $2=sqlA $3=sqlB $4=retraso
  ( $SES -c "$2" >"$TMP/$1.a" 2>&1 || true ) &
  sleep "${4:-1}"
  ini=$(t0)
  $SES -c "$3" >"$TMP/$1.b" 2>&1 || true
  echo "$(ms "$ini")" >"$TMP/$1.ms"
  wait
}
err() { grep -o 'ERROR:  [A-Z0-9]\{5\}' "$1" | head -1 | sed 's/ERROR:  //'; }
sin_error() { ! grep -q ERROR "$1"; }

# R1: A reemplaza con alojamientos explícitos y sostiene; B reimporta (sin la clave) a la vez.
reset_prog 9001
JA='[{"nombre":"CUSCO","alojamiento_previsto":"A-Cusco-1"},{"nombre":"LIMA","alojamiento_previsto":"A-Lima"},{"nombre":"CUSCO","alojamiento_previsto":"A-Cusco-2"}]'
JB='[{"nombre":"Lima"},{"nombre":"CUSCO"},{"nombre":"CUSCO"},{"nombre":"CUSCO"}]'
carrera r1 "$(ses) begin; $(rpc 9001 "$JA") select pg_sleep(3); commit;" "$(ses) $(rpc 9001 "$JB")" 1
F="$(foto 9001)"
if sin_error "$TMP/r1.a" && sin_error "$TMP/r1.b" && [ "$(cat "$TMP/r1.ms")" -ge 1000 ] && [ "$F" = "Lima=A-Lima,CUSCO=A-Cusco-1,CUSCO=A-Cusco-2,CUSCO=~" ]; then
  ok "R1 B esperó $(cat "$TMP/r1.ms") ms y partió de lo que COMMITEÓ A (no de lo previo): [$F]"
else fallo "R1 a=$(cat "$TMP/r1.a") b=$(cat "$TMP/r1.b") ms=$(cat "$TMP/r1.ms") [$F]"; fi

# R2: observador durante la espera de A: la ruta anterior COMPLETA, nunca vacía ni a medias.
reset_prog 9002
( $SES -c "$(ses) begin; $(rpc 9002 "$JA") select pg_sleep(3); commit;" >"$TMP/r2.a" 2>&1 || true ) &
sleep 1
OBS="$(foto 9002)"
wait
if [ "$OBS" = "LIMA=Hotel L,CUSCO=Hotel C1,CUSCO=Hotel C2" ] && [ "$(foto 9002)" = "CUSCO=A-Cusco-1,LIMA=A-Lima,CUSCO=A-Cusco-2" ]; then
  ok "R2 mientras A sostiene la transacción otra sesión ve la ruta anterior entera [$OBS]; tras el COMMIT, la nueva"
else fallo "R2 observado=[$OBS] final=[$(foto 9002)] a=$(cat "$TMP/r2.a")"; fi

# R3: A ok (sostiene) ‖ B con un INSERT inválido (>200 caracteres) → B falla y queda lo de A.
reset_prog 9003
LARGO="$(printf 'x%.0s' $(seq 1 201))"
JBAD="[{\"nombre\":\"ZZ1\",\"alojamiento_previsto\":\"ok\"},{\"nombre\":\"ZZ2\",\"alojamiento_previsto\":\"$LARGO\"}]"
carrera r3 "$(ses) begin; $(rpc 9003 "$JA") select pg_sleep(3); commit;" "$(ses) $(rpc 9003 "$JBAD")" 1
F="$(foto 9003)"
if sin_error "$TMP/r3.a" && [ "$(err "$TMP/r3.b")" = 23514 ] && [ "$(cat "$TMP/r3.ms")" -ge 1000 ] && [ "$F" = "CUSCO=A-Cusco-1,LIMA=A-Lima,CUSCO=A-Cusco-2" ]; then
  ok "R3 B esperó $(cat "$TMP/r3.ms") ms, falló 23514 y no dejó rastro: [$F]"
else fallo "R3 a=$(cat "$TMP/r3.a") b=$(cat "$TMP/r3.b") ms=$(cat "$TMP/r3.ms") [$F]"; fi

# R4: A hace su reemplazo y luego ROLLBACK; B (reimportación) espera y parte del estado ORIGINAL.
reset_prog 9004
carrera r4 "$(ses) begin; $(rpc 9004 "$JA") select pg_sleep(3); rollback;" "$(ses) $(rpc 9004 "$JB")" 1
F="$(foto 9004)"
if sin_error "$TMP/r4.a" && sin_error "$TMP/r4.b" && [ "$(cat "$TMP/r4.ms")" -ge 1000 ] && [ "$F" = "Lima=Hotel L,CUSCO=Hotel C1,CUSCO=Hotel C2,CUSCO=~" ]; then
  ok "R4 B esperó $(cat "$TMP/r4.ms") ms; el ROLLBACK de A no filtró nada: [$F]"
else fallo "R4 a=$(cat "$TMP/r4.a") b=$(cat "$TMP/r4.b") ms=$(cat "$TMP/r4.ms") [$F]"; fi

# R5: pares simultáneos sin retraso, cada sesión con su propio conjunto explícito.
MAL=0
for i in 1 2 3 4 5 6; do
  P=$((9010 + i)); reset_prog $P
  SA='[{"nombre":"AAA","alojamiento_previsto":"a1"},{"nombre":"AAA","alojamiento_previsto":"a2"},{"nombre":"AAB","alojamiento_previsto":"a3"}]'
  SB='[{"nombre":"BBB","alojamiento_previsto":"b1"},{"nombre":"BBC","alojamiento_previsto":"b2"}]'
  ( $SES -c "$(ses) $(rpc $P "$SA")" >"$TMP/r5.$i.a" 2>&1 || true ) &
  ( $SES -c "$(ses) $(rpc $P "$SB")" >"$TMP/r5.$i.b" 2>&1 || true ) &
  wait
  F="$(foto $P)"
  N="$($PS -c "select count(*) from public.programa_ciudades where programa_id = $P")"
  case "$F" in
    "AAA=a1,AAA=a2,AAB=a3"|"BBB=b1,BBC=b2") : ;;
    *) MAL=$((MAL + 1)); echo "  mezcla/duplicado en $P: [$F] n=$N" ;;
  esac
  if grep -q ERROR "$TMP/r5.$i.a" "$TMP/r5.$i.b"; then MAL=$((MAL + 1)); echo "  error inesperado en $P: $(cat "$TMP/r5.$i.a" "$TMP/r5.$i.b")"; fi
done
[ "$MAL" = 0 ] && ok "R5 6 pares simultáneos: siempre un conjunto ENTERO (sin mezcla, sin duplicados, sin errores)" || fallo "R5 $MAL anomalías"

echo "------------------------------------------------------------"
if [ "$FALLOS" = 0 ]; then echo "TEST 212 CARRERAS: TODO OK"; else echo "TEST 212 CARRERAS: $FALLOS FALLO(S)"; exit 1; fi
