// Environment preparation only (roles, auth, storage stubs) — shared by cadena.mjs and ciclo.mjs.
export const ENTORNO = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role supabase_admin nologin superuser; create role authenticator nologin; create role supabase_auth_admin nologin; create role dashboard_user nologin;
grant anon, authenticated, service_role to authenticator;
create schema if not exists extensions; create extension if not exists "uuid-ossp" with schema extensions;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, encrypted_password text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now(), updated_at timestamptz, last_sign_in_at timestamptz, banned_until timestamptz);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now(), updated_at timestamptz, not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$;
create function auth.role() returns text language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), 'anon') $f$;
create function auth.jwt() returns jsonb language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
create function auth.email() returns text language sql stable as $f$ select (auth.jwt() ->> 'email') $f$;
create schema storage;
create table storage.buckets (id text primary key, name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(), public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb, path_tokens text[]);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $f$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $f$;
create function storage.filename(name text) returns text language sql immutable as $f$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $f$;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
grant all on all tables in schema storage to service_role;
grant select on all tables in schema storage to authenticated, anon;
grant select, update on auth.users to service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;
