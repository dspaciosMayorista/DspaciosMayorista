#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# Prueba de INTEGRACIÓN de la migración 283 (guardado atómico de «Mi perfil»): Postgres real + PostgREST real, ambos DESECHABLES.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_283_perfil_atomico.sh
#
# Qué levanta (todo propio de esta corrida, con sufijo aleatorio, y se borra al terminar):
#   · contenedor Postgres  pg283_<sufijo>   (imagen supabase/postgres local, SIN puertos publicados)
#   · base t283 con stubs mínimos de `usuarios` y `aliados` + la migración 087 REAL (auditoría y su trigger) + la 283
#   · red Docker + contenedor PostgREST pgrst283_<sufijo> (puerto en 127.0.0.1)
#   · rol de login temporal para PostgREST
# Recorre preflight → migración → postcheck → (preflight ya aplicada, rollback, postcheck detecta, reaplicar) y después corre
# pruebas/perfilAtomico283.pg.ts (la acción REAL guardarPerfilServidor contra esa base). Nada toca Supabase remoto.
# ──────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
IMAGEN_PG="${PG283_IMAGEN_PG:-public.ecr.aws/supabase/postgres:15.8.1.085}"
IMAGEN_REST="${PG283_IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
SUF="$(hex 4)"
CT="pg283_$SUF"
REST="pgrst283_$SUF"
RED="red283_$SUF"
DB="t283_$SUF"
ROL="t283_auth_$SUF"
CLAVE="c283$(hex 10)"
SECRETO="local-283-$(hex 24)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
MIG="$APP/supabase/migrations/20260601000283_perfil_portal_atomico.sql"
PRE_SQL="$APP/supabase/scripts/preflight_283_perfil_portal_atomico.sql"
POST_SQL="$APP/supabase/scripts/postcheck_283_perfil_portal_atomico.sql"
ROLLBACK_SQL="$APP/supabase/scripts/rollback_283_perfil_portal_atomico.sql"

limpiar() {
  st=$?
  docker rm -f "$REST" >/dev/null 2>&1 || true
  docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true
  docker network rm "$RED" >/dev/null 2>&1 || true
  docker rm -f -v "$CT" >/dev/null 2>&1 || true
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker run -d --name "$CT" -e POSTGRES_PASSWORD=postgres "$IMAGEN_PG" >/dev/null
i=0
until docker exec -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d postgres -tAc "select 1" >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 90 ] && { docker logs "$CT" >&2; echo "Postgres no arrancó" >&2; exit 1; }
  sleep 1
done
sleep 3
$PS -d postgres -c "create database $DB" >/dev/null

# Stubs mínimos con las MISMAS columnas que usa la función, y la 087 real (auditoría + trigger genérico).
$PS -d "$DB" >/dev/null <<'SQL'
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function public.mi_rol() returns text language sql stable as $$ select null::text $$;
create type public.rol_usuario as enum ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo','agencia','freelance','cliente_final');
create table public.usuarios (
  id uuid primary key, email text not null unique, nombre text not null, rol public.rol_usuario not null default 'venta',
  activo boolean not null default true, agencia_id uuid, aliado_id bigint, acceso_legacy_nombre boolean not null default false,
  tenant text not null default 'mayorista'
);
create table public.aliados (
  id bigserial primary key, nombre text not null, nit text, contacto text, email text, telefono text, direccion text,
  aplica_retencion boolean default false, pct_retencion numeric(5,4) default 0, banco text, numero_cuenta text, created_at timestamptz default now()
);
SQL
$PS -d "$DB" -f - < "$APP/supabase/migrations/20260601000087_auditoria.sql" >/dev/null

# Preflight (una consulta) → migración → postcheck (una consulta). Cada uno debe dar su veredicto.
PRE="$($PS -d "$DB" -f - < "$PRE_SQL")"
echo "$PRE"
echo "$PRE" | grep -q '^99|VEREDICTO|0 falla(s)|0 fallas|LISTO PARA APLICAR$' || { echo "El preflight no dio LISTO PARA APLICAR" >&2; exit 1; }
$PS -d "$DB" -f - < "$MIG" >/dev/null
POST="$($PS -d "$DB" -f - < "$POST_SQL")"
echo "$POST"
echo "$POST" | grep -q '^99|VEREDICTO|0 falla(s)|0 fallas|CORRECTA$' || { echo "El postcheck no dio CORRECTA" >&2; exit 1; }
# Con la migración ya aplicada, el preflight debe negarse a darla por pendiente.
$PS -d "$DB" -f - < "$PRE_SQL" | grep -q '^99|VEREDICTO|1 falla(s)|0 fallas|NO APLICAR$' || { echo "El preflight debería dar NO APLICAR con la migración ya aplicada" >&2; exit 1; }
# Rollback → el postcheck debe detectarlo → se vuelve a aplicar.
$PS -d "$DB" -f - < "$ROLLBACK_SQL" >/dev/null
$PS -d "$DB" -f - < "$POST_SQL" | grep -q 'REVISAR / REVERTIR$' || { echo "El postcheck debería fallar tras el rollback" >&2; exit 1; }
$PS -d "$DB" -f - < "$MIG" >/dev/null

$PS -d "$DB" >/dev/null <<'SQL'
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
SQL

$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null
docker network connect "$RED" "$CT" >/dev/null
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1::3000" \
  -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" \
  "$IMAGEN_REST" >/dev/null
i=0
until docker logs "$REST" 2>&1 | grep -q "Schema cache loaded"; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { docker logs "$REST" >&2; echo "PostgREST no arrancó" >&2; exit 1; }
  sleep 1
done
PUERTO="$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"

cd "$APP"
PG283_CONTENEDOR="$CT" PG283_BASE="$DB" PG283_POSTGREST="http://127.0.0.1:$PUERTO" PG283_JWT_SECRET="$SECRETO" \
  node --test --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs pruebas/perfilAtomico283.pg.ts
