#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# PRUEBA · migraciones 216 (A) y 217 (B) de #39 — fases, batería SQL y rollback.
# Bases y contenedores DESECHABLES (CI con servicios efímeros, o local); nunca una base remota.
#
# Reproducción (desde dspacios-travel/):
#   docker run -d --name pg216 -e POSTGRES_PASSWORD=postgres supabase/postgres:15.8.1.085
#   sh supabase/scripts/preparar_esquema_local.sh pg216 214 plantilla216     # 001-214, SIN la 216
#   sh supabase/scripts/test_216_fases.sh pg216 plantilla216
#
#   F   los analizadores de las filas consolidadas no dan falsos verdes (sin base)
#   M   preflight → 216 (dos veces) → postcheck 22/22 → preflight "ya aplicada"; objetos ajenos intactos
#   A   fase A: la frontera NO actúa y la edición queda apagada; el código viejo y el nuevo funcionan;
#       la batería completa de la 211 y su postcheck pasan con la 216 aplicada
#   B   217 (dos veces) → postcheck 217 12/12 y 216 22/22 → batería SQL (test_216_edicion39.sql)
#       → prueba W (autorizada VOLATILE) → postcheck 211 → el código viejo falla cerrado
#   DV  desvíos: un disparador deshabilitado, un permiso devuelto o la réplica de sesión apagan la edición
#   RB  rollbacks: 217 tras uso real (conteos iguales, edición apagada) y se reaplica; 216 aborta con uso
#       real o con la 217 activa; 216 sin uso se retira por completo y se reaplica; 217 abortada a mitad
#       no deja nada. RB8: sobre la línea base REAL de Producción (P10=30, anon/authenticated sin
#       TRUNCATE), 216 → 217 → rollback 217 deja P10=30 y la misma matriz de permisos: nada ampliado
#
# Rol que aplica: ROL_MIGRA (por defecto supabase_admin, porque la plantilla de
# preparar_esquema_local.sh deja las tablas a su nombre; en Supabase alojado es `postgres`, dueño).
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla216}"
export MSYS_NO_PATHCONV=1
valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_216_fases.sh <contenedor> [plantilla]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
M216="$APP/supabase/migrations/20260601000216_cotizacion_manual_edicion_frontera.sql"
M217="$APP/supabase/migrations/20260601000217_cotizacion_manual_cierre_frontera.sql"
PW="${PGPASSWORD_216:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
valido "$ROL_ADMIN" '^[a-z_][a-z0-9_]{0,62}$' && valido "$ROL_MIGRA" '^[a-z_][a-z0-9_]{0,62}$' || { echo "Roles inválidos." >&2; exit 2; }
DIR_CT=/tmp/s216
PSA="docker exec -i -w $DIR_CT -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_ADMIN -X -q -v ON_ERROR_STOP=1"
PSM="docker exec -i -w $DIR_CT -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_MIGRA -X -q -v ON_ERROR_STOP=1"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_216 $SUF"
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
      m="$($PSA -d postgres -t -A -c "select coalesce((select shobj_description(oid, 'pg_database') from pg_database where datname = '$b'), '<ausente>')" 2>/dev/null || true)"
      [ "$m" = "$MARCA" ] && $PSA -d postgres -c "drop database if exists $b with (force)" >/dev/null 2>&1 || true
    done
  fi
  rm -rf "$TMP"
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
# Los scripts van al contenedor (por stdin, sin rutas de Windows) para que `\ir` funcione.
docker exec "$CT" sh -c "rm -rf $DIR_CT && mkdir -p $DIR_CT"
for f in test_216_fixtures.sql test_216_edicion39.sql test_216_autorizada_volatil.sql \
         test_211_fixtures.sql test_211_cotizaciones_comparativas.sql test_211_equivalencia_financiera.sql; do
  docker exec -i "$CT" sh -c "cat > $DIR_CT/$f" < "$AQUI/$f"
done
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PSA -d "$PLANTILLA" -t -A -c "select (to_regnamespace('p39_priv') is null and to_regclass('public.personas') is not null)::int")" = 1 ] \
  || { echo "La plantilla debe tener la 214 y NO la 216." >&2; exit 2; }

crear_base() { # $1 = nombre
  i=1
  until $PSA -d postgres -c "create database $1 template $PLANTILLA" >/dev/null 2>"$TMP/cb.err"; do
    [ "$i" -lt 8 ] || { cat "$TMP/cb.err" >&2; return 1; }
    i=$((i + 1)); sleep 2
  done
  BASES="$BASES $1"
  $PSA -d postgres -c "comment on database $1 is '$MARCA'" >/dev/null
  # Entorno (no esquema de la app): auth.uid()/auth.role() como en Supabase alojado (leen request.jwt.claims).
  $PSA -d "$1" >/dev/null <<'SQL'
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
aplicar() { # $1 base, $2 archivo
  $PSM -d "$1" < "$2" > "$TMP/aplicar.out" 2>&1
}
huella_ajena() { # lo que la 216/217 NO deben tocar (por catálogo)
  $PSA -d "$1" -t -A <<'SQL'
select 'policies=' || md5(coalesce(string_agg(format('%s.%s.%s|%s|%s|%s|%s', schemaname, tablename, policyname, cmd, roles, qual, with_check),
                                              E'\n' order by schemaname, tablename, policyname), '')) || ' n=' || count(*)
  from pg_policies where not (schemaname = 'public' and tablename = 'cotizacion_ediciones');
select 'funciones=' || md5(coalesce(string_agg(p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid)) || '|'
                                               || coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner),
                                               E'\n' order by p.oid::regprocedure::text), '')) || ' n=' || count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.prokind in ('f', 'p') and n.nspname not in ('pg_catalog', 'information_schema', 'p39_priv') and n.nspname !~ '^pg_'
   and p.proname not in ('crear_cotizacion_manual', 'editar_servicios_cotizacion_manual', 'actualizar_recobro_ninos_manual',
                         'registrar_pago_previo_rev', 'anular_pago_previo_controlado', 'convertir_cotizacion_manual_controlada',
                         'edicion_cotizaciones_habilitada');
