import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { clasificarAgenciaSesion, resolverTenantActivo, resolverTenantEfectivo, type LecturaAgenciaSesion } from "../lib/tenant.ts";

// `next` y `server-only` no se resuelven en ESM plano fuera de Next (mismo truco que otras pruebas).
register(
  "data:text/javascript," +
    encodeURIComponent(
      'export async function resolve(s, c, n) { if (s === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }; if (s.startsWith("./") || s.startsWith("../")) { try { return await n(s, c); } catch (e) { return n(s + ".ts", c); } } return n(s === "next/headers" ? "next/headers.js" : s, c); }'
    ),
);

// #5 D8/D9: la agencia que MUESTRA la interfaz y la que usa una operación sensible deben ser la que la
// sesión AUTORIZA (sesion_agencia). Cuatro desenlaces de lectura: ausente / sin contexto / ok / error.
const sa = { rol: "superadmin", tenant: "mayorista" };
const ok = (tenant: "mayorista" | "minorista"): LecturaAgenciaSesion => ({ estado: "ok", tenant });

describe("clasificarAgenciaSesion — cuatro desenlaces distintos", () => {
  test("RPC ausente antes de desplegar la 237 (PGRST202 / 42883)", () => {
    assert.deepEqual(clasificarAgenciaSesion(null, { code: "PGRST202" }), { estado: "ausente" });
    assert.deepEqual(clasificarAgenciaSesion(null, { code: "42883" }), { estado: "ausente" });
  });
  test("respuesta válida sin contexto: null/undefined sin error", () => {
    assert.deepEqual(clasificarAgenciaSesion(null, null), { estado: "sin_contexto" });
    assert.deepEqual(clasificarAgenciaSesion(undefined, undefined), { estado: "sin_contexto" });
  });
  test("respuesta válida con agencia", () => {
    assert.deepEqual(clasificarAgenciaSesion("mayorista", null), ok("mayorista"));
    assert.deepEqual(clasificarAgenciaSesion("minorista", null), ok("minorista"));
  });
  test("error técnico: cualquier otro código, sin código, o una respuesta que no es una agencia", () => {
    for (const e of [{ code: "PGRST301" }, { code: "42501" }, { code: "08006" }, { code: "" }, {}, { code: null }]) {
      assert.deepEqual(clasificarAgenciaSesion(null, e), { estado: "error" }, JSON.stringify(e));
    }
    for (const d of ["otra", "", 7, true, {}, ["mayorista"]]) {
      assert.deepEqual(clasificarAgenciaSesion(d, null), { estado: "error" }, JSON.stringify(d));
    }
  });
  test("un error con datos presentes sigue siendo error (no se lee el dato)", () => {
    assert.deepEqual(clasificarAgenciaSesion("mayorista", { code: "XX000" }), { estado: "error" });
  });
});

describe("resolverTenantEfectivo", () => {
  test("superadmin: cookie Minorista y sesión Mayorista -> gana la sesión (desincronizada, verificada)", () => {
    assert.deepEqual(resolverTenantEfectivo(sa, "minorista", ok("mayorista")), { tenant: "mayorista", desincronizada: true, verificada: true });
    assert.deepEqual(resolverTenantEfectivo(sa, "mayorista", ok("minorista")), { tenant: "minorista", desincronizada: true, verificada: true });
  });
  test("superadmin: cookie y sesión coinciden", () => {
    assert.deepEqual(resolverTenantEfectivo(sa, "minorista", ok("minorista")), { tenant: "minorista", desincronizada: false, verificada: true });
  });
  test("superadmin: función ausente o sin contexto -> rige la regla de la cookie (compatibilidad), verificada", () => {
    for (const l of [{ estado: "ausente" }, { estado: "sin_contexto" }] as LecturaAgenciaSesion[]) {
      assert.deepEqual(resolverTenantEfectivo(sa, "minorista", l), { tenant: resolverTenantActivo(sa, "minorista"), desincronizada: false, verificada: true });
    }
  });
  test("superadmin: ERROR técnico -> la cookie solo es pista, NO verificada", () => {
    assert.deepEqual(resolverTenantEfectivo(sa, "minorista", { estado: "error" }), { tenant: "minorista", desincronizada: false, verificada: false });
    assert.deepEqual(resolverTenantEfectivo(sa, undefined, { estado: "error" }), { tenant: "mayorista", desincronizada: false, verificada: false });
  });
  test("roles que no son superadmin: la lectura no cambia nada (agencia fija por perfil), siempre verificada", () => {
    const ad = { rol: "administracion", tenant: "minorista" };
    for (const l of [ok("mayorista"), { estado: "error" }, null] as (LecturaAgenciaSesion | null)[]) {
      assert.deepEqual(resolverTenantEfectivo(ad, "mayorista", l), { tenant: "minorista", desincronizada: false, verificada: true });
    }
    assert.deepEqual(resolverTenantEfectivo(null, undefined, ok("minorista")), { tenant: "mayorista", desincronizada: false, verificada: true });
  });
});

