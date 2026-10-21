#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# PRUEBA · migraciones 222 y 223 (#50, hija manual con precio NETO) — runner de integración sobre las
# migraciones REALES: ciclo preflight/postcheck, batería SQL, regresión de #39 y #35 con la 222 presente,
# cierre 223, rollback exacto y rollback que se niega con hijas selladas. Bases y contenedores
# DESECHABLES (GitHub Actions); nunca una base remota.
#
# Reproducción (desde dspacios-travel/), como lo hace .github/workflows/test-222-223-neto-50.yml:
#   docker network create red222
#   docker run -d --name pg222 --network red222 -e POSTGRES_PASSWORD=postgres supabase/postgres:15.8.1.085
#   sh supabase/scripts/preparar_esquema_local.sh pg222 221 plantilla222   # cadena real hasta la 221 (sin 218/220 si no existen)
#   sh supabase/scripts/test_222_neto_hija.sh pg222 plantilla222
#
#   M   preflight → 222 (la segunda vez se niega y no cambia nada) → postcheck 16/16 → preflight «ya aplicada»
#   S   test_222_neto_hija.sql  (margen, reparto, nacimiento, pago, conversión, identidad, DTM, frontera, ACL, legadas)
#   G   regresión: la batería SQL de #39 (test_216_edicion39.sql) y la de #35 (test_211_*.sql) con la 222 presente
#   B   223 → postcheck 5/5 → test_223_neto_hija_cierre.sql (modalidad obligatoria)
#   RB  rollback_222 se niega con la 223 aplicada; rollback_223; rollback_222 deja la base IDÉNTICA
#       (huella de políticas, funciones, tablas/ACL, disparadores y columnas); la 222 se reaplica
#   RB2 con una hija sellada COMMITEADA, rollback_222 se niega y no cambia nada
#
# Rol que aplica: ROL_MIGRA (por defecto supabase_admin; en Supabase alojado es `postgres`).
# Límite: no se prueba PostgREST por HTTP; los permisos se prueban con `set role` y JWT en SQL
# (patrón de test_216_edicion39.sql). Las carreras y la API HTTP de 216/217 siguen en su propio workflow.
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla222}"
export MSYS_NO_PATHCONV=1

valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_222_neto_hija.sh <contenedor> [plantilla]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
M222="$APP/supabase/migrations/20260601000222_neto_hija_manual.sql"
M223="$APP/supabase/migrations/20260601000223_neto_hija_manual_cierre.sql"
VECTORES="$APP/pruebas/netoHija50.vectores.json"
PW="${PGPASSWORD_222:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
valido "$ROL_ADMIN" '^[a-z_][a-z0-9_]{0,62}$' && valido "$ROL_MIGRA" '^[a-z_][a-z0-9_]{0,62}$' || { echo "Roles inválidos." >&2; exit 2; }
DIR_CT=/tmp/s222
PSA="docker exec -i -w $DIR_CT -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_ADMIN -X -q -v ON_ERROR_STOP=1"
PSM="docker exec -i -w $DIR_CT -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_MIGRA -X -q -v ON_ERROR_STOP=1"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_222 $SUF"
DBA="t222_a_$SUF"
DBB="t222_b_$SUF"
TMP="$(mktemp -d)"
FALLOS=0
OKS=0
BASES=""
ok()    { echo "OK    $1"; OKS=$((OKS + 1)); }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

