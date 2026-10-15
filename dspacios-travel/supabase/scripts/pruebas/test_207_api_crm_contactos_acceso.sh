#!/bin/sh
# ───────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL de la SONDA POR API (`api_207_crm_contactos_acceso.mjs`).
#
# Monta, solo en local: una base DESECHABLE `crmapi_<n>` (cadena vigente SIN
# la 207 — con la 209, sin 206/208 —; la 207 se aplica en el paso probado), un PostgREST real (imagen supabase/postgrest, contenedor
# PROPIO con nombre único) y `mock_supabase_local.mjs` (GoTrue mínimo +
# reenvío de /rest/v1). Así la sonda corre SIN cambios, por HTTP de verdad,
# y la RLS que decide es la de PostgreSQL.
#
# Comprueba:
#   pre  antes de migrar → mide totales; B2B ve > 0 = EVIDENCIA, sale 0
#   post antes de migrar → FALLA (anon no revocado, conteos por tenant con
#        error): un error HTTP/SQL nunca se lee como "0 visibles"
#   post después de migrar → TODO OK
#   post con una sesión faltante → INCOMPLETA; con categoría mal declarada →
#        FALLO; con el JSON de credenciales dentro del repo → se niega
#   la salida no contiene emails, ids ni JWT
#
# Limpia al terminar (pase o falle) SOLO lo que creó: su base, su contenedor
# PostgREST y su proceso Node. Datos 100% sintéticos.
#
# Uso:  MSYS_NO_PATHCONV=1 sh supabase/scripts/pruebas/test_207_api_crm_contactos_acceso.sh [contenedor_db]
# ───────────────────────────────────────────────────────────────────────────
set -eu
CT="${1:-supabase_db_sbqvrckukbjzhtzqpyzg}"
SUFIJO="$(date +%s)"
DB="${CRMAPI_DB:-crmapi_$SUFIJO$$}"   # CRMAPI_DB solo para probar la guarda
RESTCT="pgrst_crmapi_$SUFIJO"
AQUI="$(cd "$(dirname "$0")" && pwd)"
MIG="$AQUI/../../migrations"
M207="$MIG/20260601000207_crm_contactos_acceso.sql"
SONDA="$AQUI/api_207_crm_contactos_acceso.mjs"
APP="$AQUI/../../.."
PSQL="psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
SECRETO="local-$(date +%s%N)-secreto-de-prueba-crmapi"
FALLOS=0
MOCKPID=""
DB_CREADA=""
REST_CREADO=""
ok()    { echo "OK    $1"; }
# Node en Windows no entiende rutas POSIX de Git Bash (/tmp, /c/...).
nativo() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

limpiar() {
  [ -n "$MOCKPID" ] && kill "$MOCKPID" 2>/dev/null || true
  [ -n "$REST_CREADO" ] && docker rm -f "$RESTCT" >/dev/null 2>&1 || true
  [ -n "$DB_CREADA" ] && docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap limpiar EXIT

sql()  { docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -f -; }
sqlv() { docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -c "$1"; }
aplicar() {
  intentos=0
  while [ "$intentos" -lt 6 ]; do
    intentos=$((intentos + 1))
    if [ -n "${2:-}" ]; then
      docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL --single-transaction -d "$DB" -f - < "$1" >/dev/null 2>"$TMP/mig.err" && return 0
    else
      docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -f - < "$1" >/dev/null 2>"$TMP/mig.err" && return 0
    fi
    grep -q 'recovery mode\|not accepting connections\|because of crash' "$TMP/mig.err" || return 1
    echo "   (Postgres local reiniciando; reintento $intentos/6)"; sleep 20
  done
  return 1
}

# ── Base desechable + cadena de migraciones ─────────────────────────────────
# ── Base desechable: nombre validado, inexistente y creada por ESTE runner ──
case "$DB" in
  crmapi_[0-9]*) ;;
  *) echo "Nombre de base inseguro: $DB"; exit 2 ;;
