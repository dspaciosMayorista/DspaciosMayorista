#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# PRUEBA LOCAL · migración 214 (#32) — runner de integración sobre la migración REAL:
# carreras entre sesiones, ciclo preflight/postcheck, prueba SQL, rollback y API con JWT.
# Bases y contenedores DESECHABLES y locales; nunca una base remota, Preview ni Producción.
#
# Reproducción completa, solo con archivos versionados (desde dspacios-travel/):
#   docker network create red214
#   docker run -d --name pg214_sb --network red214 -e POSTGRES_PASSWORD=postgres \
#     public.ecr.aws/supabase/postgres:15.8.1.085
#   sh supabase/scripts/preparar_esquema_local.sh pg214_sb 213 plantilla214sb   # 001-213, SIN la 214
#   sh supabase/scripts/test_214_personas_carreras.sh pg214_sb plantilla214sb red214
#   node --test --experimental-strip-types pruebas/personasIdentidad.test.ts pruebas/personasConsulta.wiring.test.ts
#
# Uso (desde dspacios-travel/):
#   [ROL_ADMIN=..] [ROL_MIGRA=..] sh supabase/scripts/test_214_personas_carreras.sh <contenedor> [plantilla] [red]
#     contenedor  Postgres local con roles anon/authenticated/service_role/authenticator y auth.uid():
#                 la imagen de Supabase preparada con preparar_esquema_local.sh (lo recomendado), u otro
#                 Postgres con un andamiaje equivalente. ROL_ADMIN (superusuario; por defecto
#                 supabase_admin) prepara y verifica; ROL_MIGRA (por defecto postgres) aplica la 214 y
#                 debe ser como el `postgres` de Supabase: NO superusuario y con BYPASSRLS.
#     plantilla   base con el esquema vigente y SIN la 214 (por defecto plantilla214). Solo se lee.
#     red         red Docker del contenedor para levantar un PostgREST propio (por defecto red214).
#                 SIN_API=1 omite las pruebas HTTP (y lo dice).
#
#   M   preflight sin bloqueantes → 214 aplicada dos veces (idempotente) → postcheck 20/20 →
#       regresión: policies, funciones, ACL/RLS de tablas, esquemas, disparadores y ACL por defecto
#       ajenos a la 214 idénticos antes y después (207 sigue cerrando crm_contactos; 202 intacta)
#   S   test_214_personas_identidad.sql (vectores, escritores, integridad, permisos, consulta)
#   K   carreras reales: compuerta con candado consultivo; B debe quedar en pg_stat_activity
#       esperando un Lock de A antes de que A confirme o aborte (sin pg_sleep como sincronizador)
#   RB  rollback: aborta con datos (1/0/0, 1/1/0, 1/1/n), FK ajena, referencia blanda (también
#       invisible en information_schema para un rol sin privilegios), vista; escritura concurrente
#       con compuerta (espera el LOCK; procede si la inserción aborta, aborta si confirma); con todo
#       vacío elimina, postcheck en rojo y la 214 se reaplica
#   H   PostgREST local con JWT HS256 firmados: tablas cerradas, consulta por rol, firmas malas,
#       token vencido, payload alterado, esquema privado no expuesto, usuario desactivado
#
# Límite: las pruebas HTTP demuestran que PostgREST rechaza firmas, vencimientos y claims
# alterados con el secreto LOCAL; no prueban la configuración de claves ni la emisión de tokens
# de GoTrue en Supabase real.
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla214}"
RED="${3:-red214}"
export MSYS_NO_PATHCONV=1

valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_214_personas_carreras.sh <contenedor> [plantilla] [red]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
valido "$RED" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Red inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
MIG="$APP/supabase/migrations/20260601000214_personas_identidad.sql"
VECTORES="$APP/pruebas/fixtures/personasIdentidad.vectores.json"
PW="${PGPASSWORD_214:-postgres}"
# ROL_ADMIN: superusuario local para preparar y verificar. ROL_MIGRA: el rol que aplica la 214, como
# el `postgres` de Supabase (NO superusuario, con BYPASSRLS). En la imagen de Supabase son
# supabase_admin y postgres; en un Postgres simple, el superusuario y un rol equivalente.
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-postgres}"
valido "$ROL_ADMIN" '^[a-z_][a-z0-9_]{0,62}$' && valido "$ROL_MIGRA" '^[a-z_][a-z0-9_]{0,62}$' || { echo "Roles inválidos." >&2; exit 2; }
PSA="docker exec -i -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_ADMIN -X -q -v ON_ERROR_STOP=1"
PSP="docker exec -i -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_MIGRA -X -q -v ON_ERROR_STOP=1"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_214 $SUF"
DBM="t214_mig_$SUF"
PGRST="pgrst214_$SUF"
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
    # Con reintentos: bajo presión de memoria un psql puede no arrancar (fork) y una base puede seguir
    # ocupada un instante; nunca se omite una base en silencio. Solo se borra lo que lleva la marca.
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
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PSA -d "$PLANTILLA" -t -A -c "select (to_regclass('public.personas') is null and to_regnamespace('p214_priv') is null)::int")" = 1 ] \
  || { echo "La plantilla ya tiene la 214: usa una sin ella." >&2; exit 2; }

crear_base() { # $1 = nombre ; deja la base marcada para borrarla al final
  # La plantilla puede estar ocupada un instante (autovacuum, una conexión que aún se cierra): se
  # reintenta como en preparar_esquema_local.sh, sin cerrar conexiones ajenas.
  cb_i=1
  until $PSA -d postgres -c "create database $1 template $PLANTILLA" >/dev/null 2>"$TMP/cb.err"; do
    [ "$cb_i" -lt 8 ] || { cat "$TMP/cb.err" >&2; return 1; }
    cb_i=$((cb_i + 1)); sleep 2
  done
  BASES="$BASES $1"
  $PSA -d postgres -c "comment on database $1 is '$MARCA'" >/dev/null
  # Entorno: en Supabase alojado el rol de migración (`postgres`) crea esquemas en su base y tablas
  # en `public`. Aquí la base la crea ROL_ADMIN y queda como su dueña; en PG15 `public` pertenece a
  # pg_database_owner, así que ROL_MIGRA no podría crear en él. Se le concede lo mismo que tiene en
  # Supabase (preparación del entorno, no esquema de la app; M7 toma su huella DESPUÉS de esto).
  $PSA -d postgres -c "grant create on database $1 to $ROL_MIGRA" >/dev/null
  $PSA -d "$1" -c "grant create on schema public to $ROL_MIGRA" >/dev/null
  # Entorno: la imagen supabase/postgres sin el servicio de Auth trae el auth.uid() antiguo, que solo
  # lee `request.jwt.claim.sub`; PostgREST v10+ deja el JWT en `request.jwt.claims`. Se pone la
  # definición de Supabase alojado (lee los dos), como hacen local-desde-cero.sh y test_207_api_*.
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
aplicar_214() { $PSP -d "$1" < "$MIG" > "$TMP/aplicar.out" 2>&1; }
huella_ajena() { # $1 = base ; lo que la 214 NO debe tocar, por catálogo (una línea por familia)
  $PSA -d "$1" -t -A <<'SQL'
select 'policies=' || md5(coalesce(string_agg(format('%s.%s.%s|%s|%s|%s|%s', schemaname, tablename, policyname, cmd, roles, qual, with_check),
                                              E'\n' order by schemaname, tablename, policyname), '')) || ' n=' || count(*)
  from pg_policies;
select 'funciones=' || md5(coalesce(string_agg(p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid)) || '|'
                                               || coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner),
                                               E'\n' order by p.oid::regprocedure::text), '')) || ' n=' || count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.prokind in ('f', 'p') and n.nspname not in ('pg_catalog', 'information_schema', 'p214_priv') and n.nspname !~ '^pg_'
   and p.oid is distinct from to_regprocedure('public.buscar_personas_documento(text,text,text,integer,integer)');
