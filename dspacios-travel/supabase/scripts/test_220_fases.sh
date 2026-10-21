#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# FASES · #67 (migración 220) sobre una base DESECHABLE (CI o local); nunca remota.
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_220_fases.sh <contenedor> [plantilla]
#   plantilla = base con las migraciones 001-219 (la crea preparar_esquema_local.sh <ct> 219 <plantilla>)
#
#   F1   preflight ANTES de la 220: P3 en INFO y un vínculo antiguo incoherente listado (P4)
#   F2   la 220 se aplica con datos antiguos incoherentes SIN validarlos (no toca lo existente)
#   F3   postcheck en OK (12 controles)
#   F4   batería SQL (test_220_destinos_aereos.sql): todo OK
#   F5   la 220 es idempotente: se aplica una segunda vez y el postcheck sigue en OK
#   F6   el rollback se NIEGA con configuración en uso (forward-only)
#   F7   el rollback procede sin configuración: la base queda sin la 220 y el vínculo antiguo intacto
#   F8   la 220 se vuelve a aplicar tras el rollback y el postcheck vuelve a OK
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla220}"
export MSYS_NO_PATHCONV=1
valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_220_fases.sh <contenedor> [plantilla]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PW="${PGPASSWORD_220:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_220f $SUF"
DB="t220_fa_$SUF"
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
MIG="$APP/supabase/migrations/20260601000220_paquete_destinos_aereos.sql"
aplicar() { docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -v ON_ERROR_STOP=1 < "$MIG" > "$TMP/m.out" 2>&1; }
correr() { docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 < "$1"; }
uno() { $PSA -d "$DB" -t -A -c "$1"; }

# Datos ANTIGUOS: un vuelo de Cartagena vinculado a un paquete de Juan Dolio (incoherente a propósito).
$PSA -d "$DB" >"$TMP/fx.out" 2>&1 <<'SQL' || { echo "Fixtures: $(tail -5 "$TMP/fx.out")"; exit 1; }
begin;
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values
  (95010, 'F220 JUAN DOLIO', null, 'República Dominicana', true),
  (95040, 'F220 CARTAGENA', 'CTG', 'Colombia', true);
insert into public.bloqueos_vuelo (id, record, ruta, fecha_ida, fecha_regreso, cupos_total, destino_id)
  values (95101, 'F220CTG', 'BOG - CTG - BOG', current_date + 40, current_date + 44, 10, 95040);
insert into public.armado_paquetes (id, nombre, destino_id) values (95301, 'F220 Juan Dolio', 95010);
-- Paquete SIN vínculos incompatibles para la "configuración en uso" de F6 (el 95301 conserva a propósito el vínculo antiguo incompatible).
insert into public.armado_paquetes (id, nombre, destino_id) values (95302, 'F220 Juan Dolio B', 95010);
insert into public.armado_vuelos (paquete_id, bloqueo_id) values (95301, 95101);
commit;
SQL

# ── F1 · preflight antes ──────────────────────────────────────────
correr "$AQUI/preflight_220_destinos_aereos.sql" > "$TMP/pre.out" 2>&1 || { fallo "F1 el preflight falló: $(tail -3 "$TMP/pre.out")"; exit 1; }
grep -Eq '^P3\|INFO\|' "$TMP/pre.out" && ok "F1.1 preflight: la 220 aún no está aplicada (P3 INFO)" || fallo "F1.1 P3: $(grep '^P3' "$TMP/pre.out")"
grep -Eq '^P4\|REVISAR\|1\|' "$TMP/pre.out" && ok "F1.2 preflight lista el vínculo antiguo incoherente (P4 REVISAR, 1)" || fallo "F1.2 P4: $(grep '^P4' "$TMP/pre.out")"
grep -Eq '^P1\|INFO\|' "$TMP/pre.out" && ok "F1.3 preflight: prerrequisitos presentes (P1 INFO)" || fallo "F1.3 P1: $(grep '^P1' "$TMP/pre.out")"

# ── F2 · aplicar con datos antiguos incoherentes ──────────────────
aplicar && ok "F2.1 la 220 se aplicó con un vínculo antiguo incoherente (no valida lo existente)" || { fallo "F2.1 la 220 falló: $(cut -c1-400 "$TMP/m.out")"; exit 1; }
[ "$(uno "select count(*) from public.armado_vuelos where paquete_id = 95301")" = 1 ] && ok "F2.2 el vínculo antiguo quedó intacto" || fallo "F2.2 el vínculo antiguo cambió"

# ── F3 · postcheck ────────────────────────────────────────────────
postcheck() { correr "$AQUI/postcheck_220_destinos_aereos.sql" > "$TMP/post.out" 2>&1; }
postcheck && grep -Eq '^OK\|12\|0\|12\|ninguno\|' "$TMP/post.out" && ok "F3 postcheck: 12 de 12 controles en OK" || fallo "F3 postcheck: $(head -3 "$TMP/post.out" | cut -c1-300)"