limpiar() {
  st=$?
  if [ "${KEEP:-}" != 1 ]; then
    for b in $BASES; do
      hecho=0
      for intento in 1 2 3 4 5; do
        m="$($PSA -d postgres -t -A -c "select coalesce((select shobj_description(oid, 'pg_database') from pg_database where datname = '$b'), '<ausente>')" 2>/dev/null || true)"
        if [ "$m" = '<ausente>' ]; then hecho=1; break; fi
        if [ "$m" = "$MARCA" ]; then
          if $PSA -d postgres -c "drop database if exists $b with (force)" >/dev/null 2>&1; then hecho=1; break; fi
        elif [ -n "$m" ]; then
          echo "AVISO: $b no lleva la marca de esta corrida; no se toca." >&2; hecho=1; break
        fi
        sleep 2
      done
      [ "$hecho" = 1 ] || echo "AVISO: no se pudo borrar $b (lleva la marca '$MARCA'; bórrala a mano)." >&2
    done
  fi
  rm -rf "$TMP"
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
# Los scripts van al contenedor por stdin (sin rutas de Windows) para que `\ir` funcione.
docker exec "$CT" sh -c "rm -rf $DIR_CT && mkdir -p $DIR_CT"
for f in test_216_fixtures.sql test_216_edicion39.sql test_211_fixtures.sql test_211_cotizaciones_comparativas.sql \
         test_222_fixtures.sql test_222_neto_hija.sql test_222_sellada_persistente.sql test_223_neto_hija_cierre.sql \
         preflight_222_neto_hija_manual.sql postcheck_222_neto_hija_manual.sql preflight_223_neto_hija_manual_cierre.sql postcheck_223_neto_hija_manual_cierre.sql \
         rollback_222_neto_hija_manual.sql rollback_223_neto_hija_manual_cierre.sql; do
  docker exec -i "$CT" sh -c "cat > $DIR_CT/$f" < "$AQUI/$f"
done
docker exec -i "$CT" sh -c "cat > $DIR_CT/222.sql" < "$M222"
docker exec -i "$CT" sh -c "cat > $DIR_CT/223.sql" < "$M223"
docker exec -i "$CT" sh -c 'cat > /tmp/netoHija50.vectores.json' < "$VECTORES"
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PSA -d "$PLANTILLA" -t -A -c "select (to_regclass('public.cotizacion_participantes') is not null and to_regnamespace('p39_priv') is not null and to_regnamespace('p50_priv') is null and to_regclass('public.cotizacion_neto') is null)::int")" = 1 ] \
  || { echo "La plantilla debe tener la 216/217/219 y NO la 222." >&2; exit 2; }
[ "$($PSA -d "$PLANTILLA" -t -A -c "select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'D' and tgname = 'trg_cot_frontera_39'")" = 1 ] \
  || { echo "La plantilla debe tener la frontera de la 217 ACTIVA." >&2; exit 2; }

crear_base() { # $1 = nombre ; deja la base marcada para borrarla al final
  cb_i=1
  until $PSA -d postgres -c "create database $1 template $PLANTILLA" >/dev/null 2>"$TMP/cb.err"; do
    [ "$cb_i" -lt 8 ] || { cat "$TMP/cb.err" >&2; return 1; }
    cb_i=$((cb_i + 1)); sleep 2
  done
  BASES="$BASES $1"
  $PSA -d postgres -c "comment on database $1 is '$MARCA'" >/dev/null
  # Entorno: auth.uid() de Supabase alojado (lee request.jwt.claim.sub y request.jwt.claims).
  $PSA -d "$1" > /dev/null <<'SQL'
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
uno() { $PSA -d "$1" -t -A -c "$2"; }
# Aplica un archivo SQL (con su propio begin/commit) como ROL_MIGRA; deja la salida en $TMP/ap.out.
aplicar() { $PSM -d "$1" -f "$DIR_CT/$2" > "$TMP/ap.out" 2>&1; }
# Corre un script de pruebas por stdin (usa \ir relativo a $DIR_CT) como ROL_MIGRA; salida en $TMP/$3.
correr() { $PSM -d "$1" < "$AQUI/$2" > "$TMP/$3" 2>&1; }
# Fila consolidada de un preflight/postcheck: campos separados por «|».
fila() { $PSM -d "$1" -t -A -F '|' -f "$DIR_CT/$2" 2>&1 || true; }

# Huella de TODO lo que la 222 no debe dejar distinto tras un rollback (una línea por familia).
huella() { # $1 = base
  $PSA -d "$1" -t -A <<'SQL'
select 'policies=' || md5(coalesce(string_agg(format('%s.%s.%s|%s|%s|%s|%s', schemaname, tablename, policyname, cmd, roles, qual, with_check),
                                              E'\n' order by schemaname, tablename, policyname), '')) || ' n=' || count(*)
  from pg_policies;
select 'funciones=' || md5(coalesce(string_agg(p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid)) || '|'
                                               || coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner),
                                               E'\n' order by p.oid::regprocedure::text), '')) || ' n=' || count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.prokind in ('f', 'p') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_';