select 'tablas=' || md5(coalesce(string_agg(c.oid::regclass::text || '|' || c.relkind::text || '|' || coalesce(c.relacl::text, '') || '|'
                                            || c.relrowsecurity || '|' || c.relforcerowsecurity || '|' || pg_get_userbyid(c.relowner),
                                            E'\n' order by c.oid::regclass::text), '')) || ' n=' || count(*)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema', 'p214_priv') and n.nspname !~ '^pg_'
   and c.oid <> all (array_remove(array[to_regclass('public.personas')::oid, to_regclass('public.persona_capturas')::oid,
                                        to_regclass('public.persona_observaciones')::oid], null));
select 'disparadores=' || md5(coalesce(string_agg(t.tgrelid::regclass::text || '|' || t.tgname || '|' || t.tgenabled::text || '|' || t.tgfoid::regprocedure::text,
                                                  E'\n' order by t.tgrelid::regclass::text, t.tgname), '')) || ' n=' || count(*)
  from pg_trigger t
 where not t.tgisinternal
   and t.tgrelid <> all (array_remove(array[to_regclass('public.personas')::oid, to_regclass('public.persona_capturas')::oid,
                                           to_regclass('public.persona_observaciones')::oid], null));
select 'esquemas=' || md5(coalesce(string_agg(n.nspname || '|' || coalesce(n.nspacl::text, '') || '|' || pg_get_userbyid(n.nspowner),
                                              E'\n' order by n.nspname), '')) || ' n=' || count(*)
  from pg_namespace n where n.nspname <> 'p214_priv' and n.nspname !~ '^pg_';
select 'acl_defecto=' || md5(coalesce(string_agg(d.defaclrole::regrole::text || '|' || d.defaclnamespace::regnamespace::text || '|'
                                                 || d.defaclobjtype::text || '|' || d.defaclacl::text,
                                                 E'\n' order by d.defaclrole::regrole::text, d.defaclnamespace::regnamespace::text, d.defaclobjtype), ''))
       || ' n=' || count(*)
  from pg_default_acl d;
select 'crm_contactos: policies=' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'crm_contactos')
       || ' rls=' || coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.crm_contactos')), 'n/a')
       || ' anon_select=' || coalesce(has_table_privilege('anon', to_regclass('public.crm_contactos'), 'select')::text, 'n/a');
