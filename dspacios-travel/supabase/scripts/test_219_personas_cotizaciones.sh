#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# PRUEBA · migración 219 (#42, personas de cotizaciones en el CRM) — runner de integración sobre la
# migración REAL: ciclo preflight/postcheck, batería SQL, regresión #39, carreras entre sesiones,
# rollback y API con JWT. Bases y contenedores DESECHABLES (GitHub Actions); nunca una base remota.
#
# Reproducción (desde dspacios-travel/), como lo hace .github/workflows/test-personas-cotizaciones-42.yml:
#   docker network create red219
#   docker run -d --name pg219 --network red219 -e POSTGRES_PASSWORD=postgres supabase/postgres:15.8.1.085
#   sh supabase/scripts/preparar_esquema_local.sh pg219 217 plantilla219    # 001-217 (con 214, 216 y 217), SIN la 219
#   sh supabase/scripts/test_219_personas_cotizaciones.sh pg219 plantilla219 red219
#
#   F   los analizadores de las filas consolidadas no dan falsos verdes (sin base)
#   M   preflight → 219 dos veces → postcheck 20/20 → preflight "ya aplicada"; postcheck 216 22/22 y
#       217 12/12; postcheck 214 falla SOLO en C15,C16 (firmas generalizadas, esperado); objetos ajenos
#       (policies, funciones, tablas/ACL/RLS, disparadores, esquemas, ACL por defecto) idénticos
#   S   test_219_personas_cotizaciones.sql (alta, titular, sello, integridad, visibilidad, regresiones)
#   G   batería SQL de #39 (test_216_edicion39.sql) completa con la 219 presente
#   K   carreras reales con compuerta (sin pg_sleep): misma persona desde dos cotizaciones, mismo alta
#       dos veces, editor contra conversión 198 (dos órdenes), dos editores, registrar contra descartar
#       (dos órdenes)
#   RB  rollback: aborta con datos, con una vista ajena y con la foto incompleta; con todo vacío
#       restaura la 214 EXACTA (postcheck 214 20/20 y la prueba SQL 214 completa, E8g incluida) y la 219
#       se reaplica; mientras exista la 219, el rollback de la 214 aborta (FK ajena)
#   H   PostgREST local con JWT HS256 firmados: fachadas cerradas a anon/authenticated, abiertas a
#       service_role; tabla de vínculo cerrada; lista del CRM por rol; consulta 214 cerrada a B2B;
#       p214_priv sin exponer; firma ajena rechazada
#
# Rol que aplica: ROL_MIGRA (por defecto supabase_admin, porque la plantilla de preparar_esquema_local.sh
# deja TODAS las tablas a su nombre, incluidas las de la 214; en Supabase alojado es `postgres`, dueño
# de la 214, NO superusuario y con BYPASSRLS — por eso el preflight P4 lo comprueba).
# Límite: las pruebas HTTP usan el secreto LOCAL; no prueban la emisión de tokens de GoTrue real.
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla219}"
RED="${3:-red219}"
export MSYS_NO_PATHCONV=1

valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_219_personas_cotizaciones.sh <contenedor> [plantilla] [red]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
valido "$RED" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Red inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
MIG="$APP/supabase/migrations/20260601000219_personas_cotizaciones.sql"
VECTORES="$APP/pruebas/fixtures/personasIdentidad.vectores.json"
PW="${PGPASSWORD_219:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
valido "$ROL_ADMIN" '^[a-z_][a-z0-9_]{0,62}$' && valido "$ROL_MIGRA" '^[a-z_][a-z0-9_]{0,62}$' || { echo "Roles inválidos." >&2; exit 2; }
DIR_CT=/tmp/s219
PSA="docker exec -i -w $DIR_CT -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_ADMIN -X -q -v ON_ERROR_STOP=1"
PSM="docker exec -i -w $DIR_CT -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_MIGRA -X -q -v ON_ERROR_STOP=1"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_219 $SUF"
DBM="t219_mig_$SUF"
PGRST="pgrst219_$SUF"
TMP="$(mktemp -d)"
FALLOS=0
OKS=0
BASES=""
ok()    { echo "OK    $1"; OKS=$((OKS + 1)); }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

limpiar() {
  st=$?
  docker rm -f "$PGRST" >/dev/null 2>&1 || true
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
for f in test_216_fixtures.sql test_216_edicion39.sql test_219_personas_cotizaciones.sql test_214_personas_identidad.sql; do
  docker exec -i "$CT" sh -c "cat > $DIR_CT/$f" < "$AQUI/$f"
done
docker exec -i "$CT" sh -c 'cat > /tmp/personasIdentidad.vectores.json' < "$VECTORES"
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PSA -d "$PLANTILLA" -t -A -c "select (to_regclass('public.personas') is not null and to_regnamespace('p39_priv') is not null and to_regclass('public.cotizacion_participantes') is null)::int")" = 1 ] \
  || { echo "La plantilla debe tener la 214 y la 216/217, y NO la 219." >&2; exit 2; }
[ "$($PSA -d "$PLANTILLA" -t -A -c "select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'D' and tgname = 'trg_cot_frontera_39'")" = 1 ] \
  || { echo "La plantilla debe tener la frontera de la 217 ACTIVA (cadena integrada hasta la 217)." >&2; exit 2; }

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
aplicar_219() { $PSM -d "$1" < "$MIG" > "$TMP/aplicar.out" 2>&1; }
uno() { $PSA -d "$1" -t -A -c "$2"; }

# Lo que la 219 NO debe tocar (una línea por familia). Fuera: lo propio de la 214 (tablas, p214_priv
# y su consulta) y lo nuevo de la 219 (tabla de vínculo y sus cuatro RPC). Los disparadores internos
# (RI de la FK nueva hacia cotizaciones) no cuentan.
huella_ajena() { # $1 = base
  $PSA -d "$1" -t -A <<'SQL'
select 'policies=' || md5(coalesce(string_agg(format('%s.%s.%s|%s|%s|%s|%s', schemaname, tablename, policyname, cmd, roles, qual, with_check),
                                              E'\n' order by schemaname, tablename, policyname), '')) || ' n=' || count(*)
  from pg_policies;
select 'funciones=' || md5(coalesce(string_agg(p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid)) || '|'
                                               || coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner),
                                               E'\n' order by p.oid::regprocedure::text), '')) || ' n=' || count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.prokind in ('f', 'p') and n.nspname not in ('pg_catalog', 'information_schema', 'p214_priv') and n.nspname !~ '^pg_'
   and p.proname not in ('buscar_personas_documento', 'registrar_personas_cotizacion', 'actualizar_titular_cotizacion',
                         'sellar_creador_cotizacion', 'crm_personas_cotizacion_buscar');