select 'tablas=' || md5(coalesce(string_agg(c.oid::regclass::text || '|' || c.relkind::text || '|' || coalesce(c.relacl::text, '') || '|'
                                            || c.relrowsecurity::text || '|' || pg_get_userbyid(c.relowner),
                                            E'\n' order by c.oid::regclass::text), '')) || ' n=' || count(*)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p', 'v', 'm', 'S') and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and n.nspname !~ '^pg_';
select 'disparadores=' || md5(coalesce(string_agg(t.tgrelid::regclass::text || '|' || t.tgname || '|' || t.tgenabled::text || '|' || t.tgfoid::regprocedure::text,
                                                  E'\n' order by t.tgrelid::regclass::text, t.tgname), '')) || ' n=' || count(*)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where not t.tgisinternal and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_';
select 'columnas=' || md5(string_agg(a.attrelid::regclass::text || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod),
                                     ',' order by a.attrelid::regclass::text, a.attnum))
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
 where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p') and n.nspname in ('public', 'auth');
select 'esquemas=' || string_agg(nspname, ',' order by nspname) from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema';
SQL
}

echo "=== Fase M · preflight, 222, postcheck ==="
crear_base "$DBA"
f="$(fila "$DBA" preflight_222_neto_hija_manual.sql)"
echo "$f" | cut -c1-300
case "$f" in INFO\|0\|*\|12\|*) ok "M1 preflight sobre la cadena real: INFO, 0 bloqueantes, 12 chequeos" ;; *) fallo "M1 preflight inesperado: $f" ;; esac
case "$f" in *P6=INFO/0*) ok "M2 preflight: la 222 aún no está aplicada" ;; *) fallo "M2 preflight P6: $f" ;; esac
H0="$(huella "$DBA")"
if aplicar "$DBA" 222.sql; then ok "M3 la 222 se aplica"; else fallo "M3 la 222 falló: $(tail -5 "$TMP/ap.out")"; cat "$TMP/ap.out" >&2; fi
H1="$(huella "$DBA")"
if aplicar "$DBA" 222.sql; then fallo "M4 la 222 se dejó aplicar dos veces"; else
  if grep -q 'ya hay objetos de #50' "$TMP/ap.out"; then ok "M4 la segunda aplicación se niega"; else fallo "M4 mensaje inesperado: $(tail -3 "$TMP/ap.out")"; fi
fi
[ "$(huella "$DBA")" = "$H1" ] && ok "M5 la aplicación rechazada no cambió nada" || fallo "M5 la segunda aplicación cambió la base"
f="$(fila "$DBA" postcheck_222_neto_hija_manual.sql)"
echo "$f" | cut -c1-300
case "$f" in OK\|16\|0\|16\|*) ok "M6 postcheck 222: 16/16" ;; *) fallo "M6 postcheck 222: $f" ;; esac
f="$(fila "$DBA" preflight_222_neto_hija_manual.sql)"
case "$f" in *P6=REVISAR/4*) ok "M7 preflight tras la 222: «ya aplicada» (REVISAR)" ;; *) fallo "M7 preflight posterior: $f" ;; esac

echo "=== Fase S · batería SQL de #50 ==="
if correr "$DBA" test_222_neto_hija.sql s222.out; then rc=0; else rc=$?; fi
cat "$TMP/s222.out"
if [ "$rc" = 0 ] && grep -q 'TEST 222 SQL: TODO OK' "$TMP/s222.out" && ! grep -q 'FALLO ' "$TMP/s222.out"; then ok "S batería 222 completa"; else fallo "S batería 222 en rojo (rc=$rc)"; fi

