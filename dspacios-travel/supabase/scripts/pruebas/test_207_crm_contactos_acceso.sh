#!/bin/sh
# ───────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL · migración 207 (hotfix de acceso a `crm_contactos`).
#
# Base DESECHABLE dentro de un contenedor Docker propio; NUNCA toca Supabase,
# Producción ni un Preview. Datos 100% sintéticos (nombres "zz-*", UUIDs
# ...c0xx). La salida son solo OK/FALLO y conteos.
#
# Recorre: cadena vigente SIN la 207 (con la 209, sin 206/208) · siembra histórica con evidencia de auditoría ·
# ANTES (fuga estructural) · preflight · migración · postcheck · matriz ·
# default/atribución manual · matriz · recuperación · candado del rollback de último
# recurso (confirmación solo en su transacción) · re-aplicación idempotente.
#
# Solo borra la base que ESTE runner creó (nombre crmacc_<dígitos>, verificada
# inexistente antes del CREATE). Nunca otra base del contenedor.
#
# Uso:  sh supabase/scripts/pruebas/test_207_crm_contactos_acceso.sh [contenedor]
#   (Git Bash en Windows: MSYS_NO_PATHCONV=1 sh ...)
# ───────────────────────────────────────────────────────────────────────────
set -eu
CT="${1:-supabase_db_sbqvrckukbjzhtzqpyzg}"
DB="${CRMACC_DB:-crmacc_$(date +%s)$$}"   # CRMACC_DB solo para probar la guarda
AQUI="$(cd "$(dirname "$0")" && pwd)"
MIG="$AQUI/../../migrations"
M207="$MIG/20260601000207_crm_contactos_acceso.sql"
DB_CREADA=""
SCR="$AQUI/.."
PSQL="psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

limpiar() {
  [ -n "$DB_CREADA" ] && docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap limpiar EXIT

sql()  { docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -f -; }
sqlv() { docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -c "$1"; }

# Reintenta si el contenedor entra en recuperación (poca memoria): no es un
# fallo de la migración (mismo criterio que test_202_crm_leads.sh).
aplicar() { # $1 archivo, $2 = "1" fuerza transacción única
  intentos=0
  while [ "$intentos" -lt 6 ]; do
    intentos=$((intentos + 1))
    if [ -n "${2:-}" ]; then
      docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL --single-transaction -d "$DB" -f - < "$1" >"$TMP/mig.out" 2>"$TMP/mig.err" && return 0
    else
      docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -f - < "$1" >"$TMP/mig.out" 2>"$TMP/mig.err" && return 0
    fi
    if grep -q 'recovery mode\|not accepting connections\|because of crash\|could not connect' "$TMP/mig.err"; then
      echo "   (Postgres local reiniciando; reintento $intentos/6)"; sleep 20; continue
    fi
    return 1
  done
  return 1
}

# ── Base desechable: nombre validado, inexistente y creada por ESTE runner ──
case "$DB" in
  crmacc_[0-9]*) ;;
  *) echo "Nombre de base inseguro: $DB"; exit 2 ;;
esac
if [ -n "$(echo "${DB#crmacc_}" | tr -d '0-9')" ]; then echo "Nombre de base inseguro: $DB"; exit 2; fi
YA=$(docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "select 1 from pg_database where datname = '$DB'")
if [ -n "$YA" ]; then echo "La base $DB ya existe: no es de este runner; no se toca."; exit 2; fi
docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "create database $DB" >/dev/null && DB_CREADA=1
# Andamiaje (como local-desde-cero.sh).
sql >/dev/null <<'SQL'
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::json->>'role','') $$;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb);
create table if not exists storage.buckets (id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid, created_at timestamptz default now(),
  updated_at timestamptz default now(), last_accessed_at timestamptz default now(), metadata jsonb);
alter table storage.objects enable row level security;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
SQL