select 'tablas=' || md5(coalesce(string_agg(c.oid::regclass::text || '|' || c.relkind::text || '|' || coalesce(c.relacl::text, '') || '|'
                                            || c.relrowsecurity || '|' || c.relforcerowsecurity || '|' || pg_get_userbyid(c.relowner),
                                            E'\n' order by c.oid::regclass::text), '')) || ' n=' || count(*)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema', 'p214_priv') and n.nspname !~ '^pg_'
   and c.oid <> all (array_remove(array[to_regclass('public.personas')::oid, to_regclass('public.persona_capturas')::oid,
                                        to_regclass('public.persona_observaciones')::oid, to_regclass('public.cotizacion_participantes')::oid], null));
select 'disparadores=' || md5(coalesce(string_agg(t.tgrelid::regclass::text || '|' || t.tgname || '|' || t.tgenabled::text || '|' || t.tgfoid::regprocedure::text,
                                                  E'\n' order by t.tgrelid::regclass::text, t.tgname), '')) || ' n=' || count(*)
  from pg_trigger t
 where not t.tgisinternal
   and t.tgrelid <> all (array_remove(array[to_regclass('public.personas')::oid, to_regclass('public.persona_capturas')::oid,
                                           to_regclass('public.persona_observaciones')::oid, to_regclass('public.cotizacion_participantes')::oid], null));
select 'esquemas=' || md5(coalesce(string_agg(n.nspname || '|' || coalesce(n.nspacl::text, '') || '|' || pg_get_userbyid(n.nspowner),
                                              E'\n' order by n.nspname), '')) || ' n=' || count(*)
  from pg_namespace n where n.nspname !~ '^pg_';
select 'acl_defecto=' || md5(coalesce(string_agg(d.defaclrole::regrole::text || '|' || d.defaclnamespace::regnamespace::text || '|'
                                                 || d.defaclobjtype::text || '|' || d.defaclacl::text,
                                                 E'\n' order by d.defaclrole::regrole::text, d.defaclnamespace::regnamespace::text, d.defaclobjtype), ''))
       || ' n=' || count(*)
  from pg_default_acl d;
select 'cotizaciones: rls=' || (select relrowsecurity::text from pg_class where oid = 'public.cotizaciones'::regclass)
       || ' policies=' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'cotizaciones')
       || ' frontera39=' || (select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'D' and tgname = 'trg_cot_frontera_39');
SQL
}