select 'tablas=' || md5(coalesce(string_agg(c.oid::regclass::text || '|' || c.relkind::text || '|' || coalesce(c.relacl::text, '') || '|'
                                            || c.relrowsecurity || '|' || pg_get_userbyid(c.relowner),
                                            E'\n' order by c.oid::regclass::text), '')) || ' n=' || count(*)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema', 'p39_priv') and n.nspname !~ '^pg_'
   and c.relname <> 'cotizacion_ediciones';
select 'disparadores=' || md5(coalesce(string_agg(t.tgrelid::regclass::text || '|' || t.tgname || '|' || t.tgenabled::text || '|' || t.tgfoid::regprocedure::text,
                                                  E'\n' order by t.tgrelid::regclass::text, t.tgname), '')) || ' n=' || count(*)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where not t.tgisinternal and n.nspname <> 'p39_priv' and t.tgname !~ '_39(_|$)'
   and t.tgname not like 'trg_cotizacion_ediciones%';
select 'columnas_cotizaciones=' || md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum))
  from pg_attribute a where a.attrelid = 'public.cotizaciones'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'economico_rev';
SQL
}

# ── analizadores de las filas consolidadas (preflight: 10 chequeos; postcheck: N controles) ──
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
pc_valido() { # $1 archivo, $2 número de controles
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
      if ($7 !~ /^Filas: / || $8 !~ /^\[/) { mal = 1; exit }
      bien = 1
    }
    END { exit (mal || !bien) }' "$1"
}
preflight() { $PSM -d "$1" -t -A -F'|' < "$AQUI/preflight_216_cotizacion_manual_edicion.sql" > "$TMP/pre.out" 2>&1 || true; }
post216() { # imprime ok/fallos o "invalido"
  $PSA -d "$1" -t -A -F'|' < "$AQUI/postcheck_216_cotizacion_manual_edicion.sql" > "$TMP/p216.out" 2>&1 || true
  if pc_valido "$TMP/p216.out" 22; then cut -d'|' -f2,3 "$TMP/p216.out" | tr '|' '/'; else echo invalido; fi
}
post217() {
  $PSA -d "$1" -t -A -F'|' < "$AQUI/postcheck_217_cotizacion_manual_cierre.sql" > "$TMP/p217.out" 2>&1 || true
  if pc_valido "$TMP/p217.out" 12; then cut -d'|' -f2,3 "$TMP/p217.out" | tr '|' '/'; else echo invalido; fi
}
uno() { $PSA -d "$1" -t -A -c "$2"; }
sqlf() { # $1 base ; SQL por stdin (corre en $DIR_CT: puede usar \ir test_216_fixtures.sql)
  $PSA -d "$1" > "$TMP/sqlf.out" 2>&1
}

# ══ F · analizadores (sin base) ═══════════════════════════════════════════
PCV="OK|12|0|12|ninguno|C1=t;C2=t;C3=t;C4=t;C5=t;C6=t;C7=t;C8=t;C9=t;C10=t;C11=t;C12=t|Filas: x|[]"
PFV="INFO|0|1|10|P1=INFO/7;P2=INFO/3;P3=INFO/4;P4=INFO/4;P5=REVISAR/4;P6=INFO/0;P7=INFO/0;P8=INFO/0;P9=INFO/0;P10=INFO/24|PREFLIGHT: sin bloqueantes|[]"
f_rechaza() { printf '%s\n' "$3" > "$TMP/f.out"; if "$2" "$TMP/f.out" ${4:-}; then fallo "$1 ACEPTADO (falso verde)"; else ok "$1 rechazado"; fi; }
printf '%s\n' "$PCV" > "$TMP/f.out"; pc_valido "$TMP/f.out" 12 && ok "F1 postcheck bien formado: aceptado" || fallo "F1 postcheck bien formado rechazado"
printf '%s\n' "$PFV" > "$TMP/f.out"; pf_valido "$TMP/f.out" && [ "$(pf "$TMP/f.out" P5)" = REVISAR/4 ] && ok "F2 preflight bien formado: aceptado" || fallo "F2 preflight rechazado"
f_rechaza "F3 postcheck vacío:" pc_valido "" 12
f_rechaza "F4 postcheck con una línea de ERROR añadida:" pc_valido "$PCV
ERROR:  algo" 12
f_rechaza "F5 postcheck OK con un control en f:" pc_valido "$(printf '%s' "$PCV" | sed 's/C7=t/C7=f/')" 12
f_rechaza "F6 postcheck con un control de menos:" pc_valido "$(printf '%s' "$PCV" | sed 's/;C12=t//')" 12
f_rechaza "F7 postcheck de 12 leído como de 22:" pc_valido "$PCV" 22
f_rechaza "F8 preflight INFO con un BLOQUEANTE:" pf_valido "$(printf '%s' "$PFV" | sed 's/P3=INFO/P3=BLOQUEANTE/')"
f_rechaza "F9 preflight sin P10:" pf_valido "$(printf '%s' "$PFV" | sed 's/;P10=INFO\/24//')"