# Cadena VIGENTE del repo SIN la 207 (la 207 se aplica una sola vez, en el
# paso probado). Escenario exigido: con la 209 y sin 206 ni 208.
for f in "$MIG"/20260601000206_*.sql "$MIG"/20260601000208_*.sql; do
  [ -e "$f" ] && { echo "FALLO escenario: existe $(basename "$f"); esta prueba es sin 206 ni 208"; exit 1; }
done
n=0; con209=""; ultima=""
for f in "$MIG"/*.sql; do
  case "$(basename "$f")" in 20260601000207_*) continue ;; esac
  if aplicar "$f" 1; then :; elif aplicar "$f"; then :; else
    echo "FALLO al aplicar $(basename "$f")"; cat "$TMP/mig.err"; exit 1
  fi
  case "$(basename "$f")" in 20260601000209_*) con209=1 ;; esac
  ultima="$(basename "$f")"; n=$((n + 1))
done
[ -n "$con209" ] || { echo "FALLO escenario: la 209 no está en la cadena"; exit 1; }
echo "== $n migraciones aplicadas SIN la 207 (incluida la 209; última: $ultima)"

# Privilegios por omisión de Supabase: anon/authenticated con todo en public.
sql >/dev/null <<'SQL'
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
SQL

# ── Usuarios sintéticos ─────────────────────────────────────────────────────
sql >/dev/null <<'SQL'
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000c00' || lpad(i::text, 2, '0'))::uuid, 'zz-crm-' || i || '@x.test'
  from generate_series(1, 14) i;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select ('00000000-0000-0000-0000-0000000c00' || lpad(i::text, 2, '0'))::uuid, 'zz-crm-' || i || '@x.test', 'zz ' || r, r::rol_usuario, act, t
  from (values
    (1,'superadmin','mayorista',true), (2,'gerencia','mayorista',true), (3,'administracion','mayorista',true),
    (4,'operaciones','mayorista',true), (5,'venta','mayorista',true), (6,'venta','minorista',true),
    (7,'administracion','minorista',true), (8,'gerencia','minorista',true), (9,'agencia','mayorista',true),
    (10,'freelance','mayorista',true), (11,'cliente_final','mayorista',true), (12,'control_vuelo','mayorista',true),
    (13,'venta','mayorista',false), (14,'operaciones','minorista',true)
  ) v(i, r, t, act)
on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, nombre = excluded.nombre;
SQL

como() { # $1 = sufijo 2 dígitos del usuario
  echo "set role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-0000000c00$1\",\"role\":\"authenticated\"}', false);"
}

# ── Siembra histórica (ANTES de la migración), con la policy de la 042 ──────
# H1 venta mayorista · H2 administración minorista · H3 sistema/checkout B2C ·
# H4 superadmin · H5 sin auditoría · H6 venta mayorista, luego editada por
# administración minorista (tocada por las dos agencias).
sqlv "$(como 05) insert into public.crm_contactos (nombre, origen) values ('zz-H1', 'manual');" >/dev/null
sqlv "$(como 07) insert into public.crm_contactos (nombre, origen) values ('zz-H2', 'manual');" >/dev/null
sqlv "insert into public.crm_contactos (nombre, origen) values ('zz-H3', 'Cotización tarifario (B2C)');" >/dev/null
sqlv "$(como 01) insert into public.crm_contactos (nombre, origen) values ('zz-H4', 'manual');" >/dev/null
sqlv "set session_replication_role = replica; insert into public.crm_contactos (nombre, origen) values ('zz-H5', 'manual');" >/dev/null
sqlv "$(como 05) insert into public.crm_contactos (nombre, origen) values ('zz-H6', 'manual');" >/dev/null
sqlv "$(como 07) update public.crm_contactos set notas = 'editada' where nombre = 'zz-H6';" >/dev/null

# ── ANTES: la fuga estructural existe (B2B y control_vuelo leen todo) ────────
V_AG=$(sqlv "$(como 09) select count(*) from public.crm_contactos;" | tail -1)
V_CV=$(sqlv "$(como 12) select count(*) from public.crm_contactos;" | tail -1)
V_VMIN=$(sqlv "$(como 06) select count(*) from public.crm_contactos;" | tail -1)
if [ "$V_AG" = 6 ] && [ "$V_CV" = 6 ] && [ "$V_VMIN" = 6 ]; then
  ok "ANTES: agencia B2B ve 6/6, control_vuelo 6/6, venta minorista 6/6 (fuga reproducida)"
else fallo "ANTES esperado 6/6/6, obtuvo $V_AG/$V_CV/$V_VMIN"; fi

# ── Preflight (solo lectura) ────────────────────────────────────────────────
sql < "$SCR/preflight_207_crm_contactos_acceso.sql" > "$TMP/pre.txt"
if grep -q '^C|por categoría de evidencia|E1-mayorista=2, E1-minorista=1, E2=1, E3=1, E4=1$' "$TMP/pre.txt" \
   && grep -q '^C|filas creadas o editadas por personal de las DOS agencias|1$' "$TMP/pre.txt" \
   && grep -q '^A|columna tenant ya existe (debe ser false)|false$' "$TMP/pre.txt"; then
  ok "preflight: categorías E1-may=2 E1-min=1 E2=1 E3=1 E4=1, 1 fila tocada por dos agencias"
else fallo "preflight inesperado:"; grep '^[AC]|' "$TMP/pre.txt"; fi
if grep -qi 'zz-H\|@x.test' "$TMP/pre.txt"; then fallo "el preflight imprimió datos de contacto/usuario"; else ok "preflight sin nombres, emails ni ids"; fi

# ── Migración ───────────────────────────────────────────────────────────────
aplicar "$M207" 1 || { fallo "la migración no aplicó"; cat "$TMP/mig.err"; exit 1; }
ok "migración 207 aplicada una vez sobre la cadena vigente (hasta la 209)"

postcheck() { # $1 etiqueta
  sql < "$SCR/postcheck_207_crm_contactos_acceso.sql" > "$TMP/pc.txt" 2>&1 || true
  if grep -qE '\|f\|' "$TMP/pc.txt" || grep -q ERROR "$TMP/pc.txt" || [ "$(grep -cE '\|t\|' "$TMP/pc.txt")" -ne 20 ]; then
    fallo "postcheck ($1):"; grep -E '\|f\||ERROR' "$TMP/pc.txt"
  else ok "postcheck ($1): $(grep -cE '\|t\|' "$TMP/pc.txt") chequeos en true"; fi
}
postcheck "tras migrar"

matriz() { # $1 etiqueta, $2 filas esperadas
  sql < "$AQUI/test_207_crm_contactos_matriz_local.sql" > "$TMP/mx.txt" 2>&1 || true
  if grep -q ERROR "$TMP/mx.txt"; then fallo "matriz ($1) con error:"; grep ERROR "$TMP/mx.txt"; return; fi
  filas=$(grep -c '|' "$TMP/mx.txt" || true)
  malas=$(grep '|' "$TMP/mx.txt" | grep -vc '|OK$' || true)
  if [ "$malas" = 0 ] && [ "$filas" = "$2" ]; then ok "matriz ($1): $filas sesiones, todas OK"
  else fallo "matriz ($1): $malas de $filas con discrepancia"; grep '|' "$TMP/mx.txt" | grep -v '|OK$'; fi
  cp "$TMP/mx.txt" "$TMP/mx_$3.txt"
}
# 14 usuarios distintos (rol·agencia·activo) + uid sin perfil + anon = 16
matriz "todo sin atribuir" 16 a

# Sin atribuir: solo superadmin y gerencia (de cualquier agencia) ven las 6.
grep '|' "$TMP/mx_a.txt" | awk -F'|' '{print $2"·"$3"·"$4" ve="$5}' > "$TMP/resumen_a.txt"
if grep -q '^superadmin·mayorista·t ve=0/0/6$' "$TMP/resumen_a.txt" && grep -q '^gerencia·minorista·t ve=0/0/6$' "$TMP/resumen_a.txt" \
   && grep -q '^venta·mayorista·t ve=0/0/0$' "$TMP/resumen_a.txt" && grep -q '^agencia·mayorista·t ve=0/0/0$' "$TMP/resumen_a.txt"; then
  ok "sin atribuir: superadmin/gerencia 6, venta 0, agencia B2B 0"
else fallo "visibilidad sin atribuir inesperada"; cat "$TMP/resumen_a.txt"; fi

# ── Default de tenant (código VIEJO que no manda tenant) ────────────────────
sqlv "$(como 06) insert into public.crm_contactos (nombre) values ('zz-N1');" >/dev/null
sqlv "$(como 03) insert into public.crm_contactos (nombre) values ('zz-N2');" >/dev/null
sqlv "set role service_role; insert into public.crm_contactos (nombre) values ('zz-N3');" >/dev/null
D=$(sqlv "select string_agg(nombre || '=' || coalesce(tenant, 'NULL'), ',' order by nombre) from public.crm_contactos where nombre like 'zz-N%';" | tail -1)
if [ "$D" = "zz-N1=minorista,zz-N2=mayorista,zz-N3=NULL" ]; then
  ok "default: venta minorista→minorista, admin mayorista→mayorista, service_role sin tenant→NULL (no adivina)"
else fallo "default inesperado: $D"; fi
# Código NUEVO: superadmin en modo minorista estampa minorista; venta mayorista NO puede estampar minorista.
if sqlv "$(como 01) insert into public.crm_contactos (nombre, tenant) values ('zz-N4', 'minorista');" >/dev/null 2>&1; then
  ok "superadmin inserta con tenant=minorista (agencia activa)"; else fallo "superadmin no pudo insertar en minorista"; fi
if sqlv "$(como 05) insert into public.crm_contactos (nombre, tenant) values ('zz-N5', 'minorista');" >/dev/null 2>&1; then
  fallo "venta mayorista insertó en minorista"; else ok "venta mayorista NO puede insertar con tenant=minorista"; fi
if sqlv "$(como 05) insert into public.crm_contactos (nombre, tenant) values ('zz-N6', 'otra');" >/dev/null 2>&1; then
  fallo "aceptó un tenant fuera del catálogo"; else ok "tenant fuera de mayorista/minorista rechazado"; fi

# ── Atribución MANUAL por gerencia (NULL → agencia, permitido por la policy)
# Deja el mismo estado mezclado que usan las pruebas siguientes. El script de
# atribución B2C (`atribuir_207_…`) se prueba aparte, con su lote exacto, en
# `test_207_atribucion_b2c_local.sh`.
for par in "zz-H1:mayorista" "zz-H2:minorista" "zz-H3:mayorista"; do
  nom="${par%%:*}"; ten="${par#*:}"
  sqlv "$(como 02) update public.crm_contactos set tenant = '$ten' where nombre = '$nom' and tenant is null;" >/dev/null
done
A=$(sqlv "select string_agg(nombre || '=' || coalesce(tenant, 'NULL'), ',' order by nombre) from public.crm_contactos where nombre like 'zz-H%';" | tail -1)
if [ "$A" = "zz-H1=mayorista,zz-H2=minorista,zz-H3=mayorista,zz-H4=NULL,zz-H5=NULL,zz-H6=NULL" ]; then
  ok "atribución manual por gerencia (NULL → agencia): H1/H3 mayorista, H2 minorista; H4-H6 siguen NULL"
else fallo "atribución manual inesperada: $A"; fi
# El script B2C, tal cual en el repo (apagado), no escribe nada aquí.
H0=$(sqlv "select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.crm_contactos c;" | tail -1)
if sql < "$SCR/atribuir_207_crm_contactos_acceso.sql" > "$TMP/atr0.txt" 2>&1; then fallo "atribución B2C apagada no abortó"
elif [ "$(sqlv "select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.crm_contactos c;" | tail -1)" = "$H0" ]; then
  ok "atribución B2C tal cual en el repo (apagada/lote distinto): aborta sin escribir"
else fallo "atribución B2C apagada cambió datos"; fi

# ── Trigger: no se reasigna una fila ya atribuida, ni siquiera superadmin ───
if sqlv "$(como 01) update public.crm_contactos set tenant = 'minorista' where nombre = 'zz-H1';" >/dev/null 2>&1; then
  fallo "superadmin reasignó una fila atribuida"; else ok "superadmin NO puede cambiar el tenant de una fila atribuida"; fi
if sqlv "$(como 02) update public.crm_contactos set tenant = 'minorista' where nombre = 'zz-H4';" >/dev/null 2>&1; then
  ok "gerencia SÍ puede atribuir a mano una fila sin atribuir (NULL→minorista)"; else fallo "gerencia no pudo atribuir NULL→minorista"; fi

matriz "agencias mezcladas" 16 b

# Venta mayorista ve solo mayorista; venta minorista solo minorista; gerencia ambas.
grep '|' "$TMP/mx_b.txt" | awk -F'|' '{print $2"·"$3"·"$4" ve="$5}' > "$TMP/resumen_b.txt"
T=$(sqlv "select count(*) filter (where tenant='mayorista') || '/' || count(*) filter (where tenant='minorista') || '/' || count(*) filter (where tenant is null) from public.crm_contactos;" | tail -1)
MAY=${T%%/*}; RESTO=${T#*/}; MIN=${RESTO%%/*}; NUL=${RESTO#*/}
if grep -q "^venta·mayorista·t ve=$MAY/0/0$" "$TMP/resumen_b.txt" && grep -q "^venta·minorista·t ve=$MIN/0/0$" "$TMP/resumen_b.txt" \
   && grep -q "^gerencia·minorista·t ve=$MIN/$MAY/$NUL$" "$TMP/resumen_b.txt" && grep -q "^freelance·mayorista·t ve=0/0/0$" "$TMP/resumen_b.txt" \
   && grep -q "^venta·mayorista·f ve=0/0/0$" "$TMP/resumen_b.txt" && grep -q "^control_vuelo·mayorista·t ve=0/0/0$" "$TMP/resumen_b.txt"; then
  ok "mezcladas (may/min/null=$T): venta solo su agencia, gerencia ambas+sin atribuir, B2B/control_vuelo/inactivo 0"