# ── F4 · batería SQL ──────────────────────────────────────────────
RC=0; correr "$AQUI/test_220_destinos_aereos.sql" > "$TMP/sql.out" 2>&1 || RC=$?
cat "$TMP/sql.out"
if [ "$RC" = 0 ] && grep -q 'TEST 220 SQL: TODO OK' "$TMP/sql.out" && ! grep -q 'FALLO ' "$TMP/sql.out"; then ok "F4 batería SQL en verde"; else fallo "F4 batería SQL en rojo (rc=$RC)"; fi

# ── F5 · idempotencia ─────────────────────────────────────────────
aplicar && ok "F5.1 la 220 se aplica por segunda vez sin error" || fallo "F5.1 segunda aplicación: $(cut -c1-400 "$TMP/m.out")"
postcheck && grep -Eq '^OK\|12\|0\|12\|ninguno\|' "$TMP/post.out" && ok "F5.2 postcheck sigue en OK" || fallo "F5.2 postcheck: $(head -3 "$TMP/post.out" | cut -c1-300)"

# ── F6 · el rollback se niega con configuración en uso ────────────
$PSA -d "$DB" > "$TMP/prep6.out" 2>&1 <<'SQL' || { fallo "F6 la preparación de la configuración en uso falló: $(tail -3 "$TMP/prep6.out" | cut -c1-300)"; exit 1; }
begin;
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (95020, 'F220 SANTO DOMINGO', 'SDQ', 'República Dominicana', true);
insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id) values (95302, 95020);
commit;
SQL
[ "$(uno "select count(*) from public.armado_paquete_destinos_aereos where paquete_id = 95302")" = 1 ] || { fallo "F6 la preparación no dejó la alternativa del paquete 95302"; exit 1; }
if correr "$AQUI/rollback_220_destinos_aereos.sql" > "$TMP/rb.out" 2>&1; then fallo "F6 el rollback procedió con configuración en uso"; else
  grep -q 'ROLLBACK 220 ABORTADO' "$TMP/rb.out" && ok "F6 el rollback se niega con configuración en uso (forward-only)" || fallo "F6 mensaje inesperado: $(cut -c1-300 "$TMP/rb.out")"
fi
[ "$(uno "select count(*) from public.armado_paquete_destinos_aereos where paquete_id = 95302")" = 1 ] && ok "F6.1 la configuración del paquete 95302 quedó intacta tras el rechazo" || fallo "F6.1 la configuración cambió"

# ── F7 · rollback sin configuración ───────────────────────────────
$PSA -d "$DB" -c "delete from public.armado_paquete_destinos_aereos where paquete_id = 95302" > "$TMP/prep7.out" 2>&1 || { fallo "F7 no se pudo limpiar la configuración: $(tail -3 "$TMP/prep7.out" | cut -c1-300)"; exit 1; }
[ "$(uno "select count(*) from public.armado_paquete_destinos_aereos")" = 0 ] || { fallo "F7 quedó configuración sin limpiar"; exit 1; }
correr "$AQUI/rollback_220_destinos_aereos.sql" > "$TMP/rb2.out" 2>&1 && ok "F7.1 el rollback procedió sin configuración" || fallo "F7.1 rollback: $(cut -c1-400 "$TMP/rb2.out")"
[ "$(uno "select (to_regclass('public.armado_paquete_destinos_aereos') is null)::int + (to_regprocedure('public.guardar_destinos_aereos_67(bigint,bigint,boolean,bigint[])') is null)::int
          + (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'destinos_aereos_alternativos'))::int")" = 3 ] \
  && ok "F7.2 la base quedó sin la 220 (tabla, función y columna retiradas)" || fallo "F7.2 quedaron restos de la 220"
[ "$(uno "select count(*) from public.armado_vuelos where paquete_id = 95301")" = 1 ] && ok "F7.3 el vínculo antiguo sigue intacto" || fallo "F7.3 el vínculo antiguo cambió"

# ── F8 · reaplicar ────────────────────────────────────────────────
aplicar && ok "F8.1 la 220 se reaplicó tras el rollback" || fallo "F8.1 reaplicación: $(cut -c1-400 "$TMP/m.out")"
postcheck && grep -Eq '^OK\|12\|0\|12\|ninguno\|' "$TMP/post.out" && ok "F8.2 postcheck en OK tras reaplicar" || fallo "F8.2 postcheck: $(head -3 "$TMP/post.out" | cut -c1-300)"

echo ""
if [ "$FALLOS" = 0 ]; then echo "TEST 220 FASES: TODO OK ($OKS comprobaciones)"; else echo "TEST 220 FASES: $FALLOS FALLO(S) de $((OKS + FALLOS))"; exit 1; fi
