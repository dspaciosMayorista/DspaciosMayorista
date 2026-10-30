#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# FASES · hotfix 225 (CIERRE: venta pierde la tabla base de empaquetados) sobre una base DESECHABLE; nunca remota.
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_225_fases.sh <contenedor> [plantilla]
#   plantilla = cadena 001-223. El script aplica la 224 (estado "224 + código desplegado") y luego prueba la 225.
#
#   F0   la 225 se NIEGA sobre una base sin la vista de la 224 (en una base aparte) y no cambia nada
#   F1   preflight ANTES de la 225: la vista existe (P1 INFO, 1); la policy nombra a venta (P4 REVISAR, 1); recuerda
#        validar el código (P7 REVISAR); no bloquea
#   F2   la 225 se aplica sobre datos existentes sin tocarlos; SÍ cambia las policies (huella md5 distinta de la 224)
#   F3   postcheck consolidado en OK (9 de 9 controles)
#   F4   batería SQL (test_225_neto_empaquetados.sql): todo OK (venta = 0 filas en la tabla base, SÍ alcanza la vista)
#   F5   la 225 es idempotente
#   F6   la 224 NO se puede retirar mientras la 225 siga aplicada; el rollback de la 225 deja las policies EXACTAMENTE
#        como las dejó la 224 (huella md5 idéntica), conserva la vista y los datos
#   F7   la 225 se reaplica tras su rollback
#   F8   el desmontaje completo (rollback 225 y luego rollback 224) deja las policies EXACTAMENTE como antes de la 224
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla225}"
export MSYS_NO_PATHCONV=1
valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_225_fases.sh <contenedor> [plantilla]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PW="${PGPASSWORD_225:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_225f $SUF"
DB="t225_fa_$SUF"
DB0="t225_f0_$SUF"
PSA="docker exec -i -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_ADMIN -X -q -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0
OKS=0
ok()    { echo "OK    $1"; OKS=$((OKS + 1)); }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
limpiar() {
  st=$?
  if [ "${KEEP:-}" != 1 ]; then
    for base in "$DB" "$DB0"; do
      m="$($PSA -d postgres -t -A -c "select coalesce((select shobj_description(oid, 'pg_database') from pg_database where datname = '$base'), '<ausente>')" 2>/dev/null || true)"
      [ "$m" = "$MARCA" ] && $PSA -d postgres -c "drop database if exists $base with (force)" >/dev/null 2>&1 || true
    done
  fi
  rm -rf "$TMP"
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
crear_base() { # $1 nombre
  i=1
  until $PSA -d postgres -c "create database $1 template $PLANTILLA" >/dev/null 2>"$TMP/cb.err"; do
    [ "$i" -lt 8 ] || { cat "$TMP/cb.err" >&2; exit 1; }
    i=$((i + 1)); sleep 2
  done
  $PSA -d postgres -c "comment on database $1 is '$MARCA'" >/dev/null
  $PSA -d "$1" > "$TMP/env.out" 2>&1 <<'SQL' || { echo "No se pudo preparar auth.uid()/auth.role() en $1: $(tail -3 "$TMP/env.out" | cut -c1-300)" >&2; exit 1; }
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
SQL
}
M224="$APP/supabase/migrations/20260601000224_neto_empaquetados_por_rol.sql"
M225="$APP/supabase/migrations/20260601000225_neto_empaquetados_cierre.sql"
en() { # $1 base, $2 archivo SQL -> aplica el archivo; salida en $TMP/m.out
  docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$1" -X -q -v ON_ERROR_STOP=1 < "$2" > "$TMP/m.out" 2>&1
}
aplicar225() { en "$DB" "$M225"; }
correr() { docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 < "$1"; }
uno() { $PSA -d "$DB" -t -A -c "$1"; }
HUELLA_SQL="select md5(coalesce(string_agg(tablename || '/' || policyname || '/' || cmd || '/' || permissive || '/' || array_to_string(roles, ',') || '/' || coalesce(qual, '') || '/' || coalesce(with_check, ''), '|' order by tablename, policyname), ''))
            from pg_policies where schemaname = 'public' and tablename in ('empaquetados', 'empaquetado_cambios', 'armado_empaquetados')"

# ── F0 · la 225 se niega sin la vista de la 224 ───────────────────
crear_base "$DB0"
H0="$($PSA -d "$DB0" -t -A -c "$HUELLA_SQL")"
if en "$DB0" "$M225"; then fallo "F0.1 la 225 se aplicó SIN la vista de la 224"; else
  grep -q 'falta la vista public.empaquetados_basica' "$TMP/m.out" && ok "F0.1 la 225 se niega sin la vista de la 224 (mensaje claro)" || fallo "F0.1 mensaje inesperado: $(cut -c1-300 "$TMP/m.out")"
fi
[ "$($PSA -d "$DB0" -t -A -c "$HUELLA_SQL")" = "$H0" ] && ok "F0.2 el rechazo no cambió ninguna policy" || fallo "F0.2 el rechazo cambió policies"

# ── Preparación: estado "224 aplicada" con datos existentes ───────
crear_base "$DB"
$PSA -d "$DB" >"$TMP/fx.out" 2>&1 <<'SQL' || { echo "Fixtures: $(tail -5 "$TMP/fx.out")"; exit 1; }
insert into public.empaquetados (id, record, aerolinea, ruta, fecha_ida, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo)
values (97001, 'F225A1', 'AEROTEST', 'BOG - CTG - BOG', current_date + 40, 424242.42, 500000, 12345, true);
SQL
DATOS_SQL="select md5(row(id, record, aerolinea, ruta, fecha_ida, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo)::text) from public.empaquetados where id = 97001"
DATOS_ANTES="$(uno "$DATOS_SQL")"
HUELLA_223="$(uno "$HUELLA_SQL")"
en "$DB" "$M224" || { fallo "F0.3 no se pudo aplicar la 224 de preparación: $(cut -c1-400 "$TMP/m.out")"; exit 1; }
HUELLA_224="$(uno "$HUELLA_SQL")"
[ "$HUELLA_224" = "$HUELLA_223" ] && ok "F0.3 la 224 de preparación no cambió policies (aditiva)" || fallo "F0.3 la 224 cambió policies"

# ── F1 · preflight antes ──────────────────────────────────────────
correr "$AQUI/preflight_225_neto_empaquetados_cierre.sql" > "$TMP/pre.out" 2>&1 || { fallo "F1 el preflight falló: $(tail -3 "$TMP/pre.out")"; exit 1; }
grep -Eq '^P1\|INFO\|1\|' "$TMP/pre.out" && ok "F1.1 preflight: la vista de la 224 existe (P1 INFO, 1)" || fallo "F1.1 P1: $(grep '^P1' "$TMP/pre.out")"
grep -Eq '^P2\|INFO\|0\|' "$TMP/pre.out" && ok "F1.2 preflight: la 225 aún no está aplicada (P2 INFO, 0)" || fallo "F1.2 P2: $(grep '^P2' "$TMP/pre.out")"
grep -Eq '^P4\|REVISAR\|1\|' "$TMP/pre.out" && ok "F1.3 preflight cuenta la policy que aún nombra a venta (P4 REVISAR, 1)" || fallo "F1.3 P4: $(grep '^P4' "$TMP/pre.out")"
grep -Eq '^P7\|REVISAR\|1\|' "$TMP/pre.out" && ok "F1.4 preflight recuerda validar el código desplegado (P7 REVISAR)" || fallo "F1.4 P7: $(grep '^P7' "$TMP/pre.out")"
! grep -q 'BLOQUEANTE' "$TMP/pre.out" && ok "F1.5 preflight no bloquea" || fallo "F1.5 el preflight bloquea"

# ── F2 · aplicar ──────────────────────────────────────────────────
aplicar225 && ok "F2.1 la 225 se aplicó sobre datos existentes" || { fallo "F2.1 la 225 falló: $(cut -c1-400 "$TMP/m.out")"; exit 1; }
[ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F2.2 los datos de empaquetados quedaron intactos" || fallo "F2.2 los datos cambiaron"
HUELLA_225="$(uno "$HUELLA_SQL")"
[ "$HUELLA_225" != "$HUELLA_224" ] && ok "F2.3 la 225 SÍ cambió las policies (cierra la lectura de venta)" || fallo "F2.3 la 225 no cambió ninguna policy"

# ── F3 · postcheck ────────────────────────────────────────────────
postcheck() { correr "$AQUI/postcheck_225_neto_empaquetados_cierre.sql" > "$TMP/post.out" 2>&1; }
postcheck && grep -Eq '^OK\|9\|0\|9\|ninguno\|' "$TMP/post.out" && ok "F3 postcheck: 9 de 9 controles en OK (una fila consolidada)" || fallo "F3 postcheck: $(head -3 "$TMP/post.out" | cut -c1-300)"

# ── F4 · batería SQL ──────────────────────────────────────────────
RC=0; correr "$AQUI/test_225_neto_empaquetados.sql" > "$TMP/sql.out" 2>&1 || RC=$?
cat "$TMP/sql.out"
if [ "$RC" = 0 ] && grep -q 'TEST 225 SQL: TODO OK' "$TMP/sql.out" && ! grep -q 'FALLO ' "$TMP/sql.out"; then ok "F4 batería SQL en verde"; else fallo "F4 batería SQL en rojo (rc=$RC)"; fi
[ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F4.1 la batería (ROLLBACK) no dejó rastro en los datos" || fallo "F4.1 la batería cambió los datos"

# ── F5 · idempotencia ─────────────────────────────────────────────
aplicar225 && ok "F5.1 la 225 se aplica por segunda vez sin error" || fallo "F5.1 segunda aplicación: $(cut -c1-400 "$TMP/m.out")"
postcheck && grep -Eq '^OK\|9\|0\|9\|ninguno\|' "$TMP/post.out" && ok "F5.2 postcheck sigue en OK" || fallo "F5.2 postcheck: $(head -3 "$TMP/post.out" | cut -c1-300)"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_225" ] && ok "F5.3 la segunda aplicación dejó las mismas policies" || fallo "F5.3 las policies cambiaron al reaplicar"

# ── F6 · rollbacks por separado ───────────────────────────────────
if correr "$AQUI/rollback_224_neto_empaquetados.sql" > "$TMP/rb0.out" 2>&1; then fallo "F6.1 el rollback de la 224 procedió con la 225 aplicada"; else
  grep -q 'ROLLBACK 224 ABORTADO' "$TMP/rb0.out" && ok "F6.1 el rollback de la 224 se niega mientras la 225 siga aplicada" || fallo "F6.1 mensaje inesperado: $(cut -c1-300 "$TMP/rb0.out")"
fi
[ "$(uno "select (to_regclass('public.empaquetados_basica') is not null)::int")" = 1 ] && [ "$(uno "$HUELLA_SQL")" = "$HUELLA_225" ] && ok "F6.2 el rechazo no tocó la vista ni las policies" || fallo "F6.2 el rechazo cambió algo"
correr "$AQUI/rollback_225_neto_empaquetados_cierre.sql" > "$TMP/rb.out" 2>&1 && ok "F6.3 el rollback de la 225 procedió" || fallo "F6.3 rollback 225: $(cut -c1-400 "$TMP/rb.out")"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_224" ] && ok "F6.4 las policies volvieron EXACTAMENTE a como las dejó la 224 (huella md5 idéntica)" || fallo "F6.4 las policies no coinciden con el estado de la 224"
[ "$(uno "select (to_regclass('public.empaquetados_basica') is not null)::int")" = 1 ] && ok "F6.5 la vista de la 224 sigue en pie" || fallo "F6.5 el rollback de la 225 retiró la vista"
[ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F6.6 los datos siguen intactos" || fallo "F6.6 los datos cambiaron"
correr "$AQUI/rollback_225_neto_empaquetados_cierre.sql" > "$TMP/rb2.out" 2>&1 && ok "F6.7 el rollback de la 225 es idempotente" || fallo "F6.7 segundo rollback: $(cut -c1-300 "$TMP/rb2.out")"

# ── F7 · reaplicar ────────────────────────────────────────────────
aplicar225 && ok "F7.1 la 225 se reaplicó tras su rollback" || fallo "F7.1 reaplicación: $(cut -c1-400 "$TMP/m.out")"
postcheck && grep -Eq '^OK\|9\|0\|9\|ninguno\|' "$TMP/post.out" && ok "F7.2 postcheck en OK tras reaplicar" || fallo "F7.2 postcheck: $(head -3 "$TMP/post.out" | cut -c1-300)"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_225" ] && ok "F7.3 las policies tras reaplicar coinciden con las de la primera aplicación" || fallo "F7.3 las policies difieren tras reaplicar"

# ── F8 · desmontaje completo ──────────────────────────────────────
correr "$AQUI/rollback_225_neto_empaquetados_cierre.sql" > "$TMP/rb3.out" 2>&1 && correr "$AQUI/rollback_224_neto_empaquetados.sql" > "$TMP/rb4.out" 2>&1 \
  && ok "F8.1 rollback de la 225 y luego de la 224" || fallo "F8.1 desmontaje: $(cut -c1-300 "$TMP/rb3.out") $(cut -c1-300 "$TMP/rb4.out")"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_223" ] && ok "F8.2 las policies quedaron EXACTAMENTE como antes de la 224 (huella md5 idéntica)" || fallo "F8.2 las policies no coinciden con el estado inicial"
[ "$(uno "select (to_regclass('public.empaquetados_basica') is null)::int")" = 1 ] && [ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F8.3 sin vista y con los datos intactos" || fallo "F8.3 restos tras el desmontaje"

echo ""
if [ "$FALLOS" = 0 ]; then echo "TEST 225 FASES: TODO OK ($OKS comprobaciones)"; else echo "TEST 225 FASES: $FALLOS FALLO(S) de $((OKS + FALLOS))"; exit 1; fi
