#!/bin/sh
# ─────────────────────────────────────────────────────────────
# PRUEBA · migración 221 (#68, Clientes de contratos en el CRM) — runner de integración sobre la migración REAL:
# ciclo preflight/postcheck, batería SQL, rollback y API con JWT. Bases y contenedores DESECHABLES (GitHub
# Actions); nunca una base remota.
#
# Reproducción (desde dspacios-travel/), como lo hace .github/workflows/test-221-clientes-contratos-68.yml:
#   docker network create red221
#   docker run -d --name pg221 --network red221 -e POSTGRES_PASSWORD=postgres supabase/postgres:15.8.1.085
#   sh supabase/scripts/preparar_esquema_local.sh pg221 219 plantilla221    # 001-219, SIN la 221 (ni la 220: no hace falta)
#   sh supabase/scripts/test_221_clientes_contratos_crm.sh pg221 plantilla221 red221
#
#   F   los analizadores de las filas consolidadas no dan falsos verdes (sin base)
#   M   preflight → 221 dos veces → postcheck 15/15 → preflight "ya aplicada"; postcheck 219/216/217 intactos;
#       objetos ajenos (políticas, funciones, tablas/ACL/RLS, disparadores, esquemas, ACL por defecto, vista
#       ventas_basica) idénticos antes y después
#   S   test_221_clientes_contratos_crm.sql (roles, tenant, guarda de homónimos, ficha, búsqueda, ACL)
#   RB  rollback: aborta si algo ajeno depende de las funciones; sin eso, deja la base como antes y la 221 se reaplica
#   H   PostgREST local con JWT HS256 firmados: otro tenant, otro asesor, homónimos, usuarios inactivos, roles sin
#       acceso, anon, service_role y token con secreto equivocado; respuesta «ajeno» idéntica a «inexistente»
#
# Rol que aplica: ROL_MIGRA (por defecto supabase_admin; en Supabase alojado es `postgres`). La 221 NO necesita
# la 220 (#67): en Producción la 220 se aplica antes por orden operativo, no por dependencia de objetos.
# Límite: las pruebas HTTP usan el secreto LOCAL; no prueban la emisión de tokens de GoTrue real.
# ─────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla221}"
RED="${3:-red221}"
export MSYS_NO_PATHCONV=1

valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_221_clientes_contratos_crm.sh <contenedor> [plantilla] [red]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
valido "$RED" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Red inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
MIG="$APP/supabase/migrations/20260601000221_clientes_contratos_crm.sql"
PW="${PGPASSWORD_221:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
valido "$ROL_ADMIN" '^[a-z_][a-z0-9_]{0,62}$' && valido "$ROL_MIGRA" '^[a-z_][a-z0-9_]{0,62}$' || { echo "Roles inválidos." >&2; exit 2; }
DIR_CT=/tmp/s221
PSA="docker exec -i -w $DIR_CT -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_ADMIN -X -q -v ON_ERROR_STOP=1"
PSM="docker exec -i -w $DIR_CT -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_MIGRA -X -q -v ON_ERROR_STOP=1"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_221 $SUF"
DBM="t221_mig_$SUF"
PGRST="pgrst221_$SUF"
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
for f in test_216_fixtures.sql test_221_clientes_contratos_crm.sql; do
  docker exec -i "$CT" sh -c "cat > $DIR_CT/$f" < "$AQUI/$f"
done
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PSA -d "$PLANTILLA" -t -A -c "select (to_regclass('public.cotizacion_participantes') is not null and to_regclass('public.ventas') is not null and to_regprocedure('public.crm_contratos_clientes_buscar(text,text,text,integer)') is null and to_regprocedure('public.soy_asesor_del_contrato(text)') is not null)")" = t ] \
  || { echo "La plantilla debe tener la cadena hasta la 219 y NO la 221." >&2; exit 2; }

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
aplicar_221() { $PSM -d "$1" < "$MIG" > "$TMP/aplicar.out" 2>&1; }
uno() { $PSA -d "$1" -t -A -c "$2"; }

# Lo que la 221 NO debe tocar: TODO salvo sus dos funciones. Una línea por familia (7).
huella_ajena() { # $1 = base
  $PSA -d "$1" -t -A <<'SQL'
select 'policies=' || md5(coalesce(string_agg(format('%s.%s.%s|%s|%s|%s|%s', schemaname, tablename, policyname, cmd, roles, qual, with_check),
                                              E'\n' order by schemaname, tablename, policyname), '')) || ' n=' || count(*)
  from pg_policies;
select 'funciones=' || md5(coalesce(string_agg(p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid)) || '|'
                                               || coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner),
                                               E'\n' order by p.oid::regprocedure::text), '')) || ' n=' || count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.prokind in ('f', 'p') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_'
   and p.proname not in ('crm_contratos_clientes_buscar', 'crm_contrato_cliente_ficha');