# ══ M · ciclo de la 216 ═══════════════════════════════════════════════════
DB="t216_fa_$SUF"; crear_base "$DB"
preflight "$DB"
if pf_valido "$TMP/pre.out" && [ "$(cut -d'|' -f1,2 "$TMP/pre.out")" = "INFO|0" ] && [ "$(pf "$TMP/pre.out" P5)" = INFO/0 ] && [ "$(pf "$TMP/pre.out" P4)" = INFO/4 ]; then
  ok "M1 preflight sin bloqueantes (P4: 198 intacta; P5: 216 no aplicada) — $(cut -d'|' -f5 "$TMP/pre.out")"
else fallo "M1 preflight: $(tr '\n' ' ' < "$TMP/pre.out" | cut -c1-600)"; fi
huella_ajena "$DB" > "$TMP/ajena0.out" 2>&1
if aplicar "$DB" "$M216"; then ok "M2 216 aplicada como $ROL_MIGRA"; else fallo "M2 216: $(cut -c1-600 "$TMP/aplicar.out")"; exit 1; fi
if aplicar "$DB" "$M216"; then ok "M3 216 aplicada por segunda vez (idempotente)"; else fallo "M3 segunda aplicación: $(cut -c1-400 "$TMP/aplicar.out")"; fi
R="$(post216 "$DB")"; [ "$R" = "22/0" ] && ok "M4 postcheck 216 22/22" || fallo "M4 postcheck 216 = $R: $(cut -d'|' -f1-5 "$TMP/p216.out" | tr '\n' ' ' | cut -c1-400)"
preflight "$DB"
pf_valido "$TMP/pre.out" && [ "$(cut -d'|' -f1,2 "$TMP/pre.out")" = "INFO|0" ] && [ "$(pf "$TMP/pre.out" P5)" = REVISAR/4 ] \
  && ok "M5 preflight tras aplicar: P5 'ya aplicada' (REVISAR), sin bloqueantes" || fallo "M5 $(cut -d'|' -f1-5 "$TMP/pre.out" | tr '\n' ' ')"
huella_ajena "$DB" > "$TMP/ajena1.out" 2>&1
if [ "$(grep -c '=' "$TMP/ajena0.out")" = 5 ] && cmp -s "$TMP/ajena0.out" "$TMP/ajena1.out"; then
  ok "M6 objetos ajenos a la 216 idénticos antes y después ($(tr '\n' ';' < "$TMP/ajena1.out" | sed -E 's/=[0-9a-f]{32}//g'))"
else fallo "M6 regresión: $(diff "$TMP/ajena0.out" "$TMP/ajena1.out" | tr '\n' ' ' | cut -c1-600)"; fi

# ══ A · fase A (solo la 216) ══════════════════════════════════════════════
RC=0
sqlf "$DB" <<'SQL' || RC=$?
\set ON_ERROR_STOP on
begin;
\ir test_216_fixtures.sql
do $$
declare c bigint; v text; r text; rev0 int;
begin
  perform t216.afirma('A1 sin la 217 la frontera no está activa y la edición está apagada',
    not p39_priv.frontera_activa() and t216.escalar('authenticated', t216.u('admin'), 'select public.edicion_cotizaciones_habilitada()::text') = 'false');
  c := t216.crear('admin');
  perform t216.afirma('A2 código nuevo en A: crear por la RPC funciona (con autor)', (select creado_por_id = t216.u('admin') from public.cotizaciones where id = c));
  perform t216.rechaza('A3 código nuevo en A: la edición se rechaza (apagada)', t216.intenta('service_role', null, t216.editar_sql(c, 'admin', t216.serv(600000))), 'EDICION_39_SUSPENDIDA');
  perform t216.pagar(c, 450000, 'a-pago');
  v := t216.escalar('service_role', null, t216.convertir_sql(c));
  perform t216.afirma('A4 código nuevo en A: pago y conversión por los wrappers', v ~ '^[A-Z]+-\d+$', v);
  -- Código viejo en A: escritura directa como hoy (la frontera no actúa todavía).
  r := t216.escalar('authenticated', t216.u('admin'), $q$ insert into public.cotizaciones (tenant, tipo, estado, payload, moneda, precio_venta, vigencia_hasta)
        values ('mayorista', 'manual', 'abierta', '{}', 'COP', 1000, public.fecha_negocio() + 3) returning id::text $q$);
  perform t216.afirma('A5 código viejo en A: crear una manual con la sesión sigue funcionando', r ~ '^\d+$', r);
  c := r::bigint;
  rev0 := t216.rev(c);
  perform t216.acepta('A6 código viejo en A: agregar servicios con la sesión sigue funcionando', t216.intenta('authenticated', t216.u('admin'),
    format('insert into public.cotizacion_servicios (cotizacion_id, tipo_servicio, nombre_servicio, valor) values (%s, ''hotel'', ''H'', 1000)', c)));
  perform t216.afirma('A6.1 …y la revisión económica ya sube (activa desde A)', t216.rev(c) > rev0, rev0 || ' -> ' || t216.rev(c));
  rev0 := t216.rev(c);
  perform t216.acepta('A7 hueco conocido hasta la 217: PATCH directo de precio pasa', t216.intenta('authenticated', t216.u('admin'),
    format('update public.cotizaciones set precio_venta = 1 where id = %s', c)));
  perform t216.afirma('A7.1 …pero sube la revisión, y la API no la puede fijar', t216.rev(c) = rev0 + 1
    and t216.intenta('authenticated', t216.u('admin'), format('update public.cotizaciones set economico_rev = 1 where id = %s', c)) = 'ok' and t216.rev(c) = rev0 + 1);
  r := t216.intenta('service_role', null, format('select public.registrar_pago_previo(%s, 1, ''COP'', 1, ''Transferencia'', ''R-A8'', public.fecha_negocio(), %L, ''a8'', %L::jsonb, %s, null)',
         c, t216.u('admin'), t216.snap(c), t216.exigido(c)));
  perform t216.acepta('A8 código viejo en A: la 198 directo sigue funcionando (compatibilidad del despliegue)', r);