else fallo "visibilidad mezclada inesperada ($T)"; cat "$TMP/resumen_b.txt"; fi
if grep -qi 'zz-\|@x.test\|0000000c00' "$TMP/mx_b.txt"; then fallo "la matriz imprimió datos"; else ok "matriz sin nombres, emails ni ids"; fi

# ── Recuperación que conserva el cierre ────────────────────────────────────
sql < "$SCR/recuperacion_207_crm_contactos_acceso.sql" > "$TMP/rec.txt"
TOT=$(sqlv "select count(*) from public.crm_contactos;" | tail -1)
R_AG=$(sqlv "$(como 09) select count(*) from public.crm_contactos;" | tail -1)
R_CV=$(sqlv "$(como 12) select count(*) from public.crm_contactos;" | tail -1)
R_IN=$(sqlv "$(como 13) select count(*) from public.crm_contactos;" | tail -1)
R_VM=$(sqlv "$(como 06) select count(*) from public.crm_contactos;" | tail -1)
if sqlv "set role anon; select count(*) from public.crm_contactos;" >/dev/null 2>&1; then R_AN=leyo; else R_AN=negado; fi
if [ "$R_AG" = 0 ] && [ "$R_CV" = 0 ] && [ "$R_IN" = 0 ] && [ "$R_AN" = negado ] && [ "$R_VM" = "$TOT" ]; then
  ok "recuperación: B2B 0, control_vuelo 0, inactivo 0, anon negado; venta minorista ve $R_VM/$TOT (sin aislar agencia)"
