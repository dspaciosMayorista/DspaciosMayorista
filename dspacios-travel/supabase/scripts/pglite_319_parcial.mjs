// #32 — Verificación PARCIAL de la migración 319 en un Postgres real embebido (pglite, WASM) sobre un esquema STUB mínimo (no el esquema completo): preflight → 319 (y reaplicación) → postcheck →
// casos de test_319_aliado_logo.sql → rollback. Sirve cuando no hay Docker; NO sustituye la corrida sobre el esquema completo.
// pglite NO es dependencia del repo: instalarlo en una carpeta de pruebas ajena (npm i @electric-sql/pglite@0.3.14) y copiar este archivo allí.
// Variables: MIG_SQL (SQL de migración alterado, para mutaciones) · SOLO_ROLLBACK=1 (omite los casos y prueba el rollback limpio).
// Verificación PARCIAL de la 319 en un Postgres real embebido (pglite, WASM) sobre un esquema STUB mínimo. NO sustituye la prueba sobre el esquema completo.
// Uso: node run319.mjs <ruta-repo-dspacios-travel>
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

const repo = process.argv[2];
const leer = (r) => fs.readFileSync(path.join(repo, r), "utf8").replace(/\r\n/g, "\n");
const db = new PGlite();

const PRELUDIO = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create table auth.users (id uuid primary key, email text);
create type rol_usuario as enum ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo','agencia','freelance','cliente_final');
create table public.usuarios (id uuid primary key references auth.users(id), email text, nombre text, rol rol_usuario, activo boolean, tenant text default 'mayorista', aliado_id bigint, agencia_id uuid);
create table public.aliados (id bigint primary key, nombre text, nit text, tipo text);
create table public.auditoria (id bigserial primary key, tabla text, accion text);
create function public.fn_auditoria() returns trigger language plpgsql as $$ begin insert into public.auditoria(tabla, accion) values (tg_table_name, tg_op); return coalesce(new, old); end $$;
create table public.comision_plan (id bigserial primary key, cotizacion_id bigint, version int, aliado_id bigint);
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema public, auth to anon, authenticated, service_role;
grant select on public.usuarios, public.aliados to service_role;
grant delete on public.aliados to service_role;
create schema t216;
create table t216.res (nombre text, ok boolean, detalle text);
create function t216.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000216' || case p_k when 'super' then '001' when 'admin' then '002' when 'gerencia' then '003' when 'ventaA' then '005' when 'inactivo' then '009' else '999' end)::uuid $$;
create function t216.intenta(p_rol text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v_r text := 'ok';
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_rol)::text end, true);
  execute format('set local role %I', p_rol);
  begin execute p_sql; exception when others then v_r := sqlstate || ': ' || sqlerrm; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return v_r;
end $$;
create function t216.escalar(p_rol text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v_r text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_rol)::text end, true);
  execute format('set local role %I', p_rol);
  begin execute p_sql into v_r; exception when others then v_r := 'ERR ' || sqlstate || ': ' || sqlerrm; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return v_r;
end $$;
create function t216.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void language plpgsql as $$
begin insert into t216.res values (p_nombre, coalesce(p_ok, false), p_detalle); end $$;
create function t216.rechaza(p_nombre text, p_res text, p_patron text) returns void language plpgsql as $$
begin perform t216.afirma(p_nombre, p_res is not null and p_res <> 'ok' and p_res like '%' || p_patron || '%', p_res); end $$;
create function t216.acepta(p_nombre text, p_res text) returns void language plpgsql as $$
begin perform t216.afirma(p_nombre, p_res = 'ok', p_res); end $$;
insert into auth.users select t216.u(k), k || '@x.test' from unnest(array['super','admin','gerencia','ventaA','inactivo']) k;
insert into public.usuarios select t216.u(k), k || '@x.test', k, r::rol_usuario, a from (values ('super','superadmin',true),('admin','administracion',true),('gerencia','gerencia',true),('ventaA','venta',true),('inactivo','administracion',false)) v(k,r,a);
`;

async function consulta(titulo, ruta) {
  const r = await db.query(leer(ruta));
  console.log(`\n== ${titulo}`);
  for (const f of r.rows) console.log(`  [${f.estado}] ${f.control}  obs=${f.observado}  esp=${f.esperado}`);
  return r.rows;
}

await db.exec(PRELUDIO);
await consulta("PREFLIGHT 319 (antes)", "supabase/scripts/preflight_319_aliado_logo.sql");
await db.exec(process.env.MIG_SQL ?? leer("supabase/migrations/20260601000319_aliado_logo.sql"));
console.log("\nmigración 319 aplicada sin errores");
// Un segundo apply debe ser inofensivo (idempotente en tabla/índices/bucket; las funciones son create or replace).
await db.exec(process.env.MIG_SQL ?? leer("supabase/migrations/20260601000319_aliado_logo.sql"));
console.log("segunda aplicación (idempotencia) sin errores");
const post = await consulta("POSTCHECK 319 (después)", "supabase/scripts/postcheck_319_aliado_logo.sql");
const malos = post.filter((f) => f.estado === "REVISAR");
console.log(malos.length ? `POSTCHECK con ${malos.length} REVISAR` : "POSTCHECK sin REVISAR");

// Casos SQL (sin las metaórdenes de psql ni las fixtures completas de la 216).
let t = leer("supabase/scripts/test_319_aliado_logo.sql")
  .replace(/^\\(set|ir|echo).*$/gm, "").replace(/^begin;$/m, "").replace(/^rollback;$/m, "");
t = t.replace(/select count\(\*\) filter[\s\S]*?from t216\.res;\s*select nombre, detalle from t216\.res where not ok;/, "");
if (!process.env.SOLO_ROLLBACK) try { await db.exec(t); } catch (e) { console.log("ERROR en los casos:", String(e.message).slice(0, 300), "| pos", e.position); console.log(t.slice(Math.max(0, Number(e.position) - 200), Number(e.position) + 100)); process.exit(1); }
const res = await db.query("select nombre, ok, detalle from t216.res order by 1");
const fallos = res.rows.filter((x) => !x.ok);
console.log(`\nCASOS SQL (esquema stub): ${res.rows.length - fallos.length}/${res.rows.length} OK`);
for (const f of fallos) console.log("  FALLO", f.nombre, "--", f.detalle);

await db.exec("delete from public.aliado_logos where false").catch(() => {});
try { await db.exec(leer("supabase/scripts/rollback_319_aliado_logo.sql")); } catch (e) { console.log("rollback con datos presentes ->", String(e.message).slice(0, 120)); await db.exec("rollback").catch(() => {}); }
const tras = await db.query("select to_regclass('public.aliado_logos') as t");
console.log("\nROLLBACK:", tras.rows[0].t === null ? "tabla eliminada" : "la tabla sigue (rechazado por datos, esperado si quedaron filas)");