esac
if [ -n "$(echo "${DB#crmapi_}" | tr -d '0-9')" ]; then echo "Nombre de base inseguro: $DB"; exit 2; fi
YA=$(docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "select 1 from pg_database where datname = '$DB'")
if [ -n "$YA" ]; then echo "La base $DB ya existe: no es de este runner; no se toca."; exit 2; fi
docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "create database $DB" >/dev/null && DB_CREADA=1
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
grant usage on schema auth, storage, public, extensions to anon, authenticated, service_role;
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
sql >/dev/null <<'SQL'
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public, auth to anon, authenticated, service_role;
SQL
echo "== cadena de migraciones aplicada en $DB"

# ── Usuarios sintéticos (uno por categoría + uno mal declarado) ─────────────
sql >/dev/null <<'SQL'
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000d00' || lpad(i::text, 2, '0'))::uuid, 'zz-api-' || i || '@x.test'
  from generate_series(1, 6) i;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select ('00000000-0000-0000-0000-0000000d00' || lpad(i::text, 2, '0'))::uuid, 'zz-api-' || i || '@x.test', 'zz ' || r, r::rol_usuario, true, t
  from (values (1,'agencia','mayorista'), (2,'venta','mayorista'), (3,'venta','minorista'),
               (4,'gerencia','mayorista'), (5,'superadmin','mayorista'), (6,'administracion','minorista')) v(i, r, t)
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
SQL
cat > "$TMP/usuarios.json" <<'JSON'
{ "zz-api-1@x.test": { "id": "00000000-0000-0000-0000-0000000d0001", "password": "p1" },
  "zz-api-2@x.test": { "id": "00000000-0000-0000-0000-0000000d0002", "password": "p2" },
  "zz-api-3@x.test": { "id": "00000000-0000-0000-0000-0000000d0003", "password": "p3" },
  "zz-api-4@x.test": { "id": "00000000-0000-0000-0000-0000000d0004", "password": "p4" },
  "zz-api-5@x.test": { "id": "00000000-0000-0000-0000-0000000d0005", "password": "p5" },
  "zz-api-6@x.test": { "id": "00000000-0000-0000-0000-0000000d0006", "password": "p6" } }
JSON
cuentas() { # $1 = archivo destino; $2 = "sin_superadmin" | "mal" | ""
  {
    echo '['
    echo '{"categoria":"b2b","email":"zz-api-1@x.test","password":"p1"},'
    if [ "${2:-}" = mal ]; then
      echo '{"categoria":"interno_mayorista","email":"zz-api-3@x.test","password":"p3"},'
    else
      echo '{"categoria":"interno_mayorista","email":"zz-api-2@x.test","password":"p2"},'
    fi
    echo '{"categoria":"interno_minorista","email":"zz-api-3@x.test","password":"p3"},'
    if [ "${2:-}" = sin_superadmin ]; then
      echo '{"categoria":"gerencia","email":"zz-api-4@x.test","password":"p4"}'
    else
      echo '{"categoria":"gerencia","email":"zz-api-4@x.test","password":"p4"},'
      echo '{"categoria":"superadmin","email":"zz-api-5@x.test","password":"p5"}'
    fi
    echo ']'
  } > "$1"
}
cuentas "$TMP/cuentas.json"
cuentas "$TMP/cuentas_incompleta.json" sin_superadmin
cuentas "$TMP/cuentas_mal.json" mal

# Contactos históricos (antes de la migración), creados por usuarios de las dos agencias.
como() { echo "set role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-0000000d00$1\",\"role\":\"authenticated\"}', false);"; }
sqlv "$(como 02) insert into public.crm_contactos (nombre) values ('zz-A1'), ('zz-A2');" >/dev/null
sqlv "$(como 06) insert into public.crm_contactos (nombre) values ('zz-A3');" >/dev/null

# ── PostgREST propio + simulador de auth ────────────────────────────────────
RED=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$CT")
docker run -d --name "$RESTCT" --network "$RED" -p 127.0.0.1::3000 \
  -e PGRST_DB_URI="postgres://authenticator:postgres@$CT:5432/$DB" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$SECRETO" -e PGRST_DB_CHANNEL_ENABLED=true \
  public.ecr.aws/supabase/postgrest:v16.1 >/dev/null && REST_CREADO=1
PRESTO=$(docker port "$RESTCT" 3000/tcp | head -1 | sed 's/.*://')
node "$(nativo "$AQUI/mock_supabase_local.mjs")" "$PRESTO" "$SECRETO" "$(nativo "$TMP/usuarios.json")" "$(nativo "$TMP/mock.json")" &
MOCKPID=$!
i=0; until [ -s "$TMP/mock.json" ] || [ $i -ge 30 ]; do sleep 1; i=$((i + 1)); done
MPUERTO=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).puerto)" "$(nativo "$TMP/mock.json")")
ANONKEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).anonKey)" "$(nativo "$TMP/mock.json")")
i=0; until curl -s -o /dev/null "http://127.0.0.1:$PRESTO/" || [ $i -ge 60 ]; do sleep 1; i=$((i + 1)); done
echo "== PostgREST y simulador arriba"

