#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# CARRERAS · #67 (migración 220). Sesiones REALES en paralelo sobre una base DESECHABLE (CI o local);
# nunca remota. La base se crea desde la plantilla 001-219, se le aplica la 220 y sus datos se
# COMMITEAN (se descarta la base entera al final).
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_220_carrera.sh <contenedor> [plantilla]
#
# Compuerta: una sesión G toma un candado consultivo y lo conserva; la sesión que debe detenerse lo
# pide con pg_advisory_xact_lock y queda esperando (se verifica en pg_stat_activity antes de seguir).
# Se abre la compuerta terminando a G. Sin pg_sleep como sincronizador de las pruebas.
#
#   C1   vincular un vuelo a Punta Cana (A, detenida antes de confirmar) contra apagar el check (B):
#        B confirma; A falla al confirmar con destino_aereo_no_permitido; no queda vuelo incompatible
#   C2   vincular un vuelo a Santo Domingo (A) contra quitar SOLO Punta Cana (B): ambas confirman
#        (sin falso positivo); el estado final es coherente
#   C3   configuración (B, con el candado del paquete tomado y sin confirmar) contra vincular (A):
#        A queda ESPERANDO un Lock real (no el consultivo) y al confirmar B falla con
#        destino_aereo_no_permitido; no queda vuelo incompatible
#   C4   ninguna sesión terminó en deadlock
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla220}"
export MSYS_NO_PATHCONV=1
valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_220_carrera.sh <contenedor> [plantilla]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PW="${PGPASSWORD_220:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_220c $SUF"
DB="t220_ca_$SUF"
PSA="docker exec -i -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_ADMIN -X -q -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0
OKS=0
ok()    { echo "OK    $1"; OKS=$((OKS + 1)); }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
limpiar() {
  st=$?
  if [ "${KEEP:-}" != 1 ]; then
    m="$($PSA -d postgres -t -A -c "select coalesce((select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'), '<ausente>')" 2>/dev/null || true)"
    [ "$m" = "$MARCA" ] && $PSA -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
i=1
until $PSA -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>"$TMP/cb.err"; do
  [ "$i" -lt 8 ] || { cat "$TMP/cb.err" >&2; exit 1; }
  i=$((i + 1)); sleep 2
done
$PSA -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null
$PSA -d "$DB" > "$TMP/env.out" 2>&1 <<'SQL' || { echo "No se pudo preparar auth.uid()/auth.role() en la base de prueba: $(tail -3 "$TMP/env.out" | cut -c1-300)" >&2; exit 1; }
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
SQL
docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -v ON_ERROR_STOP=1 \
  < "$APP/supabase/migrations/20260601000220_paquete_destinos_aereos.sql" > "$TMP/m.out" 2>&1 \
  || { echo "No se pudo aplicar la 220: $(cut -c1-400 "$TMP/m.out")"; exit 1; }

UID_ADMIN='00000000-0000-0000-0000-000000220002'
$PSA -d "$DB" >"$TMP/fx.out" 2>&1 <<SQL || { echo "Fixtures: $(tail -5 "$TMP/fx.out")"; exit 1; }
begin;
insert into auth.users (id, email) values ('$UID_ADMIN', 'c220-admin@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
values ('$UID_ADMIN', 'c220-admin@x.test', 'C220 admin', 'administracion', true, 'mayorista')
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values
  (93010, 'C220 JUAN DOLIO', null, 'República Dominicana', true),
  (93020, 'C220 SANTO DOMINGO', 'SDQ', 'República Dominicana', true),
  (93030, 'C220 PUNTA CANA', 'PUJ', 'República Dominicana', true);
insert into public.bloqueos_vuelo (id, record, ruta, fecha_ida, fecha_regreso, cupos_total, destino_id) values
  (93101, 'C220PUJ', 'BOG - PUJ - BOG', current_date + 40, current_date + 44, 10, 93030),
  (93102, 'C220SDQ', 'BOG - SDQ - BOG', current_date + 40, current_date + 44, 10, 93020);
insert into public.armado_paquetes (id, nombre, destino_id) values (93301, 'C220 Juan Dolio', 93010);
commit;
SQL
ok "C0 base con la 220 y fixtures confirmadas"

uno() { $PSA -d "$DB" -t -A -c "$1"; }
SES() { # $1 = application_name, $2 = archivo de salida ; SQL por stdin
  docker exec -i -e PGPASSWORD="$PW" -e PGAPPNAME="$1" "$CT" psql -h 127.0.0.1 -U "$ROL_ADMIN" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 > "$2" 2>&1
}
cuando() { # $1 = consulta que devuelve 1, $2 = máximo de intentos (1 s)
  i=0
  while [ "$i" -lt "$2" ]; do
    [ "$(uno "$1" 2>/dev/null || echo 0)" = 1 ] && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}
# Estado inicial: check ENCENDIDO con las alternativas indicadas (lista SQL), sin vuelos vinculados.
reponer() { # $1 = lista de destinos alternativos, p. ej. "93030" o "93020, 93030"
  $PSA -d "$DB" > "$TMP/rep.out" 2>&1 <<SQL || { fallo "reponer: la preparación del estado falló: $(tail -3 "$TMP/rep.out" | cut -c1-300)"; exit 1; }
begin;
delete from public.armado_vuelos where paquete_id = 93301;
delete from public.armado_paquete_destinos_aereos where paquete_id = 93301;
update public.armado_paquetes set destinos_aereos_alternativos = false where id = 93301;
commit;
begin;
insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id) select 93301, d from unnest(array[$1]::bigint[]) d;
update public.armado_paquetes set destinos_aereos_alternativos = true where id = 93301;
commit;
SQL
}
# Cuántos vuelos vinculados al paquete NO cumplen hoy los destinos efectivos (debe ser 0 siempre).
incompatibles() {
  uno "select count(*) from public.armado_vuelos av join public.bloqueos_vuelo b on b.id = av.bloqueo_id join public.armado_paquetes p on p.id = av.paquete_id
        where p.id = 93301 and not (b.destino_id = any (public.destinos_aereos_efectivos_67(p.destino_id, p.destinos_aereos_alternativos,
              (select coalesce(array_agg(a.destino_id), '{}'::bigint[]) from public.armado_paquete_destinos_aereos a where a.paquete_id = p.id))))"
}
abrir_compuerta() {
  uno "select count(pg_terminate_backend(pid)) from pg_stat_activity where application_name = 'g220'" >/dev/null
}
compuerta() { # toma el candado consultivo $1 en una sesión G y lo conserva
  SES g220 "$TMP/g.out" <<SQL &
select pg_advisory_lock($1);
select pg_sleep(600);
SQL
  PID_G=$!
  cuando "select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.application_name = 'g220' and l.locktype = 'advisory' and l.granted" 30 \
    && cuando "select (count(*) >= 1)::int from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.application_name = 'g220' and l.locktype = 'advisory' and l.granted" 5 \
    || { fallo "compuerta: G no obtuvo el candado"; exit 1; }
}
# Cuerpo de B: la RPC real de guardado, como administración (rol de la API).
rpc() { # $1 = check (true/false), $2 = lista de alternativas SQL (o vacío)
  cat <<SQL
begin;
select set_config('request.jwt.claim.sub', '$UID_ADMIN', true);
set local role authenticated;
select public.guardar_destinos_aereos_67(93301, 93010, $1, array[$2]::bigint[]);
SQL
}

# ══ C1 · A (vincular PUJ) detenida antes de confirmar; B apaga el check y confirma ════════════
reponer "93030"
compuerta 220001
SES a220 "$TMP/a1.out" <<SQL &
begin;
insert into public.armado_vuelos (paquete_id, bloqueo_id) values (93301, 93101);
select pg_advisory_xact_lock(220001);
commit;
SQL
PID_A=$!
cuando "select count(*) from pg_stat_activity where application_name = 'a220' and wait_event_type = 'Lock' and wait_event = 'advisory'" 30 \
  && ok "C1.0 A (vínculo a Punta Cana) quedó detenida en la compuerta antes de confirmar" || { fallo "C1.0 A no llegó a la compuerta"; exit 1; }
{ rpc false ""; echo "commit;"; } | SES b220 "$TMP/b1.out" \
  && ok "C1.1 B apagó el check y confirmó (el vínculo de A aún no era visible)" || fallo "C1.1 B falló: $(cut -c1-300 "$TMP/b1.out")"
abrir_compuerta
wait "$PID_G" 2>/dev/null || true
RC=0; wait "$PID_A" || RC=$?
if [ "$RC" != 0 ] && grep -q 'destino_aereo_no_permitido' "$TMP/a1.out"; then ok "C1.2 A falló al confirmar con destino_aereo_no_permitido"; else fallo "C1 A debía fallar (rc=$RC): $(cut -c1-300 "$TMP/a1.out")"; fi
[ "$(incompatibles)" = 0 ] && ok "C1.3 no quedó ningún vuelo incompatible" || fallo "C1.3 quedaron vuelos incompatibles"
[ "$(uno "select destinos_aereos_alternativos::int from public.armado_paquetes where id = 93301")" = 0 ] && ok "C1.4 el check quedó apagado" || fallo "C1.4 el check no quedó apagado"

# ══ C2 · A (vincular SDQ) contra B (quitar SOLO Punta Cana): ambas confirman ═══════════════════
reponer "93020, 93030"
compuerta 220002
SES a220 "$TMP/a2.out" <<SQL &
begin;
insert into public.armado_vuelos (paquete_id, bloqueo_id) values (93301, 93102);
select pg_advisory_xact_lock(220002);
commit;
SQL
PID_A=$!
cuando "select count(*) from pg_stat_activity where application_name = 'a220' and wait_event_type = 'Lock' and wait_event = 'advisory'" 30 \
  && ok "C2.0 A (vínculo a Santo Domingo) detenida antes de confirmar" || { fallo "C2.0 A no llegó a la compuerta"; exit 1; }
{ rpc true "93020"; echo "commit;"; } | SES b220 "$TMP/b2.out" \
  && ok "C2.1 B quitó solo Punta Cana y confirmó" || fallo "C2.1 B falló: $(cut -c1-300 "$TMP/b2.out")"
abrir_compuerta
wait "$PID_G" 2>/dev/null || true
RC=0; wait "$PID_A" || RC=$?
[ "$RC" = 0 ] && ok "C2.2 A confirmó (Santo Domingo sigue permitido: sin falso positivo)" || fallo "C2.2 A falló sin motivo: $(cut -c1-300 "$TMP/a2.out")"
[ "$(incompatibles)" = 0 ] && [ "$(uno "select count(*) from public.armado_vuelos where paquete_id = 93301")" = 1 ] \
  && ok "C2.3 estado final coherente: un vuelo vinculado y ninguno incompatible" || fallo "C2.3 estado final incoherente"

# ══ C3 · B (configuración con el candado del paquete, sin confirmar) contra A (vincular PUJ) ═══
reponer "93030"
compuerta 220003
{ rpc false ""; echo "select pg_advisory_xact_lock(220003);"; echo "commit;"; } | SES b220 "$TMP/b3.out" &
PID_B=$!
cuando "select count(*) from pg_stat_activity where application_name = 'b220' and wait_event_type = 'Lock' and wait_event = 'advisory'" 30 \
  && ok "C3.0 B tiene la configuración aplicada y sin confirmar" || { fallo "C3.0 B no llegó a la compuerta"; exit 1; }
SES a220 "$TMP/a3.out" <<SQL &
begin;
insert into public.armado_vuelos (paquete_id, bloqueo_id) values (93301, 93101);
commit;
SQL
PID_A=$!
cuando "select count(*) from pg_stat_activity where application_name = 'a220' and wait_event_type = 'Lock' and wait_event <> 'advisory'" 30 \
  && ok "C3.1 A espera un Lock real del paquete (la guarda se serializa con la configuración)" || fallo "C3.1 A no quedó esperando un Lock real"
abrir_compuerta
wait "$PID_G" 2>/dev/null || true
RC=0; wait "$PID_B" || RC=$?
[ "$RC" = 0 ] && ok "C3.2 B confirmó la configuración" || fallo "C3.2 B falló: $(cut -c1-300 "$TMP/b3.out")"
RC=0; wait "$PID_A" || RC=$?
if [ "$RC" != 0 ] && grep -q 'destino_aereo_no_permitido' "$TMP/a3.out"; then ok "C3.3 A falló con destino_aereo_no_permitido tras la configuración de B"; else fallo "C3.3 A debía fallar (rc=$RC): $(cut -c1-300 "$TMP/a3.out")"; fi
[ "$(incompatibles)" = 0 ] && ok "C3.4 no quedó ningún vuelo incompatible" || fallo "C3.4 quedaron vuelos incompatibles"

# ══ C4 · sin deadlocks ═══════════════════════════════════════════════════════════════════════
if grep -qi 'deadlock' "$TMP"/a?.out "$TMP"/b?.out 2>/dev/null; then fallo "C4 hubo un deadlock"; else ok "C4 ninguna sesión terminó en deadlock"; fi

echo ""
if [ "$FALLOS" = 0 ]; then echo "TEST 220 CARRERAS: TODO OK ($OKS comprobaciones)"; else echo "TEST 220 CARRERAS: $FALLOS FALLO(S) de $((OKS + FALLOS))"; exit 1; fi