end $$;
do $$
declare f int;
begin
  select count(*) into f from t216.res where not ok;
  if f > 0 then raise exception 'fase A: % fallo(s)', f; end if;
end $$;
rollback;
SQL
grep -E '^(NOTICE|psql).*(OK|FALLO) ' "$TMP/sqlf.out" | sed -E 's/^.*NOTICE:  //' || true
[ "$RC" = 0 ] && ok "A0 fase A sin fallos" || fallo "A0 fase A: $(grep -E 'FALLO|ERROR' "$TMP/sqlf.out" | head -5 | tr '\n' ' ')"

for s in test_211_cotizaciones_comparativas.sql test_211_equivalencia_financiera.sql; do
  if $PSA -d "$DB" -f "$DIR_CT/$s" > "$TMP/s211.out" 2>&1; then
    ok "A9 batería $s completa con la 216 aplicada ($(grep -c 'OK    ' "$TMP/s211.out") verificaciones)"
  else fallo "A9 $s: $(grep -E 'FALLO|ERROR' "$TMP/s211.out" | head -5 | tr '\n' ' ')"; fi
done
$PSA -d "$DB" -t -A < "$AQUI/postcheck_211_cotizaciones_comparativas.sql" > "$TMP/p211.out" 2>&1 || true
grep -q '"veredicto": "CORRECTO"' "$TMP/p211.out" && ok "A10 postcheck 211 CORRECTO con la 216" || fallo "A10 postcheck 211: $(cut -c1-400 "$TMP/p211.out")"

# ══ B · la 217 ════════════════════════════════════════════════════════════
if aplicar "$DB" "$M217"; then ok "B1 217 aplicada"; else fallo "B1 217: $(cut -c1-600 "$TMP/aplicar.out")"; exit 1; fi
if aplicar "$DB" "$M217"; then ok "B2 217 aplicada por segunda vez (idempotente)"; else fallo "B2: $(cut -c1-400 "$TMP/aplicar.out")"; fi
R="$(post217 "$DB")"; [ "$R" = "12/0" ] && ok "B3 postcheck 217 12/12" || fallo "B3 postcheck 217 = $R: $(cut -d'|' -f1-5 "$TMP/p217.out" | tr '\n' ' ')"
R="$(post216 "$DB")"; [ "$R" = "22/0" ] && ok "B4 postcheck 216 sigue 22/22 con la 217" || fallo "B4 postcheck 216 = $R: $(cut -d'|' -f1-5 "$TMP/p216.out" | tr '\n' ' ')"
if $PSA -d "$DB" -f "$DIR_CT/test_216_edicion39.sql" > "$TMP/sql.out" 2>&1 && grep -q "TEST 216 SQL: TODO OK" "$TMP/sql.out"; then
  ok "B5 batería SQL: $(grep -c 'NOTICE:  OK' "$TMP/sql.out") verificaciones OK"
else fallo "B5 batería SQL: $(grep -E 'FALLO|ERROR' "$TMP/sql.out" | head -8 | tr '\n' ' ' | cut -c1-1500)"; fi
grep -E 'NOTICE:  (OK|FALLO) ' "$TMP/sql.out" | sed -E 's/^.*NOTICE:  /  sql: /' || true
cp "$TMP/sql.out" "${SALIDA_SQL:-/dev/null}" 2>/dev/null || true
if $PSA -d "$DB" -f "$DIR_CT/test_216_autorizada_volatil.sql" > "$TMP/w.out" 2>&1 && grep -q "TEST 216 W: TODO OK" "$TMP/w.out"; then
  ok "B6 prueba W: $(grep -c 'NOTICE:  OK' "$TMP/w.out") verificaciones OK ($(grep -o 'INFO  S1 .*' "$TMP/w.out" | head -1))"
