#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# FASES · hotfix 224 (fase 1, ADITIVA: vista empaquetados_basica) sobre una base DESECHABLE (CI o local); nunca remota.
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_224_fases.sh <contenedor> [plantilla]
#   plantilla = cadena 001-223 (la crea el workflow con preparar_esquema_local.sh ... 223 <plantilla>)
#
#   F1   preflight ANTES de la 224: la vista aún no existe (P2 INFO, 0); cuenta la policy que nombra a venta
#        (P4 INFO, 1) y no bloquea
#   F2   la 224 se aplica sobre datos existentes sin tocarlos NI cambiar ninguna policy (huella md5 igual: es aditiva)
#   F3   postcheck consolidado en OK (9 de 9 controles)
#   F4   batería SQL (test_224_neto_empaquetados.sql): todo OK (venta lee la vista Y TAMBIÉN la tabla base)
#   F5   la 224 es idempotente: se aplica una segunda vez y el postcheck sigue en OK
#   F6   el rollback retira la vista; las policies de empaquetados, empaquetado_cambios y armado_empaquetados quedan
#        EXACTAMENTE como antes de la 224 (huella md5 idéntica); no toca los datos
#   F7   la 224 se vuelve a aplicar tras el rollback y el postcheck vuelve a OK
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla224}"
export MSYS_NO_PATHCONV=1
valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_224_fases.sh <contenedor> [plantilla]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PW="${PGPASSWORD_224:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_224f $SUF"
DB="t224_fa_$SUF"
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
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
SQL
MIG="$APP/supabase/migrations/20260601000224_neto_empaquetados_por_rol.sql"
aplicar() { docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -v ON_ERROR_STOP=1 < "$MIG" > "$TMP/m.out" 2>&1; }
correr() { docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 < "$1"; }
uno() { $PSA -d "$DB" -t -A -c "$1"; }

# Huella de las policies de las tres tablas de empaquetados (nombre, comando, roles, USING y WITH CHECK).
HUELLA_SQL="select md5(coalesce(string_agg(tablename || '/' || policyname || '/' || cmd || '/' || permissive || '/' || array_to_string(roles, ',') || '/' || coalesce(qual, '') || '/' || coalesce(with_check, ''), '|' order by tablename, policyname), ''))
            from pg_policies where schemaname = 'public' and tablename in ('empaquetados', 'empaquetado_cambios', 'armado_empaquetados')"

# Datos existentes: se deben conservar intactos a lo largo de todas las fases.
$PSA -d "$DB" >"$TMP/fx.out" 2>&1 <<'SQL' || { echo "Fixtures: $(tail -5 "$TMP/fx.out")"; exit 1; }
insert into public.empaquetados (id, record, aerolinea, ruta, fecha_ida, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo)
values (97001, 'F224A1', 'AEROTEST', 'BOG - CTG - BOG', current_date + 40, 424242.42, 500000, 12345, true);
SQL
DATOS_SQL="select md5(row(id, record, aerolinea, ruta, fecha_ida, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo)::text) from public.empaquetados where id = 97001"
DATOS_ANTES="$(uno "$DATOS_SQL")"
HUELLA_ANTES="$(uno "$HUELLA_SQL")"
[ -n "$HUELLA_ANTES" ] && [ -n "$DATOS_ANTES" ] || { echo "No se pudo tomar la huella inicial." >&2; exit 1; }

# ── F1 · preflight antes ──────────────────────────────────────────
correr "$AQUI/preflight_224_neto_empaquetados.sql" > "$TMP/pre.out" 2>&1 || { fallo "F1 el preflight falló: $(tail -3 "$TMP/pre.out")"; exit 1; }
grep -Eq '^P2\|INFO\|0\|' "$TMP/pre.out" && ok "F1.1 preflight: la 224 aún no está aplicada (P2 INFO, 0)" || fallo "F1.1 P2: $(grep '^P2' "$TMP/pre.out")"
grep -Eq '^P4\|INFO\|1\|' "$TMP/pre.out" && ok "F1.2 preflight cuenta la policy de lectura que nombra a venta (P4 INFO, 1)" || fallo "F1.2 P4: $(grep '^P4' "$TMP/pre.out")"
grep -Eq '^P5\|INFO\|1\|' "$TMP/pre.out" && ok "F1.3 preflight cuenta las filas existentes de empaquetados (P5 INFO, 1)" || fallo "F1.3 P5: $(grep '^P5' "$TMP/pre.out")"
! grep -q 'BLOQUEANTE' "$TMP/pre.out" && ok "F1.4 preflight no bloquea (ningún nivel BLOQUEANTE)" || fallo "F1.4 el preflight bloquea: $(grep BLOQUEANTE "$TMP/pre.out" | head -2)"

