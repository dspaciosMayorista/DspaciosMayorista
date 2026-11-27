// R2-1 (#42 / migración 332) — the REAL generarPlanCobro action (real planDeCuotas + real reglaConfirmacion), with injected Supabase reads.
// Codex's independent probe: contrato_condiciones answering {data:null, error} still invoked reemplazar_plan_cobro and wrote 300.000 + 3 × 233.333. A failed source read is NOT verified absence:
// the action must stop BEFORE the database function is called. Hand-worked expectations: contract 1.000.000 COP, 30 % → first row 300.000, 700.000 split in equal cuotas.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import nodeModule from "node:module";

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const src = MODULOS_MINIMOS[specifier];
    if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

type Resp = { data: unknown; error: { message: string } | null };
const OK = (data: unknown): Resp => ({ data, error: null });
const FALLA = (m: string): Resp => ({ data: null, error: { message: m } });

let tablas: Record<string, Resp> = {};
let abonos: Resp = OK([]);
let acuerdo: { estado: "ausente" } | { estado: "error"; motivo: string } = { estado: "ausente" };
const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
let respuestaRpc: Resp | null = null; // null = the database function accepts and reports the rows it received

function builder(r: Resp) {
  const b: Record<string, unknown> = {};
  Object.assign(b, { select: () => b, eq: () => b, maybeSingle: async () => r, then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(r).then(ok, ko) });
  return b;
}
const clienteSesion = () => ({ from: (t: string) => builder(tablas[t] ?? OK(null)), rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return respuestaRpc ?? OK({ n: (args.p_filas as unknown[]).length }); } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => ({ from: (t: string) => builder(t === "abonos" ? abonos : OK(null)) }) } });
mock.module("@/lib/contrato/acuerdoMinimo", { namedExports: { cargarAcuerdoMinimo: async () => acuerdo } });
mock.module("@/lib/contrato/identidad", { namedExports: { parseIdentidad: (x: unknown) => x, mensajeSiIdentidad: () => null } });

const { generarPlanCobro } = await import("../app/(dashboard)/dashboard/contratos/[numero]/cobros-actions.ts");

const VENTA = { precio_venta: 1_000_000, moneda: "COP", moneda_cobro: null, trm_cobro: null, total_cobro: null, fecha_salida: "2099-06-30" /* far future: many monthly cuotas, first row = minimum */, tipo_paquete: "porcion", comision_estado: null };
const COND = [{ monto_exigido: 300_000, moneda: "COP", trm: 1 }];

beforeEach(() => {
  rpcs.length = 0;
  respuestaRpc = null;
  acuerdo = { estado: "ausente" };
  abonos = OK([]);
  tablas = { ventas: OK(VENTA), contrato_condiciones: OK(COND), config_cobros: OK({ pct_abono: 0.3 }) };
});

describe("R2-1 — an unreadable minimum source never produces a plan", () => {
  test("baseline: with every read healthy the plan is written once, 300.000 first, and the database receives the derived sources", async () => {
    const r = await generarPlanCobro("DTM-1", "mensual", {} as never);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(rpcs.length, 1);
    assert.equal(rpcs[0].fn, "reemplazar_plan_cobro");
    const filas = rpcs[0].args.p_filas as { tipo: string; monto: number }[];
    assert.equal(filas[0].monto, 300_000);
    assert.equal(filas.reduce((s, f) => s + f.monto, 0), 1_000_000);
    const f = rpcs[0].args.p_fuentes as Record<string, unknown>;
    assert.equal(f.pct_abono, 0.3, "the effective minimum percentage travels for the database to re-derive");
    assert.equal(f.moneda_efectiva, "COP");
    assert.equal(f.moneda, "COP");
    assert.ok("moneda_cobro" in f && "trm_cobro" in f, "currency inputs are part of the revalidated sources");
  });

  test("Codex's probe: contrato_condiciones read error → no plan, the database function is NEVER called", async () => {
    tablas.contrato_condiciones = FALLA("conditions unavailable");
    const r = await generarPlanCobro("DTM-1", "mensual", {} as never);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /condiciones de pago/);
    assert.equal(rpcs.length, 0, "no reemplazar_plan_cobro call, so the previous plan is untouched");
  });

  test("config_cobros read error (no frozen conditions) → no plan, no invented 30 %", async () => {
    tablas.contrato_condiciones = OK([]);
    tablas.config_cobros = FALLA("config unavailable");
    const r = await generarPlanCobro("DTM-1", "mensual", {} as never);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /porcentaje de abono/);
    assert.equal(rpcs.length, 0);
  });

  test("verified ABSENCE of a config row is not an error: the historical 30 % still applies (row missing, read succeeded)", async () => {
    tablas.contrato_condiciones = OK([]);
    tablas.config_cobros = OK(null);
    const r = await generarPlanCobro("DTM-1", "mensual", {} as never);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal((rpcs[0].args.p_filas as { monto: number }[])[0].monto, 300_000);
    assert.equal((rpcs[0].args.p_fuentes as { pct_abono: number }).pct_abono, 0.3);
  });

  test("an unreadable agreement and an unreadable payments table also stop before the database function (previous behaviour, still enforced)", async () => {
    acuerdo = { estado: "error", motivo: "x" };
    assert.equal((await generarPlanCobro("DTM-1", "mensual", {} as never)).ok, false);
    acuerdo = { estado: "ausente" };
    abonos = FALLA("abonos unavailable");
    assert.equal((await generarPlanCobro("DTM-1", "mensual", {} as never)).ok, false);
    assert.equal(rpcs.length, 0);
  });

  test("a stale-source rejection from the database is reported and writes nothing else", async () => {
    respuestaRpc = FALLA("PLAN_COBRO_FUENTES_CAMBIARON: x");
    const r = await generarPlanCobro("DTM-1", "mensual", {} as never);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /cambiaron/);
    assert.equal(rpcs.length, 1);
  });
});

describe("R2-1 — wiring and migration", () => {
  const leer = (p: string) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  test("the action no longer swallows a configuration error with a 30 % fallback", () => {
    const src = leer("app/(dashboard)/dashboard/contratos/[numero]/cobros-actions.ts");
    assert.ok(!src.includes("export async function pctAbonoDe"));
    assert.match(src, /if \(error\) return null/);
    assert.match(src, /errCond/);
  });
  test("migration 332 derives total/currency/minimum from the database and checks the sum against ITS total, not p_fuentes.total", () => {
    const sql = leer("supabase/migrations/20260601000332_correcciones_bloque_95.sql");
    assert.match(sql, /p75_priv\.regla_confirmacion\(p_numero\)/);
    assert.match(sql, /v_total := \(v_act->>'total'\)::numeric/);
    assert.ok(!/v_total := \(p_fuentes->>'total'\)::numeric/.test(sql));
    for (const k of ["moneda_efectiva", "pct_abono", "trm_cobro", "moneda_cobro"]) assert.ok(sql.includes(`'${k}'`), k);
  });
});