else fallo "B6 prueba W: $(grep -E 'FALLO|ERROR' "$TMP/w.out" | head -5 | tr '\n' ' ')"; fi
$PSA -d "$DB" -t -A < "$AQUI/postcheck_211_cotizaciones_comparativas.sql" > "$TMP/p211.out" 2>&1 || true
grep -q '"veredicto": "CORRECTO"' "$TMP/p211.out" && ok "B7 postcheck 211 CORRECTO con la 217" || fallo "B7 postcheck 211: $(cut -c1-400 "$TMP/p211.out")"

RC=0
sqlf "$DB" <<'SQL' || RC=$?
\set ON_ERROR_STOP on
begin;
\ir test_216_fixtures.sql
do $$
declare c bigint; r text;
begin
  perform t216.rechaza('B8 código viejo contra B: crear una manual con la sesión falla cerrado', t216.intenta('authenticated', t216.u('admin'),
    $q$ insert into public.cotizaciones (tenant, tipo, estado, payload, moneda, precio_venta, vigencia_hasta) values ('mayorista', 'manual', 'abierta', '{}', 'COP', 1, public.fecha_negocio() + 3) $q$), 'FRONTERA_39');
  c := t216.crear('admin');
  perform t216.rechaza('B8.1 código viejo: servicios con la sesión fallan', t216.intenta('authenticated', t216.u('admin'),
    format('insert into public.cotizacion_servicios (cotizacion_id, tipo_servicio, valor) values (%s, ''hotel'', 1)', c)), 'permission denied');
  perform t216.rechaza('B8.2 código viejo: pago directo a la 198 falla', t216.intenta('service_role', null,
    format('select public.registrar_pago_previo(%s, 100, ''COP'', 1, ''Transferencia'', ''R-B8'', public.fecha_negocio(), %L, ''b8'', %L::jsonb, %s, null)',
           c, t216.u('admin'), t216.snap(c), t216.exigido(c))), 'FRONTERA_39');
  perform t216.pagar(c, 450000, 'b8-legit');
  perform t216.rechaza('B8.3 código viejo: conversión directa a la 198 falla', t216.intenta('service_role', null,
    format('select public.convertir_cotizacion_a_contrato(%s, %L)', c, t216.u('admin'))), 'FRONTERA_39');
  perform t216.rechaza('B8.4 código viejo: recobro por UPDATE directo falla', t216.intenta('authenticated', t216.u('admin'),
    format('update public.cotizaciones set precio_venta = precio_venta + 1 where id = %s', c)), 'FRONTERA_39');
end $$;
do $$ declare f int; begin select count(*) into f from t216.res where not ok; if f > 0 then raise exception 'B8: % fallo(s)', f; end if; end $$;
rollback;
SQL
grep -E 'NOTICE:  (OK|FALLO) ' "$TMP/sqlf.out" | sed -E 's/^.*NOTICE:  /  /' || true
[ "$RC" = 0 ] && ok "B8 el código viejo falla cerrado contra B" || fallo "B8: $(grep -E 'FALLO|ERROR' "$TMP/sqlf.out" | head -5 | tr '\n' ' ')"

# ══ DV · desvíos posteriores apagan la edición ═══════════════════════════
hab() { uno "$DB" "select p39_priv.frontera_activa()::text || '/' || public.edicion_cotizaciones_habilitada()::text"; }
uno "$DB" "alter table public.cotizaciones disable trigger trg_cot_frontera_39" >/dev/null
[ "$(hab)" = "false/false" ] && ok "DV1 un disparador de frontera deshabilitado apaga la edición" || fallo "DV1 $(hab)"
uno "$DB" "alter table public.cotizaciones enable trigger trg_cot_frontera_39" >/dev/null
[ "$(hab)" = "true/true" ] && ok "DV2 rehabilitado: vuelve" || fallo "DV2 $(hab)"
uno "$DB" "grant insert on public.cotizacion_servicios to authenticated" >/dev/null
[ "$(hab)" = "false/false" ] && ok "DV3 un permiso devuelto (INSERT en servicios) apaga la edición" || fallo "DV3 $(hab)"
uno "$DB" "revoke insert on public.cotizacion_servicios from authenticated" >/dev/null
[ "$(hab)" = "true/true" ] && ok "DV4 retirado otra vez: vuelve" || fallo "DV4 $(hab)"
R="$(docker exec -i -e PGPASSWORD=$PW -e PGOPTIONS='-c session_replication_role=replica' "$CT" psql -h 127.0.0.1 -U "$ROL_ADMIN" -d "$DB" -X -q -t -A \
      -c "select p39_priv.frontera_activa()::text" 2>&1 || true)"
[ "$R" = false ] && ok "DV5 una sesión con session_replication_role=replica no ve la frontera activa (y no edita)" || fallo "DV5 $R"
# C21/C22 del postcheck 216 SÍ pueden fallar: se expone p39_priv por configuración guardada SOLO en
# esta base desechable (ALTER ROLE … IN DATABASE) y se retira enseguida.
uno "$DB" "alter role authenticated in database $DB set search_path = public, p39_priv" >/dev/null
R="$(post216 "$DB")"; FD="$(cut -d'|' -f5 "$TMP/p216.out")"
uno "$DB" "alter role authenticated in database $DB reset search_path" >/dev/null
[ "$R" = "21/1" ] && [ "$FD" = C22 ] && ok "DV6 p39_priv en el search_path de un rol: el postcheck 216 lo detecta (C22)" || fallo "DV6 $R fallidos=$FD"
uno "$DB" "alter role authenticator in database $DB set pgrst.db_schemas = 'public, graphql_public, p39_priv'" >/dev/null
R="$(post216 "$DB")"; FD="$(cut -d'|' -f5 "$TMP/p216.out")"
uno "$DB" "alter role authenticator in database $DB reset pgrst.db_schemas" >/dev/null
[ "$R" = "21/1" ] && [ "$FD" = C21 ] && ok "DV7 p39_priv en pgrst.db_schemas: el postcheck 216 lo detecta (C21)" || fallo "DV7 $R fallidos=$FD"
R="$(post216 "$DB")"; [ "$R" = "22/0" ] && ok "DV8 configuración retirada: postcheck 216 vuelve a 22/22" || fallo "DV8 $R"