select 'tablas=' || md5(coalesce(string_agg(c.oid::regclass::text || '|' || c.relkind::text || '|' || coalesce(c.relacl::text, '') || '|'
                                            || c.relrowsecurity || '|' || c.relforcerowsecurity || '|' || pg_get_userbyid(c.relowner),
                                            E'\n' order by c.oid::regclass::text), '')) || ' n=' || count(*)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_';
select 'disparadores=' || md5(coalesce(string_agg(t.tgrelid::regclass::text || '|' || t.tgname || '|' || t.tgenabled::text || '|' || t.tgfoid::regprocedure::text,
                                                  E'\n' order by t.tgrelid::regclass::text, t.tgname), '')) || ' n=' || count(*)
  from pg_trigger t where not t.tgisinternal;
select 'esquemas=' || md5(coalesce(string_agg(n.nspname || '|' || coalesce(n.nspacl::text, '') || '|' || pg_get_userbyid(n.nspowner),
                                              E'\n' order by n.nspname), '')) || ' n=' || count(*)
  from pg_namespace n where n.nspname !~ '^pg_';
select 'acl_defecto=' || md5(coalesce(string_agg(d.defaclrole::regrole::text || '|' || d.defaclnamespace::regnamespace::text || '|'
                                                 || d.defaclobjtype::text || '|' || d.defaclacl::text,
                                                 E'\n' order by d.defaclrole::regrole::text, d.defaclnamespace::regnamespace::text, d.defaclobjtype), ''))
       || ' n=' || count(*)
  from pg_default_acl d;
select 'ventas_basica=' || md5(pg_get_viewdef('public.ventas_basica'::regclass, true)) || ' acl=' || md5(coalesce((select relacl::text from pg_class where oid = 'public.ventas_basica'::regclass), ''));
SQL
}

# Filas consolidadas: nada se da por bueno si la salida no es exactamente esa fila, con todos los códigos una vez y
# en orden, y con veredicto y conteos coherentes.
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
      if ($7 !~ /^\[/) { mal = 1; exit }
      bien = 1
    }
    END { exit (mal || !bien) }' "$1"
}
# Los postchecks de la 216/217/219 (y el de la 221) son filas distintas: 219 y 221 llevan 7 u 8 columnas.
# Para los AJENOS solo se mira ok/fallos (columnas 2 y 3) y se valida con pc_valido_ajeno (detalle en la col. 7 u 8).
pc_valido_ajeno() { # $1 archivo, $2 número de chequeos
  [ "$(wc -l < "$1" | tr -d ' ')" = 1 ] || return 1
  awk -F'|' -v N="$2" 'NR == 1 { if (($1 == "OK" || $1 == "FALLA") && $4 == N) bien = 1 } END { exit !bien }' "$1"
}
# Detalle de SOLO los controles que fallaron del postcheck 221 (jsonb de la fila en $TMP/post.out), para el log.
post_fallos() { grep -o '{[^{}]*"ok": false[^{}]*}' "$TMP/post.out" 2>/dev/null | tr '\n' ' ' | cut -c1-900; }
postcheck() { # $1 base, $2 script, $3 número de chequeos, $4 (opcional) "propio" ; imprime ok/fallos o "invalido" (deja la fila en $TMP/post.out)
  $PSA -d "$1" -t -A -F'|' < "$AQUI/$2" > "$TMP/post.out" 2>&1 || true
  if [ "${4:-}" = propio ]; then
    if pc_valido "$TMP/post.out" "$3"; then cut -d'|' -f2,3 "$TMP/post.out" | tr '|' '/'; else echo invalido; fi
  else
    if pc_valido_ajeno "$TMP/post.out" "$3"; then cut -d'|' -f2,3 "$TMP/post.out" | tr '|' '/'; else echo invalido; fi
  fi
}