sonda() { # $1 fase, $2 archivo de cuentas, $3 salida, [$4 totales "S / M / N"], [$5 argumento extra] → código de salida
  ( cd "$APP" && NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$MPUERTO" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANONKEY" \
      CRM_ACCESO_CUENTAS="$(nativo "$2")" node "$(nativo "$SONDA")" --fase="$1" ${4:+"--totales=$4"} ${5:+"$5"} > "$3" 2>&1 ) && return 0 || return $?
}
# Totales autorizados = fila 20 del postcheck (como los copia el usuario).
totales_postcheck() {
  sql < "$AQUI/../postcheck_207_crm_contactos_acceso.sql" | grep '^20|' | awk -F'|' '{print $NF}'
}
sin_datos() { # $1 archivo de salida
  if grep -qiE 'zz-api|@x\.test|0000000d00|eyJ|p[1-6]"' "$1"; then fallo "la sonda imprimió credenciales/ids/JWT ($(basename "$1"))"; return; fi
}

# 1) PRE antes de migrar: mide, deja evidencia de la fuga, termina 0.
RC=0; sonda pre "$TMP/cuentas.json" "$TMP/pre.txt" || RC=$?
if [ "$RC" = 0 ] && grep -q '^EVIDENCIA b2b: ve 3 ' "$TMP/pre.txt" && grep -q '^OK    anon' "$TMP/pre.txt" && grep -q '== TODO OK' "$TMP/pre.txt"; then
  ok "pre (sin migrar): B2B ve 3 (EVIDENCIA de la fuga), anon 0, todas las sesiones medidas"
else fallo "pre inesperada (rc=$RC):"; cat "$TMP/pre.txt"; fi
sin_datos "$TMP/pre.txt"

# 2) POST antes de migrar: debe FALLAR; los errores no cuentan como cero.
RC=0; sonda post "$TMP/cuentas.json" "$TMP/post0.txt" "3 / 0 / 0" || RC=$?
if [ "$RC" = 1 ] && grep -q 'FALLO anon: respondió HTTP 200' "$TMP/post0.txt" \
   && grep -q 'FALLO interno_mayorista: conteo "propia" falló' "$TMP/post0.txt" \
   && grep -q 'FALLO b2b: FUGA\|FALLO b2b: conteo' "$TMP/post0.txt"; then
  ok "post sin migrar: FALLA (anon con GRANT, conteos por tenant con error HTTP, B2B ve) — ningún error leído como 0"
else fallo "post sin migrar debía fallar (rc=$RC):"; cat "$TMP/post0.txt"; fi
sin_datos "$TMP/post0.txt"