# ══ RB · rollbacks ════════════════════════════════════════════════════════
c0="$(uno "$DB" "select count(*) || '/' || (select count(*) from public.cotizacion_pagos_previos) || '/' || (select count(*) from public.ventas) from public.cotizaciones")"
# Uso real en esta base (commit): una edición y un pago por las puertas nuevas.
RC=0
sqlf "$DB" <<'SQL' || RC=$?
\set ON_ERROR_STOP on
begin;
\ir test_216_fixtures.sql
select t216.crear('admin') as c \gset
select t216.escalar('service_role', null, t216.editar_sql(:c, 'admin', t216.serv(600000))) as r_ed \gset
select t216.pagar(:c, 450000, 'rb-uso') as p \gset
drop schema t216 cascade;
commit;
SQL
[ "$RC" = 0 ] && ok "RB0 uso real confirmado en la base (una edición y un pago por las puertas nuevas)" || fallo "RB0 $(tail -5 "$TMP/sqlf.out" | tr '\n' ' ')"
c1="$(uno "$DB" "select count(*) || '/' || (select count(*) from public.cotizacion_pagos_previos) || '/' || (select count(*) from public.ventas) from public.cotizaciones")"
if $PSM -d "$DB" < "$AQUI/rollback_217_cotizacion_manual_cierre.sql" > "$TMP/rb.out" 2>&1 && grep -q 'ROLLBACK 217 COMPLETO' "$TMP/rb.out"; then
  ok "RB1 rollback 217 tras uso real: completo (conteos iguales, edición apagada)"
else fallo "RB1 $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" | head -3 | tr '\n' ' ')"; fi
c2="$(uno "$DB" "select count(*) || '/' || (select count(*) from public.cotizacion_pagos_previos) || '/' || (select count(*) from public.ventas) from public.cotizaciones")"
[ "$c1" = "$c2" ] && [ "$(hab)" = "false/false" ] && [ "$(uno "$DB" "select has_table_privilege('authenticated', 'public.cotizacion_servicios', 'INSERT')::text")" = true ] \
  && ok "RB1.1 datos intactos ($c2), frontera y edición apagadas, permisos devueltos" || fallo "RB1.1 c1=$c1 c2=$c2 hab=$(hab)"
R="$(post217 "$DB")"; [ "$R" != invalido ] && [ "${R#*/}" -ge 1 ] && ok "RB1.2 postcheck 217 en rojo tras la retirada ($R)" || fallo "RB1.2 $R"
# Esta base parte de la plantilla del CI (permisos por defecto de Supabase, CON TRUNCATE para
# anon/authenticated). El rollback tampoco aquí los concede: queda en la línea base de Producción.
SEIS_TRUNCATE="select count(*) from (values ('anon'), ('authenticated')) rol_api(rol),
  (values ('public.cotizacion_servicios'), ('public.cotizacion_pagos_previos'), ('public.cotizacion_condiciones')) tabla(n)
  where has_table_privilege(rol_api.rol, tabla.n, 'TRUNCATE')"
preflight "$DB"; R="$(pf "$TMP/pre.out" P10)"
[ "$(uno "$DB" "$SEIS_TRUNCATE")" = 0 ] && [ "$R" = INFO/30 ] \
  && ok "RB1.4 el rollback no concede los seis TRUNCATE de anon/authenticated, ni aunque la base los trajera (P10 $R)" || fallo "RB1.4 TRUNCATE=$(uno "$DB" "$SEIS_TRUNCATE") P10=$R"
R="$(post216 "$DB")"; [ "$R" = "22/0" ] && ok "RB1.3 postcheck 216 sigue 22/22 (A intacta)" || fallo "RB1.3 $R"
if $PSM -d "$DB" < "$AQUI/rollback_217_cotizacion_manual_cierre.sql" > "$TMP/rb.out" 2>&1; then fallo "RB2 rollback 217 repetido no abortó"; else
  grep -q 'la 217 no está aplicada' "$TMP/rb.out" && ok "RB2 rollback 217 sin la 217: aborta" || fallo "RB2 $(grep ERROR "$TMP/rb.out" | head -2)"; fi
if $PSM -d "$DB" < "$AQUI/rollback_216_cotizacion_manual_edicion.sql" > "$TMP/rb.out" 2>&1; then fallo "RB3 rollback 216 con uso real NO abortó"; else
  grep -q 'hubo uso real' "$TMP/rb.out" && [ "$(post216 "$DB")" = "22/0" ] && ok "RB3 rollback 216 con uso real: aborta (forward-only) y no toca nada" || fallo "RB3 $(grep ERROR "$TMP/rb.out" | head -2)"; fi