# ══ F · analizadores (sin base) ═══════════════════════════════════════════
PCV="OK|15|0|15|ninguno|C1=t;C2=t;C3=t;C4=t;C5=t;C6=t;C7=t;C8=t;C9=t;C10=t;C11=t;C12=t;C13=t;C14=t;C15=t|[]"
PFV="INFO|0|1|10|P1=INFO/0;P2=INFO/0;P3=INFO/1;P4=INFO/0;P5=INFO/0;P6=INFO/2;P7=INFO/0;P8=INFO/0;P9=INFO/0;P10=REVISAR/0|PREFLIGHT: sin bloqueantes|[]"
f_rechaza() { printf '%s\n' "$3" > "$TMP/f.out"; if "$2" "$TMP/f.out" ${4:-}; then fallo "$1 ACEPTADO (falso verde)"; else ok "$1 rechazado"; fi; }
printf '%s\n' "$PCV" > "$TMP/f.out"; pc_valido "$TMP/f.out" 15 && ok "F1 postcheck bien formado: aceptado" || fallo "F1 postcheck bien formado rechazado"
printf '%s\n' "$PFV" > "$TMP/f.out"; pf_valido "$TMP/f.out" && [ "$(pf "$TMP/f.out" P10)" = REVISAR/0 ] && ok "F2 preflight bien formado: aceptado" || fallo "F2 preflight rechazado"
f_rechaza "F3 postcheck vacío:" pc_valido "" 15
f_rechaza "F4 postcheck con una línea de ERROR añadida:" pc_valido "$PCV
ERROR:  algo" 15
f_rechaza "F5 postcheck OK con un control en f:" pc_valido "$(printf '%s' "$PCV" | sed 's/C7=t/C7=f/')" 15
f_rechaza "F6 postcheck con un control de menos:" pc_valido "$(printf '%s' "$PCV" | sed 's/;C15=t//')" 15
f_rechaza "F7 postcheck con conteo ok que no cuadra:" pc_valido "$(printf '%s' "$PCV" | sed 's/^OK|15|/OK|14|/')" 15
f_rechaza "F8 preflight INFO con un BLOQUEANTE:" pf_valido "$(printf '%s' "$PFV" | sed 's/P3=INFO/P3=BLOQUEANTE/')"
f_rechaza "F9 preflight sin P10:" pf_valido "$(printf '%s' "$PFV" | sed 's/;P10=REVISAR\/0//')"
f_rechaza "F10 preflight con revisar que no cuadra:" pf_valido "$(printf '%s' "$PFV" | sed 's/^INFO|0|1|/INFO|0|0|/')"

# ══ M · ciclo de la migración ══════════════════════════════════════════════
crear_base "$DBM"
huella_ajena "$DBM" > "$TMP/ajena0.out" 2>&1
$PSM -d "$DBM" -t -A -F'|' < "$AQUI/preflight_221_clientes_contratos_crm.sql" > "$TMP/pre1.out" 2>&1 || true
if pf_valido "$TMP/pre1.out" && [ "$(cut -d'|' -f1,2 "$TMP/pre1.out")" = "INFO|0" ] && [ "$(pf "$TMP/pre1.out" P5)" = INFO/0 ] \
   && [ "$(pf "$TMP/pre1.out" P6)" = INFO/2 ] && [ "$(pf "$TMP/pre1.out" P3)" = INFO/1 ] && [ "$(pf "$TMP/pre1.out" P10)" = REVISAR/0 ]; then
  ok "M1 preflight como $ROL_MIGRA: sin bloqueantes (P5: 221 no aplicada; P6: rol que lee sin RLS; P3: enmascarado vigente; P10: 220 no detectada, solo REVISAR)"
else fallo "M1 preflight: $(tr '\n' ' ' < "$TMP/pre1.out" | cut -c1-600)"; fi
if aplicar_221 "$DBM"; then ok "M2 221 aplicada como $ROL_MIGRA"; else fallo "M2 221: $(cut -c1-600 "$TMP/aplicar.out")"; exit 1; fi
if aplicar_221 "$DBM"; then ok "M3 221 aplicada por segunda vez sin error (idempotente)"; else fallo "M3 segunda aplicación: $(cut -c1-400 "$TMP/aplicar.out")"; fi
R="$(postcheck "$DBM" postcheck_221_clientes_contratos_crm.sql 15 propio)"
[ "$R" = "15/0" ] && ok "M4 postcheck 221 15/15" || fallo "M4 postcheck 221 ok/fallos=$R: $(cut -d'|' -f1-5 "$TMP/post.out" | tr '\n' ' ' | cut -c1-300) detalle: $(post_fallos)"
$PSM -d "$DBM" -t -A -F'|' < "$AQUI/preflight_221_clientes_contratos_crm.sql" > "$TMP/pre2.out" 2>&1 || true
pf_valido "$TMP/pre2.out" && [ "$(cut -d'|' -f1,2 "$TMP/pre2.out")" = "INFO|0" ] && [ "$(pf "$TMP/pre2.out" P5)" = REVISAR/2 ] \
  && ok "M5 preflight tras aplicar: P5 'ya aplicada' (REVISAR), sin bloqueantes" || fallo "M5 $(cut -d'|' -f1-5 "$TMP/pre2.out" | tr '\n' ' ' | cut -c1-400)"