SQL
}
# Preflight y postcheck devuelven UNA fila consolidada. Nada se da por bueno si la salida no es
# exactamente esa fila, con todos los códigos una vez y en orden, y con veredicto y conteos coherentes
# con el resumen: una línea de ERROR, un código faltante o un conteo distinto la invalidan.
# preflight: veredicto|bloqueantes|revisar|chequeos|resumen(P1=NIVEL/n;...;P10=..)|mensaje|detalle
pf_valido() {
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
pf() { # $1 = salida del preflight, $2 = código ; imprime NIVEL/cantidad
  awk -F'|' -v c="$2" 'NR == 1 { n = split($5, t, ";"); for (i = 1; i <= n; i++) { split(t[i], kv, "="); if (kv[1] == c) print kv[2] } }' "$1"
}
# postcheck: veredicto|ok|fallos|chequeos|fallidos|resumen(C1=t;...;C20=t)|filas|detalle
pc_valido() {
  [ "$(wc -l < "$1" | tr -d ' ')" = 1 ] || return 1
  awk -F'|' '
    NR == 1 {
      if ($1 != "OK" && $1 != "FALLA") { mal = 1; exit }
      if ($4 != 20) { mal = 1; exit }
      n = split($6, t, ";"); if (n != 20) { mal = 1; exit }
      nt = 0; nf = 0; fl = ""
      for (i = 1; i <= n; i++) {
        if (t[i] !~ /^C[0-9]+=[tf]$/) { mal = 1; exit }
        split(t[i], kv, "="); if (kv[1] != "C" i) { mal = 1; exit }
        if (kv[2] == "t") nt++; else { nf++; fl = fl (fl == "" ? "" : ",") kv[1] }
      }
      if ($2 != nt || $3 != nf) { mal = 1; exit }
      if ($5 != (nf == 0 ? "ninguno" : fl)) { mal = 1; exit }
      if ((nf == 0) != ($1 == "OK")) { mal = 1; exit }
      if ($7 !~ /^Filas: / || $8 !~ /^\[/) { mal = 1; exit }
      bien = 1
    }
    END { exit (mal || !bien) }' "$1"
}
postcheck_ok() { # $1 = base ; imprime ok/fallos de la fila consolidada, o "invalido"
  $PSA -d "$1" -t -A -F'|' < "$AQUI/postcheck_214_personas_identidad.sql" > "$TMP/post.out" 2>&1 || true
  if pc_valido "$TMP/post.out"; then cut -d'|' -f2,3 "$TMP/post.out" | tr '|' '/'; else echo invalido; fi
}

# ══ F · el analizador del formato consolidado no da falsos verdes (sin base de datos) ══════
PCV="OK|20|0|20|ninguno|C1=t;C2=t;C3=t;C4=t;C5=t;C6=t;C7=t;C8=t;C9=t;C10=t;C11=t;C12=t;C13=t;C14=t;C15=t;C16=t;C17=t;C18=t;C19=t;C20=t|Filas: personas=0|[]"
PFV="INFO|0|1|10|P1=INFO/5;P2=INFO/0;P3=INFO/3;P4=INFO/2;P5=INFO/0;P6=INFO/0;P7=REVISAR/1;P8=INFO/0;P9=INFO/1;P10=INFO/1|PREFLIGHT: sin bloqueantes|[]"
f_rechaza() { # $1 = nombre, $2 = validador, $3 = contenido
  printf '%s\n' "$3" > "$TMP/f.out"
  if "$2" "$TMP/f.out"; then fallo "$1 ACEPTADO (falso verde)"; else ok "$1 rechazado"; fi
}
printf '%s\n' "$PCV" > "$TMP/f.out"; pc_valido "$TMP/f.out" && ok "F1 postcheck bien formado: aceptado" || fallo "F1 postcheck bien formado rechazado"
printf '%s\n' "$PFV" > "$TMP/f.out"; pf_valido "$TMP/f.out" && [ "$(pf "$TMP/f.out" P7)" = REVISAR/1 ] && ok "F2 preflight bien formado: aceptado (P7=REVISAR/1)" || fallo "F2 preflight bien formado rechazado"
f_rechaza "F3 postcheck vacío:" pc_valido ""
f_rechaza "F4 postcheck con una línea de ERROR añadida:" pc_valido "$PCV
ERROR:  algo falló"
f_rechaza "F5 postcheck OK con una verificación en f:" pc_valido "$(printf '%s' "$PCV" | sed 's/C7=t/C7=f/')"
f_rechaza "F6 postcheck con 19 verificaciones:" pc_valido "$(printf '%s' "$PCV" | sed 's/;C20=t//')"
f_rechaza "F7 postcheck con conteo ok que no cuadra:" pc_valido "$(printf '%s' "$PCV" | sed 's/^OK|20|/OK|19|/')"
f_rechaza "F8 postcheck FALLA con fallidos incorrectos:" pc_valido "$(printf '%s' "$PCV" | sed 's/^OK|20|0|20|ninguno|/FALLA|19|1|20|C8|/; s/C7=t/C7=f/')"
f_rechaza "F9 preflight INFO con un BLOQUEANTE en el resumen:" pf_valido "$(printf '%s' "$PFV" | sed 's/P3=INFO/P3=BLOQUEANTE/')"
f_rechaza "F10 preflight sin P10:" pf_valido "$(printf '%s' "$PFV" | sed 's/;P10=INFO\/1//')"
f_rechaza "F11 preflight con códigos fuera de orden:" pf_valido "$(printf '%s' "$PFV" | sed 's/P1=INFO\/5;P2=INFO\/0/P2=INFO\/0;P1=INFO\/5/')"
f_rechaza "F12 preflight con revisar que no cuadra:" pf_valido "$(printf '%s' "$PFV" | sed 's/^INFO|0|1|/INFO|0|0|/')"

# ══ M · ciclo de la migración ══════════════════════════════════════════════════════════════
crear_base "$DBM"
$PSP -d "$DBM" -t -A -F'|' < "$AQUI/preflight_214_personas_identidad.sql" > "$TMP/pre1.out" 2>&1 || true
if pf_valido "$TMP/pre1.out" && [ "$(cut -d'|' -f1,2 "$TMP/pre1.out")" = "INFO|0" ] \
   && [ "$(pf "$TMP/pre1.out" P4)" = INFO/2 ] && [ "$(pf "$TMP/pre1.out" P5)" = INFO/0 ]; then
  ok "M1 preflight como $ROL_MIGRA: sin bloqueantes (P4: lee usuarios y ventas sin RLS; P5: 214 no aplicada)"
else fallo "M1 preflight: $(tr '\n' ' ' < "$TMP/pre1.out" | cut -c1-600)"; fi
huella_ajena "$DBM" > "$TMP/ajena0.out" 2>&1
if aplicar_214 "$DBM"; then ok "M2 214 aplicada como $ROL_MIGRA (no superusuario, BYPASSRLS)"; else fallo "M2 214: $(cut -c1-400 "$TMP/aplicar.out")"; exit 1; fi
if aplicar_214 "$DBM"; then ok "M3 214 aplicada por segunda vez sin error (idempotente)"; else fallo "M3 segunda aplicación: $(cut -c1-400 "$TMP/aplicar.out")"; fi
R="$(postcheck_ok "$DBM")"
[ "$R" = "20/0" ] && ok "M4 postcheck 20/20 (fila consolidada: $(cut -d'|' -f1 "$TMP/post.out"))" || fallo "M4 postcheck ok/fallos=$R: $(cut -d'|' -f1-5 "$TMP/post.out" | tr '\n' ' ' | cut -c1-300)"
$PSP -d "$DBM" -t -A -F'|' < "$AQUI/preflight_214_personas_identidad.sql" > "$TMP/pre2.out" 2>&1 || true
pf_valido "$TMP/pre2.out" && [ "$(cut -d'|' -f1,2 "$TMP/pre2.out")" = "INFO|0" ] && [ "$(pf "$TMP/pre2.out" P5)" = REVISAR/4 ] \
  && ok "M5 preflight tras aplicar: P5 'ya aplicada' (REVISAR), sin bloqueantes" || fallo "M5 $(cut -d'|' -f1-5 "$TMP/pre2.out" | tr '\n' ' ' | cut -c1-400)"
pc_valido "$TMP/post.out" && cut -d'|' -f7 "$TMP/post.out" | grep -q '^Filas: personas=0 · capturas=0 · observaciones=0' \
  && ok "M6 recién aplicada: 0/0/0 filas (no importa históricos)" || fallo "M6 $(cut -d'|' -f7 "$TMP/post.out")"
huella_ajena "$DBM" > "$TMP/ajena1.out" 2>&1
if [ "$(grep -c '=' "$TMP/ajena0.out")" = 7 ] && cmp -s "$TMP/ajena0.out" "$TMP/ajena1.out"; then
  ok "M7 regresión: objetos ajenos idénticos antes y después ($(tr '\n' ';' < "$TMP/ajena1.out" | sed -E 's/=[0-9a-f]{32}//g'))"
else fallo "M7 regresión: $(diff "$TMP/ajena0.out" "$TMP/ajena1.out" | tr '\n' ' ' | cut -c1-500)"; fi

# ══ S · prueba SQL sobre la migración real ═════════════════════════════════════════════════
# Por stdin (no `docker cp`): con MSYS_NO_PATHCONV=1 las rutas de Git Bash no llegan bien a
# ejecutables nativos de Windows; las redirecciones las resuelve la propia shell.
docker exec -i "$CT" sh -c 'cat > /tmp/personasIdentidad.vectores.json' < "$VECTORES"
if $PSA -d "$DBM" < "$AQUI/test_214_personas_identidad.sql" > "$TMP/sql.out" 2>&1 && grep -q "TEST 214 SQL: TODO OK" "$TMP/sql.out"; then
  ok "S1 prueba SQL: $(grep -c 'NOTICE:  OK' "$TMP/sql.out") verificaciones OK"
else
  fallo "S1 prueba SQL: $(grep -E 'FALLO|ERROR' "$TMP/sql.out" | head -3)"
fi
cp "$TMP/sql.out" "${SALIDA_SQL:-/dev/null}" 2>/dev/null || true

# ══ K · carreras reales ═══════════════════════════════════════════════════════════════════
SES() { # $1 = application_name, $2 = archivo de salida ; SQL por stdin
  docker exec -i -e PGPASSWORD="$PW" -e PGAPPNAME="$1" "$CT" psql -h 127.0.0.1 -U "$ROL_ADMIN" -d "$DBM" -X -q -t -A -v ON_ERROR_STOP=1 > "$2" 2>&1
}
cuando() { # $1 = consulta que devuelve 1 cuando se cumple ; $2 = máximo de intentos
  i=0
  while [ "$i" -lt "$2" ]; do
    r="$($PSA -d "$DBM" -t -A -c "$1" 2>/dev/null || echo 0)"
    [ "$r" = 1 ] && return 0
    sleep 1
    i=$((i + 1))
  done
  return 1
}
uno() { $PSA -d "$DBM" -t -A -c "$1"; }

# carrera nombre llave "sqlA" final_A "sqlB" : A ejecuta y se detiene en la compuerta con la
# transacción abierta; B debe quedar esperando un Lock de A; luego se abre la compuerta.
carrera() {
  n="$1"; k="$2"
  # Solo la compuerta se reintenta (no ejecuta nada de la 214): bajo presión de memoria su psql
  # puede no arrancar. A y B NUNCA se reintentan, para no ejecutar dos veces lo que se mide.
  g_intento=1
  while :; do
    printf 'select pg_advisory_lock(%s);\nselect pg_sleep(600);\n' "$k" | SES "${n}_g" "$TMP/$n.g" &
    pg=$!
    if cuando "select (count(*) = 1)::int from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.application_name = '${n}_g' and l.locktype = 'advisory' and l.granted" 30; then break; fi
    uno "select pg_terminate_backend(pid) from pg_stat_activity where application_name = '${n}_g'" >/dev/null 2>&1 || true
    wait "$pg" || true
    if [ "$g_intento" -ge 3 ]; then
      fallo "$n: la compuerta no tomó su candado en 3 intentos ($(tr '\n' ' ' < "$TMP/$n.g" | cut -c1-200))"; return 0
    fi
    g_intento=$((g_intento + 1))
  done
  printf 'set role service_role;\nbegin;\n%s\nselect pg_advisory_lock(%s);\n%s;\n' "$3" "$k" "$4" | SES "${n}_a" "$TMP/$n.a" &
  pa=$!
  if ! cuando "select (count(*) = 1)::int from pg_stat_activity where application_name = '${n}_a' and wait_event_type = 'Lock' and wait_event = 'advisory'" 90; then
    fallo "$n: A no llegó a la compuerta ($(cat "$TMP/$n.a"))"; uno "select pg_terminate_backend(pid) from pg_stat_activity where application_name like '${n}_%'" >/dev/null; wait "$pa" || true; wait "$pg" || true; return 0
  fi
  printf 'set role service_role;\n%s\n' "$5" | SES "${n}_b" "$TMP/$n.b" &
  pb=$!
  if cuando "select (count(*) = 1)::int from pg_stat_activity where application_name = '${n}_b' and wait_event_type = 'Lock' and wait_event <> 'advisory'" 90; then
    ESPERO=1
  else
    ESPERO=0
  fi
  uno "select pg_terminate_backend(pid) from pg_stat_activity where application_name = '${n}_g'" >/dev/null
  wait "$pa" || true; wait "$pb" || true; wait "$pg" || true
}
cap() { printf '00000000-0000-4000-c000-%012d' "$1"; }
alta_sql() { # captura tipo numero "obs-json"
  printf "select * from p214_priv.upsert_persona('%s', 'mayorista', 'captura_interna', %s, '%s', null, '%s');" "$(cap "$1")" "$2" "$3" "$4"
}
prom_sql() { # persona captura tipo numero
  printf "select * from p214_priv.promover_persona('%s', '%s', '%s', '%s');" "$1" "$(cap "$2")" "$3" "$4"
}
res() { grep -E '^[0-9a-f-]{36}\|' "$1" | head -1; }

# Fichas provisionales confirmadas para las promociones (K4-K6).
for i in 41 42 43 44 45; do
  printf 'set role service_role;\n%s\n' "$(alta_sql "$i" null "8800$i" '[{"campo":"nombres","valor":"Provisional"}]')" | SES "prep_$i" "$TMP/prep_$i" || fallo "preparación $i: $(cat "$TMP/prep_$i")"
done
F() { uno "select id from public.personas where clave_alta = '$(cap "$1")'"; }

carrera K1 214001 "$(alta_sql 1 "'CC'" 91000001 '[{"campo":"nombres","valor":"Igual"}]')" commit "$(alta_sql 2 "'CC'" 91.000.001 '[{"campo":"nombres","valor":"Igual"}]')"
A="$(res "$TMP/K1.a")"; B="$(res "$TMP/K1.b")"
if [ "$ESPERO" = 1 ] && [ "${A#*|}" = creada ] && [ "${B#*|}" = existente ] && [ "${A%%|*}" = "${B%%|*}" ] \
   && [ "$(uno "select count(*) || '/' || (select count(*) from public.persona_capturas c join public.personas p on p.id = c.persona_id where p.numero_norm = '91000001') || '/' || (select count(*) from public.persona_observaciones o join public.personas p on p.id = o.persona_id where p.numero_norm = '91000001' and o.valor = 'Igual') from public.personas where numero_norm = '91000001'")" = "1/2/2" ]; then
  ok "K1 dos altas documentadas de la misma clave (A confirma): B esperó, 'existente' con el mismo id; 1 persona, 2 capturas, 2 observaciones iguales sin colapsar (K11)"
else fallo "K1 espero=$ESPERO A=[$A] B=[$B] $(cat "$TMP/K1.b" | tr '\n' ' ')"; fi

carrera K2 214002 "$(alta_sql 3 "'CC'" 91000002 '[]')" rollback "$(alta_sql 4 "'CC'" 91000002 '[]')"
A="$(res "$TMP/K2.a")"; B="$(res "$TMP/K2.b")"
if [ "$ESPERO" = 1 ] && [ "${B#*|}" = creada ] && [ "$(uno "select count(*) from public.personas where numero_norm = '91000002'")" = 1 ] \
   && [ "$(uno "select persona_id from public.persona_capturas where id = '$(cap 4)'")" = "${B%%|*}" ]; then
  ok "K2 igual pero A aborta: B esperó y quedó 'creada' en la misma sentencia; 1 persona, sin duplicado"
else fallo "K2 espero=$ESPERO A=[$A] B=[$B] $(cat "$TMP/K2.b" | tr '\n' ' ')"; fi

carrera K3 214003 "$(alta_sql 5 null 91000003 '[{"campo":"nombres","valor":"Doble envio"}]')" commit "$(alta_sql 5 null 91000003 '[{"campo":"nombres","valor":"Doble envio"}]')"
A="$(res "$TMP/K3.a")"; B="$(res "$TMP/K3.b")"
if [ "$ESPERO" = 1 ] && [ "${A#*|}" = creada ] && [ "${B#*|}" = reintento ] && [ "${A%%|*}" = "${B%%|*}" ] \
   && [ "$(uno "select count(*) from public.personas where clave_alta = '$(cap 5)'")/$(uno "select count(*) from public.persona_capturas where id = '$(cap 5)'")" = "1/1" ]; then
  ok "K3 mismo evento provisional enviado dos veces a la vez: 1 ficha, 1 captura, B 'reintento' (sin ficha huérfana)"
else fallo "K3 espero=$ESPERO A=[$A] B=[$B] $(cat "$TMP/K3.b" | tr '\n' ' ')"; fi

carrera K3b 214004 "$(alta_sql 6 null 91000004 '[]')" commit "$(alta_sql 6 null 91000044 '[]')"
A="$(res "$TMP/K3b.a")"
if [ "$ESPERO" = 1 ] && grep -q 'clave_alta_reutilizada' "$TMP/K3b.b" && [ "$(uno "select count(*) from public.personas where clave_alta = '$(cap 6)'")" = 1 ]; then
  ok "K3b mismo id de captura con otros originales a la vez: clave_alta_reutilizada, nada escrito por B"
else fallo "K3b espero=$ESPERO A=[$A] $(cat "$TMP/K3b.b" | tr '\n' ' ')"; fi

F41="$(F 41)"; F42="$(F 42)"
SNAP="select md5(coalesce((to_jsonb(p) - 'updated_at')::text, '') || (select count(*) from public.persona_capturas where persona_id = p.id) || (select count(*) from public.persona_observaciones where persona_id = p.id)) from public.personas p where p.id = '$F42'"
ANTES="$(uno "$SNAP")"
carrera K4 214005 "$(prom_sql "$F41" 51 CC 91000005)" commit "$(prom_sql "$F42" 52 CC 91.000.005)"
A="$(res "$TMP/K4.a")"; B="$(res "$TMP/K4.b")"
if [ "$ESPERO" = 1 ] && [ "$A" = "$F41|promovida" ] && [ "$B" = "$F41|conflicto" ] && [ "$(uno "$SNAP")" = "$ANTES" ] \
   && [ "$(uno "select count(*) from public.persona_capturas where id = '$(cap 52)'")" = 0 ]; then
  ok "K4 dos promociones de fichas distintas a la misma clave: B esperó, 'conflicto' con el id ganador; la ficha de B intacta (huella igual), sin fusión"
else fallo "K4 espero=$ESPERO A=[$A] B=[$B] $(cat "$TMP/K4.b" | tr '\n' ' ')"; fi

F43="$(F 43)"
carrera K5 214006 "$(prom_sql "$F43" 53 CC 91000006)" commit "$(prom_sql "$F43" 54 CC 91000006)"
A="$(res "$TMP/K5.a")"; B="$(res "$TMP/K5.b")"
if [ "$ESPERO" = 1 ] && [ "$A" = "$F43|promovida" ] && [ "$B" = "$F43|ya_documentada" ]; then
  ok "K5 dos promociones de la MISMA ficha: B esperó su FOR UPDATE y vio 'ya_documentada'"
else fallo "K5 espero=$ESPERO A=[$A] B=[$B] $(cat "$TMP/K5.b" | tr '\n' ' ')"; fi

F44="$(F 44)"
carrera K6a 214007 "$(prom_sql "$F44" 55 CC 91000007)" commit "$(alta_sql 56 "'CC'" 91000007 '[]')"
A="$(res "$TMP/K6a.a")"; B="$(res "$TMP/K6a.b")"
if [ "$ESPERO" = 1 ] && [ "$A" = "$F44|promovida" ] && [ "$B" = "$F44|existente" ] && [ "$(uno "select count(*) from public.personas where numero_norm = '91000007'")" = 1 ]; then
  ok "K6a promoción primero, alta después a la misma clave: el alta esperó y obtuvo el id promovido ('existente')"
else fallo "K6a espero=$ESPERO A=[$A] B=[$B] $(cat "$TMP/K6a.b" | tr '\n' ' ')"; fi

F45="$(F 45)"
carrera K6b 214008 "$(alta_sql 57 "'CC'" 91000008 '[]')" commit "$(prom_sql "$F45" 58 CC 91000008)"
A="$(res "$TMP/K6b.a")"; B="$(res "$TMP/K6b.b")"
if [ "$ESPERO" = 1 ] && [ "${A#*|}" = creada ] && [ "$B" = "${A%%|*}|conflicto" ] && [ "$(uno "select estado_doc from public.personas where id = '$F45'")" = provisional ]; then
  ok "K6b alta primero, promoción después: la promoción esperó y devolvió 'conflicto'; su ficha sigue provisional"
else fallo "K6b espero=$ESPERO A=[$A] B=[$B] $(cat "$TMP/K6b.b" | tr '\n' ' ')"; fi

carrera K9 214009 "$(alta_sql 59 "'CC'" 91000009 '[{"campo":"nombres","valor":"Mismo evento"}]')" commit "$(alta_sql 59 "'CC'" 91000009 '[{"campo":"nombres","valor":"Mismo evento"}]')"
A="$(res "$TMP/K9.a")"; B="$(res "$TMP/K9.b")"
if [ "$ESPERO" = 1 ] && [ "${A#*|}" = creada ] && [ "$B" = "${A%%|*}|reintento" ] \
   && [ "$(uno "select count(*) from public.persona_capturas where id = '$(cap 59)'")/$(uno "select count(*) from public.persona_observaciones where captura_id = '$(cap 59)'")" = "1/1" ]; then
  ok "K9 mismo evento documentado enviado dos veces a la vez: 1 persona, 1 captura, 1 observación; B 'reintento'"
else fallo "K9 espero=$ESPERO A=[$A] B=[$B] $(cat "$TMP/K9.b" | tr '\n' ' ')"; fi

carrera K10 214010 "$(alta_sql 60 "'CC'" 91000010 '[{"campo":"nombres","valor":"Version A"}]')" commit "$(alta_sql 60 "'CC'" 91000010 '[{"campo":"nombres","valor":"Version B"}]')"
if [ "$ESPERO" = 1 ] && grep -q 'captura_inconsistente' "$TMP/K10.b" \
   && [ "$(uno "select string_agg(valor, ',') from public.persona_observaciones where captura_id = '$(cap 60)'")" = "Version A" ]; then
  ok "K10 mismo id de captura con otra carga a la vez: B esperó y recibió captura_inconsistente; queda solo la versión A"
else fallo "K10 espero=$ESPERO $(cat "$TMP/K10.b" | tr '\n' ' ')"; fi

printf 'set role service_role;\nbegin isolation level repeatable read;\n%s\nrollback;\n' "$(alta_sql 61 "'CC'" 91000011 '[]')" | SES k7 "$TMP/K7" || true
if grep -q 'aislamiento_no_admitido' "$TMP/K7" && [ "$(uno "select count(*) from public.personas where numero_norm = '91000011'")" = 0 ]; then
  ok "K7 escritura bajo REPEATABLE READ: aislamiento_no_admitido y nada escrito"
else fallo "K7 $(cat "$TMP/K7" | tr '\n' ' ')"; fi
echo "INFO  K8 (relectura que no encuentra la fila) NO se ejecuta: con borrado y cambio de clave bloqueados por disparadores es inalcanzable sin desactivarlos; el código conserva la defensa (alta_inconsistente)."

# ══ RB · rollback ═════════════════════════════════════════════════════════════════════════
rb() { # $1 = base ; ejecuta el rollback como postgres
  $PSP -d "$1" < "$AQUI/rollback_214_personas_identidad.sql" > "$TMP/rb.out" 2>&1
}
huella() { $PSA -d "$1" -t -A -c "select md5(coalesce((select string_agg(to_jsonb(p)::text, '|' order by id) from public.personas p), '') || coalesce((select string_agg(to_jsonb(c)::text, '|' order by id) from public.persona_capturas c), '') || coalesce((select string_agg(to_jsonb(o)::text, '|' order by id) from public.persona_observaciones o), ''))"; }

DBR="t214_rb_$SUF"; crear_base "$DBR"; aplicar_214 "$DBR" || fallo "RB preparación"
$PSA -d "$DBR" -c "insert into public.personas (tenant, tipo_doc_original, documento_original, clave_alta) values ('mayorista', null, '123', '$(cap 900)')" >/dev/null
H0="$(huella "$DBR")"
if ! rb "$DBR" && grep -q 'personas=1, capturas=0, observaciones=0' "$TMP/rb.out" && [ "$(huella "$DBR")" = "$H0" ]; then
  ok "RB1 con una persona sola: aborta (1/0/0) y no borra nada (huella idéntica)"
else fallo "RB1 $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" | head -2)"; fi
$PSA -d "$DBR" -c "insert into public.persona_capturas (id, persona_id, tenant, fuente, nivel) select '$(cap 901)', id, tenant, 'captura_interna', 'comercial' from public.personas" >/dev/null
H0="$(huella "$DBR")"
if ! rb "$DBR" && grep -q 'personas=1, capturas=1, observaciones=0' "$TMP/rb.out" && [ "$(huella "$DBR")" = "$H0" ]; then
  ok "RB2 con persona y captura sin observaciones: aborta (1/1/0) y no borra nada"
else fallo "RB2 $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" | head -2)"; fi
$PSA -d "$DBR" -c "insert into public.persona_observaciones (captura_id, persona_id, tenant, campo, valor) select id, persona_id, tenant, 'nombres', 'x' from public.persona_capturas" >/dev/null
H0="$(huella "$DBR")"
if ! rb "$DBR" && grep -q 'personas=1, capturas=1, observaciones=1' "$TMP/rb.out" && [ "$(huella "$DBR")" = "$H0" ] && [ "$(postcheck_ok "$DBR")" = "20/0" ]; then
  ok "RB3 con persona, captura y observación: aborta (1/1/1); datos y objetos intactos (postcheck 20/20)"