// ── Integración con mocks: tenantContext, getTenant y contextoCrearContrato ───────────────────
type Rpc = { data: unknown; error: { code?: string; message?: string } | null };
let perfilFila: { rol: string; tenant: string; activo: boolean } | null = { rol: "superadmin", tenant: "mayorista", activo: true };
let cookieTenant: string | undefined = undefined;
let rpcAgencia: Rpc | "lanza" = { data: "mayorista", error: null };
const rpcLlamadas: string[] = [];

mock.module(new URL("../lib/supabase/server.ts", import.meta.url).href, {
  namedExports: {
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: perfilFila, error: null }) }) }) }),
      rpc: async (nombre: string) => {
        rpcLlamadas.push(nombre);
        if (nombre !== "agencia_activa_sesion") return { data: null, error: null };
        if (rpcAgencia === "lanza") throw new Error("red");
        return rpcAgencia;
      },
    }),
  },
});
mock.module("next/headers", {
  namedExports: { cookies: async () => ({ get: (n: string) => (n === "tenant" && cookieTenant ? { value: cookieTenant } : undefined) }) },
});

const { tenantContext, getTenant, AgenciaNoVerificadaError } = await import("../lib/tenant.server.ts");
const { contextoCrearContrato } = await import("../lib/contrato/contexto.ts");

beforeEach(() => {
  perfilFila = { rol: "superadmin", tenant: "mayorista", activo: true };
  cookieTenant = undefined; rpcAgencia = { data: "mayorista", error: null }; rpcLlamadas.length = 0;
});

describe("tenantContext y getTenant", () => {
  test("error técnico de la RPC: agenciaVerificada=false, lecturaAgencia='error' y getTenant() LANZA", async () => {
    cookieTenant = "minorista";
    rpcAgencia = { data: null, error: { code: "PGRST301", message: "jwt" } };
    const c = await tenantContext();
    assert.equal(c.agenciaVerificada, false);
    assert.equal(c.lecturaAgencia, "error");
    assert.equal(c.agenciaSesion, null);
    await assert.rejects(getTenant(), AgenciaNoVerificadaError);
  });
  test("la RPC lanza una excepción: tampoco se devuelve una agencia", async () => {
    rpcAgencia = "lanza";
    await assert.rejects(tenantContext());
  });
  test("RPC ausente (pre-237): verificada, rige la cookie, getTenant() funciona", async () => {
    cookieTenant = "minorista";
    rpcAgencia = { data: null, error: { code: "PGRST202" } };
    const c = await tenantContext();
    assert.deepEqual([c.agenciaVerificada, c.lecturaAgencia, c.tenant], [true, "ausente", "minorista"]);
    assert.equal(await getTenant(), "minorista");
  });
  test("respuesta válida sin contexto: verificada, rige la cookie", async () => {
    cookieTenant = "minorista";
    rpcAgencia = { data: null, error: null };
    const c = await tenantContext();
    assert.deepEqual([c.agenciaVerificada, c.lecturaAgencia, c.tenant], [true, "sin_contexto", "minorista"]);
  });
  test("respuesta ok con la cookie desalineada: muestra la de la sesión", async () => {
    cookieTenant = "minorista";
    const c = await tenantContext();
    assert.deepEqual([c.tenant, c.desincronizada, c.agenciaSesion], ["mayorista", true, "mayorista"]);
  });
  test("un rol que no es superadmin NO consulta la RPC", async () => {
    perfilFila = { rol: "administracion", tenant: "minorista", activo: true };
    cookieTenant = "mayorista";
    const c = await tenantContext();
    assert.deepEqual([c.tenant, c.agenciaVerificada, c.lecturaAgencia], ["minorista", true, null]);
    assert.deepEqual(rpcLlamadas, []);
  });
});