# Filas consolidadas (mismo formato que la 214): nada se da por bueno si la salida no es exactamente
# esa fila, con todos los códigos una vez y en orden, y con veredicto y conteos coherentes.
pf_valido() { # $1 archivo
  [ "$(wc -l < "$1" | tr -d ' ')" = 1 ] || return 1
  awk -F'|' '
    NR == 1 {
      if ($1 != "INFO" && $1 != "BLOQUEANTE") { mal = 1; exit }
      if ($4 != 10) { mal = 1; exit }
      n = split($5, t, ";"); if (n != 10) { mal = 1; exit }
      nb = 0; nr = 0
      for (i = 1; i <= n; i++) {
        if (t[i] !~ /^P[0-9]+=(INFO|REVISAR|BLOQUEANTE)\/[0-9]+$/) { mal = 1; exit }
        split(t[i], kv, "="); if (kv[1] != "P" i) { mal = 1; exit }
        if (kv[2] ~ /^BLOQUEANTE\//) nb++; else if (kv[2] ~ /^REVISAR\//) nr++
      }
      if ($2 != nb || $3 != nr) { mal = 1; exit }
      if ((nb > 0) != ($1 == "BLOQUEANTE")) { mal = 1; exit }
      if ($6 !~ /^PREFLIGHT: / || $7 !~ /^\[/) { mal = 1; exit }
      bien = 1
    }
    END { exit (mal || !bien) }' "$1"
}
pf() { awk -F'|' -v c="$2" 'NR == 1 { n = split($5, t, ";"); for (i = 1; i <= n; i++) { split(t[i], kv, "="); if (kv[1] == c) print kv[2] } }' "$1"; }
pc_valido() { # $1 archivo, $2 número de chequeos
  [ "$(wc -l < "$1" | tr -d ' ')" = 1 ] || return 1
  awk -F'|' -v N="$2" '
    NR == 1 {
      if ($1 != "OK" && $1 != "FALLA") { mal = 1; exit }
      if ($4 != N) { mal = 1; exit }
      n = split($6, t, ";"); if (n != N) { mal = 1; exit }
      nt = 0; nf = 0; fl = ""
      for (i = 1; i <= n; i++) {
        if (t[i] !~ /^C[0-9]+=[tf]$/) { mal = 1; exit }
        split(t[i], kv, "="); if (kv[1] != "C" i) { mal = 1; exit }
        if (kv[2] == "t") nt++; else { nf++; fl = fl (fl == "" ? "" : ",") kv[1] }
      }
      if ($2 != nt || $3 != nf) { mal = 1; exit }
      if ($5 != (nf == 0 ? "ninguno" : fl)) { mal = 1; exit }
      if ((nf == 0) != ($1 == "OK")) { mal = 1; exit }
      if ($8 !~ /^\[/) { mal = 1; exit }
      bien = 1
    }
    END { exit (mal || !bien) }' "$1"
}
postcheck() { # $1 base, $2 script, $3 número de chequeos ; imprime ok/fallos o "invalido" (deja la fila en $TMP/post.out)
  $PSA -d "$1" -t -A -F'|' < "$AQUI/$2" > "$TMP/post.out" 2>&1 || true
  if pc_valido "$TMP/post.out" "$3"; then cut -d'|' -f2,3 "$TMP/post.out" | tr '|' '/'; else echo invalido; fi
}

# ══ F · analizadores (sin base) ═══════════════════════════════════════════
PCV="OK|20|0|20|ninguno|C1=t;C2=t;C3=t;C4=t;C5=t;C6=t;C7=t;C8=t;C9=t;C10=t;C11=t;C12=t;C13=t;C14=t;C15=t;C16=t;C17=t;C18=t;C19=t;C20=t|Filas: x|[]"
PFV="INFO|0|1|10|P1=INFO/5;P2=INFO/0;P3=INFO/1;P4=INFO/3;P5=REVISAR/3;P6=INFO/0;P7=INFO/4;P8=INFO/0;P9=INFO/0;P10=INFO/1|PREFLIGHT: sin bloqueantes|[]"
f_rechaza() { printf '%s\n' "$3" > "$TMP/f.out"; if "$2" "$TMP/f.out" ${4:-}; then fallo "$1 ACEPTADO (falso verde)"; else ok "$1 rechazado"; fi; }
printf '%s\n' "$PCV" > "$TMP/f.out"; pc_valido "$TMP/f.out" 20 && ok "F1 postcheck bien formado: aceptado" || fallo "F1 postcheck bien formado rechazado"
printf '%s\n' "$PFV" > "$TMP/f.out"; pf_valido "$TMP/f.out" && [ "$(pf "$TMP/f.out" P5)" = REVISAR/3 ] && ok "F2 preflight bien formado: aceptado" || fallo "F2 preflight rechazado"
f_rechaza "F3 postcheck vacío:" pc_valido "" 20
f_rechaza "F4 postcheck con una línea de ERROR añadida:" pc_valido "$PCV
ERROR:  algo" 20
f_rechaza "F5 postcheck OK con un control en f:" pc_valido "$(printf '%s' "$PCV" | sed 's/C7=t/C7=f/')" 20
f_rechaza "F6 postcheck con un control de menos:" pc_valido "$(printf '%s' "$PCV" | sed 's/;C20=t//')" 20
f_rechaza "F7 postcheck con conteo ok que no cuadra:" pc_valido "$(printf '%s' "$PCV" | sed 's/^OK|20|/OK|19|/')" 20
f_rechaza "F8 preflight INFO con un BLOQUEANTE:" pf_valido "$(printf '%s' "$PFV" | sed 's/P3=INFO/P3=BLOQUEANTE/')"
f_rechaza "F9 preflight sin P10:" pf_valido "$(printf '%s' "$PFV" | sed 's/;P10=INFO\/1//')"
f_rechaza "F10 preflight con revisar que no cuadra:" pf_valido "$(printf '%s' "$PFV" | sed 's/^INFO|0|1|/INFO|0|0|/')"

# ══ M · ciclo de la migración ══════════════════════════════════════════════
crear_base "$DBM"
$PSM -d "$DBM" -t -A -F'|' < "$AQUI/preflight_219_personas_cotizaciones.sql" > "$TMP/pre1.out" 2>&1 || true
if pf_valido "$TMP/pre1.out" && [ "$(cut -d'|' -f1,2 "$TMP/pre1.out")" = "INFO|0" ] && [ "$(pf "$TMP/pre1.out" P5)" = INFO/0 ] \
   && [ "$(pf "$TMP/pre1.out" P3)" = INFO/1 ] && [ "$(pf "$TMP/pre1.out" P7)" = INFO/4 ]; then
  ok "M1 preflight como $ROL_MIGRA: sin bloqueantes (P5: 219 no aplicada; P3: frontera 217 activa; P7: 4 restricciones a fotografiar)"
else fallo "M1 preflight: $(tr '\n' ' ' < "$TMP/pre1.out" | cut -c1-600)"; fi
huella_ajena "$DBM" > "$TMP/ajena0.out" 2>&1
if aplicar_219 "$DBM"; then ok "M2 219 aplicada como $ROL_MIGRA"; else fallo "M2 219: $(cut -c1-600 "$TMP/aplicar.out")"; exit 1; fi
if aplicar_219 "$DBM"; then ok "M3 219 aplicada por segunda vez sin error (idempotente)"; else fallo "M3 segunda aplicación: $(cut -c1-400 "$TMP/aplicar.out")"; fi
R="$(postcheck "$DBM" postcheck_219_personas_cotizaciones.sql 20)"
[ "$R" = "20/0" ] && ok "M4 postcheck 219 20/20 ($(cut -d'|' -f7 "$TMP/post.out"))" || fallo "M4 postcheck 219 ok/fallos=$R: $(cut -d'|' -f1-5 "$TMP/post.out" | tr '\n' ' ' | cut -c1-300)"
cut -d'|' -f7 "$TMP/post.out" | grep -q 'capturas_cotizacion=0 · puestos=0 · monitor_sin_puesto=0' \
  && ok "M5 recién aplicada: 0 capturas de cotización, 0 puestos, monitor en 0 (sin backfill)" || fallo "M5 $(cut -d'|' -f7 "$TMP/post.out")"
$PSM -d "$DBM" -t -A -F'|' < "$AQUI/preflight_219_personas_cotizaciones.sql" > "$TMP/pre2.out" 2>&1 || true
pf_valido "$TMP/pre2.out" && [ "$(cut -d'|' -f1,2 "$TMP/pre2.out")" = "INFO|0" ] && [ "$(pf "$TMP/pre2.out" P5)" = REVISAR/3 ] \
  && ok "M6 preflight tras aplicar: P5 'ya aplicada' (REVISAR), sin bloqueantes" || fallo "M6 $(cut -d'|' -f1-5 "$TMP/pre2.out" | tr '\n' ' ' | cut -c1-400)"
R="$(postcheck "$DBM" postcheck_216_cotizacion_manual_edicion.sql 22)"
[ "$R" = "22/0" ] && ok "M7 postcheck 216 sigue 22/22 con la 219" || fallo "M7 postcheck 216 = $R"
R="$(postcheck "$DBM" postcheck_217_cotizacion_manual_cierre.sql 12)"
[ "$R" = "12/0" ] && ok "M8 postcheck 217 sigue 12/12 con la 219" || fallo "M8 postcheck 217 = $R"
R="$(postcheck "$DBM" postcheck_214_personas_identidad.sql 20)"
F214="$(cut -d'|' -f5 "$TMP/post.out" 2>/dev/null || true)"
[ "$R" = "18/2" ] && [ "$F214" = "C15,C16" ] \
  && ok "M9 postcheck 214 con la 219: falla SOLO C15,C16 (firmas generalizadas y funciones nuevas en p214_priv; esperado)" \
  || fallo "M9 postcheck 214 con la 219 = $R fallidos=$F214"
huella_ajena "$DBM" > "$TMP/ajena1.out" 2>&1
if [ "$(grep -c '=' "$TMP/ajena0.out")" = 7 ] && cmp -s "$TMP/ajena0.out" "$TMP/ajena1.out"; then
  ok "M10 regresión: objetos ajenos idénticos antes y después ($(tr '\n' ';' < "$TMP/ajena1.out" | sed -E 's/=[0-9a-f]{32}//g'))"
else fallo "M10 regresión: $(diff "$TMP/ajena0.out" "$TMP/ajena1.out" | tr '\n' ' ' | cut -c1-500)"; fi

# ══ S · batería SQL de la 219 ═══════════════════════════════════════════════
if $PSA -d "$DBM" -f "$DIR_CT/test_219_personas_cotizaciones.sql" > "$TMP/sql.out" 2>&1 && grep -q "TEST 219 SQL: TODO OK" "$TMP/sql.out" \
   && ! grep -q 'NOTICE:  FALLO' "$TMP/sql.out"; then
  ok "S1 prueba SQL 219: $(grep -c 'NOTICE:  OK' "$TMP/sql.out") verificaciones OK"
else
  fallo "S1 prueba SQL 219: $(grep -E 'FALLO|ERROR' "$TMP/sql.out" | head -5 | tr '\n' ' ')"
fi
cp "$TMP/sql.out" "${SALIDA_SQL:-/dev/null}" 2>/dev/null || true
grep -E 'NOTICE:  (OK|FALLO)' "$TMP/sql.out" | sed 's/^.*NOTICE:  /  /' || true

# ══ G · regresión de #39 con la 219 presente ═════════════════════════════════
if $PSA -d "$DBM" -f "$DIR_CT/test_216_edicion39.sql" > "$TMP/g.out" 2>&1 && grep -q "TEST 216 SQL: TODO OK" "$TMP/g.out"; then
  ok "G1 batería SQL de #39 completa con la 219 aplicada ($(grep -c 'NOTICE:  OK' "$TMP/g.out") verificaciones)"
else
  fallo "G1 batería #39 con la 219: $(grep -E 'FALLO|ERROR' "$TMP/g.out" | head -3 | tr '\n' ' ')"
fi

# ══ K · carreras reales ══════════════════════════════════════════════════════
DBK="t219_k_$SUF"; crear_base "$DBK"; aplicar_219 "$DBK" || fallo "K preparación"
SES() { # $1 = application_name, $2 = archivo de salida ; SQL por stdin
  docker exec -i -w "$DIR_CT" -e PGPASSWORD="$PW" -e PGAPPNAME="$1" "$CT" psql -h 127.0.0.1 -U "$ROL_ADMIN" -d "$DBK" -X -q -t -A -v ON_ERROR_STOP=1 > "$2" 2>&1
}
cuando() { # $1 = consulta que devuelve 1 ; $2 = máximo de intentos
  i=0
  while [ "$i" -lt "$2" ]; do
    r="$($PSA -d "$DBK" -t -A -c "$1" 2>/dev/null || echo 0)"
    [ "$r" = 1 ] && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}
carrera() { # nombre llave "sqlA" final_A "sqlB" ; deja ESPERO=1 si B esperó un Lock de A
  n="$1"; k="$2"
  g_intento=1
  while :; do
    printf 'select pg_advisory_lock(%s);\nselect pg_sleep(600);\n' "$k" | SES "${n}_g" "$TMP/$n.g" &
    pg=$!
    if cuando "select (count(*) = 1)::int from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.application_name = '${n}_g' and l.locktype = 'advisory' and l.granted" 30; then break; fi
    uno "$DBK" "select pg_terminate_backend(pid) from pg_stat_activity where application_name = '${n}_g'" >/dev/null 2>&1 || true
    wait "$pg" || true
    if [ "$g_intento" -ge 3 ]; then fallo "$n: la compuerta no tomó su candado"; ESPERO=0; return 0; fi
    g_intento=$((g_intento + 1))
  done
  printf 'set role service_role;\nbegin;\n%s\nselect pg_advisory_lock(%s);\n%s;\n' "$3" "$k" "$4" | SES "${n}_a" "$TMP/$n.a" &
  pa=$!
  if ! cuando "select (count(*) = 1)::int from pg_stat_activity where application_name = '${n}_a' and wait_event_type = 'Lock' and wait_event = 'advisory'" 90; then
    fallo "$n: A no llegó a la compuerta ($(tr '\n' ' ' < "$TMP/$n.a" | cut -c1-300))"
    uno "$DBK" "select pg_terminate_backend(pid) from pg_stat_activity where application_name like '${n}_%'" >/dev/null; wait "$pa" || true; wait "$pg" || true; ESPERO=0; return 0
  fi
  printf 'set role service_role;\n%s\n' "$5" | SES "${n}_b" "$TMP/$n.b" &
  pb=$!
  if cuando "select (count(*) = 1)::int from pg_stat_activity where application_name = '${n}_b' and wait_event_type = 'Lock' and wait_event <> 'advisory'" 90; then
    ESPERO=1
  else
    ESPERO=0
  fi
  uno "$DBK" "select pg_terminate_backend(pid) from pg_stat_activity where application_name = '${n}_g'" >/dev/null
  wait "$pa" || true; wait "$pb" || true; wait "$pg" || true
}

# Preparación confirmada: fixtures de #39 (usuarios), cotizaciones y puestos de partida.
$PSA -d "$DBK" > "$TMP/kprep.out" 2>&1 <<'SQL' || fallo "K preparación: $(tail -5 "$TMP/kprep.out" | tr '\n' ' ')"
begin;
\ir test_216_fixtures.sql
create table t216.k (k text primary key, v bigint);
create function t216.cot_k(p_k text, p_doc text) returns bigint language plpgsql as $$
declare v bigint;
begin
  insert into public.cotizaciones (tenant, tipo, estado, payload, detalle, cliente, modulo, pax, precio_venta, moneda, vigencia_hasta, creado_por, creado_por_id)
  values ('mayorista', 'tarifario', 'abierta',
          jsonb_build_object('cliente', jsonb_build_object('nombres', 'K', 'apellidos', p_k, 'tipoDoc', 'CC', 'numeroDoc', p_doc)),
          '{}'::jsonb, 'K ' || p_k, 'tarifario', 2, 1000, 'COP', public.fecha_negocio() + 5, 'c216-admin@x.test', t216.u('admin'))
  returning id into v;
  insert into t216.k values (p_k, v);
  return v;
end $$;
select t216.cot_k('q1', '77000001'), t216.cot_k('q2', '77000001'), t216.cot_k('q3', '77000003'), t216.cot_k('q7', '77000007'), t216.cot_k('q8', '77000008');
-- Manuales pagadas (listas para convertir) y una con titular registrado para los editores.
insert into t216.k select 'm4', t216.crear('admin');
insert into t216.k select 'm5', t216.crear('admin');
insert into t216.k select 'm6', t216.crear('admin');
commit;
begin;
-- Como lo hace el servidor (service_role), por el ayudante de la 216 (el esquema t216 no es de la API).
do $$
declare r text;
begin
  for r in select t216.escalar('service_role', null, format('select public.registrar_personas_cotizacion(%s, %L::uuid, %L::jsonb)::text',
             v, t216.u('admin'), jsonb_build_array(jsonb_build_object('rol', 'titular', 'tipo_doc', 'CC', 'numero_doc', '1234567',
               'observaciones', jsonb_build_array(jsonb_build_object('campo', 'nombres', 'valor', 'Cliente'))))))
             from t216.k where k in ('m4', 'm5', 'm6') loop
    if r is null or r like 'ERR %' then raise exception 'preparación K: %', r; end if;
  end loop;
end $$;
select t216.pagar((select v from t216.k where k = 'm4'), 450000, 'k219-m4');
select t216.pagar((select v from t216.k where k = 'm5'), 450000, 'k219-m5');
commit;
SQL
K() { uno "$DBK" "select v from t216.k where k = '$1'"; }
ADM="00000000-0000-0000-0000-000000216002"
tit() { printf "jsonb_build_array(jsonb_build_object('rol','titular','tipo_doc','CC','numero_doc','%s','observaciones',jsonb_build_array(jsonb_build_object('campo','nombres','valor','%s'))))" "$1" "$2"; }
reg() { printf "select public.registrar_personas_cotizacion(%s, '%s', %s)::text;" "$1" "$ADM" "$2"; }
edit() { # cotización clave apellidos tipo número (versión esperada 1: el puesto recién registrado)
  printf "select public.actualizar_titular_cotizacion(%s, '%s', jsonb_build_object('nombres','Editado','apellidos','%s','tipo_doc','%s','numero_doc','%s','fecha_nacimiento','1980-01-01'), 1, '%s')::text;" "$1" "$ADM" "$3" "$4" "$5" "$2"
}
Q1="$(K q1)"; Q2="$(K q2)"; Q3="$(K q3)"; Q7="$(K q7)"; Q8="$(K q8)"; M4="$(K m4)"; M5="$(K m5)"; M6="$(K m6)"

carrera K1 219001 "$(reg "$Q1" "$(tit 77000001 Igual)")" commit "$(reg "$Q2" "$(tit 77000001 Igual)")"
if [ "$ESPERO" = 1 ] && grep -q '"nuevos": 1' "$TMP/K1.a" && grep -q '"nuevos": 1' "$TMP/K1.b" \
   && [ "$(uno "$DBK" "select count(*) || '/' || (select count(*) from public.persona_capturas c join public.personas p on p.id = c.persona_id where p.numero_norm = '77000001') from public.personas where numero_norm = '77000001'")" = "1/2" ]; then
  ok "K1 dos cotizaciones con el mismo documento nuevo a la vez: B esperó; 1 persona y 2 capturas (2 puestos)"
else fallo "K1 espero=$ESPERO A=[$(tr '\n' ' ' < "$TMP/K1.a")] B=[$(tr '\n' ' ' < "$TMP/K1.b")]"; fi

carrera K2 219002 "$(reg "$Q3" "$(tit 77000003 Doble)")" commit "$(reg "$Q3" "$(tit 77000003 Doble)")"
if [ "$ESPERO" = 1 ] && grep -q '"nuevos": 1' "$TMP/K2.a" && grep -q '"reintentos": 1' "$TMP/K2.b" \
   && [ "$(uno "$DBK" "select count(*) from public.persona_capturas where cotizacion_id = $Q3")/$(uno "$DBK" "select count(*) from public.cotizacion_participantes where cotizacion_id = $Q3")" = "1/1" ]; then
  ok "K2 el mismo alta enviado dos veces a la vez: B esperó el candado de la cotización y dio reintento; 1 captura, 1 puesto"
else fallo "K2 espero=$ESPERO A=[$(tr '\n' ' ' < "$TMP/K2.a")] B=[$(tr '\n' ' ' < "$TMP/K2.b")]"; fi

carrera K3a 219003 "$(edit "$M4" 00000000-0000-4000-a219-000000000001 Pasaporte PAS KA000001)" commit \
  "select public.convertir_cotizacion_manual_controlada($M4, '$ADM');"
N4="$(uno "$DBK" "select numero_contrato from public.cotizaciones where id = $M4")"
if [ "$ESPERO" = 1 ] && grep -q '"actualizado"' "$TMP/K3a.a" && [ -n "$N4" ] \
   && [ "$(uno "$DBK" "select count(*) from public.contrato_pasajeros where numero_contrato = '$N4' and tipo_id = 'PAS' and identificacion = 'KA000001'")" = 1 ]; then
  ok "K3a editor primero, conversión después: la 198 esperó el candado y convirtió con el titular NUEVO (PAS crudo)"
else fallo "K3a espero=$ESPERO N=$N4 A=[$(tr '\n' ' ' < "$TMP/K3a.a")] B=[$(tr '\n' ' ' < "$TMP/K3a.b")]"; fi

carrera K3b 219004 "select public.convertir_cotizacion_manual_controlada($M5, '$ADM');" commit \
  "$(edit "$M5" 00000000-0000-4000-a219-000000000002 Tarde PAS KB000001)"
if [ "$ESPERO" = 1 ] && grep -q 'cotizacion_no_abierta' "$TMP/K3b.b" \
   && [ "$(uno "$DBK" "select estado from public.cotizaciones where id = $M5")" = convertida ]; then
  ok "K3b conversión primero, editor después: el editor esperó y vio la cotización convertida (cotizacion_no_abierta)"
else fallo "K3b espero=$ESPERO A=[$(tr '\n' ' ' < "$TMP/K3b.a")] B=[$(tr '\n' ' ' < "$TMP/K3b.b")]"; fi

carrera K4 219005 "$(edit "$M6" 00000000-0000-4000-a219-000000000003 Primero CC 7600001)" commit \
  "$(edit "$M6" 00000000-0000-4000-a219-000000000004 Segundo CC 7600002)"
if [ "$ESPERO" = 1 ] && grep -q '"actualizado"' "$TMP/K4.a" && grep -q 'version_obsoleta' "$TMP/K4.b" \
   && [ "$(uno "$DBK" "select payload #>> '{cliente,apellidos}' from public.cotizaciones where id = $M6")" = Primero ]; then
  ok "K4 dos editores con la misma versión: gana uno; el otro esperó y recibió version_obsoleta sin escribir"
else fallo "K4 espero=$ESPERO A=[$(tr '\n' ' ' < "$TMP/K4.a")] B=[$(tr '\n' ' ' < "$TMP/K4.b")]"; fi

carrera K5a 219006 "$(reg "$Q7" "$(tit 77000007 Desc)")" commit "update public.cotizaciones set estado = 'descartada' where id = $Q7;"
if [ "$ESPERO" = 1 ] && grep -q '"nuevos": 1' "$TMP/K5a.a" && [ "$(uno "$DBK" "select estado from public.cotizaciones where id = $Q7")" = descartada ] \
   && [ "$(uno "$DBK" "select count(*) from public.cotizacion_participantes where cotizacion_id = $Q7")" = 1 ]; then
  ok "K5a registrar primero, descartar después: el descarte esperó; el puesto queda como historia"
else fallo "K5a espero=$ESPERO A=[$(tr '\n' ' ' < "$TMP/K5a.a")] B=[$(tr '\n' ' ' < "$TMP/K5a.b")]"; fi

carrera K5b 219007 "update public.cotizaciones set estado = 'descartada' where id = $Q8;" commit "$(reg "$Q8" "$(tit 77000008 Tarde)")"
if [ "$ESPERO" = 1 ] && grep -q 'cotizacion_no_abierta' "$TMP/K5b.b" \
   && [ "$(uno "$DBK" "select count(*) from public.cotizacion_participantes where cotizacion_id = $Q8")" = 0 ]; then
  ok "K5b descartar primero, registrar después: registrar esperó y respondió cotizacion_no_abierta sin escribir"
else fallo "K5b espero=$ESPERO A=[$(tr '\n' ' ' < "$TMP/K5b.a")] B=[$(tr '\n' ' ' < "$TMP/K5b.b")]"; fi

# ══ RB · rollback ═══════════════════════════════════════════════════════════
rb() { $PSM -d "$1" < "$APP/supabase/scripts/rollback_219_personas_cotizaciones.sql" > "$TMP/rb.out" 2>&1; }
DBR="t219_rb_$SUF"; crear_base "$DBR"; aplicar_219 "$DBR" || fallo "RB preparación"
if ! $PSM -d "$DBR" < "$APP/supabase/scripts/rollback_214_personas_identidad.sql" > "$TMP/rb214.out" 2>&1 \
   && grep -q '(4: FK ajenas' "$TMP/rb214.out"; then
  ok "RB0 con la 219 presente el rollback de la 214 aborta (FK ajena del vínculo), como se esperaba"
else fallo "RB0 $(grep -E 'ERROR|NOTICE' "$TMP/rb214.out" | head -2)"; fi
$PSA -d "$DBR" -c "create view public.t219_vista as select id from public.cotizacion_participantes" >/dev/null
if ! rb "$DBR" && grep -q '(3: objetos ajenos' "$TMP/rb.out"; then ok "RB1 vista ajena sobre el vínculo: aborta"; else fallo "RB1 $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" | head -2)"; fi
$PSA -d "$DBR" -c "drop view public.t219_vista" >/dev/null
$PSA -d "$DBR" -c "delete from p214_priv.r219_foto_214 where objeto = 'persona_capturas_nivel_ck'" >/dev/null
if ! rb "$DBR" && grep -q '(4: falta la foto' "$TMP/rb.out"; then ok "RB2 foto incompleta: aborta sin tocar nada"; else fallo "RB2 $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" | head -2)"; fi
[ "$(postcheck "$DBR" postcheck_219_personas_cotizaciones.sql 20)" = "19/1" ] && ok "RB2.1 tras el aborto la 219 sigue entera (solo C16 nota la foto incompleta)" || fallo "RB2.1 $(cut -d'|' -f1-5 "$TMP/post.out")"

DBV="t219_rbv_$SUF"; crear_base "$DBV"; aplicar_219 "$DBV" || fallo "RB preparación vacía"
$PSA -d "$DBV" > "$TMP/rbdatos.out" 2>&1 <<'SQL'
insert into public.cotizaciones (tenant, tipo, estado, payload, cliente, modulo, pax, precio_venta, moneda, vigencia_hasta)
values ('mayorista', 'carrito', 'abierta', '{"cliente":{"nombres":"RB"}}', 'RB', 'carrito', 1, 1, 'COP', current_date + 3);
set role service_role;
select public.registrar_personas_cotizacion((select max(id) from public.cotizaciones), null,
  '[{"rol":"titular","tipo_doc":null,"numero_doc":"9100001","observaciones":[{"campo":"nombres","valor":"RB"}]}]'::jsonb);
SQL
H0="$(uno "$DBV" "select md5(coalesce((select string_agg(to_jsonb(c)::text, '|' order by id) from public.persona_capturas c), '') || coalesce((select string_agg(to_jsonb(p)::text, '|' order by id) from public.cotizacion_participantes p), ''))")"
if ! rb "$DBV" && grep -q 'capturas_cotizacion=1, puestos=0\|(1: hay capturas' "$TMP/rb.out" \
   && [ "$(uno "$DBV" "select md5(coalesce((select string_agg(to_jsonb(c)::text, '|' order by id) from public.persona_capturas c), '') || coalesce((select string_agg(to_jsonb(p)::text, '|' order by id) from public.cotizacion_participantes p), ''))")" = "$H0" ]; then
  ok "RB3 con una captura de cotización y su puesto: aborta (1) y no borra nada (huella idéntica)"
else fallo "RB3 $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" | head -2) $(tail -2 "$TMP/rbdatos.out")"; fi

DBL="t219_rbl_$SUF"; crear_base "$DBL"; aplicar_219 "$DBL" || fallo "RB preparación limpia"
if rb "$DBL" && grep -q 'ROLLBACK 219 COMPLETO' "$TMP/rb.out"; then ok "RB4 vacía: el rollback restaura la 214 y verifica 5 funciones y 4 restricciones contra la foto"; else fallo "RB4 $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" | head -3)"; fi
R="$(postcheck "$DBL" postcheck_214_personas_identidad.sql 20)"
[ "$R" = "20/0" ] && ok "RB5 tras el rollback, postcheck 214 20/20" || fallo "RB5 postcheck 214 = $R $(cut -d'|' -f5 "$TMP/post.out")"
if $PSA -d "$DBL" -f "$DIR_CT/test_214_personas_identidad.sql" > "$TMP/s214.out" 2>&1 && grep -q "TEST 214 SQL: TODO OK" "$TMP/s214.out" \
   && grep -q 'OK    E8g' "$TMP/s214.out"; then
  ok "RB6 la prueba SQL 214 completa vuelve a pasar ($(grep -c 'NOTICE:  OK' "$TMP/s214.out") verificaciones, E8g incluida)"