# ── F2 · aplicar ──────────────────────────────────────────────────
aplicar && ok "F2.1 la 224 se aplicó sobre datos existentes" || { fallo "F2.1 la 224 falló: $(cut -c1-400 "$TMP/m.out")"; exit 1; }
[ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F2.2 los datos de empaquetados quedaron intactos" || fallo "F2.2 los datos cambiaron"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_ANTES" ] && ok "F2.3 la 224 no cambió ninguna policy (huella md5 idéntica: es aditiva, venta conserva la lectura)" || fallo "F2.3 la 224 cambió policies"

# ── F3 · postcheck ────────────────────────────────────────────────
postcheck() { correr "$AQUI/postcheck_224_neto_empaquetados.sql" > "$TMP/post.out" 2>&1; }
postcheck && grep -Eq '^OK\|9\|0\|9\|ninguno\|' "$TMP/post.out" && ok "F3 postcheck: 9 de 9 controles en OK (una fila consolidada)" || fallo "F3 postcheck: $(head -3 "$TMP/post.out" | cut -c1-300)"

# ── F4 · batería SQL ──────────────────────────────────────────────
RC=0; correr "$AQUI/test_224_neto_empaquetados.sql" > "$TMP/sql.out" 2>&1 || RC=$?
cat "$TMP/sql.out"
if [ "$RC" = 0 ] && grep -q 'TEST 224 SQL: TODO OK' "$TMP/sql.out" && ! grep -q 'FALLO ' "$TMP/sql.out"; then ok "F4 batería SQL en verde"; else fallo "F4 batería SQL en rojo (rc=$RC)"; fi
[ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F4.1 la batería (ROLLBACK) no dejó rastro en los datos" || fallo "F4.1 la batería cambió los datos"

# ── F5 · idempotencia ─────────────────────────────────────────────
HUELLA_224="$(uno "$HUELLA_SQL")"
aplicar && ok "F5.1 la 224 se aplica por segunda vez sin error" || fallo "F5.1 segunda aplicación: $(cut -c1-400 "$TMP/m.out")"
postcheck && grep -Eq '^OK\|9\|0\|9\|ninguno\|' "$TMP/post.out" && ok "F5.2 postcheck sigue en OK" || fallo "F5.2 postcheck: $(head -3 "$TMP/post.out" | cut -c1-300)"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_224" ] && ok "F5.3 la segunda aplicación dejó las mismas policies" || fallo "F5.3 las policies cambiaron al reaplicar"

# ── F6 · rollback: estado exacto anterior ─────────────────────────
correr "$AQUI/rollback_224_neto_empaquetados.sql" > "$TMP/rb.out" 2>&1 && ok "F6.1 el rollback procedió" || fallo "F6.1 rollback: $(cut -c1-400 "$TMP/rb.out")"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_ANTES" ] && ok "F6.2 las policies de empaquetados/empaquetado_cambios/armado_empaquetados quedaron EXACTAMENTE como antes de la 224 (huella md5 idéntica)" || fallo "F6.2 las policies no coinciden con el estado anterior"
[ "$(uno "select (to_regclass('public.empaquetados_basica') is null)::int")" = 1 ] && ok "F6.3 la vista quedó retirada" || fallo "F6.3 la vista sigue existiendo"
[ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F6.4 los datos siguen intactos" || fallo "F6.4 los datos cambiaron"
correr "$AQUI/rollback_224_neto_empaquetados.sql" > "$TMP/rb2.out" 2>&1 && ok "F6.5 el rollback es idempotente" || fallo "F6.5 segundo rollback: $(cut -c1-300 "$TMP/rb2.out")"

# ── F7 · reaplicar ────────────────────────────────────────────────
aplicar && ok "F7.1 la 224 se reaplicó tras el rollback" || fallo "F7.1 reaplicación: $(cut -c1-400 "$TMP/m.out")"
postcheck && grep -Eq '^OK\|9\|0\|9\|ninguno\|' "$TMP/post.out" && ok "F7.2 postcheck en OK tras reaplicar" || fallo "F7.2 postcheck: $(head -3 "$TMP/post.out" | cut -c1-300)"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_224" ] && ok "F7.3 las policies tras reaplicar coinciden con las de la primera aplicación" || fallo "F7.3 las policies difieren tras reaplicar"

echo ""
if [ "$FALLOS" = 0 ]; then echo "TEST 224 FASES: TODO OK ($OKS comprobaciones)"; else echo "TEST 224 FASES: $FALLOS FALLO(S) de $((OKS + FALLOS))"; exit 1; fi