else fallo "RB3 $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" | head -2)"; fi

DBV="t214_rbv_$SUF"; crear_base "$DBV"; aplicar_214 "$DBV" || fallo "RB preparación vacía"
$PSA -d "$DBV" -c "create table public.t214_vinculo (id bigint, ref uuid references public.personas (id))" >/dev/null
if ! rb "$DBV" && grep -q '(4: FK ajenas' "$TMP/rb.out"; then ok "RB4 tabla ajena con FK hacia personas (vacía): aborta"; else fallo "RB4 $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" | head -2)"; fi
$PSA -d "$DBV" -c "drop table public.t214_vinculo; create table public.t214_blanda (captura_id uuid)" >/dev/null
# La tabla la crea ROL_ADMIN y se le retiran los privilegios a todos los roles. information_schema
# oculta una tabla a quien no tiene privilegios sobre ella (así falló la primera versión del rollback,
# que buscaba ahí); en Supabase `postgres` es miembro de pg_read_all_data y la ve igual, así que el
# punto ciego se demuestra con un rol sin privilegios (RB5c). Rollback y preflight usan pg_catalog.
$PSA -d "$DBV" -c "revoke all on public.t214_blanda from public, anon, authenticated, service_role, $ROL_MIGRA" >/dev/null
V="$($PSP -d "$DBV" -t -A -c "select count(*) from information_schema.columns where table_name = 't214_blanda'")"
if ! rb "$DBV" && grep -q '(5: referencias blandas: t214_blanda.captura_id' "$TMP/rb.out"; then
  ok "RB5 columna captura_id ajena sin FK y sin privilegios para nadie: aborta (information_schema le muestra $V columna(s) a $ROL_MIGRA)"