R="$(postcheck "$DBM" postcheck_219_personas_cotizaciones.sql 20)"
[ "$R" = "20/0" ] && ok "M6 postcheck 219 sigue 20/20 con la 221" || fallo "M6 postcheck 219 = $R"
R="$(postcheck "$DBM" postcheck_216_cotizacion_manual_edicion.sql 22)"
[ "$R" = "22/0" ] && ok "M7 postcheck 216 sigue 22/22 con la 221" || fallo "M7 postcheck 216 = $R"
R="$(postcheck "$DBM" postcheck_217_cotizacion_manual_cierre.sql 12)"
[ "$R" = "12/0" ] && ok "M8 postcheck 217 sigue 12/12 con la 221" || fallo "M8 postcheck 217 = $R"
huella_ajena "$DBM" > "$TMP/ajena1.out" 2>&1
if [ "$(grep -c '=' "$TMP/ajena0.out")" = 7 ] && cmp -s "$TMP/ajena0.out" "$TMP/ajena1.out"; then
  ok "M9 objetos ajenos idénticos antes y después (políticas, funciones, tablas/ACL/RLS, disparadores, esquemas, ACL por defecto y ventas_basica)"
else fallo "M9 la 221 tocó objetos ajenos: $(diff "$TMP/ajena0.out" "$TMP/ajena1.out" | head -6 | tr '\n' ' ')"; fi
[ "$(uno "$DBM" "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('crm_contratos_clientes_buscar','crm_contrato_cliente_ficha')")" = 2 ] \
  && ok "M10 la 221 agrega exactamente dos funciones y ninguna tabla" || fallo "M10 funciones de la 221"

# ══ S · batería SQL ════════════════════════════════════════════════════════
DBS="t221_sql_$SUF"; crear_base "$DBS"; aplicar_221 "$DBS" || fallo "S preparación: $(cut -c1-300 "$TMP/aplicar.out")"
if $PSA -d "$DBS" -f "$DIR_CT/test_221_clientes_contratos_crm.sql" > "$TMP/sql.out" 2>&1 && grep -q "TEST 221 SQL: TODO OK" "$TMP/sql.out" \
   && ! grep -q 'NOTICE:  FALLO' "$TMP/sql.out"; then
  ok "S1 prueba SQL 221: $(grep -c 'NOTICE:  OK' "$TMP/sql.out") verificaciones OK"
else
  fallo "S1 prueba SQL 221: $(grep -E 'FALLO|ERROR' "$TMP/sql.out" | head -5 | tr '\n' ' ')"
fi
grep -E 'NOTICE:  (OK|FALLO)' "$TMP/sql.out" | sed 's/^.*NOTICE:  /  /' || true

# ══ RB · rollback ══════════════════════════════════════════════════════════
DBR="t221_rb_$SUF"; crear_base "$DBR"; aplicar_221 "$DBR" || fallo "RB preparación: $(cut -c1-300 "$TMP/aplicar.out")"
rb() { $PSM -d "$1" < "$AQUI/rollback_221_clientes_contratos_crm.sql" > "$TMP/rb.out" 2>&1; }
$PSA -d "$DBR" -c "create view public.v221_dependiente as select * from public.crm_contrato_cliente_ficha('x')" >/dev/null 2>&1 \
  || fallo "RB0 no se pudo crear la vista dependiente de prueba"
if ! rb "$DBR" && grep -q 'ROLLBACK 221 ABORTADO' "$TMP/rb.out" \
   && [ "$(uno "$DBR" "select (to_regprocedure('public.crm_contrato_cliente_ficha(text)') is not null)::text")" = true ]; then
  ok "RB1 con una vista ajena que depende de la ficha: el rollback aborta y no borra nada"
else fallo "RB1 $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" | head -2)"; fi
$PSA -d "$DBR" -c "drop view public.v221_dependiente" >/dev/null 2>&1 || true
if rb "$DBR"; then ok "RB2 sin dependencias: el rollback corre"; else fallo "RB2 $(cut -c1-300 "$TMP/rb.out")"; fi
[ "$(uno "$DBR" "select count(*) from pg_proc where proname in ('crm_contratos_clientes_buscar','crm_contrato_cliente_ficha')")" = 0 ] \
  && ok "RB3 las dos funciones desaparecen" || fallo "RB3 quedaron funciones"
huella_ajena "$DBR" > "$TMP/ajena2.out" 2>&1
cmp -s "$TMP/ajena0.out" "$TMP/ajena2.out" && ok "RB4 tras el rollback la base es idéntica a la de antes de la 221 (7 familias)" \
  || fallo "RB4 diferencias tras el rollback: $(diff "$TMP/ajena0.out" "$TMP/ajena2.out" | head -4 | tr '\n' ' ')"