else fallo "recuperación: agencia=$R_AG cv=$R_CV inactivo=$R_IN anon=$R_AN venta_min=$R_VM/$TOT"; fi
if sqlv "$(como 09) insert into public.crm_contactos (nombre, tenant) values ('zz-REC', 'mayorista');" >/dev/null 2>&1; then
  fallo "recuperación: B2B pudo insertar"; else ok "recuperación: B2B sigue sin poder insertar"; fi
# Volver al cierre completo = re-correr la migración.
aplicar "$M207" 1 || { fallo "re-aplicar tras recuperación falló"; cat "$TMP/mig.err"; }
postcheck "tras recuperación + re-aplicar"
matriz "tras recuperación + re-aplicar" 16 r

# ── Rollback de último recurso: sin confirmación aborta sin tocar nada ──────
CANT_ANTES=$(sqlv "select count(*) filter (where tenant is not null) from public.crm_contactos;" | tail -1)
POL_ANTES=$(sqlv "select string_agg(policyname, ',' order by policyname) from pg_policies where tablename = 'crm_contactos';" | tail -1)
if sql < "$SCR/rollback_207_crm_contactos_acceso.sql" > "$TMP/rb0.txt" 2>&1; then
  fallo "rollback sin confirmación NO abortó"
else
  POL_TRAS=$(sqlv "select string_agg(policyname, ',' order by policyname) from pg_policies where tablename = 'crm_contactos';" | tail -1)
  if grep -q "NO ejecutado" "$TMP/rb0.txt" && [ "$POL_TRAS" = "$POL_ANTES" ]; then
    ok "rollback sin la línea de confirmación: aborta y las policies del hotfix siguen intactas"
  else fallo "rollback sin confirmación cambió algo: $POL_TRAS"; fi