else fallo "RB6 prueba 214 tras el rollback: $(grep -E 'FALLO|ERROR' "$TMP/s214.out" | head -3 | tr '\n' ' ')"; fi
R="$(postcheck "$DBL" postcheck_219_personas_cotizaciones.sql 20)"
if [ "$R" != invalido ] && [ "${R#*/}" -ge 15 ]; then ok "RB7 tras el rollback el postcheck 219 queda en rojo ($R ok/fallos)"; else fallo "RB7 postcheck 219 tras rollback: $R"; fi
if aplicar_219 "$DBL" && [ "$(postcheck "$DBL" postcheck_219_personas_cotizaciones.sql 20)" = "20/0" ]; then
  ok "RB8 la 219 se reaplica sobre la base revertida: postcheck 20/20"
else fallo "RB8 reaplicar: $(cut -c1-300 "$TMP/aplicar.out")"; fi
if rb "$DBL" && $PSM -d "$DBL" < "$APP/supabase/scripts/rollback_214_personas_identidad.sql" > "$TMP/rb214b.out" 2>&1 \
   && grep -q 'ROLLBACK 214 COMPLETO' "$TMP/rb214b.out"; then
  ok "RB9 sin la 219, el rollback de la 214 vuelve a proceder sobre tablas vacías"