if rb "$DBR"; then ok "RB5 el rollback es idempotente"; else fallo "RB5 $(cut -c1-200 "$TMP/rb.out")"; fi
if aplicar_221 "$DBR"; then ok "RB6 la 221 se reaplica tras el rollback"; else fallo "RB6 $(cut -c1-300 "$TMP/aplicar.out")"; fi
R="$(postcheck "$DBR" postcheck_221_clientes_contratos_crm.sql 15 propio)"
[ "$R" = "15/0" ] && ok "RB7 postcheck 221 15/15 tras reaplicar" || fallo "RB7 postcheck = $R detalle: $(post_fallos)"

# ══ H · API con JWT firmados (PostgREST local) ═══════════════════════════════
if [ "${SIN_API:-}" = 1 ]; then
  echo "INFO  H omitida por SIN_API=1 (las pruebas HTTP NO se ejecutaron)."
else
  DBA="t221_api_$SUF"; crear_base "$DBA"; aplicar_221 "$DBA" || fallo "H preparación"
  SECRETO="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  CLAVE_AUTH="auth_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  $PSA -d postgres -c "alter role authenticator with login password '$CLAVE_AUTH'" >/dev/null
  $PSA -d "$DBA" > "$TMP/seed.out" 2>&1 <<'SQL'
insert into auth.users (id, email)
select ('00000000-0000-4000-a221-0000000000' || n)::uuid, 'h221_' || n || '@x.test'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1','b2','b3','b4']) n
on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-4000-a221-0000000000a1', 'h221_a1@x.test', 'Adan Admin',     'administracion', true,  'mayorista'),
  ('00000000-0000-4000-a221-0000000000a2', 'h221_a2@x.test', 'Gina Gerente',   'gerencia',       true,  'mayorista'),
  ('00000000-0000-4000-a221-0000000000a3', 'h221_a3@x.test', 'Olga Oper',      'operaciones',    true,  'mayorista'),
  ('00000000-0000-4000-a221-0000000000a4', 'h221_a4@x.test', 'Sara Super',     'superadmin',     true,  'mayorista'),
  ('00000000-0000-4000-a221-0000000000a5', 'h221_a5@x.test', 'Ana Venta',      'venta',          true,  'mayorista'),
  ('00000000-0000-4000-a221-0000000000a6', 'h221_a6@x.test', 'Beto Venta',     'venta',          true,  'mayorista'),
  ('00000000-0000-4000-a221-0000000000a7', 'h221_a7@x.test', ' ana venta ',    'venta',          true,  'mayorista'),
  ('00000000-0000-4000-a221-0000000000a8', 'h221_a8@x.test', 'Ines Inactiva',  'administracion', false, 'mayorista'),
  ('00000000-0000-4000-a221-0000000000a9', 'h221_a9@x.test', 'Agencia H',      'agencia',        true,  'mayorista'),
  ('00000000-0000-4000-a221-0000000000b1', 'h221_b1@x.test', 'Carlos Vuelo',   'control_vuelo',  true,  'mayorista'),
  ('00000000-0000-4000-a221-0000000000b2', 'h221_b2@x.test', 'Fran Freelance', 'freelance',      true,  'mayorista'),
  ('00000000-0000-4000-a221-0000000000b3', 'h221_b3@x.test', 'Mario Min Admin','administracion', true,  'minorista'),
  ('00000000-0000-4000-a221-0000000000b4', 'h221_b4@x.test', 'Mina Venta',     'venta',          true,  'minorista')
on conflict (id) do update set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol,
                               activo = excluded.activo, tenant = excluded.tenant;
insert into public.ventas (numero_contrato, asesor, cliente, cliente_documento, cliente_email, cliente_telefono, tenant, estado) values
  ('DTM-6901', 'Beto Venta', 'Cliente H Uno',    '90000001', 'h1@example.test', '3100000001', 'mayorista', 'activo'),
  ('DTM-6902', 'Ana Venta',  'Cliente H Dos',    '90000002', 'h2@example.test', '3100000002', 'mayorista', 'activo'),
  ('DTM-6903', null,         'Cliente H Tres',   '90000003', 'h3@example.test', '3100000003', 'mayorista', 'activo'),
  ('DTM-6904', 'Beto Venta', 'Cliente H Cuatro', '90000004', 'h4@example.test', '3100000004', 'mayorista', 'activo'),
  ('MIN-H221-0005', 'Mina Venta', 'Cliente H Cinco', '90000005', 'h5@example.test', '3100000005', 'minorista', 'activo'),
  ('MIN-H221-0006', 'Beto Venta', 'Cliente H Seis',  '90000006', 'h6@example.test', '3100000006', 'minorista', 'activo');