fi
POLS() { sqlv "select string_agg(policyname, ',' order by policyname) from pg_policies where tablename = 'crm_contactos';" | tail -1; }
CONFIRMADO="$TMP/rollback_confirmado.sql"
sed 's/^-- select set_config(/select set_config(/' "$SCR/rollback_207_crm_contactos_acceso.sql" > "$CONFIRMADO"
grep -q "^select set_config('app.reabrir_crm_contactos'" "$CONFIRMADO" || fallo "no se pudo preparar la versión confirmada del rollback"

# Un valor de SESIÓN anterior (set de sesión, y set_config no local de otra
# transacción con su propio txid) NO autoriza esta ejecución.
if { echo "set app.reabrir_crm_contactos = 'REABRIR_FUGA';";
     echo "begin; select set_config('app.reabrir_crm_contactos', 'REABRIR_FUGA:' || txid_current(), false); commit;";
     cat "$SCR/rollback_207_crm_contactos_acceso.sql"; } | sql > "$TMP/rb1.txt" 2>&1; then
  fallo "rollback autorizado por un valor de sesión anterior"
elif grep -q "NO ejecutado" "$TMP/rb1.txt" && [ "$(POLS)" = "$POL_ANTES" ]; then
  ok "valor de sesión/transacción anterior: no autoriza, aborta y las policies siguen intactas"
