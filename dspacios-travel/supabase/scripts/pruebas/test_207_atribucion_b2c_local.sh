#!/bin/sh
# ───────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL · `atribuir_207_crm_contactos_acceso.sql` (atribución B2C).
#
# Solo bases DESECHABLES `crmatr_<dígitos>` creadas por este runner (cada una
# verificada inexistente antes del CREATE); solo borra esas. Nunca toca
# Supabase, Producción ni un Preview. Datos 100% sintéticos ("zz-*").
#
# Siembra ANTES de la 207 (como en Producción): 24 contactos E2 (alta del
# checkout: INSERT auditado sin actor, origen B2C), 7 E4 (junio, sin
# auditoría, sin edición) y contactos ajenos (internos y un B2C creado con
# sesión). Aplica la 207 y usa esa base como PLANTILLA: cada escenario corre
# sobre una copia limpia.
#
# Uso:  MSYS_NO_PATHCONV=1 sh supabase/scripts/pruebas/test_207_atribucion_b2c_local.sh [contenedor]
# ───────────────────────────────────────────────────────────────────────────
set -eu
CT="${1:-supabase_db_sbqvrckukbjzhtzqpyzg}"
PREF="crmatr_$(date +%s)$$"
AQUI="$(cd "$(dirname "$0")" && pwd)"
MIG="$AQUI/../../migrations"
M207="$MIG/20260601000207_crm_contactos_acceso.sql"
ATR="$AQUI/../atribuir_207_crm_contactos_acceso.sql"
PSQL="psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0
CREADAS=""
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

limpiar() {
  for b in $CREADAS; do
    docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "drop database if exists $b with (force)" >/dev/null 2>&1 || true
  done
  rm -rf "$TMP"
}
trap limpiar EXIT