SQL
  [ "$(uno "$DBA" "select count(*) from public.ventas where numero_contrato ~ '^(DTM-690[1-4]|MIN-H221-000[56])$'")" = 6 ] && ok "H0 datos sembrados (13 usuarios, 6 contratos)" || fallo "H0 siembra: $(tail -3 "$TMP/seed.out" | tr '\n' ' ')"

  docker rm -f "$PGRST" >/dev/null 2>&1 || true
  docker run -d --name "$PGRST" --network "$RED" -p 127.0.0.1:3221:3000 \
    -e PGRST_DB_URI="postgres://authenticator:$CLAVE_AUTH@$CT:5432/$DBA" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" \
    ghcr.io/supabase/postgrest:v16.1 >/dev/null
  BASE="http://127.0.0.1:3221"
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
  tok() { firmar "{\"sub\":\"00000000-0000-4000-a221-0000000000$1\",\"role\":\"authenticated\",\"aud\":\"authenticated\",\"exp\":$((ahora + 3600))}" "$SECRETO"; }
  T_AD="$(tok a1)"; T_GE="$(tok a2)"; T_OP="$(tok a3)"; T_SU="$(tok a4)"; T_VA="$(tok a5)"; T_VB="$(tok a6)"; T_VC="$(tok a7)"
  T_IN="$(tok a8)"; T_AG="$(tok a9)"; T_CV="$(tok b1)"; T_FR="$(tok b2)"; T_AM="$(tok b3)"; T_VM="$(tok b4)"
  T_SR="$(firmar "{\"role\":\"service_role\",\"exp\":$((ahora + 3600))}" "$SECRETO")"
  T_MAL="$(firmar "{\"sub\":\"00000000-0000-4000-a221-0000000000a1\",\"role\":\"authenticated\",\"exp\":$((ahora + 3600))}" "otro-secreto-que-no-es-el-local-221")"

  pedir() { # $1 método, $2 ruta, $3 token o '-', $4 cuerpo o '-' ; deja el cuerpo en $TMP/h.body e imprime el estado
    if [ "$3" = - ]; then AUTH="X-Sin-Token: 1"; else AUTH="Authorization: Bearer $3"; fi
    if [ "$4" = - ]; then
      curl -s -w '%{stderr}%{http_code}' -X "$1" -H "$AUTH" "$BASE$2" 2>&1 >"$TMP/h.body" || echo 000
    else
      curl -s -w '%{stderr}%{http_code}' -X "$1" -H "$AUTH" -H 'Content-Type: application/json' -d "$4" "$BASE$2" 2>&1 >"$TMP/h.body" || echo 000
    fi
  }
  lista() { pedir POST /rpc/crm_contratos_clientes_buscar "$1" "$2"; }
  ficha() { pedir POST /rpc/crm_contrato_cliente_ficha "$1" "{\"p_numero_contrato\":\"$2\"}"; }
  # Números de contrato devueltos, separados por coma ('' si el arreglo está vacío); 'ERROR' si no es un arreglo JSON.
  nums() { node -e "let r;try{r=JSON.parse(require('fs').readFileSync(0,'utf8'))}catch(e){console.log('ERROR');process.exit(0)}console.log(Array.isArray(r)?r.map(x=>x.numero_contrato).sort().reverse().join(','):'ERROR')" < "$TMP/h.body"; }
  MAYO4="DTM-6904,DTM-6903,DTM-6902,DTM-6901"

  s="$(lista "$T_AD" '{"p_tenant":"minorista"}')"; n="$(nums)"
  [ "$s" = 200 ] && [ "$n" = "" ] && ok "H2 administración (mayorista) pide minorista por REST: 200 y vacío" || fallo "H2 s=$s nums=$n"
  s="$(lista "$T_AD" '{}')"; n="$(nums)"
  [ "$s" = 200 ] && [ "$n" = "$MAYO4" ] && ok "H3 administración sin p_tenant: sus 4 contratos de mayorista, ninguno de minorista" || fallo "H3 s=$s nums=$n"
  s="$(lista "$T_AD" '{"p_tenant":"mayorista","p_busqueda":"Cliente H"}')"; n="$(nums)"
  [ "$s" = 200 ] && [ "$n" = "$MAYO4" ] && ok "H4 administración con su propio p_tenant y búsqueda: 4 contratos" || fallo "H4 s=$s nums=$n"
  s="$(lista "$T_GE" '{"p_tenant":"minorista"}')"; n1="$(nums)"; s2="$(lista "$T_GE" '{}')"; n2="$(nums)"
  [ "$s" = 200 ] && [ "$n1" = "" ] && [ "$s2" = 200 ] && [ "$n2" = "$MAYO4" ] && ok "H5 gerencia (mayorista): pedir minorista da vacío (la vista le abre ambos, la función no); sin p_tenant, su tenant" || fallo "H5 n1=$n1 n2=$n2"
  s="$(lista "$T_OP" '{"p_tenant":"minorista"}')"; n="$(nums)"
  [ "$s" = 200 ] && [ "$n" = "" ] && ok "H6 operaciones pide minorista: vacío" || fallo "H6 s=$s nums=$n"
  s="$(lista "$T_AM" '{"p_tenant":"mayorista"}')"; n1="$(nums)"; s2="$(lista "$T_AM" '{}')"; n2="$(nums)"
  [ "$n1" = "" ] && [ "$n2" = "MIN-H221-0006,MIN-H221-0005" ] && ok "H7 administración de minorista: mayorista vacío; sin p_tenant, sus 2 contratos" || fallo "H7 n1=$n1 n2=$n2"
  s="$(lista "$T_SU" '{"p_tenant":"minorista"}')"; n1="$(nums)"; lista "$T_SU" '{"p_tenant":"mayorista"}' >/dev/null; n2="$(nums)"; lista "$T_SU" '{}' >/dev/null; n3="$(nums)"
  [ "$n1" = "MIN-H221-0006,MIN-H221-0005" ] && [ "$n2" = "$MAYO4" ] && [ "$n3" = "" ] && ok "H8 superadmin elige el tenant; sin p_tenant, vacío" || fallo "H8 n1=$n1 n2=$n2 n3=$n3"
  s="$(lista "$T_VB" '{}')"; n="$(nums)"
  [ "$s" = 200 ] && [ "$n" = "DTM-6904,DTM-6901" ] && ok "H9 venta B por REST: solo sus contratos de mayorista (no el de minorista con su mismo nombre de asesor)" || fallo "H9 s=$s nums=$n"
  s="$(lista "$T_VB" '{"p_tenant":"minorista"}')"; n="$(nums)"
  [ "$n" = "" ] && ok "H10 venta B pide minorista: vacío" || fallo "H10 nums=$n"
  s="$(lista "$T_VA" '{}')"; n1="$(nums)"; s2="$(lista "$T_VC" '{}')"; n2="$(nums)"
  [ "$s" = 200 ] && [ "$n1" = "" ] && [ "$n2" = "" ] && ok "H11 homónimos activos (Ana Venta y ' ana venta ') no ven el contrato ambiguo" || fallo "H11 n1=$n1 n2=$n2"
  s="$(lista "$T_VM" '{}')"; n="$(nums)"
  [ "$n" = "MIN-H221-0005" ] && ok "H12 venta de minorista: solo el suyo" || fallo "H12 nums=$n"

  # Contrato de OTRO asesor: ni la lista ni la búsqueda ni la ficha lo entregan, y la respuesta es idéntica a «no existe».
  for termino in "Cliente H Dos" "90000002" "h2@example" "3100000002" "DTM-6902"; do
    lista "$T_VB" "{\"p_busqueda\":\"$termino\"}" >/dev/null; n="$(nums)"
    [ "$n" = "" ] || fallo "H13 venta B encontró un contrato ajeno con el término '$termino': $n"
  done
  s_aj="$(lista "$T_VB" '{"p_busqueda":"Cliente H Dos"}')"; cp "$TMP/h.body" "$TMP/aj.body"
  s_no="$(lista "$T_VB" '{"p_busqueda":"ZzNoExiste221"}')"; cp "$TMP/h.body" "$TMP/no.body"
  [ "$s_aj" = "$s_no" ] && cmp -s "$TMP/aj.body" "$TMP/no.body" && ok "H13 buscar datos de un contrato ajeno: nada, y la respuesta es idéntica a buscar algo inexistente (estado y cuerpo)" || fallo "H13 respuestas distintas ($s_aj/$s_no)"
  s="$(ficha "$T_VB" DTM-6901)"; n="$(nums)"; [ "$s" = 200 ] && [ "$n" = "DTM-6901" ] && ok "H14 ficha de un contrato propio: una fila" || fallo "H14 s=$s nums=$n"
  s_aj="$(ficha "$T_VB" DTM-6902)"; cp "$TMP/h.body" "$TMP/aj.body"
  s_in="$(ficha "$T_VB" DTM-6999)"; cp "$TMP/h.body" "$TMP/in.body"
  s_ot="$(ficha "$T_VB" MIN-H221-0006)"; cp "$TMP/h.body" "$TMP/ot.body"
  if [ "$s_aj" = 200 ] && [ "$s_aj" = "$s_in" ] && [ "$s_aj" = "$s_ot" ] && cmp -s "$TMP/aj.body" "$TMP/in.body" && cmp -s "$TMP/ot.body" "$TMP/in.body" && [ "$(cat "$TMP/in.body")" = "[]" ]; then
    ok "H15 ficha de contrato de OTRO asesor, de OTRO tenant e inexistente: las tres respuestas son idénticas ([])"
  else fallo "H15 respuestas distintas ($s_aj/$s_in/$s_ot): $(cat "$TMP/aj.body" | cut -c1-100)"; fi
  s="$(ficha "$T_AD" MIN-H221-0005)"; n1="$(nums)"; s2="$(ficha "$T_AM" DTM-6901)"; n2="$(nums)"
  [ "$n1" = "" ] && [ "$n2" = "" ] && ok "H16 ficha de otro tenant por REST: vacío para administración de cada agencia" || fallo "H16 n1=$n1 n2=$n2"
  ficha "$T_GE" MIN-H221-0005 >/dev/null; n1="$(nums)"; ficha "$T_SU" MIN-H221-0005 >/dev/null; n2="$(nums)"
  [ "$n1" = "" ] && [ "$n2" = "MIN-H221-0005" ] && ok "H17 ficha de otro tenant: gerencia vacío, superadmin sí" || fallo "H17 n1=$n1 n2=$n2"

  # Sin acceso: inactivo, agencia, control_vuelo, freelance.
  todo=""
  for t in "$T_IN" "$T_AG" "$T_CV" "$T_FR"; do
    s="$(lista "$t" '{}')"; n="$(nums)"; [ "$s" = 200 ] && [ "$n" = "" ] || todo="$todo [lista s=$s n=$n]"
    s="$(ficha "$t" DTM-6901)"; n="$(nums)"; [ "$s" = 200 ] && [ "$n" = "" ] || todo="$todo [ficha s=$s n=$n]"
  done
  [ -z "$todo" ] && ok "H18 usuario inactivo, agencia, control_vuelo y freelance: 200 y vacío en lista y ficha" || fallo "H18$todo"

  s="$(lista - '{}')"; [ "$s" = 401 ] || [ "$s" = 403 ] && ok "H19 anon (sin token) no ejecuta la lista ($s)" || fallo "H19 s=$s"
  s="$(ficha - DTM-6901)"; [ "$s" = 401 ] || [ "$s" = 403 ] && ok "H20 anon no ejecuta la ficha ($s)" || fallo "H20 s=$s"
  s="$(lista "$T_SR" '{"p_tenant":"mayorista"}')"; [ "$s" = 401 ] || [ "$s" = 403 ] && ok "H21 service_role no ejecuta la lista ($s)" || fallo "H21 s=$s"
  s="$(ficha "$T_SR" DTM-6901)"; [ "$s" = 401 ] || [ "$s" = 403 ] && ok "H22 service_role no ejecuta la ficha ($s)" || fallo "H22 s=$s"
  s="$(lista "$T_MAL" '{}')"; [ "$s" = 401 ] && ok "H23 JWT con secreto equivocado: 401" || fallo "H23 s=$s"

  # p_tenant hostil y GET.
  todo=""
  for hostil in 'x' '' 'MAYORISTA' "mayorista' or '1'='1" 'minorista;drop table ventas'; do
    cuerpo="$(node -e 'console.log(JSON.stringify({p_tenant: process.argv[1]}))' "$hostil")"
    lista "$T_AD" "$cuerpo" >/dev/null; n="$(nums)"; [ "$n" = "" ] || todo="$todo [admin '$hostil' -> $n]"
  done
  s="$(pedir GET "/rpc/crm_contratos_clientes_buscar?p_tenant=minorista" "$T_AD" -)"; n="$(nums)"
  [ -z "$todo" ] && [ "$s" = 200 ] && [ "$n" = "" ] && ok "H24 p_tenant hostil o inválido (y GET con otro tenant): vacío" || fallo "H24$todo GET s=$s n=$n"
  [ "$(uno "$DBA" "select count(*) from public.ventas")" = 6 ] && ok "H25 ninguna llamada escribió datos (6 contratos)" || fallo "H25 cambió el número de contratos"
fi

echo
if [ "$FALLOS" -gt 0 ]; then
  echo "TEST 221 CLIENTES CONTRATOS: $FALLOS FALLO(S), $OKS OK"
  exit 1
fi
echo "TEST 221 CLIENTES CONTRATOS: TODO OK ($OKS verificaciones)"