else fallo "rollback con valor anterior: $(POLS)"; cat "$TMP/rb1.txt"; fi

# Confirmación correcta pero con las sentencias SUELTAS (sin begin/commit):
# la confirmación y el candado caen en transacciones distintas → aborta.
if grep -v '^begin;$' "$CONFIRMADO" | grep -v '^commit;$' | sql > "$TMP/rb2.txt" 2>&1; then
  fallo "rollback sin transacción única se ejecutó"
elif grep -q "NO ejecutado" "$TMP/rb2.txt" && [ "$(POLS)" = "$POL_ANTES" ]; then
  ok "confirmación en otra transacción (sentencias sueltas): aborta y nada cambia"
else fallo "rollback suelto: $(POLS)"; cat "$TMP/rb2.txt"; fi

# Confirmación dentro de la misma transacción: restaura la 042 (y reabre, como advierte).
sql < "$CONFIRMADO" > "$TMP/rb.txt"
V_AG2=$(sqlv "$(como 09) select count(*) from public.crm_contactos;" | tail -1)
TOT=$(sqlv "select count(*) from public.crm_contactos;" | tail -1)
POL=$(POLS)
if [ "$POL" = "crm_contactos: escritura,crm_contactos: lectura" ] && [ "$V_AG2" = "$TOT" ]; then
  ok "rollback confirmado en su transacción: 042 restaurada (agencia vuelve a ver $V_AG2/$TOT, la fuga reaparece)"