# Crea una base desechable PROPIA (nombre validado, inexistente) — opcionalmente desde plantilla.
crear_base() { # $1 nombre, [$2 plantilla]
  case "$1" in crmatr_[0-9]*) ;; *) echo "Nombre inseguro: $1"; exit 2 ;; esac
  [ -z "$(echo "${1#crmatr_}" | tr -d '0-9')" ] || { echo "Nombre inseguro: $1"; exit 2; }
  ya=$(docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "select 1 from pg_database where datname = '$1'")
  [ -z "$ya" ] || { echo "La base $1 ya existe: no es de este runner; no se toca."; exit 2; }
  if [ -n "${2:-}" ]; then
    # La plantilla es una base PROPIA de este runner: se cierran las sesiones
    # que queden en ella (CREATE ... TEMPLATE exige que no haya ninguna).
    case " $CREADAS " in *" $2 "*) ;; *) echo "La plantilla $2 no es de este runner"; exit 2 ;; esac
    i=0
    until docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$2' and pid <> pg_backend_pid()" -c "create database $1 template $2" >/dev/null 2>"$TMP/clon.err"; do
      i=$((i + 1)); [ $i -ge 10 ] && { cat "$TMP/clon.err"; exit 1; }; sleep 1
    done
  else
    docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "create database $1" >/dev/null
  fi
  CREADAS="$CREADAS $1"
}
sqlf() { docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$1" -f -; }        # $1 base; stdin = SQL
sqlc() { docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$1" -c "$2"; }     # $1 base; $2 SQL
aplicar() { # $1 base, $2 archivo
  i=0
  while [ $i -lt 6 ]; do
    i=$((i + 1))
    docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL --single-transaction -d "$1" -f - < "$2" >/dev/null 2>"$TMP/mig.err" && return 0
    docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$1" -f - < "$2" >/dev/null 2>"$TMP/mig.err" && return 0
    grep -q 'recovery mode\|not accepting connections\|because of crash' "$TMP/mig.err" || return 1
    echo "   (Postgres local reiniciando; reintento $i/6)"; sleep 20
  done
  return 1
}

# ── Base plantilla: cadena vigente SIN la 207 → siembra → 207 ───────────────
BASE="$PREF"
crear_base "$BASE"
sqlf "$BASE" >/dev/null <<'SQL'
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
for f in "$MIG"/20260601000206_*.sql "$MIG"/20260601000208_*.sql; do
  [ -e "$f" ] && { echo "FALLO escenario: existe $(basename "$f"); esta prueba es sin 206 ni 208"; exit 1; }
done
n=0
for f in "$MIG"/*.sql; do
  case "$(basename "$f")" in 20260601000207_*) continue ;; esac
  aplicar "$BASE" "$f" || { echo "FALLO al aplicar $(basename "$f")"; cat "$TMP/mig.err"; exit 1; }
  n=$((n + 1))
done
echo "== $n migraciones aplicadas sin la 207 (última: $(ls "$MIG" | grep -v 20260601000207 | tail -1))"

# Siembra histórica (todavía sin columna tenant).
sqlf "$BASE" >/dev/null <<'SQL'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000e0001', 'zz-atr-1@x.test');
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
values ('00000000-0000-0000-0000-0000000e0001', 'zz-atr-1@x.test', 'zz venta', 'venta', true, 'mayorista')
on conflict (id) do update set rol = 'venta', activo = true, tenant = 'mayorista';

-- E4: 7 altas de junio, SIN auditoría (trigger apagado), sin edición.
set session_replication_role = replica;
insert into public.crm_contactos (nombre, categoria, origen, tipo_doc, documento, created_at, updated_at)
select 'zz-E4-' || i, 'cliente_final', 'Cotización tarifario (B2C)', 'CC', (4000 + i)::text,
       timestamptz '2026-06-08 12:00-05' + i * interval '1 day',
       timestamptz '2026-06-08 12:00-05' + i * interval '1 day'
  from generate_series(1, 7) i;
set session_replication_role = origin;

-- E2: 24 altas del checkout (service_role, sin sesión) → INSERT auditado sin actor.
insert into public.crm_contactos (nombre, categoria, origen, tipo_doc, documento)
select 'zz-E2-' || i, 'cliente_final', 'Cotización tarifario (B2C)', 'CC', (2000 + i)::text
  from generate_series(1, 24) i;

-- Ajenos: contactos internos con sesión y un B2C creado CON actor (no E2).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000e0001","role":"authenticated"}', false);
insert into public.crm_contactos (nombre, categoria, origen, tipo_doc, documento)
values ('zz-AJ-1', 'cliente_final', 'manual', 'CC', '9001'),
       ('zz-AJ-2', 'agencia', 'cargue B2B', null, '9002'),
       ('zz-AJ-3', 'cliente_final', 'Cotización tarifario (B2C)', 'CC', '9003');
SQL
aplicar "$BASE" "$M207" || { echo "FALLO al aplicar la 207"; cat "$TMP/mig.err"; exit 1; }
echo "== 207 aplicada sobre la siembra; plantilla lista"

CONF="$TMP/atribuir_confirmado.sql"
sed 's/^-- select set_config(.app\.atribuir_crm_b2c/select set_config('"'"'app.atribuir_crm_b2c/' "$ATR" > "$CONF"
grep -q "^select set_config('app.atribuir_crm_b2c'" "$CONF" || { echo "FALLO no se pudo preparar la versión habilitada"; exit 1; }
# Versión habilitada que, además, retiene el LOCK 4 s antes del COMMIT (carreras).
sed 's/^commit;$/select pg_sleep(4);\ncommit;/' "$CONF" > "$TMP/atribuir_lento.sql"

huella() { sqlc "$1" "select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.crm_contactos c;" | tail -1; }
huella_ajenos() { sqlc "$1" "select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.crm_contactos c where c.nombre not like 'zz-E2-%' and c.nombre not like 'zz-E4-%';" | tail -1; }
estado() { sqlc "$1" "select count(*) filter (where nombre ~ '^zz-E[24]-' and tenant = 'mayorista') || '/' || count(*) filter (where nombre ~ '^zz-E[24]-' and tenant is null) || '/' || count(*) filter (where tenant is null) || '/' || count(*) from public.crm_contactos;" | tail -1; }
k=0
clon() { k=$((k + 1)); C="${PREF}${k}"; crear_base "$C" "$BASE"; }
# Corre el script habilitado en $C y exige que ABORTE con $1, dejando la tabla idéntica.
debe_abortar() { # $1 patrón del mensaje, $2 etiqueta
  H0=$(huella "$C")
  if sqlf "$C" < "$CONF" > "$TMP/out.txt" 2>&1; then fallo "$2: no abortó"; return; fi
  if grep -q "$1" "$TMP/out.txt" && [ "$(huella "$C")" = "$H0" ]; then ok "$2"
  else fallo "$2: $(grep -o 'ERROR.*' "$TMP/out.txt" | head -1)"; fi
}

# 1) Apagado (archivo tal cual): simulacro, verifica 24/7/31 y no escribe.
clon; H0=$(huella "$C")
if sqlf "$C" < "$ATR" > "$TMP/out.txt" 2>&1; then fallo "apagado: no abortó"
elif grep -q "APAGADA (simulacro): candidatos frescos E2=24 E4=7 total=31" "$TMP/out.txt" && [ "$(huella "$C")" = "$H0" ]; then
  ok "apagado (tal cual en el repo): simulacro E2=24 E4=7 total=31, nada escrito"
else fallo "apagado: $(grep -o 'ERROR.*' "$TMP/out.txt" | head -1)"; fi

# 2) Lote válido habilitado + 3) reintento.
clon; HA=$(huella_ajenos "$C")
if sqlf "$C" < "$CONF" > "$TMP/out.txt" 2>&1 && grep -q "Atribución B2C OK: 31 filas → mayorista (E2=24, E4=7)" "$TMP/out.txt"; then
  E=$(estado "$C")
  if [ "$E" = "31/0/3/34" ] && [ "$(huella_ajenos "$C")" = "$HA" ]; then
    ok "lote válido: 31 → mayorista (E2=24, E4=7); 3 ajenos siguen NULL e idénticos (estado $E)"
  else fallo "lote válido: estado $E"; fi
  AUD=$(sqlc "$C" "select count(*) from public.auditoria where tabla = 'crm_contactos' and accion = 'UPDATE' and cambios ? 'tenant';" | tail -1)
  [ "$AUD" = 31 ] && ok "la atribución quedó auditada: 31 UPDATE de tenant" || fallo "auditoría de la atribución: $AUD"
else fallo "lote válido: $(grep -o 'ERROR.*' "$TMP/out.txt" | head -1)"; fi
debe_abortar "candidatos frescos E2=0 E4=0 total=0" "reintento tras éxito: aborta (E2=0 E4=0) sin cambios"

# 4) Origen distinto (sin tilde) en un E2 → E2=23.
clon; sqlc "$C" "set session_replication_role = replica; update public.crm_contactos set origen = 'Cotizacion tarifario (B2C)' where nombre = 'zz-E2-1';" >/dev/null
debe_abortar "E2=23 E4=7 total=30" "origen distinto en un E2: aborta (E2=23)"
# 5) Categoría distinta en un E4 → E4=6.
clon; sqlc "$C" "set session_replication_role = replica; update public.crm_contactos set categoria = 'agencia' where nombre = 'zz-E4-1';" >/dev/null
debe_abortar "E2=24 E4=6 total=30" "categoría distinta en un E4: aborta (E4=6)"
# 6) E4 posterior al primer evento global, y E4 editado.
clon; sqlc "$C" "set session_replication_role = replica; update public.crm_contactos set created_at = now() + interval '1 day', updated_at = now() + interval '1 day' where nombre = 'zz-E4-2';" >/dev/null
debe_abortar "E2=24 E4=6 total=30" "E4 creado después del primer evento auditado: aborta (E4=6)"
clon; sqlc "$C" "set session_replication_role = replica; update public.crm_contactos set updated_at = created_at + interval '1 day' where nombre = 'zz-E4-3';" >/dev/null
debe_abortar "E2=24 E4=6 total=30" "E4 con señal de edición (updated_at): aborta (E4=6)"
# 7) Auditoría contradictoria: UPDATE de categoría, segundo INSERT, INSERT con actor, evento sobre un E4.
clon; sqlc "$C" "insert into public.auditoria (accion, tabla, registro_id, cambios) select 'UPDATE', 'crm_contactos', id::text, '{\"categoria\":{\"antes\":\"agencia\",\"despues\":\"cliente_final\"}}' from public.crm_contactos where nombre = 'zz-E2-2';" >/dev/null
debe_abortar "E2=23 E4=7 total=30" "auditoría contradictoria (UPDATE de categoría en un E2): aborta"
clon; sqlc "$C" "insert into public.auditoria (accion, tabla, registro_id, despues) select 'INSERT', 'crm_contactos', id::text, jsonb_build_object('origen', origen) from public.crm_contactos where nombre = 'zz-E2-3';" >/dev/null
debe_abortar "E2=23 E4=7 total=30" "auditoría contradictoria (segundo INSERT en un E2): aborta"
clon; sqlc "$C" "update public.auditoria set actor_id = '00000000-0000-0000-0000-0000000e0001' where tabla = 'crm_contactos' and accion = 'INSERT' and registro_id = (select id::text from public.crm_contactos where nombre = 'zz-E2-4');" >/dev/null
debe_abortar "E2=23 E4=7 total=30" "auditoría contradictoria (INSERT con actor en un E2): aborta"
clon; sqlc "$C" "insert into public.auditoria (accion, tabla, registro_id) select 'UPDATE', 'crm_contactos', id::text from public.crm_contactos where nombre = 'zz-E4-4';" >/dev/null
debe_abortar "E2=24 E4=6 total=30" "auditoría contradictoria (evento sobre un E4): aborta"
# Una edición INOCUA de un E2 (teléfono) no lo descalifica.
clon; sqlc "$C" "insert into public.auditoria (accion, tabla, registro_id, cambios) select 'UPDATE', 'crm_contactos', id::text, '{\"telefono\":{\"antes\":null,\"despues\":\"x\"}}' from public.crm_contactos where nombre = 'zz-E2-5';" >/dev/null
if sqlf "$C" < "$CONF" > "$TMP/out.txt" 2>&1 && grep -q "31 filas → mayorista" "$TMP/out.txt"; then ok "edición inocua (teléfono) de un E2: sigue siendo candidato, 31 atribuidos"
else fallo "edición inocua: $(grep -o 'ERROR.*' "$TMP/out.txt" | head -1)"; fi
# 8) Tenant ya asignado en un E2 → E2=23 y esa fila conserva su agencia.
clon; sqlc "$C" "update public.crm_contactos set tenant = 'minorista' where nombre = 'zz-E2-6';" >/dev/null
debe_abortar "E2=23 E4=7 total=30" "tenant ya asignado en un E2: aborta (E2=23), la fila sigue en minorista"
# 9) Contacto B2C número 32: candidato válido nuevo → aborta; no candidato → 31 y queda intacto.
clon; sqlc "$C" "insert into public.crm_contactos (nombre, categoria, origen, tipo_doc, documento) values ('zz-N32', 'cliente_final', 'Cotización tarifario (B2C)', 'CC', '3200');" >/dev/null
debe_abortar "E2=25 E4=7 total=32" "B2C número 32 con el patrón (alta sin tenant en la ventana): aborta (E2=25)"
clon; sqlc "$C" "insert into public.crm_contactos (nombre, categoria, origen, tipo_doc, documento) values ('zz-N32', 'cliente_final', 'Cotización tarifario (B2C)', 'CE', '3201');" >/dev/null
HA=$(huella_ajenos "$C")
if sqlf "$C" < "$CONF" > "$TMP/out.txt" 2>&1 && grep -q "31 filas → mayorista" "$TMP/out.txt" \
   && [ "$(huella_ajenos "$C")" = "$HA" ] \
   && [ "$(sqlc "$C" "select coalesce(tenant, 'NULL') from public.crm_contactos where nombre = 'zz-N32';" | tail -1)" = NULL ]; then
  ok "B2C número 32 fuera del patrón (CE): se atribuyen exactamente 31 y el 32 queda intacto (NULL)"
else fallo "B2C 32 fuera del patrón: $(grep -o 'ERROR.*' "$TMP/out.txt" | head -1)"; fi

# 10) Concurrencia.
# (a) Una alta B2C válida SIN confirmar retiene la tabla: el script espera el LOCK,
#     ve la fila al confirmarse y aborta (E2=25). No queda nada atribuido.
clon
( sqlc "$C" "begin; insert into public.crm_contactos (nombre, categoria, origen, tipo_doc, documento) values ('zz-CC1', 'cliente_final', 'Cotización tarifario (B2C)', 'CC', '3300'); select pg_sleep(4); commit;" >/dev/null 2>&1 ) &
sleep 1
if sqlf "$C" < "$CONF" > "$TMP/out.txt" 2>&1; then R=paso; else R=aborto; fi
wait
E=$(estado "$C")
if [ "$R" = aborto ] && grep -q "E2=25 E4=7 total=32" "$TMP/out.txt" && [ "$E" = "0/31/35/35" ]; then
  ok "carrera (alta concurrente primero): el script espera, ve la alta y aborta; nada atribuido ($E)"
else fallo "carrera (a): $R $E $(grep -o 'ERROR.*' "$TMP/out.txt" | head -1)"; fi
# (b) El script retiene el LOCK; la alta concurrente ESPERA y entra después: 31
#     atribuidos y la alta nueva queda intacta (NULL) para la reconciliación.
clon
( sqlf "$C" < "$TMP/atribuir_lento.sql" > "$TMP/outb.txt" 2>&1 ) &
sleep 2
T0=$(date +%s)
sqlc "$C" "insert into public.crm_contactos (nombre, categoria, origen, tipo_doc, documento) values ('zz-CC2', 'cliente_final', 'Cotización tarifario (B2C)', 'CC', '3301');" >/dev/null
T1=$(date +%s)
wait
E=$(estado "$C")
N=$(sqlc "$C" "select coalesce(tenant, 'NULL') from public.crm_contactos where nombre = 'zz-CC2';" | tail -1)
if grep -q "31 filas → mayorista" "$TMP/outb.txt" && [ "$E" = "31/0/4/35" ] && [ "$N" = NULL ] && [ $((T1 - T0)) -ge 1 ]; then
  ok "carrera (script primero): la alta esperó el LOCK ($((T1 - T0)) s) y quedó NULL; 31 atribuidos ($E)"
else fallo "carrera (b): estado $E nueva=$N espera=$((T1 - T0))s $(grep -o 'ERROR.*' "$TMP/outb.txt" | head -1)"; fi
# (c) Dos ejecuciones simultáneas: una atribuye, la otra espera y aborta (E2=0).
clon
( sqlf "$C" < "$TMP/atribuir_lento.sql" > "$TMP/outc1.txt" 2>&1 ) &
sleep 1
if sqlf "$C" < "$CONF" > "$TMP/outc2.txt" 2>&1; then R=paso; else R=aborto; fi
wait
if grep -q "31 filas → mayorista" "$TMP/outc1.txt" && [ "$R" = aborto ] && grep -q "E2=0 E4=0 total=0" "$TMP/outc2.txt" && [ "$(estado "$C")" = "31/0/3/34" ]; then
  ok "dos ejecuciones a la vez: una atribuye 31, la otra espera el LOCK y aborta sin cambios"
else fallo "dos ejecuciones: $R $(estado "$C")"; fi

# 11) Reversión total: un efecto colateral sobre un contacto ajeno, DENTRO de la
#     misma transacción, se detecta después del UPDATE y revierte TODO.
clon
sqlc "$C" "create function public.zz_colateral() returns trigger language plpgsql as \$f\$ begin update public.crm_contactos set notas = 'colateral' where nombre = 'zz-AJ-1' and notas is distinct from 'colateral'; return new; end \$f\$;
           create trigger zz_colateral after update of tenant on public.crm_contactos for each statement execute function public.zz_colateral();" >/dev/null
debe_abortar "cambió algún contacto ajeno al lote. Todo revertido" "efecto colateral en un contacto ajeno: aborta y revierte TODO (31 siguen NULL, ajeno intacto)"
[ "$(estado "$C")" = "0/31/34/34" ] && ok "tras la reversión: 0 atribuidos, 31 del lote NULL" || fallo "tras la reversión: $(estado "$C")"

# 12) Sin la 207 aplicada: aborta sin tocar nada.
k=$((k + 1)); C="${PREF}${k}"; crear_base "$C" "$BASE"
sqlc "$C" "alter table public.crm_contactos drop column tenant cascade;" >/dev/null 2>&1 || true
if sqlf "$C" < "$CONF" > "$TMP/out.txt" 2>&1; then fallo "sin columna tenant: no abortó"
elif grep -q "falta crm_contactos.tenant\|column \"tenant\" does not exist\|tenant" "$TMP/out.txt"; then ok "sin la 207 (sin columna tenant): aborta sin escribir"
else fallo "sin la 207: $(grep -o 'ERROR.*' "$TMP/out.txt" | head -1)"; fi

# 13) La salida nunca contiene nombres, documentos ni emails.
if cat "$TMP"/out*.txt | grep -qE 'zz-(E2|E4|AJ|N32|CC)|@x\.test|[^0-9]2[0-9]{3}[^0-9]|[^0-9]40[0-9]{2}[^0-9]'; then
  fallo "la salida del script contiene datos de contactos"
else ok "la salida del script solo trae conteos (sin nombres, documentos ni emails)"; fi

echo
if [ "$FALLOS" -eq 0 ]; then echo "== TODO OK"; else echo "== $FALLOS FALLO(S)"; exit 1; fi