describe("contextoCrearContrato usa la misma agencia efectiva que el panel", () => {
  test("FALLO DOBLE (Minorista -> Mayorista): cookie quedó en Minorista, sesión en Mayorista -> panel y contrato apuntan a Mayorista", async () => {
    cookieTenant = "minorista";                       // la cookie no pudo escribirse ni restaurarse
    rpcAgencia = { data: "mayorista", error: null };  // la base quedó autorizando Mayorista
    const panel = await tenantContext();
    const contrato = await contextoCrearContrato("test", "f1");
    assert.equal(panel.tenant, "mayorista");
    assert.equal(contrato.ok, true);
    assert.equal((contrato as { tenant: string }).tenant, "mayorista");
    assert.equal(panel.tenant, (contrato as { tenant: string }).tenant);
  });
  test("error técnico al leer la agencia: se RECHAZA antes de numerar (tecnico) aunque la cookie diga Minorista", async () => {
    cookieTenant = "minorista";
    rpcAgencia = { data: null, error: { code: "PGRST301" } };
    const contrato = await contextoCrearContrato("test", "f2");
    assert.equal(contrato.ok, false);
    assert.equal((contrato as { tecnico?: boolean }).tecnico, true);
  });
  test("la RPC lanza: no se elige agencia (la creación no continúa)", async () => {
    cookieTenant = "minorista";
    rpcAgencia = "lanza";
    await assert.rejects(contextoCrearContrato("test", "f3"));
  });
  test("pre-237 (RPC ausente): conserva la regla de la cookie", async () => {
    cookieTenant = "minorista";
    rpcAgencia = { data: null, error: { code: "PGRST202" } };
    const c = await contextoCrearContrato("test", "f4");
    assert.equal(c.ok, true);
    assert.equal((c as { tenant: string }).tenant, "minorista");
  });
  test("sin contexto de sesión: conserva la regla de la cookie", async () => {
    cookieTenant = "minorista";
    rpcAgencia = { data: null, error: null };
    const c = await contextoCrearContrato("test", "f5");
    assert.equal((c as { tenant: string }).tenant, "minorista");
  });
  test("rol sin permiso sigue rechazado (autorización intacta)", async () => {
    perfilFila = { rol: "control_vuelo", tenant: "mayorista", activo: true };
    const c = await contextoCrearContrato("test", "f6");
    assert.equal(c.ok, false);
    assert.deepEqual(rpcLlamadas, []);
  });
  test("usuario inactivo sigue rechazado", async () => {
    perfilFila = { rol: "superadmin", tenant: "mayorista", activo: false };
    const c = await contextoCrearContrato("test", "f7");
    assert.equal(c.ok, false);
  });
  test("no superadmin (administracion): agencia de perfil, SIN consultar la RPC", async () => {
    perfilFila = { rol: "administracion", tenant: "minorista", activo: true };
    cookieTenant = "mayorista";
    const c = await contextoCrearContrato("test", "f8");
    assert.equal((c as { tenant: string }).tenant, "minorista");
    assert.deepEqual(rpcLlamadas, []);
  });
});

test("cableado: el panel avisa 'no verificada' y los usos directos de la cookie quedan acotados", () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  const leer = (r: string) => readFileSync(join(raiz, r), "utf8");
  assert.match(leer("app/(dashboard)/layout.tsx"), /!agenciaVerificada \? "no_verificada"/);
  assert.doesNotMatch(leer("app/(dashboard)/layout.tsx"), /rpc\("agencia_activa_sesion"\)/);
  assert.match(leer("lib/tenant.server.ts"), /clasificarAgenciaSesion\(data, error\)/);
  assert.match(leer("lib/contrato/contexto.ts"), /resolverTenantEfectivo/);
  assert.doesNotMatch(leer("lib/contrato/contexto.ts"), /resolverTenantActivo/);
});

// Usos directos de la cookie de agencia / de la regla sin base: lista CERRADA. Un archivo nuevo que lea
// COOKIE_TENANT o llame resolverTenantActivo reabre la divergencia cookie-vs-sesión y obliga a revisarlo aquí.
test("guarda: solo estos archivos leen la cookie de agencia o resuelven la agencia sin la base", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  const hallados: string[] = [];
  const sinComentarios = (t: string) => t.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(join(raiz, dir))) {
      if (nombre === "node_modules" || nombre === ".next") continue;
      const rel = `${dir}/${nombre}`;
      if (statSync(join(raiz, rel)).isDirectory()) recorrer(rel);
      else if (/\.(ts|tsx)$/.test(nombre) && /COOKIE_TENANT|resolverTenantActivo\(/.test(sinComentarios(readFileSync(join(raiz, rel), "utf8")))) hallados.push(rel);
    }
  };
  recorrer("app"); recorrer("lib");
  hallados.push(...(/COOKIE_TENANT/.test(readFileSync(join(raiz, "proxy.ts"), "utf8")) ? ["proxy.ts"] : []));
  assert.deepEqual(hallados.sort(), [
    "app/(dashboard)/tenant-actions.ts",   // ESCRIBE la cookie, solo tras mover la base
    "lib/contrato/contexto.ts",            // lee la cookie solo para combinarla con la base (resolverTenantEfectivo)
    "lib/auth/contextoAgencia.ts",         // elige la agencia INICIAL al autenticar (crea la autoridad) y arma el mensaje de error
    "lib/tenant.server.ts",                // lectura combinada con la base (resolverTenantEfectivo)
    "lib/tenant.ts",                       // definiciones puras
    "proxy.ts",                            // solo oculta módulos de Minorista (bloquea, no autoriza)
  ].sort());
});