else fallo "rollback: policies=$POL agencia=$V_AG2/$TOT"; fi
if sqlv "$(como 05) insert into public.crm_contactos (nombre, tenant) values ('zz-R1', 'mayorista');" >/dev/null 2>&1; then
  ok "tras rollback, crear contacto con tenant sigue funcionando (columna conservada)"; else fallo "tras rollback falla el insert con tenant"; fi

# En UNA misma sesión: rollback confirmado, re-aplicar la migración y volver a
# correr el rollback SIN confirmar → la confirmación anterior ya no vale.
{ cat "$CONFIRMADO"; cat "$M207"; cat "$SCR/rollback_207_crm_contactos_acceso.sql"; } | sql > "$TMP/rb3.txt" 2>&1 && R3=paso || R3=aborto
if [ "$R3" = aborto ] && grep -q "NO ejecutado" "$TMP/rb3.txt" && [ "$(POLS)" = "$POL_ANTES" ]; then
  ok "misma sesión: tras un rollback confirmado, la siguiente ejecución vuelve a exigir confirmación"
else fallo "la confirmación sobrevivió a su transacción ($R3): $(POLS)"; fi

# ── Re-aplicación idempotente ───────────────────────────────────────────────
aplicar "$M207" 1 || { fallo "re-aplicar la migración falló"; cat "$TMP/mig.err"; }
CANT_DESP=$(sqlv "select count(*) filter (where tenant is not null) - 1 from public.crm_contactos;" | tail -1)
[ "$CANT_DESP" = "$CANT_ANTES" ] && ok "re-aplicada: atribuciones conservadas ($CANT_ANTES)" || fallo "atribuciones cambiaron: $CANT_ANTES → $CANT_DESP"
postcheck "re-aplicada"
matriz "re-aplicada" 16 c

# ── La matriz con mutaciones se niega fuera de una base desechable ─────────
if docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -f - < "$AQUI/test_207_crm_contactos_matriz_local.sql" > "$TMP/mxg.txt" 2>&1; then
  fallo "la matriz local corrió sobre la base 'postgres'"
elif grep -q "no es una base desechable" "$TMP/mxg.txt"; then
  ok "la matriz con INSERT/UPDATE/DELETE aborta fuera de una base crmacc_/crmapi_"
else fallo "la matriz falló por otra razón en 'postgres'"; fi

# ── Preflight y postcheck: una sola sentencia SELECT, sin escrituras ───────
for f in preflight_207_crm_contactos_acceso.sql postcheck_207_crm_contactos_acceso.sql; do
  if sed -e 's/--.*$//' -e "s/'[^']*'//g" "$SCR/$f" | grep -qiE '\b(insert|update|delete|truncate|create|alter|drop|grant|revoke|begin|commit|set role|set local)\b|do \$\$'; then
    fallo "$f contiene sentencias de escritura o de sesión"
  else ok "$f: solo SELECT"; fi
done

echo
if [ "$FALLOS" -eq 0 ]; then echo "== TODO OK"; else echo "== $FALLOS FALLO(S)"; exit 1; fi