# ── Migración + contactos nuevos con agencia ────────────────────────────────
aplicar "$M207" 1 || { fallo "la migración no aplicó"; cat "$TMP/mig.err"; exit 1; }
sqlv "$(como 02) insert into public.crm_contactos (nombre, tenant) values ('zz-B1', 'mayorista');" >/dev/null
sqlv "$(como 03) insert into public.crm_contactos (nombre, tenant) values ('zz-B2', 'minorista');" >/dev/null
sqlv "$(como 05) insert into public.crm_contactos (nombre, tenant) values ('zz-B3', 'minorista');" >/dev/null
# PostgREST recarga el esquema por el NOTIFY de la migración (sin reiniciar:
# un reinicio cambia el puerto publicado). Mientras no recargue, pedir la
# columna nueva da 400 (columna desconocida); después, anon recibe 401/403.
sqlv "notify pgrst, 'reload schema';" >/dev/null
i=0
while :; do
  CODIGO=$(curl -s -o /dev/null -w '%{http_code}' -I -H "apikey: $ANONKEY" -H "Authorization: Bearer $ANONKEY"     "http://127.0.0.1:$PRESTO/crm_contactos?select=tenant&limit=0" || true)
  case "$CODIGO" in 401|403) break ;; esac
  i=$((i + 1)); [ $i -ge 60 ] && { echo "PostgREST no recargó el esquema (último código $CODIGO)"; break; }
  sleep 1
done

# 3) POST después de migrar: TODO OK.
TOTALES=$(totales_postcheck)
[ "$TOTALES" = "3 / 1 / 2" ] && ok "postcheck fila 20 (sin atribuir / mayorista / minorista) = $TOTALES" || fallo "totales del postcheck inesperados: '$TOTALES'"
RC=0; sonda post "$TMP/cuentas.json" "$TMP/post.txt" "$TOTALES" || RC=$?
if [ "$RC" = 0 ] && grep -q '== TODO OK' "$TMP/post.txt" \
   && grep -q 'categoria=b2b .*visibles=0' "$TMP/post.txt" \
   && grep -q 'categoria=interno_mayorista .*visibles=1 .*otra_agencia=0 .*sin_atribuir=0' "$TMP/post.txt" \
   && grep -q 'categoria=interno_minorista .*visibles=2 .*otra_agencia=0 .*sin_atribuir=0' "$TMP/post.txt" \
   && grep -q 'categoria=gerencia .*visibles=6 .*propia=1 .*otra_agencia=2 .*sin_atribuir=3' "$TMP/post.txt" \
   && grep -q 'OK    anon negado por privilegio' "$TMP/post.txt"; then
  ok "post (migrada): anon negado 401/403, B2B 0, internos solo su agencia, gerencia/superadmin ambas + sin atribuir"
else fallo "post migrada inesperada (rc=$RC):"; cat "$TMP/post.txt"; fi
sin_datos "$TMP/post.txt"

# 4) Sesión faltante → INCOMPLETA.
RC=0; sonda post "$TMP/cuentas_incompleta.json" "$TMP/inc.txt" "$TOTALES" || RC=$?
if [ "$RC" = 1 ] && grep -q 'INCOMPLETA: faltan sesiones de superadmin' "$TMP/inc.txt"; then
  ok "sin sesión de superadmin: INCOMPLETA y código 1"
else fallo "sesión faltante no detectada (rc=$RC)"; cat "$TMP/inc.txt"; fi

# 5) Categoría mal declarada → FALLO.
RC=0; sonda post "$TMP/cuentas_mal.json" "$TMP/mal.txt" "$TOTALES" || RC=$?
if [ "$RC" = 1 ] && grep -q 'FALLO interno_mayorista: la cuenta es "interno_minorista"' "$TMP/mal.txt"; then
  ok "cuenta declarada en la categoría equivocada: FALLO"
else fallo "categoría equivocada no detectada (rc=$RC)"; cat "$TMP/mal.txt"; fi
sin_datos "$TMP/mal.txt"

# 6) Credenciales dentro del repo → se niega antes de conectarse.
cp "$TMP/cuentas.json" "$APP/.cuentas_prueba_crm.json"
RC=0; sonda post "$APP/.cuentas_prueba_crm.json" "$TMP/repo.txt" "$TOTALES" || RC=$?
rm -f "$APP/.cuentas_prueba_crm.json"
if [ "$RC" = 2 ] && grep -q 'DENTRO del repositorio' "$TMP/repo.txt"; then
  ok "JSON de credenciales dentro del repo: se niega (código 2)"