echo "=== Fase G · regresión de #39 y #35 con la 222 presente ==="
if correr "$DBA" test_216_edicion39.sql g216.out; then rc=0; else rc=$?; fi
tail -25 "$TMP/g216.out"
if [ "$rc" = 0 ] && grep -q 'TEST 216 SQL: TODO OK' "$TMP/g216.out" && ! grep -q 'FALLO ' "$TMP/g216.out"; then ok "G1 batería #39 (216/217) completa con la 222 presente"; else fallo "G1 batería #39 en rojo (rc=$rc)"; fi
# Con la 217 activa el bloque 12 de la batería #35 prueba la creación por la RPC autorizada y el rechazo de las
# escrituras económicas directas (no el INSERT directo de antes): se EXIGE ese contexto para que una frontera
# apagada por error no pase por el camino viejo.
if $PSM -v esperar_frontera=activa -d "$DBA" < "$AQUI/test_211_cotizaciones_comparativas.sql" > "$TMP/g211.out" 2>&1; then rc=0; else rc=$?; fi
tail -25 "$TMP/g211.out"
# Además de rc y FALLO: el bloque 12 corrió en el contexto esperado (no se salta en silencio) y sus puertas se probaron.
g2faltan=""
for marca in 'OK    12.0 contexto de la regresión: frontera 216/217 ACTIVA' 'OK    12.1 un interno crea una cotización simple por la operación autorizada'              'OK    12.1c ' 'OK    12.2b ' 'OK    12.3 ' 'OK    12.4 ' 'OK    12.4b ' 'OK    12.5 '; do
  grep -qF -- "$marca" "$TMP/g211.out" || g2faltan="$g2faltan [$marca]"
done
if [ "$rc" = 0 ] && ! grep -q 'FALLO ' "$TMP/g211.out" && ! grep -qi '^psql:.*ERROR' "$TMP/g211.out" && [ -z "$g2faltan" ]; then ok "G2 batería #35 (211) con la 222 presente (bloque 12 con la frontera activa)"; else fallo "G2 batería #35 en rojo (rc=$rc; faltan:${g2faltan:- ninguna})"; fi

