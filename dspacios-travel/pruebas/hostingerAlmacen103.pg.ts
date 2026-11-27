// #103 HIN-2 — the REAL durable store (almacenHostingerDe) through the REAL supabase-js → PostgREST → PostgreSQL path of a DISPOSABLE database: the RPC payload/response mapping (bigint, boolean), the compare-and-swap through HTTP,
// concurrent advances, the parked-replies backlog, and what the browser-facing roles can NOT do. Needs migration 330 only.
// MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pg127 plantilla127 PG105 pruebas/hostingerAlmacen103.pg.ts supabase/migrations/20260601000330_hostinger_entrada_estado.sql
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { almacenHostingerDe } from "../lib/solicitudProveedor/hostinger.ts";

const CT = process.env.PG105_CONTENEDOR ?? "pg127", DB = process.env.PG105_BASE ?? "", PGRST = process.env.PG105_POSTGREST ?? "", SECRETO = process.env.PG105_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG105_BASE (desechable), PG105_POSTGREST y PG105_JWT_SECRET: usa supabase/scripts/test_pg_local.sh.");
const b64u = (s: string) => Buffer.from(s).toString("base64url");
const jwt = (payload: Record<string, unknown>) => { const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 })); return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`; };
const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
const cliente = (token: string) => createClient(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
const servicio = cliente(jwt({ role: "service_role" }));
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const B = "AC1a2b3c4d5e6f7g";
const almacen = almacenHostingerDe(servicio as never);

describe("migration 330 through the real HTTP path", () => {
  test("Z1 leerEstado creates the row and maps the types; avanzar is a compare-and-swap (true once, false when stale)", async () => {
    const e0 = await almacen.leerEstado(B); assert.deepEqual(e0, { version: 0, uidCubierto: 0, barridoTope: null, barridoSiguiente: null, barridoDesde: null });
    assert.equal(await almacen.avanzar(B, 0, { uidCubierto: 0, barridoTope: 500, barridoSiguiente: 500, barridoDesde: null }), true);
    assert.equal(await almacen.avanzar(B, 0, { uidCubierto: 0, barridoTope: 999, barridoSiguiente: 999, barridoDesde: null }), false, "stale version loses");
    assert.deepEqual(await almacen.leerEstado(B), { version: 1, uidCubierto: 0, barridoTope: 500, barridoSiguiente: 500, barridoDesde: null });
    assert.equal(await almacen.avanzar(B, 1, { uidCubierto: 500, barridoTope: null, barridoSiguiente: null, barridoDesde: null }), true);
    assert.deepEqual(await almacen.leerEstado(B), { version: 2, uidCubierto: 500, barridoTope: null, barridoSiguiente: null, barridoDesde: null });
  });

  test("Z1b the eligibility threshold of a sweep round-trips as an ISO timestamp, is kept while the sweep advances and is cleared when it ends", async () => {
    const B2 = "AC2desde0000test"; const e0 = await almacen.leerEstado(B2); assert.equal(e0.barridoDesde, null);
    const umbral = "2026-11-20T10:00:00.000Z";
    assert.equal(await almacen.avanzar(B2, 0, { uidCubierto: 0, barridoTope: 200, barridoSiguiente: 200, barridoDesde: umbral }), true);
    assert.equal(new Date((await almacen.leerEstado(B2)).barridoDesde!).toISOString(), umbral);
    assert.equal(await almacen.avanzar(B2, 1, { uidCubierto: 0, barridoTope: 200, barridoSiguiente: 150, barridoDesde: umbral }), true);
    assert.equal(new Date((await almacen.leerEstado(B2)).barridoDesde!).toISOString(), umbral, "kept while the sweep advances");
    await assert.rejects(() => almacen.avanzar(B2, 2, { uidCubierto: 200, barridoTope: null, barridoSiguiente: null, barridoDesde: umbral }), /hostinger_estado_avanzar/);
    assert.equal(await almacen.avanzar(B2, 2, { uidCubierto: 200, barridoTope: null, barridoSiguiente: null, barridoDesde: null }), true);
    assert.deepEqual(await almacen.leerEstado(B2), { version: 3, uidCubierto: 200, barridoTope: null, barridoSiguiente: null, barridoDesde: null });
  });

  test("Z2 concurrent advances through PostgREST: of 8 simultaneous calls on one version exactly one wins", async () => {
    const e = await almacen.leerEstado(B);
    const r = await Promise.all(Array.from({ length: 8 }, (_, i) => almacen.avanzar(B, e.version, { uidCubierto: e.uidCubierto, barridoTope: 800 + i, barridoSiguiente: 800 + i, barridoDesde: null })));
    assert.equal(r.filter(Boolean).length, 1); assert.equal((await almacen.leerEstado(B)).version, e.version + 1);
  });

  test("Z3 a database rule violation or an unknown shape is an ERROR (thrown), never a silent false", async () => {
    const e = await almacen.leerEstado(B);
    await assert.rejects(() => almacen.avanzar(B, e.version, { uidCubierto: 500, barridoTope: 400, barridoSiguiente: 400, barridoDesde: null }), /hostinger_estado_avanzar/);   // tope <= cubierto violates the CHECK
    await assert.rejects(() => almacen.leerEstado("ab"), /hostinger_estado_leer/);
  });

  test("Z4 the backlog: save (upsert with attempts), list oldest first, delete; the list respects the limit", async () => {
    await almacen.guardarPendiente(B, { uid: 42, dedupe: `hostinger:${B}:<m42@x>`, messageId: "<m42@x>", intentos: 1, error: "descarga fallida" });
    await new Promise((r) => setTimeout(r, 20));
    await almacen.guardarPendiente(B, { uid: 43, dedupe: `hostinger:${B}:<m43@x>`, messageId: null, intentos: 1, error: "x".repeat(500) });
    await almacen.guardarPendiente(B, { uid: 42, dedupe: `hostinger:${B}:<m42@x>`, messageId: "<m42@x>", intentos: 2, error: "otra vez" });
    const l = await almacen.listarPendientes(B, 10); assert.deepEqual(l.map((x) => [x.uid, x.intentos, x.messageId]), [[42, 2, "<m42@x>"], [43, 1, null]], "oldest first, attempts updated, large id mapped to number");
    assert.equal(sql(`select length(ultimo_error) from public.hostinger_respuestas_pendientes where uid = 43`), "300", "the error text is truncated to the column limit");
    assert.equal((await almacen.listarPendientes(B, 1)).length, 1);
    await almacen.borrarPendiente(B, 42); await almacen.borrarPendiente(B, 43); assert.deepEqual(await almacen.listarPendientes(B, 10), []);
  });

  test("Z5 the browser-facing roles can reach NOTHING (no table access, no function call, even with a valid token)", async () => {
    for (const rol of ["anon", "authenticated"]) {
      const c = cliente(jwt({ role: rol, sub: "00000000-0000-0000-0000-000000105001" }));
      for (const t of ["hostinger_estado_buzon", "hostinger_respuestas_pendientes"]) { const { data, error } = await c.from(t).select("*"); assert.ok(error && !((data as unknown[] | null)?.length), `${rol} select ${t}: ${error?.message}`); }
      const f = await c.rpc("hostinger_estado_leer", { p_buzon: B }); assert.ok(f.error, `${rol} rpc leer`);
      const g = await c.rpc("hostinger_estado_avanzar", { p_buzon: B, p_version: 0, p_cubierto: 0, p_tope: null, p_siguiente: null }); assert.ok(g.error, `${rol} rpc avanzar`);
    }
  });
});
