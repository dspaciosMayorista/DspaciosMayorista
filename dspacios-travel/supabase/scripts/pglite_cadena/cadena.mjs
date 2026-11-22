// Replays the REAL migration chain (every supabase/migrations/*.sql, in order) on embedded PostgreSQL (PGlite, WASM)
// over a minimal Supabase-like environment (roles, auth, storage). Environment preparation only; no app schema is faked.
// Usage: node cadena.mjs <repo dspacios-travel path> [outDataDir]   env: CONTINUE=1 keeps going after a failing file; HASTA=<n> stops after migration n.
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import fs from "node:fs";
import path from "node:path";

const repo = process.argv[2];
const dir = path.join(repo, "supabase", "migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const hasta = process.env.HASTA ? Number(process.env.HASTA) : Infinity;
const db = new PGlite({ extensions: { uuid_ossp } });

const ENTORNO = `
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
await db.exec(ENTORNO);

const fallos = [];
let aplicadas = 0;
for (const f of files) {
  const n = Number(f.match(/^2026060100(\d{4})_/)?.[1] ?? NaN);
  if (!Number.isNaN(n) && n > hasta) break;
  const sql = fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");
  try { await db.exec(sql); aplicadas++; }
  catch (e) {
    fallos.push({ f, msg: String(e.message).split("\n")[0] });
    try { await db.exec("rollback"); } catch {}
    if (!process.env.CONTINUE) { console.log(`STOP ${f}: ${fallos.at(-1).msg}`); break; }
  }
}
console.log(`aplicadas=${aplicadas} de ${files.length}; fallos=${fallos.length}`);
for (const x of fallos.slice(0, 40)) console.log(`FALLO ${x.f}: ${x.msg}`);
if (process.argv[3]) { fs.mkdirSync(process.argv[3], { recursive: true }); await db.dumpDataDir("none").then(async (b) => fs.writeFileSync(path.join(process.argv[3], "chain.tgz"), Buffer.from(await b.arrayBuffer()))); console.log("datadir guardado"); }
await db.close();
