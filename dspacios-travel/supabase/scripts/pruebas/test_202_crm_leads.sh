#!/bin/sh
# ───────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL · migración 202 (CRM leads) — comportamiento real.
#
# Monta una base DESECHABLE, aplica la cadena completa 1→201, luego la 203 y
# después la 202, y corre test_202_crm_leads.sql. Al final borra la base, pase
# o falle. NUNCA toca una base remota, la de Supabase ni un Preview.
#
# Uso:
#   sh supabase/scripts/pruebas/test_202_crm_leads.sh [contenedor]
# ───────────────────────────────────────────────────────────────────────────
set -eu
CT="${1:-supabase_db_sbqvrckukbjzhtzqpyzg}"
DB="crm202_$(date +%s)"
AQUI="$(cd "$(dirname "$0")" && pwd)"
MIG="$AQUI/../../migrations"
PRUEBA="$AQUI/test_202_crm_leads.sql"
PSQL="psql -h 127.0.0.1 -U postgres -X -q -t -A -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0

limpiar() {
  docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap limpiar EXIT

sql() { docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -f -; }

# ── Base desechable + andamiaje mínimo (como local-desde-cero.sh) ────────────
docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "create database $DB" >/dev/null
cat > "$TMP/andamiaje.sql" <<'SQL'
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::json->>'role','') $$;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb
);
create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), metadata jsonb
);
alter table storage.objects enable row level security;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
SQL
sql < "$TMP/andamiaje.sql" >/dev/null

# `docker exec` no ve el disco del host: los archivos se pasan por stdin con
# `-f -`, igual que `local-desde-cero.sh` los pasa a un psql local.
#
# Reintenta si el contenedor entra en recuperación: en una máquina con poca
# memoria PostgreSQL local puede reiniciarse a mitad del bucle de migraciones, y
# eso NO es un fallo de la migración. `set -e` abortaría el script por eso.
aplicar() { # $1 = ruta del archivo, $2 = "1" para forzar transacción única
  intentos=0
  while [ "$intentos" -lt 6 ]; do
    intentos=$((intentos + 1))
    if [ -n "${2:-}" ]; then
      docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL --single-transaction -d "$DB" -f - < "$1" >/dev/null 2>"$TMP/mig.err"
    else
      docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -f - < "$1" >/dev/null 2>"$TMP/mig.err"
    fi
    [ $? -eq 0 ] && return 0
    if grep -q 'recovery mode\|not accepting connections\|terminating connection because of crash' "$TMP/mig.err"; then
      echo "   (Postgres local reiniciando; reintento $intentos/6)"
      sleep 20
      continue
    fi
    return 1
  done
  return 1
}