else fallo "RB5 V=$V $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" | head -2)"; fi
VC="$($PSA -d "$DBV" -t -A -c "set role anon; select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 't214_blanda') || '|' || (select count(*) from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 't214_blanda' and a.attname = 'captura_id' and a.attnum > 0 and not a.attisdropped)" 2>&1)"
[ "$VC" = "0|1" ] && ok "RB5c sin privilegios (anon), information_schema oculta la columna y pg_catalog la muestra (0|1): por eso rollback y preflight buscan en el catálogo" || fallo "RB5c anon information_schema|pg_catalog = $VC"

$PSP -d "$DBV" -t -A -F'|' < "$AQUI/preflight_214_personas_identidad.sql" > "$TMP/pre3.out" 2>&1 || true
pf_valido "$TMP/pre3.out" && [ "$(pf "$TMP/pre3.out" P7)" = REVISAR/1 ] && ok "RB5b el preflight (P7) también la ve como $ROL_MIGRA" || fallo "RB5b P7=$(pf "$TMP/pre3.out" P7) $(cut -d'|' -f1-4 "$TMP/pre3.out" | tr '\n' ' ' | cut -c1-200)"
$PSA -d "$DBV" -c "drop table public.t214_blanda; create view public.t214_vista as select id from public.personas" >/dev/null
if ! rb "$DBV" && grep -q '(6: objetos ajenos' "$TMP/rb.out"; then ok "RB6 vista ajena dependiente: aborta"; else fallo "RB6 $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" | head -2)"; fi
$PSA -d "$DBV" -c "drop view public.t214_vista" >/dev/null