else fallo "RB9 $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" "$TMP/rb214b.out" | head -3)"; fi

# ══ H · API con JWT firmados (PostgREST local) ═══════════════════════════════
if [ "${SIN_API:-}" = 1 ]; then
  echo "INFO  H omitida por SIN_API=1 (las pruebas HTTP NO se ejecutaron)."
else
  DBA="t219_api_$SUF"; crear_base "$DBA"; aplicar_219 "$DBA" || fallo "H preparación"
  SECRETO="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  CLAVE_AUTH="auth_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  $PSA -d postgres -c "alter role authenticator with login password '$CLAVE_AUTH'" >/dev/null
  $PSA -d "$DBA" > "$TMP/seed.out" 2>&1 <<'SQL'
insert into auth.users (id, email) values
  ('00000000-0000-4000-a219-0000000000a1', 'h_ad@x.test'), ('00000000-0000-4000-a219-0000000000a2', 'h_ge@x.test'),
  ('00000000-0000-4000-a219-0000000000a3', 'h_va@x.test'), ('00000000-0000-4000-a219-0000000000a4', 'h_vb@x.test'),
  ('00000000-0000-4000-a219-0000000000a5', 'h_ag@x.test'), ('00000000-0000-4000-a219-0000000000a6', 'h_in@x.test'),
  ('00000000-0000-4000-a219-0000000000a7', 'h_cv@x.test')