# ── Cadena 1→201 y luego la 203 (la 202 se aplica DESPUÉS, como en producción) ─
n=0
for f in "$MIG"/*.sql; do
  b=$(basename "$f")
  case "$b" in
    20260601000202*) continue ;;
  esac
  if aplicar "$f" 1; then :; elif aplicar "$f"; then
    # `alter type ... add value` no admite usar el valor nuevo en la misma
    # transacción: se reintenta suelta (mismo criterio que local-desde-cero.sh).
    :
  else
    echo "FALLO al aplicar $b"; cat "$TMP/mig.err"; exit 1
  fi
  n=$((n + 1))
done
echo "== $n migraciones aplicadas (1→201 + 203)"

# Permisos de tabla al final, igual que `local-desde-cero.sh`: muchas
# migraciones crean tablas y las conceden por omisión. Sin esto, `authenticated`
# no podría leer `auditoria` y la prueba de comportamiento no probaría nada real.
sql >/dev/null <<'SQL'
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
SQL

aplicar "$MIG/20260601000202_crm_leads.sql" 1 > "$TMP/m202.err" 2>&1 || {
  echo "FALLO al aplicar la 202"; cat "$TMP/m202.err"; exit 1; }
echo "== 202 aplicada sobre 1→201 + 203"

# El postcheck de la 203 debe seguir en verde DESPUÉS de la 202: en particular
# "historiales sin triggers propios". Es el cruce que daba falso antes.
sql < "$AQUI/../postcheck_203_tarifas_generacion_acotada.sql" > "$TMP/pc203.txt" 2>&1 || true
# El script imprime `chequeo | ok`; con -t -A la barra separadora se conserva en
# el texto y el valor va al final de la línea.
if grep -qE 'historiales sin triggers propios.*\| *t$' "$TMP/pc203.txt"; then
  echo "OK    la 202 no toco los historiales de la 203"
else
  echo "FALLO la 203 postcheck despues de la 202:"; grep -n 'historiales sin triggers' "$TMP/pc203.txt"; FALLOS=$((FALLOS + 1))
fi

# El postcheck propio de la 202: todas las filas en true.
sql < "$AQUI/../postcheck_202_crm_leads.sql" > "$TMP/pc202.txt" 2>&1 || true
if grep -qE '\| *f$' "$TMP/pc202.txt"; then
  echo "FALLO el postcheck de la 202:"; grep -E '\| *f$' "$TMP/pc202.txt"; FALLOS=$((FALLOS + 1))
else
  echo "OK    postcheck de la 202: todas las filas en true"
fi

# ── Comportamiento de la 202 ────────────────────────────────────────────────
# Reintenta mientras el contenedor siga en recuperación; una aserción que falla
# de verdad NO se reintenta (el mensaje no menciona recuperación).
intentos=0
while :; do
  intentos=$((intentos + 1))
  sql < "$PRUEBA" > "$TMP/prueba.txt" 2>&1 && break
  if [ "$intentos" -ge 8 ] || ! grep -q 'recovery mode\|not accepting connections\|because of crash' "$TMP/prueba.txt"; then
    echo "FALLO la prueba de comportamiento:"
    grep -E 'FALLO|ERROR|NOTICE' "$TMP/prueba.txt" | tail -20
    exit 1
  fi
  echo "   (Postgres local reiniciando; reintento $intentos/8)"
  sleep 20
done
echo "== aserciones de comportamiento:"
grep 'OK   ' "$TMP/prueba.txt" | sed 's/^OK   /  · /'
echo "OK    todas las aserciones de comportamiento de la 202"

# ── Rollback: con datos se niega y no cambia nada ───────────────────────────
# La prueba de comportamiento terminó en ROLLBACK, así que la base está vacía:
# hay que dejar un lead a propósito para provocar el rechazo.
sql <<'SQL' >/dev/null
insert into public.crm_leads (tenant, canal, nombre) values ('mayorista', 'otro', 'Lead de prueba para el rollback');
SQL
RES="$(sql < "$AQUI/../rollback_202_crm_leads.sql" 2>&1 || true)"
if printf '%s' "$RES" | grep -q 'Rollback 202 cancelado'; then
  echo "OK    rollback con leads cargados: se niega"
else
  echo "FALLO el rollback deberia haberse negado:"; printf '%s\n' "$RES" | tail -5; FALLOS=$((FALLOS + 1))
fi
# Y lo importante: negarse no puede haber cambiado nada.
inventario() { # $1 = etiqueta para el mensaje
  sql <<'SQL' | tail -1
select (select count(*) from public.crm_leads)
    || '/' || (select count(*) from public.crm_lead_actividades)
    || '/' || (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                 where ns.nspname = 'public' and p.proname like 'crm_lead%');
SQL
}
ANTES_NEGATIVA="$(inventario)"
if [ "$ANTES_NEGATIVA" = "$(inventario)" ] \
   && [ "$(inventario)" != "" ] \
   && [ "$(sql <<'SQL'
select (to_regclass('public.crm_leads') is not null)::text;
SQL
)" = "true" ]; then
  echo "OK    tras negarse, tablas, datos y funciones siguen intactos ($ANTES_NEGATIVA)"
else
  echo "FALLO el rollback cambió algo pese a negarse"; FALLOS=$((FALLOS + 1))
fi

# ── Rollback con el módulo vacío: solo objetos propios ──────────────────────
# Base nueva de cero: la cadena entera otra vez, ya sin leads.
docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "create database $DB" >/dev/null
sql < "$TMP/andamiaje.sql" >/dev/null
for f in "$MIG"/*.sql; do
  b=$(basename "$f")
  case "$b" in
    20260601000202*) continue ;;
  esac
  aplicar "$f" 1 || aplicar "$f" || { echo "FALLO al reaplicar $b"; exit 1; }
done
aplicar "$MIG/20260601000202_crm_leads.sql" 1 || { echo "FALLO al reaplicar la 202"; exit 1; }

# Inventario de objetos AJENOS al CRM antes del rollback (triggers sobre tablas
# que no son del CRM, y funciones que no son `crm_lead_*`). Si el rollback los
# toca, es que se pasó de alcance.
# Se mide en dos partes: lo que el rollback DEBE dejar igual (triggers sobre
# tablas ajenas y funciones que no son `crm_lead_*`) y lo que DEBE caer
# exactamente (las 2 tablas del CRM, sus 2 `trg_auditoria` y sus 23 funciones).
inventario() { # $1 = "ajeno" | "propio"
  sql <<SQL | tail -1
select case when '$1' = 'ajeno' then
    (select count(*) from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where not t.tgisinternal
       and c.relname not in ('crm_leads', 'crm_lead_actividades'))::text
    || '/' || (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                 where ns.nspname = 'public' and p.proname not like 'crm_lead%')::text
  else
    (select count(*) from pg_tables where schemaname = 'public')::text
    || '/' || (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_auditoria')::text
    || '/' || (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                 where ns.nspname = 'public' and p.proname like 'crm_lead%')::text
  end;
SQL
}

AJENOS_ANTES="$(inventario ajeno)"
PROPIOS_ANTES="$(inventario propio)"
RES="$(sql < "$AQUI/../rollback_202_crm_leads.sql" 2>&1 || true)"
AJENOS_DESPUES="$(inventario ajeno)"
PROPIOS_DESPUES="$(inventario propio)"

if printf '%s' "$RES" | grep -qi 'error\|FALLO'; then
  echo "FALLO el rollback vacío dio error:"; printf '%s\n' "$RES" | tail -5; FALLOS=$((FALLOS + 1))
elif [ "$AJENOS_ANTES" = "$AJENOS_DESPUES" ]; then
  echo "OK    rollback vacío: los objetos ajenos quedaron intactos (triggers ajenos/funciones ajenas = $AJENOS_DESPUES)"
else
  echo "FALLO el rollback tocó objetos ajenos: $AJENOS_ANTES -> $AJENOS_DESPUES"; FALLOS=$((FALLOS + 1))
fi

# Lo propio: tablas y trg_auditoria deben caer 2 y 2; las funciones, todas.
tab_antes="$(printf '%s' "$PROPIOS_ANTES" | cut -d/ -f1)"
tab_despues="$(printf '%s' "$PROPIOS_DESPUES" | cut -d/ -f1)"
aud_antes="$(printf '%s' "$PROPIOS_ANTES" | cut -d/ -f2)"
aud_despues="$(printf '%s' "$PROPIOS_DESPUES" | cut -d/ -f2)"
fn_antes="$(printf '%s' "$PROPIOS_ANTES" | cut -d/ -f3)"
fn_despues="$(printf '%s' "$PROPIOS_DESPUES" | cut -d/ -f3)"
if [ "$((tab_antes - tab_despues))" -eq 2 ] \
   && [ "$((aud_antes - aud_despues))" -eq 2 ] \
   && [ "$fn_antes" -gt 0 ] && [ "$fn_despues" -eq 0 ]; then
  echo "OK    rollback vacío: retiró exactamente sus 2 tablas, sus 2 trg_auditoria y sus $fn_antes funciones crm_lead*"
else
  echo "FALLO el rollback no retiró solo lo suyo: $PROPIOS_ANTES -> $PROPIOS_DESPUES"
  FALLOS=$((FALLOS + 1))
fi

RES="$(sql <<'SQL' | tail -1
select ((to_regclass('public.crm_leads') is null) and (to_regclass('public.crm_lead_actividades') is null))::text;
SQL
)"
if [ "$RES" = "true" ]; then
  echo "OK    las dos tablas del CRM desaparecieron"
else
  echo "FALLO quedaron tablas del CRM tras el rollback"; FALLOS=$((FALLOS + 1))
fi

if [ "$FALLOS" -eq 0 ]; then
  echo "PASO TODA LA PRUEBA DE LA 202"
else
  echo "$FALLOS FALLO(S)"; exit 1
fi