# Escritura concurrente, sin pg_sleep como sincronizador: A inserta una persona con la transacción
# abierta y se detiene en una compuerta (candado consultivo de G); el rollback debe quedar esperando
# el LOCK de la tabla (pg_stat_activity); entonces se abre la compuerta y A aborta (RB7) o confirma
# (RB7b). El rollback trae lock_timeout de 10 s: la compuerta se abre en cuanto se ve la espera.
# rb_concurrente base final(rollback|commit) ; deja RBC_ESPERO (1/0), RBC_RC y la salida en $TMP/rb.out
cuando_en() { # $1 = base, $2 = consulta que devuelve 1, $3 = máximo de intentos
  ce_i=0
  while [ "$ce_i" -lt "$3" ]; do
    [ "$($PSA -d "$1" -t -A -c "$2" 2>/dev/null || echo 0)" = 1 ] && return 0
    sleep 1; ce_i=$((ce_i + 1))
  done
  return 1
}
rb_concurrente() {
  b="$1"; fin="$2"; RBC_ESPERO=0; RBC_RC=9
  g_intento=1
  while :; do
    printf 'select pg_advisory_lock(214700);\nselect pg_sleep(600);\n' | docker exec -i -e PGPASSWORD="$PW" -e PGAPPNAME=rbw_g "$CT" psql -h 127.0.0.1 -U "$ROL_ADMIN" -d "$b" -X -q -t -A > "$TMP/rbw.g" 2>&1 &
    pg=$!
    cuando_en "$b" "select (count(*) = 1)::int from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.application_name = 'rbw_g' and l.locktype = 'advisory' and l.granted" 30 && break
    $PSA -d "$b" -c "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'rbw_g'" >/dev/null 2>&1 || true
    wait "$pg" || true
    [ "$g_intento" -lt 3 ] || { echo "compuerta sin candado: $(tr '\n' ' ' < "$TMP/rbw.g" | cut -c1-200)" > "$TMP/rb.out"; return 0; }
    g_intento=$((g_intento + 1))
  done
  printf "begin;\ninsert into public.personas (tenant, tipo_doc_original, documento_original, clave_alta) values ('mayorista', null, '456', '%s');\nselect pg_advisory_lock(214700);\n%s;\n" "$(cap 902)" "$fin" \
    | docker exec -i -e PGPASSWORD="$PW" -e PGAPPNAME=rbw_a "$CT" psql -h 127.0.0.1 -U "$ROL_ADMIN" -d "$b" -X -q -t -A -v ON_ERROR_STOP=1 > "$TMP/rbw.a" 2>&1 &
  pa=$!
  if cuando_en "$b" "select (count(*) = 1)::int from pg_stat_activity where application_name = 'rbw_a' and wait_event_type = 'Lock' and wait_event = 'advisory'" 90; then
    docker exec -i -e PGPASSWORD="$PW" -e PGAPPNAME=rbw_rb "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$b" -X -q -v ON_ERROR_STOP=1 \
      < "$AQUI/rollback_214_personas_identidad.sql" > "$TMP/rb.out" 2>&1 &
    prb=$!
    cuando_en "$b" "select (count(*) = 1)::int from pg_stat_activity where application_name = 'rbw_rb' and wait_event_type = 'Lock' and wait_event <> 'advisory'" 30 && RBC_ESPERO=1
    $PSA -d "$b" -c "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'rbw_g'" >/dev/null 2>&1 || true
    if wait "$prb"; then RBC_RC=0; else RBC_RC=1; fi
  else
    echo "A no llegó a la compuerta: $(tr '\n' ' ' < "$TMP/rbw.a" | cut -c1-200)" > "$TMP/rb.out"
    $PSA -d "$b" -c "select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('rbw_g', 'rbw_a')" >/dev/null 2>&1 || true
  fi
  wait "$pa" || true; wait "$pg" || true
}
rb_concurrente "$DBV" rollback
if [ "$RBC_ESPERO" = 1 ] && [ "$RBC_RC" = 0 ] && grep -q 'ROLLBACK 214 COMPLETO' "$TMP/rb.out"; then
  ok "RB7 inserción concurrente sin confirmar: el rollback esperó su LOCK; A abortó y el rollback procedió sobre tablas vacías"
else fallo "RB7 espero=$RBC_ESPERO rc=$RBC_RC $(grep -E 'ERROR|NOTICE|compuerta|A no' "$TMP/rb.out" | head -2)"; fi
R="$(postcheck_ok "$DBV")"
if [ "$R" != invalido ] && [ "${R#*/}" -ge 17 ]; then ok "RB8 tras el rollback el postcheck queda en rojo ($R ok/fallos)"; else fallo "RB8 postcheck tras rollback: $R"; fi
if aplicar_214 "$DBV" && [ "$(postcheck_ok "$DBV")" = "20/0" ]; then ok "RB9 la 214 se reaplica sobre la base revertida: postcheck 20/20"; else fallo "RB9 reaplicar: $(cut -c1-300 "$TMP/aplicar.out")"; fi
# RB7b: la otra rama, en una base aparte (la fila confirmada no se puede borrar: sin borrado).
DBC="t214_rbc_$SUF"; crear_base "$DBC"; aplicar_214 "$DBC" || fallo "RB7b preparación"
rb_concurrente "$DBC" commit
if [ "$RBC_ESPERO" = 1 ] && [ "$RBC_RC" = 1 ] && grep -q 'personas=1, capturas=0, observaciones=0' "$TMP/rb.out" \
   && [ "$(postcheck_ok "$DBC")" = "20/0" ]; then
  ok "RB7b inserción concurrente que CONFIRMA: el rollback esperó su LOCK y luego abortó (1/0/0); objetos intactos (postcheck 20/20)"