else fallo "no se negó con credenciales dentro del repo (rc=$RC)"; cat "$TMP/repo.txt"; fi

# 7) post sin --totales: se niega (código 2): sin totales no puede verificar
#    que el acceso legítimo siga completo.
RC=0; sonda post "$TMP/cuentas.json" "$TMP/sintot.txt" || RC=$?
if [ "$RC" = 2 ] && grep -q 'falta --totales' "$TMP/sintot.txt"; then ok "post sin --totales: se niega (código 2)"
else fallo "post sin totales no se negó (rc=$RC)"; cat "$TMP/sintot.txt"; fi

# 8) Totales que no cuadran (uno más en mayorista): FALLO por PÉRDIDA, no OK.
RC=0; sonda post "$TMP/cuentas.json" "$TMP/tot_mal.txt" "3 / 2 / 2" || RC=$?
if [ "$RC" = 1 ] && grep -q 'FALLO interno_mayorista: PÉRDIDA de acceso legítimo: ve 1 propia, autorizado 2' "$TMP/tot_mal.txt" \
   && grep -q 'FALLO gerencia: PÉRDIDA' "$TMP/tot_mal.txt" && grep -q 'FALLO superadmin: PÉRDIDA' "$TMP/tot_mal.txt" \
   && grep -q '^OK    interno_minorista' "$TMP/tot_mal.txt" && grep -q '^OK    b2b' "$TMP/tot_mal.txt"; then
  ok "totales que no cuadran: FALLO PÉRDIDA en interno mayorista, gerencia y superadmin; minorista y B2B OK"
else fallo "totales que no cuadran no se detectaron (rc=$RC)"; cat "$TMP/tot_mal.txt"; fi

# 9) Regresión REAL demasiado cerrada: la lectura deja fuera a `venta` y aísla
#    también a gerencia/superadmin a su agencia (sin "sin atribuir"). No hay
#    fuga, pero el CRM interno pierde acceso: la sonda debe FALLAR.
sql >/dev/null <<'SQL'
drop policy "crm_contactos: interno lectura" on public.crm_contactos;
create policy "crm_contactos: interno lectura" on public.crm_contactos for select to authenticated
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
         and tenant is not null and tenant = public.mi_tenant());
SQL
RC=0; sonda post "$TMP/cuentas.json" "$TMP/cerrada.txt" "$TOTALES" || RC=$?
if [ "$RC" = 1 ] && grep -q 'FALLO interno_mayorista: PÉRDIDA de acceso legítimo: ve 0 propia, autorizado 1' "$TMP/cerrada.txt" \
   && grep -q 'FALLO interno_minorista: PÉRDIDA de acceso legítimo: ve 0 propia, autorizado 2' "$TMP/cerrada.txt" \
   && grep -q 'FALLO gerencia: PÉRDIDA de acceso legítimo: ve 0 otra agencia, autorizado 2; PÉRDIDA de acceso legítimo: ve 0 sin atribuir, autorizado 3' "$TMP/cerrada.txt" \
   && grep -q 'FALLO superadmin: PÉRDIDA' "$TMP/cerrada.txt" && grep -q '^OK    b2b' "$TMP/cerrada.txt" \
   && grep -q 'OK    anon negado' "$TMP/cerrada.txt"; then
  ok "policy demasiado cerrada (sin fuga): FALLO PÉRDIDA en venta de ambas agencias, gerencia y superadmin; B2B/anon siguen OK"
else fallo "la pérdida de acceso legítimo no se detectó (rc=$RC)"; cat "$TMP/cerrada.txt"; fi
sin_datos "$TMP/cerrada.txt"
# Re-aplicar la migración restaura la policy correcta → OK otra vez.
aplicar "$M207" 1 || { fallo "re-aplicar la migración falló"; cat "$TMP/mig.err"; }
RC=0; sonda post "$TMP/cuentas.json" "$TMP/post2.txt" "$(totales_postcheck)" || RC=$?
if [ "$RC" = 0 ] && grep -q '== TODO OK' "$TMP/post2.txt"; then ok "tras re-aplicar la migración: post vuelve a TODO OK"
else fallo "post tras re-aplicar (rc=$RC)"; cat "$TMP/post2.txt"; fi

