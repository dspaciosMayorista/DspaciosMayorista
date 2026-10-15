// #44 / K15 · migración 210 — trayecto REAL por HTTP contra PostgreSQL:
//   lib/reservar/financieroContrato.ts (orquestador REAL, sin simulaciones) → PostgREST propio →
//   registrar_financiero_contrato / revertir_contrato_incompleto / contrato_financiero_pendiente,
//   más los permisos efectivos por rol (anon / authenticated / service_role) y por agencia.
//
// SOLO base LOCAL desechable. No corre en `npm run test:*`: la lanza
// supabase/scripts/test_210_app_rpc.sh, que crea la base (001–205 + 207 + 210), levanta un
// PostgREST propio y lo borra todo al final. Nada aquí habla con Supabase remoto.
//
// Las dependencias de efectos contables (postearAsiento / eliminarAsiento) son contadores: lo que se
// prueba aquí es QUÉ decide la aplicación frente a las respuestas reales de la base. Los asientos
// reales (índice único) se prueban en SQL (test_210_financiero_contrato.sql, E1–E3; carrera R9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  registrarFinancieroContrato, revertirContratoIncompleto,
  type CxPFinanciera, type DepsFinanciero,
} from "../lib/reservar/financieroContrato.ts";

const CT = process.env.PG210_CONTENEDOR ?? "pg206b_eb3bbf43";
const DB = process.env.PG210_BASE ?? "";
const PGRST = process.env.PG210_POSTGREST ?? "";
const SECRETO = process.env.PG210_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) {
  throw new Error("Faltan PG210_BASE (desechable), PG210_POSTGREST y PG210_JWT_SECRET: usa supabase/scripts/test_210_app_rpc.sh.");
}

// ── JWT (HS256) con el secreto del PostgREST local ────────────────────────
const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const TOKENS = {
  service: jwt({ role: "service_role" }),
  anon: jwt({ role: "anon" }),
  auth: jwt({ role: "authenticated", sub: "00000000-0000-0000-0000-000000210099" }),
};

// ── SQL directo (superusuario del contenedor) para sembrar y comprobar ────
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: q, encoding: "utf8" }).trim();
}
let consecutivo = 0;
function contrato(estado: "pendiente" | "completo" = "pendiente", tenant = "mayorista"): string {
  const n = `${tenant === "minorista" ? "MIN" : "DTM"}-2104${String(++consecutivo).padStart(2, "0")}`;
  sql(`insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado) values ('${n}', 'C', '${tenant}', 3000000, 'activo', '${estado}')`);
  return n;
}
const foto = (n: string) => sql(`select coalesce((select financiero_estado || '/reg=' || (financiero_registrado_en is not null) from public.ventas where numero_contrato = '${n}'), 'sin-venta')
  || ' cxp=' || (select count(*) from public.cuentas_por_pagar where numero_contrato = '${n}')
  || ' ids=' || coalesce((select string_agg(id::text, ',' order by id) from public.cuentas_por_pagar where numero_contrato = '${n}'), '-')
  || ' pend=' || (select count(*) from public.contrato_financiero_pendiente where numero_contrato = '${n}')`);

