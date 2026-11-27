#!/bin/sh
# F6 (#95 · revisión del dueño 2026-11-26) — acciones REALES de los formularios manuales (cotización dinámica, comparativa y contrato manual) contra PostgreSQL + PostgREST locales y DESECHABLES (Docker).
# Cubre destino ↔ hotel, orden de fechas, infantes, compra directa/plataforma (proveedor de la obligación) y acomodación estructurada, con persistencia leída de nuevo (pruebas/formulariosManuales95f6.pg.ts).
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_f6_95_formularios.sh <base_nueva> [contenedor_pg] [plantilla]
#   base_nueva ^f6a_[a-z0-9_]{1,30}$ NUEVA (se borra al final; KEEP=1 la conserva). Plantilla por defecto rev_consolidada_base (la cadena de migraciones SIN datos del dueño, hasta la 343) en el contenedor pgrevc.
#   La migración 346 se aplica a la COPIA. Nunca toca la plantilla (solo la lee) ni rev_consolidada ni ninguna otra base de revisión.
set -eu
export MSYS_NO_PATHCONV=1
DB="${1:-}"; CT="${2:-pgrevc}"; PLANTILLA="${3:-rev_consolidada_base}"
printf '%s' "$DB" | grep -Eq '^f6a_[a-z0-9_]{1,30}$' || { echo "Base inválida: usa un nombre nuevo ^f6a_[a-z0-9_]{1,30}\$." >&2; exit 2; }
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
[ "$PLANTILLA" = "rev_consolidada_base" ] || case "$PLANTILLA" in rev_*|dspacios_*|rev_consolidada*) echo "Esa plantilla es de revisión/propia del dueño: solo se admite rev_consolidada_base (cadena sin datos del dueño)." >&2; exit 2;; esac
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; REST="pgrstf6_$TOKEN"; RED="redf6_$TOKEN"; ROL="f6a_auth_$TOKEN"; SECRETO="${F6_SECRETO:-local-f6-$(hex 24)}"; CLAVE="c$(hex 12)"; MARCA="test_f6_95 $TOKEN"
AQUI="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$AQUI/../.." && pwd)"; MIGS="$APP/supabase/migrations"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
BASE_PROPIA=0; ROL_PROPIO=0; RED_PROPIA=0
limpiar() {
  st=$?
  docker rm -f "$REST" >/dev/null 2>&1 || true
  if [ "$RED_PROPIA" = 1 ]; then docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true; fi
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    marca="$($PS -d postgres -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'" 2>/dev/null || true)"
    [ "$marca" = "$MARCA" ] && for i in 1 2 3 4 5; do $PS -d postgres -c "drop database $DB" >/dev/null 2>&1 && break; sleep 2; done
  fi
  [ "$ROL_PROPIO" = 1 ] && $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true
  exit "$st"
}
trap limpiar EXIT
docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe: no se toca." >&2; exit 3; }
# Con una plantilla COMBINADA (p. ej. rev2_plantilla_347, que ya trae 346–347) la 346 no se vuelve a aplicar.
YA346="$($PS -d "$PLANTILLA" -c "select count(*) from information_schema.columns where table_name = 'contrato_hoteles' and column_name = 'compra_origen'")"
creada=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  $PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>&1 && { creada=1; break; }
  sleep 3
done
[ "$creada" = 1 ] || { echo "No se pudo crear $DB (la plantilla puede estar en uso por otra copia en curso)." >&2; exit 3; }
BASE_PROPIA=1
$PS -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null
if [ "$YA346" = 0 ]; then
  $PS -d "$DB" < "$MIGS/20260601000346_hotel_contrato_origen_compra.sql" >/dev/null && echo "  migración 346 aplicada a la copia" || { echo "FALLÓ la 346" >&2; exit 1; }
else echo "  la plantilla ya trae la 346: no se vuelve a aplicar"; fi
# Entorno (NO es esquema de la app): auth.uid()/auth.role() leen el JWT de request.jwt.claims (PostgREST ≥ 12 ya no fija request.jwt.claim.*).
$PS -d "$DB" >/dev/null <<'SQL'
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
SQL
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null; ROL_PROPIO=1
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null; RED_PROPIA=1
docker network connect "$RED" "$CT" >/dev/null
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1::3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" public.ecr.aws/supabase/postgrest:v16.4 >/dev/null
i=0
until docker logs "$REST" 2>&1 | grep -q "Schema cache loaded"; do i=$((i + 1)); [ "$i" -gt 60 ] && { docker logs "$REST" >&2; echo "PostgREST no arrancó" >&2; exit 1; }; sleep 1; done
PUERTO="$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
REST_URL="http://127.0.0.1:$PUERTO"
echo "== PostgREST $REST en $REST_URL contra $DB =="
cd "$APP"
ARCHIVOS="${F6_ARCHIVOS:-pruebas/formulariosManuales95f6.pg.ts}"
set +e
F6_BASE="$DB" F6_CONTENEDOR="$CT" F6_POSTGREST="$REST_URL" F6_JWT_SECRET="$SECRETO" \
  node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoaderRelativo.mjs --test $ARCHIVOS
st=$?
exit "$st"
