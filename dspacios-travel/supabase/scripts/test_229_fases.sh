#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# FASES · 229 (publicar_tarifario_resultado set-based, #100) sobre una base DESECHABLE (CI o local); nunca remota.
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_229_fases.sh <contenedor> [plantilla]
#   plantilla = cadena 001-228 (la crea preparar_esquema_local.sh <contenedor> 228 <plantilla>)
#
#   F1   preflight ANTES de la 229: sin REVISAR (la 226 con bucle por fila, ACL, bypassrls, 0 triggers, 6 CHECK)
#   F2   la 229 se aplica sin tocar datos ni ACL (huella md5 de ACL/policies igual)
#   F3   postcheck consolidado: sin REVISAR
#   F4   equivalencia 226 vs 229 (test_229_publicar_equivalencia.sql): mismas respuestas, mismos errores, mismo snapshot
#   F5   se repiten test_181, test_226 y test_227 sobre la base con la 229
#   F6   el mismo payload de ≈ tamaño real da el MISMO snapshot (hash) con la 226 y la 229, y se mide el tiempo
#   F7   la 229 es idempotente
#   F8   el rollback deja el cuerpo, el comment y la ACL EXACTAMENTE como la 226 (md5 igual al de la base original); idempotente
#   F9   la 229 se vuelve a aplicar tras el rollback y el postcheck vuelve a estar limpio
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla228}"
export MSYS_NO_PATHCONV=1
valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_229_fases.sh <contenedor> [plantilla]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PW="${PGPASSWORD_229:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_229f $SUF"
DB="t229_fa_$SUF"
DB0="t229_or_$SUF"
PSA="docker exec -i -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_ADMIN -X -q -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0
OKS=0
ok()    { echo "OK    $1"; OKS=$((OKS + 1)); }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
limpiar() {
  st=$?
  if [ "${KEEP:-}" != 1 ]; then
    for d in "$DB" "$DB0"; do
      m="$($PSA -d postgres -t -A -c "select coalesce((select shobj_description(oid, 'pg_database') from pg_database where datname = '$d'), '<ausente>')" 2>/dev/null || true)"
      [ "$m" = "$MARCA" ] && $PSA -d postgres -c "drop database if exists $d with (force)" >/dev/null 2>&1 || true
    done
  fi
  rm -rf "$TMP"
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }

PREP_AUTH="create or replace function auth.uid() returns uuid language sql stable as \$\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$\$;
create or replace function auth.role() returns text language sql stable as \$\$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text \$\$;"
for d in "$DB0" "$DB"; do
  i=1
  until $PSA -d postgres -c "create database $d template $PLANTILLA" >/dev/null 2>"$TMP/cb.err"; do
    [ "$i" -lt 8 ] || { cat "$TMP/cb.err" >&2; exit 1; }
    i=$((i + 1)); sleep 2
  done
  $PSA -d postgres -c "comment on database $d is '$MARCA'" >/dev/null
  printf '%s\n' "$PREP_AUTH" | $PSA -d "$d" >/dev/null
done
MIG="$APP/supabase/migrations/20260601000229_publicar_tarifario_setbased.sql"
RB="$AQUI/rollback_229_publicar_tarifario_setbased.sql"
uno()     { $PSA -d "$DB" -t -A -c "$1"; }
uno0()    { $PSA -d "$DB0" -t -A -c "$1"; }
aplicar() { $PSA -d "$DB" < "$MIG" > "$TMP/m.out" 2>&1; }
verifica() { # corre un script consolidado (control|valor|esperado|estado) y cuenta REVISAR
  $PSA -d "$DB" -t -A -F '|' < "$1" > "$TMP/v.out" 2>&1 || { cat "$TMP/v.out" >&2; return 2; }
  grep -c '|REVISAR$' "$TMP/v.out" || true
}

# Huella de ACL + comment + cuerpo de las dos funciones (publicador y envoltorio 227) y de las policies de tarifario_resultado.
HUELLA="select md5(
  coalesce((select string_agg(p.proname || '/' || coalesce(p.proacl::text, '') || '/' || coalesce(obj_description(p.oid, 'pg_proc'), '') || '/' || md5(replace(p.prosrc, E'\\r', '')), '|' order by p.proname)
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'publicar_tarifario_resultado%'), '')
  || coalesce((select string_agg(policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by policyname) from pg_policies where tablename = 'tarifario_resultado'), ''))"
HUELLA_ACL="select md5(
  coalesce((select string_agg(p.proname || '/' || coalesce(p.proacl::text, ''), '|' order by p.proname)
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'publicar_tarifario_resultado%'), '')
  || coalesce((select string_agg(policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by policyname) from pg_policies where tablename = 'tarifario_resultado'), ''))"

