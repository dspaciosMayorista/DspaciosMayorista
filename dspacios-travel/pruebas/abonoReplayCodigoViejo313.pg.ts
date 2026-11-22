// REL-2 · OLD source × FINAL database: payment registration, REPLAY (same operation id) and confirmation through the code serving users today, with migrations 312/313 installed.
// Copied into the OLD tree (commit 312608a5922d4424ac912153394f4aee99357cb2) and run THERE: `registrarAbono` is the OLD server action, which calls the UNCHANGED `registrar_abono` RPC.
// What it proves about 312/313: the new column `abonos.moneda_pago` stays NULL for payments written by old code (no reinterpretation), the insert trigger `trg_f313_abonos_moneda` is inert for them,
// a replay of the same operation id does not create a second payment, and the minimum-payment confirmation still happens inside the same operation.
// Contract seeded directly in SQL (COP, 1.000.000, pending, no frozen conditions → the historical 30 % minimum applies). Only the session and next/cache are replaced.
//   MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pgb2b plantilla_rel2_final PG313 pruebas/abonoReplayCodigoViejo313.pg.ts
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG313_CONTENEDOR ?? "pgb2b";
const DB = process.env.PG313_BASE ?? "";
const PGRST = process.env.PG313_POSTGREST ?? "";
const SECRETO = process.env.PG313_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG313_BASE (desechable), PG313_POSTGREST y PG313_JWT_SECRET: usa supabase/scripts/test_pg_local.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(specifier, context, nextResolve) { const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true }; return nextResolve(specifier, context); } });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const UID_ADMIN = "00000000-0000-0000-0000-000000313001";
const SESION_ADMIN = "5e313000-0000-0000-0000-000000313001";
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: UID_ADMIN, session_id: SESION_ADMIN }), { id: UID_ADMIN, email: "admin313@x.test" });
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
}
const num = (q: string) => Number(sql(q));

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[], set: () => undefined };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

// OLD module (this file runs inside the old tree).
const { registrarAbono } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");

const NUM = "DTM-3131";
const abonos = () => num(`select count(*) from public.abonos where numero_contrato = '${NUM}'`);
const estado = () => sql(`select estado from public.ventas where numero_contrato = '${NUM}'`);
const pagar = (cop: number, operacion: string) => registrarAbono(NUM, cop, "Efectivo", `r-${cop}`, undefined, undefined, undefined, operacion, {} as never);

before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin313@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin313@x.test', 'Admin 313', 'administracion', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into auth.sessions (id, user_id) values ('${SESION_ADMIN}', '${UID_ADMIN}') on conflict do nothing;
    insert into public.ventas (numero_contrato, cliente, tenant, estado, precio_venta, moneda, asesor, destino, pax) values ('${NUM}', 'Cliente 313', 'mayorista', 'pendiente', 1000000, 'COP', 'Admin 313', 'CARTAGENA', 2);
  `);
});

describe("R2-313 · código VIEJO (312608a59) × base con la cadena final 001–326: pago, reintento y confirmación", () => {
  test("A0 la base trae 312/313 y el código es el viejo", () => {
    assert.equal(num("select count(*) from information_schema.columns where table_name = 'abonos' and column_name = 'moneda_pago'"), 1, "312");
    assert.equal(num("select count(*) from pg_proc where proname = 'registrar_abono_moneda'"), 1, "313 función");
    assert.equal(num("select count(*) from pg_trigger where tgname = 'trg_f313_abonos_moneda' and tgenabled = 'O'"), 1, "313 disparador activo");
  });

  test("A1 pago bajo el mínimo (30 % = 300.000): 200.000 se registra, el contrato sigue pendiente y la columna nueva queda NULL", async () => {
    const op = randomUUID();
    assert.deepEqual(await pagar(200000, op), { ok: true });
    assert.equal(abonos(), 1);
    assert.equal(estado(), "pendiente");
    assert.equal(sql(`select coalesce(moneda_pago, 'NULL') from public.abonos where numero_contrato = '${NUM}'`), "NULL", "el código viejo no escribe moneda_pago: sin reinterpretación");
    assert.equal(num(`select monto_cop from public.abonos where numero_contrato = '${NUM}'`), 200000);
  });

  test("A2 REINTENTO de la misma operación (doble pulsación): no crea un segundo abono ni cambia el estado", async () => {
    const op = randomUUID();
    assert.deepEqual(await pagar(50000, op), { ok: true });
    assert.equal(abonos(), 2);
    assert.deepEqual(await pagar(50000, op), { ok: true }, "la repetición responde ok (ya registrado)");
    assert.equal(abonos(), 2, "la misma operación no duplica el pago");
    assert.equal(num(`select coalesce(sum(monto_cop), 0) from public.abonos where numero_contrato = '${NUM}'`), 250000);
    assert.equal(estado(), "pendiente");
  });

  test("A3 el pago que completa el mínimo confirma el contrato en la MISMA operación; una operación nueva suma otro abono", async () => {
    assert.deepEqual(await pagar(50000, randomUUID()), { ok: true }); // 250.000 + 50.000 = 300.000 = mínimo exacto
    assert.equal(abonos(), 3);
    assert.equal(estado(), "confirmado", "la confirmación por mínimo sigue ocurriendo con el código viejo");
    assert.equal(num(`select count(*) from public.abonos where numero_contrato = '${NUM}' and moneda_pago is not null`), 0, "ningún abono escrito por código viejo trae moneda_pago");
  });

  test("A4 después de confirmar, un reintento de la operación anterior sigue sin duplicar", async () => {
    const op = randomUUID();
    assert.deepEqual(await pagar(10000, op), { ok: true });
    const n = abonos();
    assert.deepEqual(await pagar(10000, op), { ok: true });
    assert.equal(abonos(), n);
    assert.equal(estado(), "confirmado");
  });
});
