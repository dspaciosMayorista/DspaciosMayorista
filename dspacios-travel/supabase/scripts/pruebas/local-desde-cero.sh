#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────────
# Levanta una base LOCAL desde cero y le aplica TODAS las migraciones en orden.
#
#   supabase/scripts/pruebas/local-desde-cero.sh [nombre_base] [puerto] [hasta]
#
#   `hasta` = número de migración máximo a aplicar (ej. 149). Sirve para montar
#   el estado ANTES de una migración y comparar con el de DESPUÉS.
#
# PARA QUÉ
#   Poder probar una migración nueva contra el esquema completo sin tocar
#   Supabase. No reemplaza a producción —no hay storage-api, ni GoTrue, ni
#   PostgREST— pero sí reproduce lo único que deciden las policies: las tablas,
#   las funciones y el JWT que se hace pasar por un usuario.
#
# QUÉ SIMULA (y qué NO)
#   · `auth.users` y `auth.uid()` — sí, leyendo `request.jwt.claims`, igual que
#     Supabase.
#   · `storage.objects` y `storage.buckets` — la TABLA y sus policies, sí. La
#     API de Storage NO: aquí un `insert` sobre `storage.objects` sí funciona,
#     mientras que en Supabase alojado está bloqueado. Por eso las pruebas de
#     RLS de Storage evalúan el PREDICADO en vez de hacer DML, y la prueba de
#     integración de verdad (`storage-adjuntos.mjs`) va por la API.
#   · Roles `anon`, `authenticated`, `service_role` — sí.
#
# Requiere PostgreSQL local corriendo y permiso para `createdb`.
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${1:-dspacios_local}"
PUERTO="${2:-55432}"
HASTA="${3:-}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRACIONES="$AQUI/../../migrations"

echo "== Base '$BASE' en el puerto $PUERTO"
psql -p "$PUERTO" -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists $BASE"
psql -p "$PUERTO" -d postgres -v ON_ERROR_STOP=1 -q -c "create database $BASE"

echo "== Andamio: roles, esquema auth y esquema storage"
psql -p "$PUERTO" -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;
SQL

psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

-- Igual que Supabase: el id del usuario sale del claim `sub` del JWT, que
-- PostgREST deja en el ajuste `request.jwt.claims`.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'role','')
$$;

-- `raw_user_meta_data` la usa el trigger `handle_new_user` (migración 006):
-- sin esa columna, cualquier alta de usuario revienta.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb
);

create table if not exists storage.buckets (
  id     text primary key,
  name   text,
  public boolean default false
);

create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets(id),
  name             text,
  owner            uuid,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata         jsonb
);
alter table storage.objects enable row level security;

grant usage on schema auth, storage, public to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
SQL

# Cada migración va en UNA transacción, como la corre el editor SQL de
# Supabase. Importa: la 015 crea una tabla temporal `on commit drop` y la usa
# 580 líneas más abajo — en autocommit se destruye antes de llegar ahí.
#
# Excepción: `alter type ... add value` (la 122 agrega 'infante' al enum de
# acomodaciones) no admite usar el valor nuevo en la misma transacción. Esas se
# reintentan sueltas y se avisa cuáles fueron, para que no pase inadvertido.
echo "== Migraciones"
n=0; sueltas=""
for f in "$MIGRACIONES"/*.sql; do
  if [ -n "$HASTA" ]; then
    # `20260601000150_...` → 150
    num=$(basename "$f" | sed -E 's/^[0-9]{10}0*([0-9]+)_.*/\1/')
    [ "$num" -gt "$HASTA" ] 2>/dev/null && continue
  fi
  if psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q --single-transaction -f "$f" > /dev/null 2>/tmp/mig.err; then
    :
  elif psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$f" > /dev/null; then
    sueltas="$sueltas $(basename "$f")"
  else
    echo "   FALLÓ: $(basename "$f")"; cat /tmp/mig.err; exit 1
  fi
  n=$((n + 1))
done
echo "   $n migraciones aplicadas sin error"
[ -n "$sueltas" ] && echo "   (fuera de transacción, por el enum:$sueltas)"

# Los permisos de tabla se conceden después: muchas migraciones crean tablas.
psql -p "$PUERTO" -d "$BASE" -v ON_ERROR_STOP=1 -q <<'SQL'
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
SQL

echo "== Listo: psql -p $PUERTO -d $BASE"
