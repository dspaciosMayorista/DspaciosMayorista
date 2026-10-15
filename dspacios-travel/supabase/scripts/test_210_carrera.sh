#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# CARRERAS · 210 cierre de K15 (20260601000210_financiero_contrato_reentrada.sql)
# DOS SESIONES REALES con COMMIT real + observador. SOLO base LOCAL DESECHABLE
# en un contenedor Docker propio (nunca remota, nunca Preview/Producción).
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_210_carrera.sh <base_nueva> [contenedor] [plantilla]
#     base_nueva  ^t210_[a-z0-9_]{1,40}$ que NO exista: se crea desde la plantilla
#                 (001–205), se le aplican 207 + 210 y se BORRA al final (KEEP=1 la
#                 conserva). Si ya existe, no se toca. SIN_210=1: modo de control sin la 210 (rojo esperado).
#     contenedor  postgres local (por defecto pg206b_eb3bbf43).
#     plantilla   base con 001–205 (por defecto plantilla205). Solo se lee.
#
#   R1   RPC ‖ RPC (mismo contrato)              → una completa, la otra {ya_completo}; 2 CxP, ids iguales
#   R2a  RPC (completando) ‖ compensación        → revertir espera y responde ya_completo; contrato intacto
#   R2b  compensación (sostiene) ‖ RPC           → la RPC espera y falla "no existe"; ni contrato ni CxP huérfanas
#   R3a  RPC ‖ upsert del payload pendiente      → el upsert espera y se descarta; 0 residuo
#   R3b  upsert del payload (sostiene) ‖ RPC     → la RPC espera, completa y borra la fila; 0 residuo
#   R4   UPDATE del pendiente (sostiene la fila) ‖ RPC → sin interbloqueo; completa; 0 residuo
#   R5   compensación (sostiene) ‖ upsert del payload → el upsert espera y la FK lo rechaza; 0 residuo
#   R6   respuesta perdida: RPC ok y luego compensación → ya_completo; contrato intacto; 0 residuo
#   R7   doble proceso (RPC ‖ RPC con el payload ya persistido) → 2 CxP, 0 residuo
#   R8   fallo intermedio: la RPC de A falla a mitad ‖ RPC de B → A deshace todo; B completa; 2 CxP de B
#   R9   dos posteos del asiento de la misma CxP    → uno entra, el otro 23505; un solo asiento
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg206b_eb3bbf43}"
PLANTILLA="${3:-plantilla205}"
export MSYS_NO_PATHCONV=1
nombre_ok() { printf '%s' "$1" | grep -Eq "$2"; }
nombre_ok "$DB" '^t210_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t210_[a-z0-9_]{1,40}\$." >&2; exit 2; }
nombre_ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
nombre_ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PSA="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
PS="$PSA -d $DB -t -A"
SES="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -d $DB -X -q -t -A -v VERBOSITY=verbose"
TMP="$(mktemp -d)"
MARCA="test_210_carrera $(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
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
  if [ -n "${SALIDAS_DIR:-}" ]; then mkdir -p "$SALIDAS_DIR" && cp "$TMP"/* "$SALIDAS_DIR"/ 2>/dev/null || true; fi
  rm -rf "$TMP"
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe: no se toca." >&2; exit 3; }
$PSA -d postgres -c "create database $DB template $PLANTILLA" >/dev/null || { echo "No se pudo crear $DB." >&2; exit 3; }
BASE_PROPIA=1
$PSA -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null
docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -d "$DB" < "$APP/supabase/migrations/20260601000207_crm_contactos_acceso.sql" >/dev/null 2>&1 || { echo "La 207 falló." >&2; exit 1; }
if [ "${SIN_210:-}" = 1 ]; then
  # Modo de CONTROL: sin la 210 (solo 171/172). Las carreras deben salir en ROJO: demuestra que detectan K15.
  # (Solo la columna que el observador `foto` lee; no cambia ningún comportamiento de la 172.)
  $PSA -d "$DB" -c "alter table public.ventas add column financiero_registrado_en timestamptz" >/dev/null
  echo "Base $DB: plantilla + 207 SIN la 210 (modo de control: se esperan FALLOS)."
else
  $PSA -d "$DB" -1 < "$APP/supabase/migrations/20260601000210_financiero_contrato_reentrada.sql" >/dev/null || { echo "La 210 falló." >&2; exit 1; }
  echo "Base $DB: plantilla + 207 + 210 aplicadas."
fi

# Contratos pendientes DTM-2103NN (NN = 01..30), payload persistido solo donde se indica.
$PS >/dev/null <<'SQL'
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado)
select 'DTM-2103' || lpad(i::text, 2, '0'), 'C', 'mayorista', 3000000, 'activo', 'pendiente' from generate_series(1, 30) i;
SQL

srv() { echo "set role service_role; select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false);"; }
CXP='[{"proveedor":"Hotel T","tipo_proveedor":"hotel","servicio":"Alojamiento","valor_total":1000000,"fecha_obligacion":"2026-10-01"},{"proveedor":"Aerolinea T","tipo_proveedor":"aereo","servicio":"Tiquete","valor_total":500000,"fecha_obligacion":"2026-10-01"}]'
reg() { echo "select public.registrar_financiero_contrato('$1', 'mayorista', '{\"costo_hotel\":1000000,\"otros_costos\":500000}'::jsonb, '$CXP'::jsonb);"; }
rev() { echo "select public.revertir_contrato_incompleto('$1', 'mayorista');"; }
ups() { echo "insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values ('$1', 'mayorista', '{\"costo_hotel\":1000000}', '$CXP'::jsonb) on conflict (numero_contrato) do update set costos = excluded.costos, cxp = excluded.cxp;"; }
foto() {
  $PS -c "select coalesce((select financiero_estado || '/reg=' || (financiero_registrado_en is not null) from public.ventas where numero_contrato = '$1'), 'sin-venta')
    || ' cxp=' || (select count(*) from public.cuentas_por_pagar where numero_contrato = '$1')
    || ' ids=' || coalesce((select string_agg(id::text, ',' order by id) from public.cuentas_por_pagar where numero_contrato = '$1'), '-')
    || ' pend=' || (select count(*) from public.contrato_financiero_pendiente where numero_contrato = '$1')
    || ' asientos=' || (select count(*) from public.asientos_contables a where a.origen = 'cxp' and a.referencia in (select 'cxp:' || id from public.cuentas_por_pagar where numero_contrato = '$1'))"
}
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
ya() { grep -q '"ya_completo": true' "$1"; }
creo() { grep -q '"creadas": \[{' "$1"; }
estado_rev() { grep -o '"estado": "[a-z_]*"' "$1" | tail -1 | sed 's/"estado": //; s/"//g'; }
sec() { echo "$(srv) begin; $1 select pg_sleep($2); commit;"; }

# R1: RPC ‖ RPC.
carrera r1 "$(sec "$(reg DTM-210301)" 3)" "$(srv) $(reg DTM-210301)" 1
F="$(foto DTM-210301)"
if creo "$TMP/r1.a" && ya "$TMP/r1.b" && sin_error "$TMP/r1.b" && [ "$(cat "$TMP/r1.ms")" -ge 1000 ] && echo "$F" | grep -q '^completo/reg=true cxp=2 ids=[0-9]*,[0-9]* pend=0 asientos=[0-9]*$'; then
  ok "R1 RPC ‖ RPC: B esperó $(cat "$TMP/r1.ms") ms y dio ya_completo; una sola escritura [$F]"
else fallo "R1 a=$(cat "$TMP/r1.a") b=$(cat "$TMP/r1.b") [$F]"; fi
IDS1="$(echo "$F" | grep -o 'ids=[0-9,]*')"
# …y un tercer intento posterior (la reentrada) tampoco mueve nada.
$SES -c "$(srv) $(reg DTM-210301)" >"$TMP/r1c" 2>&1 || true
[ "$(foto DTM-210301 | grep -o 'ids=[0-9,]*')" = "$IDS1" ] && ya "$TMP/r1c" && ok "R1b reentrada posterior: ya_completo; los mismos ids de CxP ($IDS1)" || fallo "R1b $(cat "$TMP/r1c") [$(foto DTM-210301)]"

# R2a: la RPC sostiene la venta (completando) ‖ la compensación llega a la vez.
carrera r2a "$(sec "$(reg DTM-210302)" 3)" "$(srv) $(rev DTM-210302)" 1
F="$(foto DTM-210302)"
if creo "$TMP/r2a.a" && [ "$(estado_rev "$TMP/r2a.b")" = ya_completo ] && [ "$(cat "$TMP/r2a.ms")" -ge 1000 ] && echo "$F" | grep -q '^completo/reg=true cxp=2 .* pend=0 asientos=[0-9]*$'; then
  ok "R2a RPC ‖ compensación: la compensación esperó $(cat "$TMP/r2a.ms") ms y respondió ya_completo; el contrato sigue completo [$F]"
else fallo "R2a a=$(cat "$TMP/r2a.a") b=$(cat "$TMP/r2a.b") [$F]"; fi

# R2b: la compensación sostiene la venta ‖ la RPC llega a la vez (orden inverso).
carrera r2b "$(sec "$(rev DTM-210303)" 3)" "$(srv) $(reg DTM-210303)" 1
F="$(foto DTM-210303)"
if [ "$(estado_rev "$TMP/r2b.a")" = revertido ] && [ "$(err "$TMP/r2b.b")" = P0001 ] && grep -q "no existe en la agencia" "$TMP/r2b.b" && [ "$F" = "sin-venta cxp=0 ids=- pend=0 asientos=0" ]; then
  ok "R2b compensación ‖ RPC: la RPC esperó $(cat "$TMP/r2b.ms") ms y falló 'no existe'; ni contrato ni CxP huérfanas [$F]"
else fallo "R2b a=$(cat "$TMP/r2b.a") b=$(cat "$TMP/r2b.b") [$F]"; fi

# R3a: la RPC completa (sostiene) ‖ upsert del payload.
carrera r3a "$(sec "$(reg DTM-210304)" 3)" "$(srv) $(ups DTM-210304)" 1
F="$(foto DTM-210304)"
if creo "$TMP/r3a.a" && sin_error "$TMP/r3a.b" && [ "$(cat "$TMP/r3a.ms")" -ge 1000 ] && echo "$F" | grep -q '^completo/reg=true cxp=2 .* pend=0 asientos=[0-9]*$'; then
  ok "R3a RPC ‖ upsert del payload: el upsert esperó $(cat "$TMP/r3a.ms") ms y se descartó; 0 residuo [$F]"
else fallo "R3a a=$(cat "$TMP/r3a.a") b=$(cat "$TMP/r3a.b") [$F]"; fi

# R3b: el upsert sostiene la venta ‖ la RPC llega a la vez (orden inverso).
carrera r3b "$(srv) begin; $(ups DTM-210305) select pg_sleep(3); commit;" "$(srv) $(reg DTM-210305)" 1
F="$(foto DTM-210305)"
if sin_error "$TMP/r3b.a" && creo "$TMP/r3b.b" && [ "$(cat "$TMP/r3b.ms")" -ge 1000 ] && echo "$F" | grep -q '^completo/reg=true cxp=2 .* pend=0 asientos=[0-9]*$'; then
  ok "R3b upsert ‖ RPC: la RPC esperó $(cat "$TMP/r3b.ms") ms, completó y borró la fila; 0 residuo [$F]"
else fallo "R3b a=$(cat "$TMP/r3b.a") b=$(cat "$TMP/r3b.b") [$F]"; fi

# R4: UPDATE del pendiente (como marcarIntentoFallido) sostiene la fila ‖ la RPC: sin interbloqueo.
$PS -c "$(ups DTM-210306)" >/dev/null
carrera r4 "$(srv) begin; update public.contrato_financiero_pendiente set intentos = intentos + 1, ultimo_error = 'x' where numero_contrato = 'DTM-210306'; select pg_sleep(3); commit;" "$(srv) $(reg DTM-210306)" 1
F="$(foto DTM-210306)"
if sin_error "$TMP/r4.a" && creo "$TMP/r4.b" && ! grep -q 40P01 "$TMP/r4.a" "$TMP/r4.b" && echo "$F" | grep -q '^completo/reg=true cxp=2 .* pend=0 asientos=[0-9]*$'; then
  ok "R4 UPDATE del pendiente ‖ RPC: sin interbloqueo; la RPC esperó $(cat "$TMP/r4.ms") ms; completa y 0 residuo [$F]"
else fallo "R4 a=$(cat "$TMP/r4.a") b=$(cat "$TMP/r4.b") [$F]"; fi

# R5: la compensación sostiene la venta ‖ el upsert del payload llega a la vez.
carrera r5 "$(sec "$(rev DTM-210307)" 3)" "$(srv) $(ups DTM-210307)" 1
F="$(foto DTM-210307)"
if [ "$(estado_rev "$TMP/r5.a")" = revertido ] && [ "$(err "$TMP/r5.b")" = 23503 ] && [ "$F" = "sin-venta cxp=0 ids=- pend=0 asientos=0" ]; then
  ok "R5 compensación ‖ upsert: el upsert esperó $(cat "$TMP/r5.ms") ms y la FK lo rechazó (23503); 0 residuo [$F]"
else fallo "R5 a=$(cat "$TMP/r5.a") b=$(cat "$TMP/r5.b") [$F]"; fi

# R6: respuesta perdida — la RPC confirmó pero el proceso no lo supo; la compensación no borra nada.
$SES -c "$(srv) $(ups DTM-210308) $(reg DTM-210308)" >"$TMP/r6a" 2>&1 || true
$SES -c "$(srv) $(rev DTM-210308)" >"$TMP/r6b" 2>&1 || true
F="$(foto DTM-210308)"
if [ "$(estado_rev "$TMP/r6b")" = ya_completo ] && echo "$F" | grep -q '^completo/reg=true cxp=2 .* pend=0 asientos=[0-9]*$'; then
  ok "R6 respuesta perdida + compensación: ya_completo; contrato intacto; 0 residuo [$F]"
else fallo "R6 a=$(cat "$TMP/r6a") b=$(cat "$TMP/r6b") [$F]"; fi

# R7: doble proceso con el payload ya persistido (reconciliador ‖ reconciliador).
$PS -c "$(ups DTM-210309)" >/dev/null
carrera r7 "$(sec "$(reg DTM-210309)" 2)" "$(srv) $(ups DTM-210309) $(reg DTM-210309)" 0.5
F="$(foto DTM-210309)"
if sin_error "$TMP/r7.a" && sin_error "$TMP/r7.b" && echo "$F" | grep -q '^completo/reg=true cxp=2 .* pend=0 asientos=[0-9]*$'; then
  ok "R7 doble proceso: sin error; 2 CxP y 0 residuo [$F]"
else fallo "R7 a=$(cat "$TMP/r7.a") b=$(cat "$TMP/r7.b") [$F]"; fi

# R8: la RPC de A falla a mitad (2.ª CxP) y B espera → A deshace todo; B completa con lo suyo.
$PS >/dev/null <<'SQL'
create function public.t210_falla() returns trigger language plpgsql as $$
begin if new.servicio = 'Tiquete' and current_setting('t210.falla', true) = 'si' then perform pg_sleep(2); raise exception 'fallo inyectado t210 en la 2a CxP'; end if; return new; end $$;
create trigger t210_falla before insert on public.cuentas_por_pagar for each row execute function public.t210_falla();
SQL
carrera r8 "$(srv) select set_config('t210.falla', 'si', false); $(reg DTM-210310)" "$(srv) $(reg DTM-210310)" 1
F="$(foto DTM-210310)"
if [ "$(err "$TMP/r8.a")" = P0001 ] && grep -q "fallo inyectado t210" "$TMP/r8.a" && creo "$TMP/r8.b" && echo "$F" | grep -q '^completo/reg=true cxp=2 .* pend=0 asientos=[0-9]*$'; then
  ok "R8 fallo intermedio de A ‖ RPC de B: A deshizo todo; B completó tras esperar $(cat "$TMP/r8.ms") ms; 2 CxP, sin duplicados [$F]"
else fallo "R8 a=$(cat "$TMP/r8.a") b=$(cat "$TMP/r8.b") [$F]"; fi
$PS -c "drop trigger t210_falla on public.cuentas_por_pagar; drop function public.t210_falla();" >/dev/null

# R9: dos posteos del asiento de la misma CxP (el alta y la reconciliación).
ASI="insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia) values ('mayorista', %s, current_date, 'cxp', 'cxp', 'cxp:910101');"
carrera r9 "$(srv) begin; $(printf "$ASI" 920001) select pg_sleep(3); commit;" "$(srv) $(printf "$ASI" 920002)" 1
N="$($PS -c "select count(*) from public.asientos_contables where origen = 'cxp' and referencia = 'cxp:910101'")"
if sin_error "$TMP/r9.a" && [ "$(err "$TMP/r9.b")" = 23505 ] && [ "$N" = 1 ]; then
  ok "R9 dos posteos del asiento de una CxP: el segundo esperó $(cat "$TMP/r9.ms") ms y dio 23505; un solo asiento"
else fallo "R9 a=$(cat "$TMP/r9.a") b=$(cat "$TMP/r9.b") asientos=$N"; fi

echo "Fallos: $FALLOS"
[ "$FALLOS" = 0 ]