on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-4000-a219-0000000000a1', 'h_ad@x.test', 'Adan Admin', 'administracion', true, 'mayorista'),
  ('00000000-0000-4000-a219-0000000000a2', 'h_ge@x.test', 'Gina Gerente', 'gerencia', true, 'mayorista'),
  ('00000000-0000-4000-a219-0000000000a3', 'h_va@x.test', 'Ana Venta', 'venta', true, 'mayorista'),
  ('00000000-0000-4000-a219-0000000000a4', 'h_vb@x.test', 'Beto Venta', 'venta', true, 'mayorista'),
  ('00000000-0000-4000-a219-0000000000a5', 'h_ag@x.test', 'Agencia H', 'agencia', true, 'mayorista'),
  ('00000000-0000-4000-a219-0000000000a6', 'h_in@x.test', 'Ines Inactiva', 'administracion', false, 'mayorista'),
  ('00000000-0000-4000-a219-0000000000a7', 'h_cv@x.test', 'Carlos Vuelo', 'control_vuelo', true, 'mayorista')
on conflict (id) do update set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol,
                               activo = excluded.activo, tenant = excluded.tenant;
create table public.t219_h (k text primary key, v bigint);
do $$
declare x record; v_id bigint;
begin
  for x in select * from (values ('va', '00000000-0000-4000-a219-0000000000a3', 'h_va@x.test', '00000000-0000-4000-a219-00000000b001'),
                                 ('vb', '00000000-0000-4000-a219-0000000000a4', 'h_vb@x.test', '00000000-0000-4000-a219-00000000b002'),
                                 ('ag', '00000000-0000-4000-a219-0000000000a5', 'h_ag@x.test', '00000000-0000-4000-a219-00000000b003')) t(k, u, e, r) loop
    insert into public.cotizaciones (tenant, tipo, estado, payload, cliente, modulo, pax, precio_venta, moneda,
                                     vigencia_hasta, creado_por, creado_por_id)
    values ('mayorista', 'tarifario', 'abierta',
            jsonb_build_object('cliente', jsonb_build_object('nombres', 'H', 'apellidos', x.k, 'tipoDoc', 'CC', 'numeroDoc', '78000001'),
                               'pasajeros', jsonb_build_array(jsonb_build_object('ref', x.r, 'nombres', 'Pasajero ' || x.k))),
            'H', 'tarifario', 1, 1, 'COP', current_date + 3, x.e, x.u::uuid)
    returning id into v_id;
    insert into public.t219_h values (x.k, v_id);
  end loop;