# ── Omisión explícita de interno_minorista (Producción hoy: 0 usuarios) ────
FILA30() { sql < "$AQUI/../preflight_207_crm_contactos_acceso.sql" | grep '^D|usuarios internos activos' | awk -F'|' '{print $NF}'; }
# JSON sin la cuenta interno_minorista.
grep -v 'interno_minorista' "$TMP/cuentas.json" > "$TMP/cuentas_sin_min.json"
CERO='administracion·mayorista=1, gerencia·mayorista=1, superadmin·mayorista=1, venta·mayorista=1'

# 11) Preflight REAL de esta base (tiene internos de minorista): la omisión FALLA.
F30=$(FILA30)
RC=0; sonda post "$TMP/cuentas_sin_min.json" "$TMP/om_real.txt" "$TOTALES" "--sin-interno-minorista=$F30" || RC=$?
if [ "$RC" = 1 ] && grep -q 'FALLO interno_minorista: el preflight cuenta usuarios internos de minorista' "$TMP/om_real.txt"; then
  ok "omisión con el preflight real (hay internos de minorista): FALLA y exige sesión real"
else fallo "omisión con internos de minorista no falló (rc=$RC)"; cat "$TMP/om_real.txt"; fi
sin_datos "$TMP/om_real.txt"

# 12) Preflight con 0 internos de minorista: omisión válida, dicha como NO PROBADO.
RC=0; sonda post "$TMP/cuentas_sin_min.json" "$TMP/om_ok.txt" "$TOTALES" "--sin-interno-minorista=$CERO" || RC=$?
if [ "$RC" = 0 ] && grep -q '^NO PROBADO interno_minorista' "$TMP/om_ok.txt" \
   && grep -q '== TODO OK (con omisión explícita: interno_minorista NO PROBADO)' "$TMP/om_ok.txt" \
   && ! grep -q '^OK    interno_minorista' "$TMP/om_ok.txt" \
   && grep -q '^OK    b2b' "$TMP/om_ok.txt" && grep -q '^OK    gerencia' "$TMP/om_ok.txt" && grep -q '^OK    superadmin' "$TMP/om_ok.txt"; then
  ok "omisión con 0 internos de minorista: exit 0, NO PROBADO explícito, sin 'OK interno_minorista', demás categorías probadas"
else fallo "omisión válida (rc=$RC)"; cat "$TMP/om_ok.txt"; fi
sin_datos "$TMP/om_ok.txt"

# 13) Mismo caso con el preflight REAL de la base tras desactivar a los internos
#     de minorista (el flujo de Producción: valor leído del preflight, no tecleado).
sqlv "update public.usuarios set activo = false where tenant = 'minorista' and rol in ('administracion','operaciones','venta');" >/dev/null
F30=$(FILA30)
RC=0; sonda post "$TMP/cuentas_sin_min.json" "$TMP/om_real0.txt" "$TOTALES" "--sin-interno-minorista=$F30" || RC=$?
sqlv "update public.usuarios set activo = true where id in ('00000000-0000-0000-0000-0000000d0003','00000000-0000-0000-0000-0000000d0006');" >/dev/null
if [ "$RC" = 0 ] && grep -q '^NO PROBADO interno_minorista' "$TMP/om_real0.txt"; then
  ok "omisión con el preflight real sin internos de minorista (activo=false): exit 0 y NO PROBADO"
else fallo "omisión con preflight real en 0 (rc=$RC)"; cat "$TMP/om_real0.txt"; fi