echo "=== Fase B · 223 y modalidad obligatoria ==="
f="$(fila "$DBA" preflight_223_neto_hija_manual_cierre.sql)"
echo "$f" | cut -c1-300
case "$f" in INFO\|0\|0\|3\|Q1=INFO/1\;Q2=INFO/0\;Q3=INFO/*) ok "B0 preflight 223 con la 222 aplicada: INFO, 0 bloqueantes, 3 chequeos (Q3 cuenta madres B2B sin aliado)" ;; *) fallo "B0 preflight 223 inesperado: $f" ;; esac
if aplicar "$DBA" 223.sql; then ok "B1 la 223 se aplica"; else fallo "B1 la 223 falló: $(tail -5 "$TMP/ap.out")"; fi
if aplicar "$DBA" 223.sql; then fallo "B2 la 223 se dejó aplicar dos veces"; else grep -q 'ya es obligatoria' "$TMP/ap.out" && ok "B2 la segunda aplicación de la 223 se niega" || fallo "B2 mensaje: $(tail -3 "$TMP/ap.out")"; fi
f="$(fila "$DBA" preflight_223_neto_hija_manual_cierre.sql)"
case "$f" in BLOQUEANTE\|1\|*Q2=BLOQUEANTE/1*) ok "B2b preflight 223 con la 223 ya aplicada: BLOQUEANTE (no repetir)" ;; *) fallo "B2b preflight 223 tras la 223: $f" ;; esac
f="$(fila "$DBA" postcheck_223_neto_hija_manual_cierre.sql)"
echo "$f" | cut -c1-300
case "$f" in OK\|5\|0\|5\|*) ok "B3 postcheck 223: 5/5" ;; *) fallo "B3 postcheck 223: $f" ;; esac
f="$(fila "$DBA" postcheck_222_neto_hija_manual.sql)"
case "$f" in OK\|16\|0\|16\|*) ok "B4 postcheck 222 sigue en verde con la 223" ;; *) fallo "B4 postcheck 222 con la 223: $f" ;; esac
if correr "$DBA" test_223_neto_hija_cierre.sql b223.out; then rc=0; else rc=$?; fi
cat "$TMP/b223.out"
if [ "$rc" = 0 ] && grep -q 'TEST 223 SQL: TODO OK' "$TMP/b223.out" && ! grep -q 'FALLO ' "$TMP/b223.out"; then ok "B5 batería 223 completa"; else fallo "B5 batería 223 en rojo (rc=$rc)"; fi

echo "=== Fase RB · rollback ==="
H2="$(huella "$DBA")"
if $PSM -d "$DBA" -f "$DIR_CT/rollback_222_neto_hija_manual.sql" > "$TMP/rb.out" 2>&1; then fallo "RB1 el rollback de la 222 corrió con la 223 aplicada"; else
  grep -q 'la 223 sigue aplicada' "$TMP/rb.out" && ok "RB1 rollback_222 se niega con la 223 aplicada" || fallo "RB1 mensaje: $(tail -3 "$TMP/rb.out")"; fi
[ "$(huella "$DBA")" = "$H2" ] && ok "RB1b y no cambió nada" || fallo "RB1b el rollback rechazado cambió la base"
if $PSM -d "$DBA" -f "$DIR_CT/rollback_223_neto_hija_manual_cierre.sql" > "$TMP/rb.out" 2>&1; then ok "RB2 rollback_223"; else fallo "RB2 rollback_223: $(tail -3 "$TMP/rb.out")"; fi
[ "$(uno "$DBA" 'select p50_priv.exigir_modalidad()::text')" = false ] && ok "RB2b la modalidad vuelve a ser opcional" || fallo "RB2b el interruptor no se apagó"
if $PSM -d "$DBA" -f "$DIR_CT/rollback_223_neto_hija_manual_cierre.sql" > "$TMP/rb.out" 2>&1; then fallo "RB2c rollback_223 corrió dos veces"; else ok "RB2c rollback_223 repetido se niega"; fi
if $PSM -d "$DBA" -f "$DIR_CT/rollback_222_neto_hija_manual.sql" > "$TMP/rb.out" 2>&1; then ok "RB3 rollback_222 con todo vacío"; else fallo "RB3 rollback_222: $(tail -5 "$TMP/rb.out")"; cat "$TMP/rb.out" >&2; fi
HF="$(huella "$DBA")"
if [ "$HF" = "$H0" ]; then ok "RB4 tras el rollback la base es IDÉNTICA a la anterior a la 222 (políticas, funciones, tablas/ACL, disparadores, columnas, esquemas)"; else
  fallo "RB4 la base no volvió a ser idéntica"; echo "--- antes"; echo "$H0"; echo "--- después"; echo "$HF"; fi
if aplicar "$DBA" 222.sql; then ok "RB5 la 222 se reaplica tras el rollback"; else fallo "RB5 reaplicar la 222: $(tail -5 "$TMP/ap.out")"; fi
f="$(fila "$DBA" postcheck_222_neto_hija_manual.sql)"
case "$f" in OK\|16\|0\|16\|*) ok "RB6 postcheck 222 tras reaplicar: 16/16" ;; *) fallo "RB6 postcheck tras reaplicar: $f" ;; esac

echo "=== Fase RB2 · rollback con una hija sellada ==="
crear_base "$DBB"
aplicar "$DBB" 222.sql || { fallo "RB7 la 222 no se aplicó en la segunda base: $(tail -5 "$TMP/ap.out")"; }
if $PSM -d "$DBB" < "$AQUI/test_222_sellada_persistente.sql" > "$TMP/pers.out" 2>&1; then ok "RB7 se creó una hija NETO sellada y COMMITEADA"; else fallo "RB7 no se pudo crear la hija sellada: $(tail -5 "$TMP/pers.out")"; fi
HB="$(huella "$DBB")"
NB="$(uno "$DBB" "select count(*) from public.cotizacion_neto where modalidad = 'neto'")"
[ "$NB" = 1 ] && ok "RB7b hay exactamente 1 sello NETO persistido" || fallo "RB7b sellos NETO: $NB"
if $PSM -d "$DBB" -f "$DIR_CT/rollback_222_neto_hija_manual.sql" > "$TMP/rb.out" 2>&1; then fallo "RB8 el rollback corrió con una hija sellada"; else
  grep -q 'hija(s) selladas' "$TMP/rb.out" && ok "RB8 rollback_222 se niega con hijas selladas" || fallo "RB8 mensaje: $(tail -3 "$TMP/rb.out")"; fi
[ "$(huella "$DBB")" = "$HB" ] && ok "RB8b y la base queda exactamente igual (el sello se conserva)" || fallo "RB8b el rollback rechazado cambió la base"
f="$(fila "$DBB" postcheck_222_neto_hija_manual.sql)"
case "$f" in OK\|16\|0\|16\|*) ok "RB8c postcheck 222 sigue en 16/16" ;; *) fallo "RB8c postcheck: $f" ;; esac

echo "=== RESUMEN: $OKS ok, $FALLOS fallo(s) ==="
if [ "$FALLOS" -gt 0 ]; then exit 1; fi
echo "TEST 222/223 NETO: TODO OK"