if aplicar "$DB" "$M217" && [ "$(post217 "$DB")" = "12/0" ]; then ok "RB4 la 217 se reaplica tras su retirada (12/12)"; else fallo "RB4 $(cut -c1-300 "$TMP/aplicar.out")"; fi
if $PSM -d "$DB" < "$AQUI/rollback_216_cotizacion_manual_edicion.sql" > "$TMP/rb.out" 2>&1; then fallo "RB5 rollback 216 con la 217 activa NO abortó"; else
  grep -q 'corre primero rollback_217' "$TMP/rb.out" && ok "RB5 rollback 216 con la 217 activa: aborta" || fallo "RB5 $(grep ERROR "$TMP/rb.out" | head -2)"; fi
c3="$(uno "$DB" "select count(*) || '/' || (select count(*) from public.cotizacion_pagos_previos) || '/' || (select count(*) from public.ventas) from public.cotizaciones")"
[ "$c3" = "$c1" ] && ok "RB5.1 ningún rollback tocó datos ($c0 → $c3 solo por el uso real)" || fallo "RB5.1 $c1 vs $c3"

# 216 sin uso: se retira por completo y se reaplica.
DBV="t216_rv_$SUF"; crear_base "$DBV"
huella_ajena "$DBV" > "$TMP/v0.out" 2>&1
aplicar "$DBV" "$M216" || fallo "RB6 preparación: $(cut -c1-300 "$TMP/aplicar.out")"
if $PSM -d "$DBV" < "$AQUI/rollback_216_cotizacion_manual_edicion.sql" > "$TMP/rb.out" 2>&1 && grep -q 'ROLLBACK 216 COMPLETO' "$TMP/rb.out"; then
  ok "RB6 rollback 216 sin uso: completo"
else fallo "RB6 $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" | head -3 | tr '\n' ' ')"; fi
huella_ajena "$DBV" > "$TMP/v1.out" 2>&1
cmp -s "$TMP/v0.out" "$TMP/v1.out" && [ "$(uno "$DBV" "select (to_regnamespace('p39_priv') is null and to_regclass('public.cotizacion_ediciones') is null)::text")" = true ] \
  && ok "RB6.1 el catálogo volvió a como estaba antes de la 216" || fallo "RB6.1 $(diff "$TMP/v0.out" "$TMP/v1.out" | tr '\n' ' ' | cut -c1-400)"
R="$(post216 "$DBV")"; [ "$R" != invalido ] && [ "${R#*/}" -ge 10 ] && ok "RB6.2 postcheck 216 devuelve su fila en rojo sin la 216 ($R)" || fallo "RB6.2 $R $(cut -c1-300 "$TMP/p216.out")"
preflight "$DBV"; [ "$(pf "$TMP/pre.out" P5)" = INFO/0 ] && ok "RB6.3 preflight: P5 'no aplicada' otra vez" || fallo "RB6.3 $(cut -d'|' -f5 "$TMP/pre.out")"
if aplicar "$DBV" "$M216" && [ "$(post216 "$DBV")" = "22/0" ]; then ok "RB6.4 la 216 se reaplica: 22/22"; else fallo "RB6.4 $(cut -c1-300 "$TMP/aplicar.out")"; fi
# 217 abortada a mitad (réplica de sesión: la verificación final falla) → nada aplicado.
R="$(docker exec -i -e PGPASSWORD=$PW -e PGOPTIONS='-c session_replication_role=replica' "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DBV" -X -q -v ON_ERROR_STOP=1 < "$M217" 2>&1 || true)"
if printf '%s' "$R" | grep -q '217: la frontera no quedó activa' \
   && [ "$(uno "$DBV" "select (select count(*) from pg_trigger where tgname in ('trg_cot_frontera_39','trg_cot_pagos_frontera_39','trg_cot_condiciones_frontera_39') and tgenabled = 'D')::text || '/' || has_table_privilege('authenticated', 'public.cotizacion_servicios', 'INSERT')::text")" = "3/true" ]; then
  ok "RB7 la 217 abortada a mitad no deja nada (disparadores deshabilitados, permisos intactos)"
else fallo "RB7 $(printf '%s' "$R" | tr '\n' ' ' | cut -c1-300)"; fi
R="$(post217 "$DBV")"; [ "$R" != invalido ] && [ "${R#*/}" -ge 1 ] && ok "RB7.1 postcheck 217 en rojo ($R)" || fallo "RB7.1 $R"