# 14) Valor ilegible → se niega (código 2); omisión + cuenta real → se niega (código 2).
RC=0; sonda post "$TMP/cuentas_sin_min.json" "$TMP/om_mal.txt" "$TOTALES" "--sin-interno-minorista=cualquier cosa" || RC=$?
[ "$RC" = 2 ] && grep -q 'no es la fila 30 del preflight' "$TMP/om_mal.txt" && ok "omisión con valor ilegible: se niega (código 2)" || { fallo "valor ilegible (rc=$RC)"; cat "$TMP/om_mal.txt"; }
RC=0; sonda post "$TMP/cuentas.json" "$TMP/om_dup.txt" "$TOTALES" "--sin-interno-minorista=$CERO" || RC=$?
[ "$RC" = 2 ] && grep -q 'elegir una sola' "$TMP/om_dup.txt" && ok "omisión + cuenta interno_minorista en el JSON: se niega (código 2)" || { fallo "omisión + cuenta (rc=$RC)"; cat "$TMP/om_dup.txt"; }

# 15) La omisión NO relaja nada más: totales que no cuadran siguen dando PÉRDIDA;
#     sin la sesión de superadmin sigue INCOMPLETA.
RC=0; sonda post "$TMP/cuentas_sin_min.json" "$TMP/om_perd.txt" "3 / 2 / 2" "--sin-interno-minorista=$CERO" || RC=$?
[ "$RC" = 1 ] && grep -q 'FALLO interno_mayorista: PÉRDIDA de acceso legítimo' "$TMP/om_perd.txt" && grep -q 'FALLO gerencia: PÉRDIDA' "$TMP/om_perd.txt" \
  && ok "con omisión, la PÉRDIDA de acceso legítimo sigue fallando" || { fallo "omisión relajó la pérdida (rc=$RC)"; cat "$TMP/om_perd.txt"; }
cat > "$TMP/cuentas_sin_min_ni_super.json" <<'JSON'
[ {"categoria":"b2b","email":"zz-api-1@x.test","password":"p1"},
  {"categoria":"interno_mayorista","email":"zz-api-2@x.test","password":"p2"},
  {"categoria":"gerencia","email":"zz-api-4@x.test","password":"p4"} ]
JSON
RC=0; sonda post "$TMP/cuentas_sin_min_ni_super.json" "$TMP/om_inc.txt" "$TOTALES" "--sin-interno-minorista=$CERO" || RC=$?
[ "$RC" = 1 ] && grep -q 'INCOMPLETA: faltan sesiones de superadmin' "$TMP/om_inc.txt" && ! grep -q 'faltan sesiones de.*interno_minorista' "$TMP/om_inc.txt" \
  && ok "con omisión, falta de superadmin sigue INCOMPLETA (y minorista no se reclama)" || { fallo "omisión relajó la cobertura (rc=$RC)"; cat "$TMP/om_inc.txt"; }

# 16) Sin el flag, la sesión interno_minorista sigue siendo obligatoria y se prueba de verdad.
RC=0; sonda post "$TMP/cuentas_sin_min.json" "$TMP/sin_flag.txt" "$TOTALES" || RC=$?
[ "$RC" = 1 ] && grep -q 'INCOMPLETA: faltan sesiones de interno_minorista' "$TMP/sin_flag.txt" && ok "sin el flag, falta interno_minorista: INCOMPLETA" || { fallo "sin flag (rc=$RC)"; cat "$TMP/sin_flag.txt"; }
grep -q 'categoria=interno_minorista .*visibles=2 .*otra_agencia=0 .*sin_atribuir=0' "$TMP/post.txt" && grep -q '^OK    interno_minorista' "$TMP/post.txt" \
  && ok "suite local: interno_minorista probado de verdad (ve 2 de su agencia, 0 de la otra, 0 sin atribuir)" || fallo "no hay prueba efectiva de interno_minorista en la suite local"

# 10) La sonda no muta: el total de filas no cambió tras todas las corridas.
TOT=$(sqlv "select count(*) from public.crm_contactos;" | tail -1)
[ "$TOT" = 6 ] && ok "tras todas las corridas de la sonda la tabla sigue con 6 filas (sin escrituras)" || fallo "la tabla cambió: $TOT filas"

echo
if [ "$FALLOS" -eq 0 ]; then echo "== TODO OK"; else echo "== $FALLOS FALLO(S)"; exit 1; fi
