#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# CARRERAS · #67 (migración 220). Sesiones REALES en paralelo sobre una base DESECHABLE (CI o local);
# nunca remota. La base se crea desde la plantilla (cadena 001-221 SIN la 220), se le aplica la 220 y sus
# datos se COMMITEAN (se descarta la base entera al final).
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_220_carrera.sh <contenedor> [plantilla]
#
# SEMÁNTICA REAL (diagnosticada con evidencia en este mismo log, líneas "EVIDENCIA"):
#   El trigger `tarifario_trg_armado_vuelos` de la migración 181 (after insert/update/delete en
#   armado_vuelos, for each row) llama a tarifario_invalidar(), que hace UPDATE de la fila del paquete en
#   armado_paquetes EN EL MOMENTO DEL INSERT. Por eso quien vincula un vuelo conserva la fila del paquete
#   tomada (NO KEY UPDATE) hasta confirmar o abortar, y toda configuración concurrente del mismo paquete
#   (la RPC guardar_destinos_aereos_67 empieza con SELECT … FOR NO KEY UPDATE sobre esa fila) queda
#   ESPERANDO a que el vínculo se confirme, y viceversa. No es la 220: la 220 solo agrega sus propias
#   guardas diferidas (al confirmar) y su candado FOR NO KEY UPDATE, que ya está tomado por la 181.
#   Consecuencia: las dos operaciones se SERIALIZAN; la que confirma primero gana y la segunda valida
#   contra el estado ya confirmado de la primera y, si ya no cumple, falla con su código.
#
# Compuerta: una sesión G toma un candado consultivo y lo conserva; la sesión que debe detenerse lo pide
# con pg_advisory_xact_lock y queda esperando (se verifica en pg_stat_activity). La compuerta se abre por
# ESTADO (la otra sesión quedó esperando) o por TIEMPO (10 s), nunca después de esperar a que la sesión
# bloqueada termine (eso la colgaría: espera a A, que espera la compuerta).
# Nada puede colgarse: todas las sesiones (A, B, G) llevan lock_timeout y statement_timeout de pocos
# segundos, G se libera sola a los 45 s y un vigía aborta la prueba entera a los 110 s con mensaje claro.
#
#   C1   vincular PUJ (A, sin confirmar) contra apagar el check (B): B ESPERA a A; al confirmar A, B falla
#        con destino_aereo_vinculos y pide desvincular; el check sigue encendido; el vuelo queda vinculado
#   C2   vincular SDQ (A) contra quitar SOLO Punta Cana (B): B espera a A; ambas confirman (sin falso positivo)
#   C3   configuración (B, con la fila del paquete tomada, sin confirmar) contra vincular PUJ (A): A ESPERA a
#        B; al confirmar B, A falla con destino_aereo_no_permitido; el check queda apagado; ningún vuelo
#   C4   ninguna sesión terminó en deadlock ni quedó viva
# En C1-C3, además: NUNCA queda un vuelo incompatible confirmado.
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
PLAZO_TOTAL=110
# Opciones de sesión: A y B no pueden esperar más de 25 s un candado ni ejecutar más de 35 s una sentencia;
# G se libera sola (statement_timeout 50 s sobre un pg_sleep de 45 s) y no espera más de 5 s para tomar el candado.
OPT_AB="-c lock_timeout=25s -c statement_timeout=35s -c idle_in_transaction_session_timeout=40s"
OPT_G="-c lock_timeout=5s -c statement_timeout=50s"
ok()    { echo "OK    $1"; OKS=$((OKS + 1)); }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
VIGIA=""
limpiar() {
  st=$?
  [ -z "$VIGIA" ] || kill "$VIGIA" 2>/dev/null || true
  if [ "${KEEP:-}" != 1 ]; then
    m="$($PSA -d postgres -t -A -c "select coalesce((select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'), '<ausente>')" 2>/dev/null || true)"
    [ "$m" = "$MARCA" ] && $PSA -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT
trap 'echo "FALLO PLAZO: las carreras superaron ${PLAZO_TOTAL} s (orquestación colgada o sesión bloqueada); se aborta la prueba." >&2; exit 124' TERM
# Vigía: aborta la prueba entera si algo se cuelga. Sin salida propia (no retiene el pipe de tee).
( sleep "$PLAZO_TOTAL"; kill -TERM "$$" ) >/dev/null 2>&1 &
VIGIA=$!

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
ok "C0 base con la 220 (sobre la cadena sin la 220) y fixtures confirmadas"

uno() { $PSA -d "$DB" -t -A -c "$1"; }
SES() { # $1 = application_name, $2 = archivo de salida, $3 = opciones de sesión (por defecto OPT_AB) ; SQL por stdin
  docker exec -i -e PGPASSWORD="$PW" -e PGAPPNAME="$1" -e PGOPTIONS="${3:-$OPT_AB}" "$CT" \
    psql -h 127.0.0.1 -U "$ROL_ADMIN" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 > "$2" 2>&1
}
cuando() { # $1 = consulta que devuelve 1, $2 = máximo de intentos (1 s); devuelve 0 si se cumplió
  i=0
  while [ "$i" -lt "$2" ]; do
    [ "$(uno "$1" 2>/dev/null || echo 0)" = 1 ] && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}
espera_gate() { # $1 = application_name que debe estar detenida en la compuerta (espera consultiva)
  cuando "select (count(*) = 1)::int from pg_stat_activity where application_name = '$1' and wait_event_type = 'Lock' and wait_event = 'advisory'" 15
}
bloqueada_por() { # $1 = sesión que debe quedar ESPERANDO a $2 (espera de fila: tuple o transactionid, nunca la compuerta)
  cuando "select (count(*) >= 1)::int from pg_stat_activity b where b.application_name = '$1' and b.wait_event_type = 'Lock' and b.wait_event in ('tuple', 'transactionid')
          and exists (select 1 from pg_stat_activity a where a.application_name = '$2' and a.pid = any (pg_blocking_pids(b.pid)))" 10
}
evidencia() { # $1 = etiqueta ; deja en el log quién espera a quién y qué candados hay sin conceder
  echo "EVIDENCIA [$1] sesiones (estado, espera, bloqueada por):"
  uno "select '  ' || a.application_name || ' pid=' || a.pid || ' estado=' || coalesce(a.state, '-') || ' espera=' || coalesce(a.wait_event_type || '/' || a.wait_event, '-')
              || ' bloqueada_por=' || coalesce((select string_agg(x.application_name, ',') from pg_stat_activity x where x.pid = any (pg_blocking_pids(a.pid))), '-')
         from pg_stat_activity a where a.application_name in ('a220', 'b220', 'g220') order by a.application_name"
  echo "EVIDENCIA [$1] candados SIN conceder:"
  uno "select '  ' || a.application_name || ' ' || l.locktype || ' ' || l.mode || ' ' || coalesce(l.relation::regclass::text, coalesce(l.transactionid::text, '-'))
         from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.application_name in ('a220', 'b220', 'g220') and not l.granted order by 1"
}
sesiones_vivas() { uno "select count(*) from pg_stat_activity where application_name in ('a220', 'b220', 'g220')"; }
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
abrir_compuerta() { # cierra G (libera el candado) y espera a que termine
  uno "select count(pg_terminate_backend(pid)) from pg_stat_activity where application_name = 'g220'" >/dev/null
  wait "$PID_G" 2>/dev/null || true
}
compuerta() { # toma el candado consultivo $1 en una sesión G y lo conserva (máx. 45 s)
  SES g220 "$TMP/g.out" "$OPT_G" <<SQL &
select pg_advisory_lock($1);
select pg_sleep(45);
SQL
  PID_G=$!
  cuando "select (count(*) = 1)::int from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.application_name = 'g220' and l.locktype = 'advisory' and l.granted" 15 \
    || { fallo "compuerta: G no obtuvo el candado $1 ($(cut -c1-200 "$TMP/g.out"))"; exit 1; }
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

# ── Evidencia de la causa: qué triggers de usuario hay sobre las tablas del armado ─────────────────────
echo "EVIDENCIA triggers de usuario sobre armado_vuelos: $(uno "select string_agg(tgname, ', ' order by tgname) from pg_trigger where tgrelid = 'public.armado_vuelos'::regclass and not tgisinternal")"
echo "EVIDENCIA triggers de usuario sobre armado_paquetes: $(uno "select string_agg(tgname, ', ' order by tgname) from pg_trigger where tgrelid = 'public.armado_paquetes'::regclass and not tgisinternal")"

# ══ C1 · A (vincular PUJ, sin confirmar) contra B (apagar el check) ═══════════════════════════════════
reponer "93030"
REV_ANTES="$(uno "select tarifario_revision_fuente from public.armado_paquetes where id = 93301")"
compuerta 220001
SES a220 "$TMP/a1.out" <<SQL &
begin;
insert into public.armado_vuelos (paquete_id, bloqueo_id) values (93301, 93101);
select 'EVIDENCIA revision de armado_paquetes vista DENTRO de A (sin confirmar) = ' || tarifario_revision_fuente from public.armado_paquetes where id = 93301;
select pg_advisory_xact_lock(220001);
commit;
SQL
PID_A=$!
espera_gate a220 && ok "C1.0 A (vínculo a Punta Cana) quedó detenida en la compuerta antes de confirmar" || { fallo "C1.0 A no llegó a la compuerta ($(cut -c1-200 "$TMP/a1.out"))"; exit 1; }
{ rpc false ""; echo "commit;"; } | SES b220 "$TMP/b1.out" &
PID_B=$!
if bloqueada_por b220 a220; then ok "C1.1 B queda ESPERANDO a A (A tiene tomada la fila del paquete desde su insert, por el trigger de la 181)"; else fallo "C1.1 B no quedó esperando a A en 10 s"; fi
evidencia C1
echo "EVIDENCIA revision CONFIRMADA (vista desde fuera) = $(uno "select tarifario_revision_fuente from public.armado_paquetes where id = 93301"); antes de A = $REV_ANTES"
abrir_compuerta
RC_A=0; wait "$PID_A" || RC_A=$?
RC_B=0; wait "$PID_B" || RC_B=$?
if [ "$RC_A" = 0 ] && [ "$RC_B" != 0 ] && grep -q 'destino_aereo_vinculos' "$TMP/b1.out" \
   && [ "$(uno "select destinos_aereos_alternativos::int from public.armado_paquetes where id = 93301")" = 1 ] \
   && [ "$(uno "select count(*) from public.armado_vuelos where paquete_id = 93301 and bloqueo_id = 93101")" = 1 ]; then
  ok "C1.2 A confirmó primero; B falló con destino_aereo_vinculos (pide desvincular); el check sigue encendido y el vuelo quedó vinculado"
elif [ "$RC_A" != 0 ] && [ "$RC_B" = 0 ] && grep -q 'destino_aereo_no_permitido' "$TMP/a1.out" \
   && [ "$(uno "select destinos_aereos_alternativos::int from public.armado_paquetes where id = 93301")" = 0 ] \
   && [ "$(uno "select count(*) from public.armado_vuelos where paquete_id = 93301")" = 0 ]; then
  ok "C1.2 B confirmó primero; A falló con destino_aereo_no_permitido; el check quedó apagado y ningún vuelo vinculado"
else
  fallo "C1.2 resultado inesperado (rc A=$RC_A, rc B=$RC_B). A: $(cut -c1-250 "$TMP/a1.out" | tr '\n' ' ') | B: $(cut -c1-250 "$TMP/b1.out" | tr '\n' ' ')"
fi
grep -h 'EVIDENCIA revision' "$TMP/a1.out" 2>/dev/null | head -1 || true
[ "$(incompatibles)" = 0 ] && ok "C1.3 no quedó ningún vuelo incompatible confirmado" || fallo "C1.3 quedaron vuelos incompatibles"

# ══ C2 · A (vincular SDQ) contra B (quitar SOLO Punta Cana): ambas confirman ═══════════════════════════
reponer "93020, 93030"
compuerta 220002
SES a220 "$TMP/a2.out" <<SQL &
begin;
insert into public.armado_vuelos (paquete_id, bloqueo_id) values (93301, 93102);
select pg_advisory_xact_lock(220002);
commit;
SQL
PID_A=$!
espera_gate a220 && ok "C2.0 A (vínculo a Santo Domingo) detenida en la compuerta antes de confirmar" || { fallo "C2.0 A no llegó a la compuerta ($(cut -c1-200 "$TMP/a2.out"))"; exit 1; }
{ rpc true "93020"; echo "commit;"; } | SES b220 "$TMP/b2.out" &
PID_B=$!
if bloqueada_por b220 a220; then ok "C2.1 B queda ESPERANDO a A"; else fallo "C2.1 B no quedó esperando a A en 10 s"; fi
evidencia C2
abrir_compuerta
RC_A=0; wait "$PID_A" || RC_A=$?
RC_B=0; wait "$PID_B" || RC_B=$?
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ]; then ok "C2.2 las dos confirmaron (Santo Domingo sigue permitido: sin falso positivo)"
else fallo "C2.2 una falló sin motivo (rc A=$RC_A, rc B=$RC_B). A: $(cut -c1-250 "$TMP/a2.out" | tr '\n' ' ') | B: $(cut -c1-250 "$TMP/b2.out" | tr '\n' ' ')"; fi
[ "$(incompatibles)" = 0 ] && [ "$(uno "select count(*) from public.armado_vuelos where paquete_id = 93301")" = 1 ] \
  && [ "$(uno "select string_agg(destino_id::text, ',') from public.armado_paquete_destinos_aereos where paquete_id = 93301")" = 93020 ] \
  && ok "C2.3 estado final coherente: un vuelo vinculado, solo Santo Domingo como alternativa y ninguno incompatible" || fallo "C2.3 estado final incoherente"

# ══ C3 · B (configuración con la fila del paquete tomada, sin confirmar) contra A (vincular PUJ) ═══════
reponer "93030"
compuerta 220003
{ rpc false ""; echo "select pg_advisory_xact_lock(220003);"; echo "commit;"; } | SES b220 "$TMP/b3.out" &
PID_B=$!
espera_gate b220 && ok "C3.0 B tiene la configuración aplicada y sin confirmar (detenida en la compuerta)" || { fallo "C3.0 B no llegó a la compuerta ($(cut -c1-200 "$TMP/b3.out"))"; exit 1; }
SES a220 "$TMP/a3.out" <<SQL &
begin;
insert into public.armado_vuelos (paquete_id, bloqueo_id) values (93301, 93101);
commit;
SQL
PID_A=$!
if bloqueada_por a220 b220; then ok "C3.1 A queda ESPERANDO a B (la fila del paquete la tiene B)"; else fallo "C3.1 A no quedó esperando a B en 10 s"; fi
evidencia C3
abrir_compuerta
RC_B=0; wait "$PID_B" || RC_B=$?
RC_A=0; wait "$PID_A" || RC_A=$?
[ "$RC_B" = 0 ] && ok "C3.2 B confirmó la configuración" || fallo "C3.2 B falló (rc=$RC_B): $(cut -c1-250 "$TMP/b3.out" | tr '\n' ' ')"
if [ "$RC_A" != 0 ] && grep -q 'destino_aereo_no_permitido' "$TMP/a3.out"; then ok "C3.3 A falló con destino_aereo_no_permitido tras la configuración de B"; else fallo "C3.3 A debía fallar con destino_aereo_no_permitido (rc=$RC_A): $(cut -c1-250 "$TMP/a3.out" | tr '\n' ' ')"; fi
[ "$(incompatibles)" = 0 ] && [ "$(uno "select count(*) from public.armado_vuelos where paquete_id = 93301")" = 0 ] \
  && [ "$(uno "select destinos_aereos_alternativos::int from public.armado_paquetes where id = 93301")" = 0 ] \
  && ok "C3.4 estado final: check apagado, ningún vuelo vinculado ni incompatible" || fallo "C3.4 estado final incoherente"

# ══ C4 · sin deadlocks y sin sesiones vivas ═════════════════════════════════════════════════════════════
if grep -qi 'deadlock' "$TMP"/a?.out "$TMP"/b?.out 2>/dev/null; then fallo "C4.1 hubo un deadlock"; else ok "C4.1 ninguna sesión terminó en deadlock"; fi
[ "$(sesiones_vivas)" = 0 ] && ok "C4.2 no quedó ninguna sesión A/B/G viva" || fallo "C4.2 quedaron sesiones vivas: $(sesiones_vivas)"

echo ""
if [ "$FALLOS" = 0 ]; then echo "TEST 220 CARRERAS: TODO OK ($OKS comprobaciones)"; else echo "TEST 220 CARRERAS: $FALLOS FALLO(S) de $((OKS + FALLOS))"; exit 1; fi