end $$;
grant select on public.t219_h to service_role;
set role service_role;
select public.registrar_personas_cotizacion(v, case k when 'va' then '00000000-0000-4000-a219-0000000000a3'::uuid
                                                      when 'vb' then '00000000-0000-4000-a219-0000000000a4'::uuid
                                                      else '00000000-0000-4000-a219-0000000000a5'::uuid end,
         jsonb_build_array(
           jsonb_build_object('rol', 'titular', 'tipo_doc', 'CC', 'numero_doc', '78000001',
             'observaciones', jsonb_build_array(jsonb_build_object('campo', 'apellidos', 'valor', 'Titular' || k))),
           jsonb_build_object('rol', 'pasajero', 'ref', case k when 'va' then '00000000-0000-4000-a219-00000000b001'
                                                               when 'vb' then '00000000-0000-4000-a219-00000000b002'
                                                               else '00000000-0000-4000-a219-00000000b003' end,
             'orden', 0, 'tipo_doc', 'CC', 'numero_doc', '78000002',
             'observaciones', jsonb_build_array(jsonb_build_object('campo', 'nombres', 'valor', 'Pasajero' || k)))))
  from public.t219_h;
reset role;
SQL
  [ "$(uno "$DBA" "select count(*) from public.cotizacion_participantes")" = 6 ] && ok "H0 datos sembrados por la fachada como service_role (6 puestos)" || fallo "H0 siembra: $(tail -3 "$TMP/seed.out")"
  QVA="$(uno "$DBA" "select v from public.t219_h where k = 'va'")"

  docker rm -f "$PGRST" >/dev/null 2>&1 || true
  docker run -d --name "$PGRST" --network "$RED" -p 127.0.0.1:3219:3000 \
    -e PGRST_DB_URI="postgres://authenticator:$CLAVE_AUTH@$CT:5432/$DBA" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" \
    ghcr.io/supabase/postgrest:v16.1 >/dev/null
  BASE="http://127.0.0.1:3219"
  i=0; while [ "$i" -lt 90 ]; do [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/" || true)" = 200 ] && break; sleep 1; i=$((i + 1)); done
  [ "$i" -lt 90 ] && ok "H1 PostgREST local listo con secreto JWT local" || fallo "H1 PostgREST no respondió: $(docker logs --tail 5 "$PGRST" 2>&1 | tr '\n' ' ')"

  b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
  firmar() {
    h="$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)"
    p="$(printf '%s' "$1" | b64url)"
    s="$(printf '%s' "$h.$p" | openssl dgst -sha256 -hmac "$2" -binary | b64url)"
    printf '%s.%s.%s' "$h" "$p" "$s"
  }
  ahora="$(date +%s)"
  tok() { firmar "{\"sub\":\"$1\",\"role\":\"authenticated\",\"aud\":\"authenticated\",\"exp\":$((ahora + 3600))}" "$SECRETO"; }
  T_AD="$(tok 00000000-0000-4000-a219-0000000000a1)"; T_GE="$(tok 00000000-0000-4000-a219-0000000000a2)"
  T_VA="$(tok 00000000-0000-4000-a219-0000000000a3)"; T_AG="$(tok 00000000-0000-4000-a219-0000000000a5)"
  T_IN="$(tok 00000000-0000-4000-a219-0000000000a6)"; T_CV="$(tok 00000000-0000-4000-a219-0000000000a7)"
  T_SR="$(firmar "{\"role\":\"service_role\",\"exp\":$((ahora + 3600))}" "$SECRETO")"
  T_MAL="$(firmar "{\"sub\":\"00000000-0000-4000-a219-0000000000a1\",\"role\":\"authenticated\",\"exp\":$((ahora + 3600))}" "otro-secreto-que-no-es-el-local-219")"

  pedir() { # $1 método, $2 ruta, $3 token o '-', $4 cuerpo o '-', $5 encabezado extra o '-'
    if [ "$3" = - ]; then AUTH="X-Sin-Token: 1"; else AUTH="Authorization: Bearer $3"; fi
    if [ "$5" = - ]; then EXTRA="X-T219: 1"; else EXTRA="$5"; fi
    if [ "$4" = - ]; then
      curl -s -w '%{stderr}%{http_code}' -X "$1" -H "$AUTH" -H "$EXTRA" "$BASE$2" 2>&1 >"$TMP/h.body" || echo 000
    else
      curl -s -w '%{stderr}%{http_code}' -X "$1" -H "$AUTH" -H "$EXTRA" -H 'Content-Type: application/json' -d "$4" "$BASE$2" 2>&1 >"$TMP/h.body" || echo 000
    fi
  }
  json() { node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8'));process.exit(($2)?0:1)" < "$TMP/h.body"; }
  REG="{\"p_cotizacion_id\":$QVA,\"p_usuario_id\":\"00000000-0000-4000-a219-0000000000a1\",\"p_participantes\":[]}"
  for fn in registrar_personas_cotizacion actualizar_titular_cotizacion sellar_creador_cotizacion; do
    c="$(pedir POST "/rpc/$fn" - "$REG" -)"
    case "$c" in 401|404) ok "H2 anon POST /rpc/$fn: $c (sin EXECUTE)";; *) fallo "H2 anon /rpc/$fn: $c $(cat "$TMP/h.body")";; esac
    c="$(pedir POST "/rpc/$fn" "$T_AD" "$REG" -)"
    case "$c" in 403|404) ok "H3 authenticated (administración) POST /rpc/$fn: $c (sin EXECUTE)";; *) fallo "H3 admin /rpc/$fn: $c $(cat "$TMP/h.body")";; esac
  done
  c="$(pedir POST /rpc/registrar_personas_cotizacion "$T_SR" "$REG" -)"
  [ "$c" = 200 ] && json x 'r.nuevos===0' && ok "H4 service_role (credencial de servidor) sí ejecuta la fachada: 200" || fallo "H4 service_role: $c $(cat "$TMP/h.body")"
  for t in "-:anon" "$T_AD:administración"; do
    c="$(pedir GET "/cotizacion_participantes?select=*" "${t%%:*}" - -)"
    case "$c" in 401|403) ok "H5 ${t#*:} GET /cotizacion_participantes: $c (cerrada)";; *) fallo "H5 ${t#*:} GET: $c $(cat "$TMP/h.body")";; esac
  done
  LISTA='{"p_tenant":null,"p_texto":null,"p_limite":50,"p_offset":0}'
  c="$(pedir POST /rpc/crm_personas_cotizacion_buscar "$T_AD" "$LISTA" -)"
  [ "$c" = 200 ] && json x 'r.total===6' && ok "H6 lista CRM, administración: 6 puestos del tenant" || fallo "H6: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/crm_personas_cotizacion_buscar "$T_VA" "$LISTA" -)"
  [ "$c" = 200 ] && json x "r.total===2&&r.items.every(i=>i.cotizacion.id===$QVA)" && ok "H7 lista CRM, venta: solo los 2 puestos de su cotización" || fallo "H7: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/crm_personas_cotizacion_buscar "$T_AG" "$LISTA" -)"
  [ "$c" = 200 ] && json x 'r.total===2&&r.items.every(i=>i.persona_id===null)&&!JSON.stringify(r).includes("Titularva")' \
    && ok "H8 lista CRM, agencia: solo sus 2 puestos, sin persona_id" || fallo "H8: $c $(cat "$TMP/h.body")"
  VACIA='r.total===0&&r.has_more===false&&r.items.length===0&&Object.keys(r).length===3'
  for t in "$T_IN:inactivo" "$T_CV:control_vuelo"; do
    c="$(pedir POST /rpc/crm_personas_cotizacion_buscar "${t%%:*}" "$LISTA" -)"
    [ "$c" = 200 ] && json x "$VACIA" && ok "H9 lista CRM, ${t#*:}: vacía idéntica" || fallo "H9 ${t#*:}: $c $(cat "$TMP/h.body")"
  done
  c="$(pedir POST /rpc/crm_personas_cotizacion_buscar - "$LISTA" -)"
  [ "$c" = 401 ] && ok "H10 lista CRM sin token: 401" || fallo "H10: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/crm_personas_cotizacion_buscar "$T_GE" "$LISTA" -)"
  [ "$c" = 200 ] && json x "$VACIA" && ok "H11a gerencia sin p_tenant: vacía" || fallo "H11a: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/crm_personas_cotizacion_buscar "$T_GE" '{"p_tenant":"mayorista","p_limite":50,"p_offset":0}' -)"
  [ "$c" = 200 ] && json x 'r.total===6' && ok "H11b gerencia con p_tenant explícito: 6" || fallo "H11b: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/buscar_personas_documento "$T_AG" '{"p_tenant":null,"p_tipo_doc":"CC","p_numero":"78000001"}' -)"
  [ "$c" = 200 ] && json x 'r.persona===null&&r.total===0' && ok "H12 consulta global 214 sigue cerrada a B2B (vacío)" || fallo "H12: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/buscar_personas_documento "$T_VA" '{"p_tenant":null,"p_tipo_doc":"CC","p_numero":"78000002"}' -)"
  [ "$c" = 200 ] && json x 'r.total===1&&r.observaciones[0].cotizacion_id!==null' \
    && ok "H13 venta por la consulta 214: el pasajero solo de su cotización (1), con su cotización de origen" || fallo "H13: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/upsert_persona "$T_AD" '{}' 'Content-Profile: p214_priv')"
  [ "$c" = 406 ] && ok "H14 p214_priv por Content-Profile: 406 (no expuesto)" || fallo "H14: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/crm_personas_cotizacion_buscar "$T_MAL" "$LISTA" -)"
  [ "$c" = 401 ] && ok "H15 token firmado con otro secreto: 401" || fallo "H15: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/crm_personas_cotizacion_buscar "$T_AD" '{"p_tenant":null,"p_limite":51,"p_offset":0}' -)"
  [ "$c" = 400 ] && grep -q 22023 "$TMP/h.body" && ok "H16 p_limite 51: 400 (22023)" || fallo "H16: $c $(cat "$TMP/h.body")"
  docker rm -f "$PGRST" >/dev/null 2>&1 || true
fi

echo "------------------------------------------------------------"
echo "Resultado: $OKS OK, $FALLOS FALLO(S)"
if [ "$FALLOS" = 0 ]; then echo "TEST 219 PERSONAS COTIZACIONES: TODO OK"; else echo "TEST 219 PERSONAS COTIZACIONES: $FALLOS FALLO(S)"; exit 1; fi