// ── HTTP hacia PostgREST ──────────────────────────────────────────────────
async function http(token: string, metodo: string, ruta: string, cuerpo?: unknown, extra: Record<string, string> = {}) {
  const r = await fetch(`${PGRST}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extra },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json: unknown = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* sin cuerpo JSON */ }
  return { status: r.status, json: json as { code?: string; message?: string } | unknown, texto };
}

// Dependencias REALES del orquestador (RPC y payload pendiente por PostgREST con service_role).
type Contadores = { post: number[]; borrar: number[]; llamadas: string[] };
function deps(opciones: { perderRespuestaDe?: string } = {}): { d: DepsFinanciero; c: Contadores } {
  const c: Contadores = { post: [], borrar: [], llamadas: [] };
  const d: DepsFinanciero = {
    rpc: async (fn, args) => {
      c.llamadas.push(fn);
      const r = await http(TOKENS.service, "POST", `/rpc/${fn}`, args);
      if (r.status >= 400) {
        const e = r.json as { message?: string; code?: string };
        return { data: null, error: { message: e?.message ?? r.texto } };
      }
      // La RPC YA confirmó en la base, pero la respuesta "no llega" (corte de red, proceso que muere).
      if (opciones.perderRespuestaDe === fn) return { data: null, error: { message: "fetch failed" } };
      return { data: r.json, error: null };
    },
    postearAsiento: async (x) => { c.post.push(x.id); return { ok: true }; },
    eliminarAsiento: async (id) => { c.borrar.push(id); },
    guardarPendiente: async (p) => {
      const r = await http(TOKENS.service, "POST", "/contrato_financiero_pendiente?on_conflict=numero_contrato",
        { numero_contrato: p.numeroContrato, tenant: p.tenant, costos: p.costos, cxp: p.cxp },
        { Prefer: "resolution=merge-duplicates,return=minimal" });
      return r.status >= 400 ? { ok: false, error: r.texto } : { ok: true };
    },
  };
  return { d, c };
}
const cxp = (servicio: string, valor = 100000, tipo = "hotel"): CxPFinanciera => ({
  proveedor: "Proveedor X", tipo_proveedor: tipo, servicio, valor_total: valor, fecha_obligacion: "2026-10-01",
  aplica_retencion: false, pct_retencion: 0, observaciones: "Generado automáticamente desde el tarifario", servicio_id: null,
});
const params = (n: string, extra: Partial<{ cxp: CxPFinanciera[] }> = {}) =>
  ({ numeroContrato: n, tenant: "mayorista", costos: { costo_hotel: 100000 }, cxp: extra.cxp ?? [cxp("Alojamiento"), cxp("Tiquete", 50000, "aereo")], fecha: "2026-10-01" });

test("T1 primera escritura por HTTP: completa el contrato; sin residuo del pendiente", async (t) => {
  const n = contrato();
  const { d, c } = deps();
  const r = await registrarFinancieroContrato(d, params(n));
  t.diagnostic(`resultado: ${JSON.stringify(r)} · ${foto(n)}`);
  assert.equal(r.ok, true);
  assert.match(foto(n), /^completo\/reg=true cxp=2 ids=\d+,\d+ pend=0$/);
  assert.equal(c.post.length, 2, "un asiento por CxP creada");
  assert.deepEqual(c.borrar, []);
});

test("T2 reentrada: la misma escritura otra vez es un no-op (ids de CxP intactos, sin asientos movidos, sin residuo)", async (t) => {
  const n = contrato();
  const a = deps();
  assert.equal((await registrarFinancieroContrato(a.d, params(n))).ok, true);
  const antes = foto(n);
  const b = deps();
  const r = await registrarFinancieroContrato(b.d, params(n));
  t.diagnostic(`antes: ${antes} · resultado: ${JSON.stringify(r)} · después: ${foto(n)}`);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.yaCompleto, true);
  assert.equal(foto(n), antes, "íntegro: mismos ids de CxP, pend=0");
  assert.deepEqual(b.c.post, [], "no se postea ningún asiento");
  assert.deepEqual(b.c.borrar, [], "no se borra ningún asiento");
  assert.ok(!b.c.llamadas.includes("revertir_contrato_incompleto"), "no hay compensación");
});

test("T3 respuesta perdida: la RPC confirmó pero el proceso no lo supo → la compensación NO borra el contrato", async (t) => {
  const n = contrato();
  const { d, c } = deps({ perderRespuestaDe: "registrar_financiero_contrato" });
  const r = await registrarFinancieroContrato(d, params(n));
  t.diagnostic(`resultado: ${JSON.stringify(r)} · ${foto(n)}`);
  assert.equal(r.ok, true, "el dinero quedó escrito: no es un fallo");
  assert.equal(r.ok && r.yaCompleto, true);
  assert.match(foto(n), /^completo\/reg=true cxp=2 .* pend=0$/, "contrato y CxP conservados, sin residuo");
  assert.deepEqual(c.borrar, []);
  assert.deepEqual(c.llamadas, ["registrar_financiero_contrato", "revertir_contrato_incompleto"], "intentó compensar y la base dijo ya_completo");
});

test("T4 error genuino de la RPC (valor negativo) con el contrato pendiente: se revierte como siempre", async (t) => {
  const n = contrato();
  const { d } = deps();
  const r = await registrarFinancieroContrato(d, params(n, { cxp: [cxp("Alojamiento", -5)] }));
  t.diagnostic(`resultado: ${JSON.stringify(r)} · ${foto(n)}`);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.revertido, true);
  assert.equal(foto(n), "sin-venta cxp=0 ids=- pend=0");
});

test("T5 doble proceso simultáneo sobre el mismo contrato: una sola serie de CxP, un solo juego de asientos, sin residuo", async (t) => {
  const n = contrato();
  const a = deps(), b = deps();
  const [ra, rb] = await Promise.all([registrarFinancieroContrato(a.d, params(n)), registrarFinancieroContrato(b.d, params(n))]);
  t.diagnostic(`a: ${JSON.stringify(ra)} · b: ${JSON.stringify(rb)} · ${foto(n)}`);
  assert.equal(ra.ok && rb.ok, true);
  assert.match(foto(n), /^completo\/reg=true cxp=2 .* pend=0$/);
  assert.equal(a.c.post.length + b.c.post.length, 2, "los asientos se postean una sola vez entre los dos procesos");
  assert.deepEqual([...a.c.borrar, ...b.c.borrar], []);
  assert.equal([ra, rb].filter((r) => r.ok && r.yaCompleto).length, 1, "exactamente uno fue la reentrada");
});

test("T6 compensación directa sobre un contrato completo por la RPC: ya_completo (no lo borra)", async () => {
  const n = contrato();
  assert.equal((await registrarFinancieroContrato(deps().d, params(n))).ok, true);
  const antes = foto(n);
  const r = await revertirContratoIncompleto(deps().d, n, "mayorista");
  assert.equal(r.ok, false);
  assert.equal(r.completado, true);
  assert.equal(foto(n), antes);
});

test("T7 contrato completo por DEFECTO (flujo manual de main, sin marca): la compensación lo revierte como siempre", async () => {
  const n = contrato("completo");
  const r = await revertirContratoIncompleto(deps().d, n, "mayorista");
  assert.equal(r.ok, true);
  assert.equal(foto(n), "sin-venta cxp=0 ids=- pend=0");
});

test("T8 payload pendiente de un contrato ya completo (upsert de un segundo proceso): se descarta, sin residuo y sin error", async () => {
  const n = contrato();
  assert.equal((await registrarFinancieroContrato(deps().d, params(n))).ok, true);
  const r = await deps().d.guardarPendiente({ numeroContrato: n, tenant: "mayorista", costos: { costo_hotel: 1 }, cxp: [cxp("X")] });
  assert.equal(r.ok, true);
  assert.match(foto(n), /pend=0$/);
});

// ── Permisos efectivos por HTTP ───────────────────────────────────────────
const ARGS_REG = (n: string) => ({ p_numero_contrato: n, p_tenant: "mayorista", p_costos: {}, p_cxp: [] });
const ARGS_REV = (n: string) => ({ p_numero_contrato: n, p_tenant: "mayorista" });

test("P1 llamada directa a las RPC: anon y authenticated rechazados (42501) sin efecto; service_role permitido", async (t) => {
  const n = contrato();
  const antes = foto(n);
  const filas: string[] = [];
  for (const [quien, token] of [["anon", TOKENS.anon], ["authenticated", TOKENS.auth]] as const) {
    for (const [fn, args] of [["registrar_financiero_contrato", ARGS_REG(n)], ["revertir_contrato_incompleto", ARGS_REV(n)]] as const) {
      const r = await http(token, "POST", `/rpc/${fn}`, args);
      filas.push(`${quien} ${fn}: HTTP ${r.status} ${(r.json as { code?: string })?.code}`);
      assert.ok(r.status === 401 || r.status === 403, `${quien} ${fn}: ${r.status}`);
      assert.equal((r.json as { code?: string })?.code, "42501");
    }
  }
  t.diagnostic(filas.join(" | "));
  assert.equal(foto(n), antes, "los rechazos no escriben");
  const ok = await http(TOKENS.service, "POST", "/rpc/registrar_financiero_contrato", ARGS_REG(n));
  assert.equal(ok.status, 200);
  assert.match(foto(n), /^completo\/reg=true cxp=0 /);
});

test("P2 contrato_financiero_pendiente: authenticated y anon no ven filas ni escriben (RLS sin policies) y responden IGUAL con un contrato pendiente o completo", async () => {
  const pendiente = contrato();
  const completo = contrato();
  assert.equal((await registrarFinancieroContrato(deps().d, params(completo))).ok, true);
  // Una fila real que ellos NO deben ver (sembrada como dueño).
  sql(`insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values ('${pendiente}', 'mayorista', '{}', '[]')`);
  const respuestas: string[] = [];
  for (const [quien, token] of [["anon", TOKENS.anon], ["authenticated", TOKENS.auth]] as const) {
    const lee = await http(token, "GET", "/contrato_financiero_pendiente?select=numero_contrato");
    // Supabase concede SELECT a estos roles; la RLS (sin policies) deja 0 filas visibles. anon puede recibir 401.
    assert.ok((lee.status === 200 && Array.isArray(lee.json) && lee.json.length === 0) || lee.status === 401 || lee.status === 403, `${quien} lectura ${lee.status} ${lee.texto.slice(0, 80)}`);
    const codigos: string[] = [];
    for (const n of [pendiente, completo]) {
      const escribe = await http(token, "POST", "/contrato_financiero_pendiente", { numero_contrato: n, tenant: "mayorista", costos: {}, cxp: [] }, { Prefer: "return=minimal" });
      assert.ok(escribe.status === 401 || escribe.status === 403, `${quien} escritura ${escribe.status}`);
      codigos.push(`${escribe.status}/${(escribe.json as { code?: string })?.code}`);
    }
    assert.equal(codigos[0], codigos[1], `${quien}: pendiente y completo responden distinto (${codigos.join(" vs ")}): se filtraría el estado`);
    respuestas.push(`${quien}: lectura ${lee.status}, escritura ${codigos[0]}`);
  }
  assert.equal(sql(`select count(*) from public.contrato_financiero_pendiente where numero_contrato = '${completo}'`), "0");
  assert.equal(sql(`select count(*) from public.contrato_financiero_pendiente where numero_contrato = '${pendiente}'`), "1", "la fila del dueño sigue ahí, intacta");
});

test("P3 aislamiento entre agencias: la RPC y la compensación con la agencia equivocada no tocan el contrato", async (t) => {
  const n = contrato("pendiente", "minorista");
  const antes = foto(n);
  const reg = await http(TOKENS.service, "POST", "/rpc/registrar_financiero_contrato", { ...ARGS_REG(n), p_tenant: "mayorista" });
  assert.equal(reg.status, 400);
  assert.match((reg.json as { message?: string }).message ?? "", /no existe en la agencia mayorista/);
  const rev = await http(TOKENS.service, "POST", "/rpc/revertir_contrato_incompleto", { ...ARGS_REV(n), p_tenant: "mayorista" });
  assert.equal(rev.status, 200);
  assert.deepEqual(rev.json, { estado: "no_existe" });
  t.diagnostic(`antes: ${antes} · después: ${foto(n)}`);
  assert.equal(foto(n), antes, "el contrato minorista sigue intacto");
  // Con su agencia, sí.
  const ok = await http(TOKENS.service, "POST", "/rpc/registrar_financiero_contrato", { ...ARGS_REG(n), p_tenant: "minorista", p_cxp: [cxp("Alojamiento")] });
  assert.equal(ok.status, 200);
  assert.equal(sql(`select tenant from public.cuentas_por_pagar where numero_contrato = '${n}'`), "minorista");
});

test("P4 compensación por HTTP: devuelve jsonb {estado} (revertido / ya_completo / no_existe)", async () => {
  const pendiente = contrato();
  assert.deepEqual((await http(TOKENS.service, "POST", "/rpc/revertir_contrato_incompleto", ARGS_REV(pendiente))).json, { estado: "revertido" });
  const completo = contrato();
  await http(TOKENS.service, "POST", "/rpc/registrar_financiero_contrato", ARGS_REG(completo));
  assert.deepEqual((await http(TOKENS.service, "POST", "/rpc/revertir_contrato_incompleto", ARGS_REV(completo))).json, { estado: "ya_completo" });
  assert.deepEqual((await http(TOKENS.service, "POST", "/rpc/revertir_contrato_incompleto", ARGS_REV("DTM-299999"))).json, { estado: "no_existe" });
});