else fallo "RB7b espero=$RBC_ESPERO rc=$RBC_RC $(grep -E 'ERROR|NOTICE|compuerta|A no' "$TMP/rb.out" | head -2)"; fi

# ══ H · API con JWT firmados (PostgREST local) ════════════════════════════════════════════
if [ "${SIN_API:-}" = 1 ]; then
  echo "INFO  H omitida por SIN_API=1 (las pruebas HTTP NO se ejecutaron)."
else
  DBA="t214_api_$SUF"; crear_base "$DBA"; aplicar_214 "$DBA" || fallo "H preparación"
  SECRETO="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  CLAVE_AUTH="auth_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  $PSA -d postgres -c "alter role authenticator with login password '$CLAVE_AUTH'" >/dev/null
  $PSA -d "$DBA" > "$TMP/seed.out" 2>&1 <<'SQL'
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000003', 'h_ad@x.test'), ('00000000-0000-4000-a000-000000000002', 'h_ge@x.test'),
  ('00000000-0000-4000-a000-000000000005', 'h_va@x.test'), ('00000000-0000-4000-a000-000000000006', 'h_vl@x.test'),
  ('00000000-0000-4000-a000-000000000009', 'h_ag@x.test'), ('00000000-0000-4000-a000-000000000011', 'h_in@x.test')
on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-4000-a000-000000000003', 'h_ad@x.test', 'Adan Admin', 'administracion', true, 'mayorista'),
  ('00000000-0000-4000-a000-000000000002', 'h_ge@x.test', 'Gina Gerente', 'gerencia', true, 'mayorista'),
  ('00000000-0000-4000-a000-000000000005', 'h_va@x.test', 'Ana Ruiz', 'venta', true, 'mayorista'),
  ('00000000-0000-4000-a000-000000000006', 'h_vl@x.test', 'Luis Mora', 'venta', true, 'mayorista'),
  ('00000000-0000-4000-a000-000000000009', 'h_ag@x.test', 'Agencia Uno', 'agencia', true, 'mayorista'),
  ('00000000-0000-4000-a000-000000000011', 'h_in@x.test', 'Ines Inactiva', 'venta', false, 'mayorista')
on conflict (id) do update set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol,
                               activo = excluded.activo, tenant = excluded.tenant;
insert into public.ventas (numero_contrato, cliente, asesor, tenant) values
  ('DTM-92143', 'Cliente', 'Ana Ruiz', 'mayorista'), ('DTM-92144', 'Cliente', 'Pedro Diaz', 'mayorista');