# Referencia 226: el cuerpo EXACTO (copiado en el rollback) renombrado a _ref226_publicar. Solo en $DB.
awk '/^create or replace function public.publicar_tarifario_resultado\(/{f=1} f{print} f&&/^\$\$;/{exit}' "$RB" | sed '1s/publicar_tarifario_resultado/_ref226_publicar/' > "$TMP/ref226.sql"
[ -s "$TMP/ref226.sql" ] || { echo "No se pudo extraer el cuerpo de la 226 del rollback." >&2; exit 1; }

# ── F1 preflight ──
n="$(verifica "$AQUI/preflight_229_publicar_tarifario_setbased.sql")" || { fallo "F1 el preflight no corrió"; n=-1; }
if [ "$n" = 0 ]; then ok "F1 preflight sin REVISAR ($(grep -c '|OK$' "$TMP/v.out") OK, $(grep -c '|INFO$' "$TMP/v.out") INFO)"; else fallo "F1 preflight con $n REVISAR"; cat "$TMP/v.out"; fi
MD5_226="$(uno0 "select md5(replace(prosrc, E'\\r', '')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'publicar_tarifario_resultado'")"
HUELLA_226="$(uno0 "$HUELLA")"
ACL_226="$(uno0 "$HUELLA_ACL")"
$PSA -d "$DB" < "$TMP/ref226.sql"

# ── F2 aplicar ──
if aplicar; then ok "F2 la 229 se aplica"; else fallo "F2 la 229 falló: $(tail -3 "$TMP/m.out" | cut -c1-300)"; fi
[ "$(uno "$HUELLA_ACL")" = "$ACL_226" ] && ok "F2 ACL y policies idénticas a las de la 226" || fallo "F2 la 229 cambió una ACL o policy"
[ "$(uno "select md5(replace(prosrc, E'\\r', '')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'publicar_tarifario_resultado'")" != "$MD5_226" ] && ok "F2 el cuerpo cambió" || fallo "F2 el cuerpo sigue igual al de la 226"

# ── F3 postcheck ──
n="$(verifica "$AQUI/postcheck_229_publicar_tarifario_setbased.sql")" || { fallo "F3 el postcheck no corrió"; n=-1; }
if [ "$n" = 0 ]; then ok "F3 postcheck sin REVISAR ($(grep -c '|OK$' "$TMP/v.out") OK)"; else fallo "F3 postcheck con $n REVISAR"; cat "$TMP/v.out"; fi

# ── F4 equivalencia ──
$PSA -d "$DB" < "$AQUI/test_229_publicar_equivalencia.sql" > "$TMP/eq.out" 2>&1 || true
if grep -q 'TEST 229 EQUIVALENCIA: TODO OK' "$TMP/eq.out"; then ok "F4 $(grep 'TEST 229 EQUIVALENCIA' "$TMP/eq.out" | sed 's/.*EQUIVALENCIA: //')"; else fallo "F4 equivalencia"; grep -E 'FALLO|ERROR' "$TMP/eq.out" | head -10; fi

# ── F5 baterías 181, 226 y 227 ──
$PSA -d "$DB" -c "insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000229777', 'c181-oper@x.test') on conflict do nothing; insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000229777', 'c181-oper@x.test', 'C181 oper', 'operaciones', true, 'mayorista') on conflict (id) do update set rol = 'operaciones', activo = true" >/dev/null
for t in 181_tarifario_snapshots_atomicos 226_tarifa_infante 227_salida_vinculada; do
  docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_ADMIN" -d "$DB" -X -q -v ON_ERROR_STOP=0 < "$AQUI/test_$t.sql" > "$TMP/b$t.out" 2>&1 || true
  if grep -qE 'ERROR|FALLO' "$TMP/b$t.out"; then fallo "F5 test_$t"; grep -E 'ERROR|FALLO' "$TMP/b$t.out" | head -5
  elif grep -q 'AVISO: no hay ningún usuario' "$TMP/b$t.out"; then fallo "F5 test_$t omitió las pruebas con sesión real"
  elif grep -qE 'TODO OK|TODAS LAS PRUEBAS EJECUTADAS TERMINARON EN OK' "$TMP/b$t.out"; then ok "F5 test_$t: $(grep -E 'TODO OK|TODAS LAS PRUEBAS' "$TMP/b$t.out" | tail -1 | sed 's/.*NOTICE:  //' | cut -c1-90)"
  else fallo "F5 test_$t sin cierre reconocible"; tail -3 "$TMP/b$t.out"; fi
done

# ── F6 mismo payload de tamaño real: mismo snapshot y tiempos ──
timed() { # $1 función · $2 n  →  imprime "true|<ms>"
  out="$(printf '%s\n' "select set_config('request.jwt.claims','{\"sub\":\"00000000-0000-0000-0000-000000229004\",\"role\":\"authenticated\"}', false);" "set role authenticated;" "\\timing on" \
    "select public.$1(229301, s.g, s.r, 'COP', (select filas from public.t229_payload where n=$2))::text from (select tarifario_generacion g, tarifario_revision_fuente r from public.armado_paquetes where id=229301) s;" \
    | docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_ADMIN" -d "$DB" -X -t -A -v ON_ERROR_STOP=1 2>&1)"
  printf '%s|%s' "$(printf '%s' "$out" | grep -E '^(true|false)' | head -1)" "$(printf '%s' "$out" | sed -n 's/^Time: \([0-9.]*\) ms.*/\1/p' | head -1)"
}
hash() { uno "select count(*) || '|' || md5(string_agg((to_jsonb(t) - 'id' - 'created_at')::text, '|' order by t.id)) from tarifario_resultado t where paquete_id = 229301"; }
for N in 5062 12000; do
  $PSA -d "$DB" -v n=$N -f - < "$AQUI/test_229_tiempo_fixtures.sql" > "$TMP/fx.out" 2>&1 || { fallo "F6 fixtures n=$N"; tail -3 "$TMP/fx.out"; continue; }
  timed _ref226_publicar $N >/dev/null            # calienta y deja un snapshot previo del mismo tamaño
  TR=""; TN=""
  for i in 1 2 3; do
    r="$(timed _ref226_publicar $N)"; H_REF="$(hash)"; TR="$TR ${r#*|}"
    w="$(timed publicar_tarifario_resultado $N)"; H_NEW="$(hash)"; TN="$TN ${w#*|}"
    [ "${r%%|*}" = true ] && [ "${w%%|*}" = true ] && [ "$H_REF" = "$H_NEW" ] || { fallo "F6 n=$N corrida $i: res ref=${r%%|*} 229=${w%%|*} hash ref=$H_REF 229=$H_NEW"; }
  done
  MAXN="$(printf '%s\n' $TN | sort -n | tail -1)"
  echo "      n=$N · 226 (ms):$TR · 229 (ms):$TN"
  if [ "$(printf '%s' "$MAXN" | awk '{print ($1 < 3000)}')" = 1 ]; then ok "F6 n=$N: mismo snapshot (hash) con la 226 y la 229 en 3 corridas; la 229 tarda como máximo ${MAXN} ms (< 3000)"; else fallo "F6 n=$N: la 229 tardó ${MAXN} ms (meta < 3000)"; fi
done

# ── F7 idempotente ──
if aplicar; then ok "F7 la 229 se aplica una segunda vez"; else fallo "F7 segunda aplicación: $(tail -3 "$TMP/m.out" | cut -c1-300)"; fi
n="$(verifica "$AQUI/postcheck_229_publicar_tarifario_setbased.sql")" || n=-1
[ "$n" = 0 ] && ok "F7 postcheck sin REVISAR tras la segunda aplicación" || fallo "F7 postcheck con $n REVISAR"

# ── F8 rollback ──
$PSA -d "$DB" < "$RB" > "$TMP/rb.out" 2>&1 && ok "F8 el rollback corre" || { fallo "F8 el rollback falló: $(tail -3 "$TMP/rb.out" | cut -c1-300)"; }
[ "$(uno "select md5(replace(prosrc, E'\\r', '')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'publicar_tarifario_resultado'")" = "$MD5_226" ] \
  && ok "F8 el cuerpo restaurado es IDÉNTICO (md5) al de la 226 de la base original" || fallo "F8 el cuerpo restaurado difiere de la 226"
[ "$(uno "$HUELLA")" = "$HUELLA_226" ] && ok "F8 cuerpo, comment, ACL y policies = huella de la base original (226)" || fallo "F8 la huella difiere de la de la 226"
$PSA -d "$DB" < "$RB" > "$TMP/rb2.out" 2>&1 && ok "F8 el rollback es idempotente" || fallo "F8 segundo rollback falló"
[ "$(uno "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'publicar_tarifario_resultado%'")" = 2 ] && ok "F8 siguen existiendo exactamente 2 funciones de publicación (vigente + envoltorio 227)" || fallo "F8 cambió el número de funciones"
n="$(verifica "$AQUI/postcheck_229_publicar_tarifario_setbased.sql")" || n=-1
[ "$n" = 2 ] && ok "F8 el postcheck detecta la versión 226 (2 controles REVISAR: C5 y C6)" || fallo "F8 el postcheck dio $n REVISAR (esperado 2)"

# ── F9 reaplicar ──
if aplicar; then ok "F9 la 229 se re-aplica tras el rollback"; else fallo "F9 re-aplicación: $(tail -3 "$TMP/m.out" | cut -c1-300)"; fi
n="$(verifica "$AQUI/postcheck_229_publicar_tarifario_setbased.sql")" || n=-1
[ "$n" = 0 ] && ok "F9 postcheck sin REVISAR" || fallo "F9 postcheck con $n REVISAR"

echo "──────────────"
echo "FASES 229: $OKS OK, $FALLOS FALLO"
[ "$FALLOS" = 0 ] || exit 1