# ══ RB8 · rollback 217 sobre la línea base REAL de Producción ══════════════
# Antes de la 216, Producción tenía P10=30: anon y authenticated SIN TRUNCATE en servicios, pagos
# previos y condiciones (la plantilla del CI trae los permisos por defecto de Supabase, con
# TRUNCATE). Se simula esa línea base en una base desechable, se aplica 216 → 217 → rollback 217
# y se exige P10=30 con la MISMA matriz de permisos que antes de la 217.
# Matriz: cada (rol, tabla, privilegio) que la API tiene sobre las tres tablas, incluido PUBLIC.
matriz() { # $1 base, $2 archivo de salida (una entrada por línea, ordenada)
  uno "$1" "select r.rol || ':' || t.n || ':' || p.priv
              from (values ('anon'), ('authenticated'), ('service_role'), ('public')) r(rol),
                   (values ('public.cotizacion_servicios'), ('public.cotizacion_pagos_previos'), ('public.cotizacion_condiciones')) t(n),
                   (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
             where has_table_privilege(r.rol, t.n, p.priv) order by 1" | sort > "$2"
}
hab_en() { uno "$1" "select p39_priv.frontera_activa()::text || '/' || public.edicion_cotizaciones_habilitada()::text"; }
DBP="t216_p10_$SUF"; crear_base "$DBP"
preflight "$DBP"; P10_PLANTILLA="$(pf "$TMP/pre.out" P10)"
# Línea base explícita (no depende de los permisos por defecto de la plantilla): anon/authenticated
# con INSERT/UPDATE/DELETE y SIN TRUNCATE; service_role con los cuatro.
uno "$DBP" "revoke truncate on public.cotizacion_servicios, public.cotizacion_pagos_previos, public.cotizacion_condiciones from anon, authenticated;
            grant insert, update, delete on public.cotizacion_servicios, public.cotizacion_pagos_previos, public.cotizacion_condiciones to anon, authenticated;
            grant insert, update, delete, truncate on public.cotizacion_servicios, public.cotizacion_pagos_previos, public.cotizacion_condiciones to service_role" >/dev/null
preflight "$DBP"; R="$(pf "$TMP/pre.out" P10)"
[ "$R" = INFO/30 ] && [ "$(uno "$DBP" "$SEIS_TRUNCATE")" = 0 ] \
  && ok "RB8 línea base de Producción simulada: P10=30, sin los seis TRUNCATE (la plantilla del CI traía $P10_PLANTILLA)" \
  || fallo "RB8 línea base: P10=$R (plantilla $P10_PLANTILLA), TRUNCATE=$(uno "$DBP" "$SEIS_TRUNCATE")"
aplicar "$DBP" "$M216" || fallo "RB8.1 216: $(cut -c1-300 "$TMP/aplicar.out")"
matriz "$DBP" "$TMP/m_antes.out"
if aplicar "$DBP" "$M217" && [ "$(post217 "$DBP")" = "12/0" ] && [ "$(post216 "$DBP")" = "22/0" ]; then
  ok "RB8.1 216 y 217 aplicadas sobre la línea base de Producción (217 12/12, 216 22/22)"
else fallo "RB8.1 217: $(cut -c1-300 "$TMP/aplicar.out") · 217=$(post217 "$DBP") 216=$(post216 "$DBP")"; fi
if $PSM -d "$DBP" < "$AQUI/rollback_217_cotizacion_manual_cierre.sql" > "$TMP/rb.out" 2>&1 && grep -q 'ROLLBACK 217 COMPLETO' "$TMP/rb.out"; then
  ok "RB8.2 rollback 217 completo sobre la línea base de Producción"
else fallo "RB8.2 $(grep -E 'ERROR|NOTICE' "$TMP/rb.out" | head -3 | tr '\n' ' ')"; fi
matriz "$DBP" "$TMP/m_despues.out"
preflight "$DBP"; R="$(pf "$TMP/pre.out" P10)"
AGREGADOS="$(comm -13 "$TMP/m_antes.out" "$TMP/m_despues.out" | tr '\n' ' ')"
QUITADOS="$(comm -23 "$TMP/m_antes.out" "$TMP/m_despues.out" | tr '\n' ' ')"
[ "$R" = INFO/30 ] && [ -s "$TMP/m_antes.out" ] && cmp -s "$TMP/m_antes.out" "$TMP/m_despues.out" \
  && ok "RB8.3 P10 vuelve a 30 y la matriz de permisos es idéntica a la previa a la 217 ($(wc -l < "$TMP/m_antes.out" | tr -d ' ') entradas): nada ampliado ni perdido" \
  || fallo "RB8.3 P10=$R · agregados=[$AGREGADOS] · quitados=[$QUITADOS]"
[ "$(uno "$DBP" "$SEIS_TRUNCATE")" = 0 ] && [ "$(hab_en "$DBP")" = "false/false" ] \
  && ok "RB8.4 sin ninguno de los seis TRUNCATE; frontera y edición apagadas" || fallo "RB8.4 TRUNCATE=$(uno "$DBP" "$SEIS_TRUNCATE") hab=$(hab_en "$DBP")"
# Control: la comparación SÍ detecta un permiso de más (y se retira enseguida).
uno "$DBP" "grant truncate on public.cotizacion_servicios to anon" >/dev/null
matriz "$DBP" "$TMP/m_control.out"
uno "$DBP" "revoke truncate on public.cotizacion_servicios from anon" >/dev/null
[ "$(comm -13 "$TMP/m_antes.out" "$TMP/m_control.out" | tr -d '\n')" = "anon:public.cotizacion_servicios:TRUNCATE" ] \
  && ok "RB8.5 control: un TRUNCATE de más sí aparece como ampliación" || fallo "RB8.5 $(comm -13 "$TMP/m_antes.out" "$TMP/m_control.out" | tr '\n' ' ')"

echo "------------------------------------------------------------"
echo "Resultado: $OKS OK, $FALLOS FALLO(S)"
if [ "$FALLOS" = 0 ]; then echo "TEST 216 FASES: TODO OK"; else echo "TEST 216 FASES: $FALLOS FALLO(S)"; exit 1; fi