insert into public.contrato_pasajeros (numero_contrato, nombre) values ('DTM-92143', 'P1'), ('DTM-92144', 'P2');
set role service_role;
select * from p214_priv.upsert_persona('00000000-0000-4000-d000-000000000001', 'mayorista', 'captura_interna', 'CC', '1.020.304.050', null, '[{"campo":"nombres","valor":"Ana API"}]');
select * from p214_priv.upsert_persona('00000000-0000-4000-d000-000000000002', 'mayorista', 'contrato_pasajero', 'CC', '1020304050', null, '[{"campo":"nombres","valor":"Ana Maria API"}]', 'DTM-92143', (select id from public.contrato_pasajeros where numero_contrato = 'DTM-92143'));
select * from p214_priv.upsert_persona('00000000-0000-4000-d000-000000000003', 'mayorista', 'contrato_pasajero', 'CC', '1020304050', null, '[{"campo":"nombres","valor":"AJENO API"}]', 'DTM-92144', (select id from public.contrato_pasajeros where numero_contrato = 'DTM-92144'));
reset role;
SQL
  [ "$($PSA -d "$DBA" -t -A -c "select count(*) from public.persona_observaciones")" = 3 ] && ok "H0 datos de API sembrados por el escritor (3 observaciones)" || fallo "H0 siembra: $(tail -3 "$TMP/seed.out")"

  docker rm -f "$PGRST" >/dev/null 2>&1 || true
  docker run -d --name "$PGRST" --network "$RED" -p 127.0.0.1:3214:3000 \
    -e PGRST_DB_URI="postgres://authenticator:$CLAVE_AUTH@$CT:5432/$DBA" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" \
    public.ecr.aws/supabase/postgrest:v16.1 >/dev/null
  BASE="http://127.0.0.1:3214"
  i=0; while [ "$i" -lt 90 ]; do [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/" || true)" = 200 ] && break; sleep 1; i=$((i + 1)); done
  [ "$i" -lt 90 ] && ok "H1 PostgREST local listo con secreto JWT local" || fallo "H1 PostgREST no respondió: $(docker logs --tail 5 "$PGRST" 2>&1 | tr '\n' ' ')"

  b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
  firmar() { # $1 = payload JSON, $2 = secreto
    h="$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)"
    p="$(printf '%s' "$1" | b64url)"
    s="$(printf '%s' "$h.$p" | openssl dgst -sha256 -hmac "$2" -binary | b64url)"
    printf '%s.%s.%s' "$h" "$p" "$s"
  }
  ahora="$(date +%s)"
  tok() { firmar "{\"sub\":\"$1\",\"role\":\"authenticated\",\"aud\":\"authenticated\",\"exp\":$((ahora + 3600))}" "$SECRETO"; }
  T_AD="$(tok 00000000-0000-4000-a000-000000000003)"; T_GE="$(tok 00000000-0000-4000-a000-000000000002)"
  T_VA="$(tok 00000000-0000-4000-a000-000000000005)"; T_VL="$(tok 00000000-0000-4000-a000-000000000006)"
  T_AG="$(tok 00000000-0000-4000-a000-000000000009)"; T_IN="$(tok 00000000-0000-4000-a000-000000000011)"
  T_MAL="$(firmar "{\"sub\":\"00000000-0000-4000-a000-000000000003\",\"role\":\"authenticated\",\"exp\":$((ahora + 3600))}" "otro-secreto-que-no-es-el-local-214")"
  T_VENC="$(firmar "{\"sub\":\"00000000-0000-4000-a000-000000000003\",\"role\":\"authenticated\",\"exp\":$((ahora - 60))}" "$SECRETO")"
  T_ALT="$(printf '%s' "$T_VA" | cut -d. -f1).$(printf '%s' '{"sub":"00000000-0000-4000-a000-000000000003","role":"service_role"}' | b64url).$(printf '%s' "$T_VA" | cut -d. -f3)"
  T_SR="$(firmar "{\"role\":\"service_role\",\"exp\":$((ahora + 3600))}" "$SECRETO")"

  # El cuerpo va al archivo por redirección de la shell y el código HTTP por stderr (%{stderr}),
  # para no pasar rutas de Git Bash a curl ni a node.
  pedir() { # $1 método, $2 ruta, $3 token o '-', $4 cuerpo o '-', $5 encabezado extra o '-' ; deja el cuerpo en $TMP/h.body
    if [ "$3" = - ]; then AUTH="X-Sin-Token: 1"; else AUTH="Authorization: Bearer $3"; fi
    if [ "$5" = - ]; then EXTRA="X-T214: 1"; else EXTRA="$5"; fi
    if [ "$4" = - ]; then
      curl -s -w '%{stderr}%{http_code}' -X "$1" -H "$AUTH" -H "$EXTRA" "$BASE$2" 2>&1 >"$TMP/h.body" || echo 000
    else
      curl -s -w '%{stderr}%{http_code}' -X "$1" -H "$AUTH" -H "$EXTRA" -H 'Content-Type: application/json' -d "$4" "$BASE$2" 2>&1 >"$TMP/h.body" || echo 000
    fi
  }
  json() { node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8'));process.exit(($2)?0:1)" < "$TMP/h.body"; }
  CUERPO='{"p_tenant":null,"p_tipo_doc":"CC","p_numero":"1.020.304.050"}'
  VACIO='r.persona===null&&r.total===0&&r.has_more===false&&r.divergencia===false&&r.observaciones.length===0&&r.variantes.length===0&&Object.keys(r).length===6'

  for t in personas persona_capturas persona_observaciones; do
    c="$(pedir GET "/$t?select=*" - - -)"
    [ "$c" = 401 ] && ok "H2 anon GET /$t: 401" || fallo "H2 anon GET /$t: $c $(cat "$TMP/h.body")"
    c="$(pedir GET "/$t?select=*" "$T_AD" - -)"
    [ "$c" = 403 ] && grep -q 42501 "$TMP/h.body" && ok "H3 administración GET /$t: 403 (42501)" || fallo "H3 GET /$t: $c $(cat "$TMP/h.body")"
  done
  c="$(pedir POST /personas "$T_AD" '{"tenant":"mayorista","tipo_doc_original":"CC","documento_original":"1212121"}' -)"
  [ "$c" = 403 ] && ok "H4 administración POST /personas: 403" || fallo "H4 POST: $c $(cat "$TMP/h.body")"
  c="$(pedir PATCH "/persona_observaciones?campo=eq.nombres" "$T_AD" '{"valor":"x"}' -)"
  [ "$c" = 403 ] && ok "H5 administración PATCH /persona_observaciones: 403" || fallo "H5 PATCH: $c $(cat "$TMP/h.body")"
  c="$(pedir DELETE "/personas?tenant=eq.mayorista" "$T_AD" - -)"
  [ "$c" = 403 ] && ok "H6 administración DELETE /personas: 403" || fallo "H6 DELETE: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/buscar_personas_documento - "$CUERPO" -)"
  [ "$c" = 401 ] && ok "H7 anon POST /rpc/buscar_personas_documento: 401" || fallo "H7 anon rpc: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/buscar_personas_documento "$T_AD" "$CUERPO" -)"
  [ "$c" = 200 ] && json x 'r.total===3&&r.persona.tenant==="mayorista"' && ok "H8 administración: 200, total 3" || fallo "H8 admin: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/buscar_personas_documento "$T_VA" "$CUERPO" -)"
  [ "$c" = 200 ] && json x 'r.total===2&&!JSON.stringify(r).includes("AJENO")&&r.observaciones.every(o=>o.actor_rol===null)' && ok "H9 venta asesora: 200, total 2, nada del contrato ajeno, sin actor_rol" || fallo "H9 venta: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/buscar_personas_documento "$T_VL" "$CUERPO" -)"
  [ "$c" = 200 ] && json x 'r.total===1&&!JSON.stringify(r).includes("Ana Maria")' && ok "H10 venta sin contratos de esa persona: total 1" || fallo "H10: $c $(cat "$TMP/h.body")"
  for par in "$T_AG:agencia" "$T_IN:inactivo"; do
    c="$(pedir POST /rpc/buscar_personas_documento "${par%%:*}" "$CUERPO" -)"
    [ "$c" = 200 ] && json x "$VACIO" && ok "H11 ${par#*:}: 200 con la respuesta vacía idéntica" || fallo "H11 ${par#*:}: $c $(cat "$TMP/h.body")"
  done
  c="$(pedir POST /rpc/buscar_personas_documento "$T_VA" '{"p_tenant":"minorista","p_tipo_doc":"CC","p_numero":"1020304050"}' -)"
  [ "$c" = 200 ] && json x "$VACIO" && ok "H12 venta con p_tenant de la otra agencia: vacío idéntico" || fallo "H12: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/buscar_personas_documento "$T_GE" "$CUERPO" -)"
  [ "$c" = 200 ] && json x "$VACIO" && ok "H13a gerencia sin p_tenant: vacío" || fallo "H13a: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/buscar_personas_documento "$T_GE" '{"p_tenant":"mayorista","p_tipo_doc":"CC","p_numero":"1020304050"}' -)"
  [ "$c" = 200 ] && json x 'r.total===3' && ok "H13b gerencia con p_tenant mayorista explícito: total 3" || fallo "H13b: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/buscar_personas_documento "$T_MAL" "$CUERPO" -)"
  [ "$c" = 401 ] && ok "H14 token firmado con otro secreto: 401" || fallo "H14: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/buscar_personas_documento "$T_VENC" "$CUERPO" -)"
  [ "$c" = 401 ] && ok "H15 token vencido: 401" || fallo "H15: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/buscar_personas_documento "$T_ALT" "$CUERPO" -)"
  [ "$c" = 401 ] && ok "H16 payload alterado (sub y role) con la firma original: 401" || fallo "H16: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/buscar_personas_documento "$T_SR" "$CUERPO" -)"
  [ "$c" = 403 ] && ok "H17 token service_role sin sub: 403 (sin EXECUTE sobre la consulta)" || fallo "H17: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/upsert_persona "$T_AD" '{}' 'Content-Profile: p214_priv')"
  [ "$c" = 406 ] && ok "H18 esquema p214_priv por Content-Profile: 406 (no expuesto)" || fallo "H18: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/upsert_persona "$T_AD" '{}' -)"
  [ "$c" = 404 ] && ok "H19 /rpc/upsert_persona en public: 404 (no existe fuera de p214_priv)" || fallo "H19: $c $(cat "$TMP/h.body")"
  c="$(pedir POST /rpc/buscar_personas_documento "$T_AD" '{"p_tenant":null,"p_tipo_doc":"CC","p_numero":"1020304050","p_limite":51}' -)"
  [ "$c" = 400 ] && grep -q 22023 "$TMP/h.body" && ok "H20 p_limite 51: 400 (22023)" || fallo "H20: $c $(cat "$TMP/h.body")"
  $PSA -d "$DBA" -c "update public.usuarios set activo = false where id = '00000000-0000-4000-a000-000000000005'" >/dev/null
  c="$(pedir POST /rpc/buscar_personas_documento "$T_VA" "$CUERPO" -)"
  [ "$c" = 200 ] && json x "$VACIO" && ok "H21 usuario desactivado DESPUÉS de emitir su token: vacío aunque el token siga vigente" || fallo "H21: $c $(cat "$TMP/h.body")"
  c="$(pedir GET "/personas?select=tenant" "$T_SR" - -)"
  echo "INFO  H22 con la clave service_role la tabla personas es legible por la API (HTTP $c): es la credencial de servidor de #42; nunca va al navegador."
  docker rm -f "$PGRST" >/dev/null 2>&1 || true
fi

echo "------------------------------------------------------------"
echo "Resultado: $OKS OK, $FALLOS FALLO(S)"
if [ "$FALLOS" = 0 ]; then echo "TEST 214 CARRERAS/INTEGRACIÓN: TODO OK"; else echo "TEST 214 CARRERAS/INTEGRACIÓN: $FALLOS FALLO(S)"; exit 1; fi
